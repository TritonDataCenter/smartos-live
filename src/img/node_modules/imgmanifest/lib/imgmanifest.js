/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * A node.js module for working with SmartDataCenter Image manifests.
 * An 'image manifest' is an object that describes the metadata for a
 * SmartDataCenter Image.
 */

var warn = console.warn;
var path = require('path');
var format = require('util').format;
var assert = require('assert-plus');


// ---- globals

// Current latest image manifest spec version.
var V = 2;



// ---- internal support stuff

// Courtesy of <http://stackoverflow.com/a/12826757/122384>.
function deepObjCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function assertUuid(uuid, name) {
    if (!UUID_RE.test(uuid)) {
        throw new assert.AssertionError({
            message: format('uuid (%s) is required: "%s"', name, uuid)
        });
    }
}




// ---- upgraders

/**
 * Upgrade this manifest from v=1 (aka v=undefined) to v=2.
 */
function upgradeTo2(oldManifest) {
    assert.object(oldManifest, 'oldManifest');
    assertUuid(oldManifest.uuid, 'oldManifest.uuid');
    assert.ok(oldManifest.creator_uuid,
        format('old DSAPI manifest does not have a "creator_uuid": %s',
               oldManifest));

    var manifest = deepObjCopy(oldManifest);

    if (manifest.creator_uuid) {
        assert.ok(manifest.owner === undefined,
            'manifest.owner && manifest.creator_uuid');
        manifest.owner = manifest.creator_uuid;
    }
    delete manifest.creator_uuid;
    delete manifest.vendor_uuid;
    delete manifest.creator_name;
    delete manifest.cloud_name;

    // Bogus field in some datasets.joyent.com/datasets (DATASET-629).
    delete manifest.creator_admin;

    if (manifest.restricted_to_uuid) {
        assert.ok(manifest.public === undefined,
            'manifest.restricted_to_uuid && manifest.public');
        manifest.public = false;
        manifest.acl = [manifest.restricted_to_uuid];
    } else {
        manifest.public = true;
    }
    delete manifest.restricted_to_uuid;
    delete manifest.owner_uuid;

    manifest.disabled = (manifest.disabled === undefined
        ? false : Boolean(manifest.disabled));
    manifest.state = (manifest.disabled ? 'disabled' : 'active');

    if (!manifest.published_at && manifest.created_at) {
        manifest.published_at = manifest.created_at;
    }
    // published_at: YYYY-MM-DDTHH:MMZ -> YYYY-MM-DDTHH:MM:SSZ
    // (IMGAPI is being more picky about the date format.)
    var no_secs = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z/;
    if (manifest.published_at && no_secs.test(manifest.published_at)) {
        manifest.published_at = manifest.published_at.slice(0, -1) + ':00Z';
    }

    // Files: drop 'path', drop 'url' (not sure if needed for DSAPI import),
    // add 'compression'.
    if (manifest.files) {
        manifest.files.forEach(function (file) {
            if (!file.compression) {
                file.compression = {
                    '.gz': 'gzip',
                    '.bz2': 'bzip2'
                }[path.extname(file.path || file.url)] || 'none';
            }
            delete file.path;
            delete file.url;
        });
    }

    // IMGAPI-104: image_size should be a number
    if (manifest.image_size) {
        manifest.image_size = Number(manifest.image_size);
    }

    // Deprecated long ago, now dropped.
    delete manifest.platform_type;
    delete manifest.created_at;
    delete manifest.updated_at;

    // Drop possible old imgadm (pre v2) stashed data.
    delete manifest._url;

    manifest.v = 2;
    return manifest;
}


var upgraders = [
    [2, upgradeTo2]
];
var highestUpV = upgraders[upgraders.length - 1][0];



// ---- exports

/**
 * Upgrade the given manifest.
 *
 * @param manifest {Object}
 * @returns {Object} The upgraded manifest
 * @throws {Error} If the manifest could not be upgraded.
 */
function upgradeManifest(oldManifest) {
    var currV;
    if (!oldManifest.v && oldManifest.creator_uuid) {
        // `creator_uuid` is a v1-only manifest field, removed in v2.
        currV = 1;
    } else if (!oldManifest.v) {
        throw new Error('manifest does not have a "v" field');
    } else {
        currV = Number(oldManifest.v);
    }

    if (currV >= V) {
        return oldManifest;
    }

    // Find start index in `upgraders`.
    var i, v, idx;
    for (i = 0; i < upgraders.length; i++) {
        v = upgraders[i][0];
        if (v > currV) {
            idx = i;
            break;
        }
    }
    assert.ok(idx !== undefined);

    var manifest = oldManifest;
    var todos = upgraders.slice(idx);
    for (i = 0; i < todos.length; i++) {
        var upgrader = todos[i][1];
        // log.debug('upgrade to %s', v);
        manifest = upgrader(manifest);
    }

    return manifest;
}


/**
 * ---- validation
 *
 * There are multiple separate validation cases:
 * - In a 'dc' mode IMGAPI (e.g. in SDC).
 *      validateDcManifest
 * - In a 'public' mode IMGAPI (e.g. https://images.joyent.com).
 *      validatePublicManifest
 * - In a 'private' mode IMGAPI.
 *      validatePrivateManifest
 * - Minimal requirements for a image manifest, say, from 'imgadm create'.
 *      validateMinimalManifest
 *
 * All of these expect to be validating a manifest upgrade to the latest
 * version.
 */

/**
 * Validate a minimal manifest, e.g. as created by 'imgadm create'. This is
 * all that `imgadm install/import` requires for installing an image.
 *
 * @param manifest {Object} The manifest to validate.
 * @returns {Array} An array of error objects, if any, else null.
 */
function validateMinimalManifest(manifest) {
    var requiredFields = [
        'v',
        'uuid',
        'name',
        'version',
        'type',
        'os'
    ];
    return validateFields(manifest, requiredFields);
}


var validators = {
    v: function validateV(manifest) {
        var errs = [];
        if (!manifest.v) {
            errs.push({field: 'v', code: 'MissingParameter'});
        } else {
            var v = Number(manifest.v);
            if (isNaN(v) || v < 0) {
                errs.push({
                    field: 'v',
                    code: 'Invalid',
                    message: '"v" must be a positive integer'
                });
            }
        }
        return errs;
    },

    uuid: function validateUuid(manifest) {
        var errs = [];
        if (!manifest.uuid) {
            errs.push({field: 'uuid', code: 'MissingParameter'});
        } else if (! UUID_RE.test(manifest.uuid)) {
            errs.push({field: 'uuid', code: 'Invalid'});
        }
        return errs;
    },

    name: function validateName(manifest) {
        var errs = [];
        if (!manifest.name) {
            errs.push({field: 'name', code: 'MissingParameter'});
        } else if (manifest.name.length > 512) {
            errs.push({
                field: 'name',
                code: 'Invalid',
                message: 'image name is too long, max 512 characters'
            });
        }
        return errs;
    },

    version: function validateVersion(manifest) {
        var errs = [];
        if (!manifest.version) {
            errs.push({field: 'version', code: 'MissingParameter'});
        } else if (manifest.version.length > 128) {
            errs.push({
                field: 'version',
                code: 'Invalid',
                message: 'image version is too long, max 128 characters'
            });
        }
        return errs;
    },

    description: function validateDescription(manifest) {
        var errs = [];
        if (manifest.description && manifest.description.length > 512) {
            errs.push({
                field: 'description',
                code: 'Invalid',
                message: 'image description is too long, max 512 characters'
            });
        }
        return errs;
    },

    type: function validateType(manifest) {
        var errs = [];
        var VALID_TYPES = {
            'zone-dataset': true,
            'zvol': true
        };
        if (manifest.type === undefined) {
            errs.push({field: 'type', code: 'MissingParameter'});
        } else if (VALID_TYPES[manifest.type] === undefined) {
            errs.push({
                field: 'type',
                code: 'Invalid',
                message: format('invalid image type, "%s", must be one of: %s',
                    manifest.type, Object.keys(VALID_TYPES).join(', '))
            });
        }
        return errs;
    },

    os: function validateOs(manifest) {
        var errs = [];
        var VALID_OSES = {
            'smartos': true,
            'linux': true,
            'windows': true,
            'bsd': true,
            'illumos': true,
            'other': true
        };
        if (manifest.os === undefined) {
            errs.push({field: 'os', code: 'MissingParameter'});
        } else if (VALID_OSES[manifest.os] === undefined) {
            errs.push({
                field: 'os',
                code: 'Invalid',
                message: format('invalid image os, "%s", must be one of: %s',
                    manifest.os, Object.keys(VALID_OSES).join(', '))
            });
        }
        return errs;
    }

    // TODO: nic_driver, disk_driver, cpu_type, image_size
    // TODO: state, disabled, public, published_at, files
    // TODO: homepage, icon, acl, requirements.*, users, tags
    // TODO: generate_passwords, inherited_directories
    // TODO: billing_tags, traits
    //
    // FIELD: function validateFIELD(manifest) {
    //     var errs = [];
    //     ...
    //     return errs;
    // },
};

function validateFields(manifest, requiredFields) {
    assert.object(manifest, 'manifest');
    assert.arrayOfString(requiredFields, 'requiredFields');

    var errs = []; // validation errors

    requiredFields.forEach(function (field) {
        validators[field](manifest).forEach(function (err) {
            errs.push(err);
        });
    });

    // TODO validate the rest of the fields (optional)

    // TODO error on additional fields

    return errs.length ? errs : null;
}





// ---- exports

module.exports = {
    V: V,
    upgradeManifest: upgradeManifest,
    validateMinimalManifest: validateMinimalManifest
};
