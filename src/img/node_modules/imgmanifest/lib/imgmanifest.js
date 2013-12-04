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
var url = require('url');
var assert = require('assert-plus');


// ---- globals

// Current latest image manifest spec version.
var V = 2;

// Regexes
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var NAME_RE = /^[A-Za-z0-9._/ -]+$/;
var VERSION_RE = /^[A-Za-z0-9._/-]+$/;
// published_at (ISO 8601 date string, e.g. "2012-12-25T12:00:00.123Z")
// Required if activated.
var PUBLISHED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

// Maximum values
var MAX_URL_LENGTH = 128;
var MAX_NAME_LENGTH = 512;
var MAX_VERSION_LENGTH = 128;
var MAX_DESCRIPTION_LENGTH = 512;
var MAX_BILLING_TAG_LENGTH = 128;
var MAX_TAGS_LENGTH = 10 * 1024; // (10K)


// ---- internal support stuff

function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}

// Courtesy of <http://stackoverflow.com/a/12826757/122384>.
function deepObjCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function assertUuid(uuid, name) {
    if (!UUID_RE.test(uuid)) {
        throw new assert.AssertionError({
            message: format('uuid (%s) is required: "%s"', name, uuid)
        });
    }
}

/**
 * Convert a boolean or string representation (as in redis or UFDS or a
 * query param) into a boolean, or raise TypeError trying.
 *
 * @param value {Boolean|String} The input value to convert.
 * @param default_ {Boolean} The default value is `value` is undefined.
 * @param errName {String} The variable name to quote in the possibly
 *      raised TypeError.
 */
function boolFromString(value, default_, errName) {
    if (value === undefined) {
        return default_;
    } else if (value === 'false') {
        return false;
    } else if (value === 'true') {
        return true;
    } else if (typeof (value) === 'boolean') {
        return value;
    } else {
        throw new TypeError(
            format('invalid value for "%s": %j', errName, value));
    }
}

function isPositiveInteger(n) {
    return typeof (n) === 'number' && n % 1 === 0;
}

/**
 * TODO: this must be a regex
 * Validates that a platform string has the following format:
 *
 * YYYYMMDDTHHMMSSZ
 */
function validPlatformVersion(string) {
    var MIN_YEAR = 2012;

    // 20130308T102805Z
    if (string.length !== 16) {
        return false;
    // 2013
    } else if (Number(string.substr(0, 4)) < MIN_YEAR) {
        return false;
    // 03
    } else if (Number(string.substr(4, 2)) > 12 ||
        Number(string.substr(4, 2)) === 0) {
        return false;
    // 08
    } else if (Number(string.substr(6, 2)) > 31 ||
        Number(string.substr(6, 2)) === 0) {
        return false;
    // T
    } else if (string.substr(8, 1) !== 'T') {
        return false;
    // 10
    } else if (Number(string.substr(9, 2)) > 23) {
        return false;
    // 28
    } else if (Number(string.substr(11, 2)) > 59) {
        return false;
    // 05
    } else if (Number(string.substr(13, 2)) > 59) {
        return false;
    // Z
    } else if (string.substr(15, 1) !== 'Z') {
        return false;
    }

    return true;
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


/**
 * Validate a datacenter manifest. Datacenter images are 'regular' images. They
 * only differ with public and private images in the value of the public field
 * and the mode the Images API has been configured to function.
 *
 * @param manifest {Object} The manifest to validate.
 * @returns {Array} An array of error objects, if any, else null.
 */
function validateDcManifest(manifest) {
    var requiredFields = [
        'v',
        'uuid',
        'owner',
        'name',
        'version',
        'disabled',
        'activated',
        'published_at',
        'state',
        'type',
        'os',
        'files',
        'nic_driver',
        'disk_driver',
        'cpu_type',
        'image_size'
    ];
    return validateFields(manifest, requiredFields, { mode: 'dc' });
}


/**
 * Validate a public manifest. Mode 'public' is passed to validateFields
 *
 * @param manifest {Object} The manifest to validate.
 * @returns {Array} An array of error objects, if any, else null.
 */
function validatePublicManifest(manifest) {
    var requiredFields = [
        'v',
        'uuid',
        'owner',
        'name',
        'version',
        'disabled',
        'activated',
        'published_at',
        'state',
        'type',
        'os',
        'files',
        'nic_driver',
        'disk_driver',
        'cpu_type',
        'image_size'
    ];
    return validateFields(manifest, requiredFields, { mode: 'public' });
}


/**
 * Validate a private manifest. Mode 'private' is passed to validateFields
 *
 * @param manifest {Object} The manifest to validate.
 * @returns {Array} An array of error objects, if any, else null.
 */
function validatePrivateManifest(manifest) {
    var requiredFields = [
        'v',
        'uuid',
        'owner',
        'name',
        'version',
        'disabled',
        'activated',
        'published_at',
        'state',
        'type',
        'os',
        'files',
        'nic_driver',
        'disk_driver',
        'cpu_type',
        'image_size'
    ];
    return validateFields(manifest, requiredFields, { mode: 'private' });
}


var fields = [
    {
        name: 'v',
        mutable: false

    },
    {
        name: 'uuid',
        mutable: false
    },
    {
        name: 'owner',
        mutable: false
    },
    {
        name: 'name',
        mutable: false
    },
    {
        name: 'version',
        mutable: false
    },
    {
        name: 'description',
        mutable: true
    },
    {
        name: 'homepage',
        mutable: true
    },
    {
        name: 'eula',
        mutable: true
    },
    {
        name: 'disabled',
        mutable: false
    },
    {
        name: 'activated',
        mutable: false
    },
    {
        name: 'published_at',
        mutable: false
    },
    {
        name: 'state',
        mutable: false
    },
    {
        name: 'public',
        mutable: true
    },
    {
        name: 'type',
        inheritable: true,
        mutable: false
    },
    {
        name: 'os',
        inheritable: true,
        mutable: true
    },
    {
        name: 'origin',
        mutable: false
    },
    {
        name: 'error',
        mutable: false
    },
    {
        name: 'files',
        mutable: false
    },
    {
        name: 'icon',
        mutable: false
    },
    {
        name: 'acl',
        mutable: true
    },
    {
        name: 'requirements',
        inheritable: true,
        mutable: true
    },
    {
        name: 'users',
        inheritable: true,
        mutable: true
    },
    {
        name: 'billing_tags',
        inheritable: true,
        mutable: true
    },
    {
        name: 'traits',
        inheritable: true,
        mutable: true
    },
    {
        name: 'tags',
        mutable: true
    },
    {
        name: 'generate_passwords',
        inheritable: true,
        mutable: true
    },
    {
        name: 'inherited_directories',
        inheritable: true,
        mutable: true
    },
    {
        name: 'nic_driver',
        inheritable: true,
        mutable: true
    },
    {
        name: 'disk_driver',
        inheritable: true,
        mutable: true
    },
    {
        name: 'cpu_type',
        inheritable: true,
        mutable: true
    },
    {
        name: 'image_size',
        inheritable: true,
        mutable: true
    }
];

var validators = {
    v: function validateV(manifest) {
        var errs = [];
        if (manifest.v === undefined) {
            errs.push({ field: 'v', code: 'MissingParameter' });
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
        if (manifest.uuid === undefined) {
            errs.push({ field: 'uuid', code: 'MissingParameter' });
        } else if (! UUID_RE.test(manifest.uuid)) {
            errs.push({field: 'uuid', code: 'Invalid'});
        }
        return errs;
    },

    owner: function validateOwner(manifest) {
        var errs = [];
        if (manifest.owner === undefined) {
            errs.push({ field: 'owner', code: 'MissingParameter' });
        } else if (! UUID_RE.test(manifest.owner)) {
            errs.push({field: 'owner', code: 'Invalid'});
        }
        return errs;
    },

    name: function validateName(manifest) {
        var errs = [];
        if (manifest.name === undefined) {
            errs.push({ field: 'name', code: 'MissingParameter' });
        } else if (manifest.name.length > MAX_NAME_LENGTH) {
            errs.push({
                field: 'name',
                code: 'Invalid',
                message: 'image name is too long, max ' + MAX_NAME_LENGTH +
                ' characters'
            });
        } else if (!NAME_RE.test(manifest.name)) {
            errs.push({
                field: 'name',
                code: 'Invalid',
                message: 'image name has invalid characters (only alpha-' +
                    'numeric characters and " ", ".", "-", "_" and "/" are ' +
                    'allowed)'
            });
        }
        return errs;
    },

    version: function validateVersion(manifest) {
        var errs = [];
        if (manifest.version === undefined) {
            errs.push({ field: 'version', code: 'MissingParameter' });
        } else if (manifest.version.length > MAX_VERSION_LENGTH) {
            errs.push({
                field: 'version',
                code: 'Invalid',
                message: 'image version is too long, max ' +
                MAX_VERSION_LENGTH + ' characters'
            });
        } else if (!VERSION_RE.test(manifest.version)) {
            errs.push({
                field: 'version',
                code: 'Invalid',
                message: 'image version has invalid characters (only alpha-' +
                    'numeric characters and ".", "-", "_" and "/" are allowed)'
            });
        }
        return errs;
    },

    description: function validateDescription(manifest) {
        var errs = [];
        if (manifest.description === undefined) {
            errs.push({ field: 'description', code: 'MissingParameter' });
        } else if (manifest.description.length > MAX_DESCRIPTION_LENGTH) {
            errs.push({
                field: 'description',
                code: 'Invalid',
                message: 'image description is too long, max ' +
                MAX_DESCRIPTION_LENGTH + ' characters'
            });
        }
        return errs;
    },

    homepage: function validateHomepage(manifest) {
        var errs = [];
        if (manifest.homepage === undefined) {
            errs.push({ field: 'homepage', code: 'MissingParameter' });
        } else {
            var homepage = url.parse(manifest.homepage);
            if (homepage.protocol === undefined ||
                (homepage.protocol !== 'http:' &&
                    homepage.protocol !== 'https:')) {
                errs.push({
                    field: 'homepage',
                    code: 'Invalid',
                    message: 'invalid image homepage URL protocol'
                });
            } else if (manifest.homepage.length > MAX_URL_LENGTH) {
                errs.push({
                    field: 'homepage',
                    code: 'Invalid',
                    message: format('image homepage URL is too long ' +
                        '(max %d characters)', MAX_URL_LENGTH)
                });
            }
        }
        return errs;
    },

    eula: function validateEula(manifest) {
        var errs = [];
        if (manifest.eula === undefined) {
            errs.push({ field: 'eula', code: 'MissingParameter' });
        } else {
            var eula = url.parse(manifest.eula);
            if (eula.protocol === undefined || (eula.protocol !== 'http:' &&
                eula.protocol !== 'https:')) {
                errs.push({
                    field: 'eula',
                    code: 'Invalid',
                    message: 'invalid image EULA URL protocol'
                });
            } else if (manifest.eula.length > MAX_URL_LENGTH) {
                errs.push({
                    field: 'eula',
                    code: 'Invalid',
                    message: format('image EULA URL is too long ' +
                        '(max %d characters)', MAX_URL_LENGTH)
                });
            }
        }
        return errs;
    },

    disabled: function validateDisabled(manifest) {
        var errs = [];
        if (manifest.disabled === undefined) {
            errs.push({ field: 'disabled', code: 'MissingParameter' });
        } else {
            var disabled = boolFromString(manifest.disabled);
            if (typeof (disabled) !== 'boolean') {
                errs.push({
                    field: 'disabled',
                    code: 'Invalid'
                });
            }
        }
        return errs;
    },

    activated: function validateActivated(manifest) {
        var errs = [];
        if (manifest.activated === undefined) {
            errs.push({ field: 'activated', code: 'MissingParameter' });
        } else {
            var activated = boolFromString(manifest.activated);
            if (typeof (activated) !== 'boolean') {
                errs.push({
                    field: 'activated',
                    code: 'Invalid'
                });
            }
        }
        return errs;
    },

    published_at: function validatePublishedAt(manifest) {
        var errs = [];
        var activated = boolFromString(manifest.activated);
        if (activated === true && manifest.published_at === undefined) {
            errs.push({
                field: 'published_at',
                code: 'MissingParameter',
                message: 'if activated is "true" published_at must be present'
            });
        } else if (manifest.published_at &&
            !PUBLISHED_AT_RE.test(manifest.published_at)) {
            errs.push({
                field: 'published_at',
                code: 'Invalid',
                message: 'published_at date not in ' +
                         '"YYYY-MM-DDTHH:MM:SS(.SSS)Z" format'
            });
        }
        return errs;
    },

    state: function validateState(manifest) {
        var errs = [];
        if (manifest.state === undefined) {
            errs.push({ field: 'state', code: 'MissingParameter' });
        } else {
            var VALID_STATES = ['active', 'unactivated', 'disabled', 'failed',
                'creating'];
            if (typeof (manifest.state) !== 'string' ||
                VALID_STATES.indexOf(manifest.state) === -1) {
                errs.push({
                    field: 'state',
                    code: 'Invalid'
                });
            }
        }
        return errs;
    },

    /*jsl:ignore*/
    public: function validatePublic(manifest, options) {
        var errs = [];
        if (manifest.public === undefined) {
            errs.push({ field: 'public', code: 'MissingParameter' });
        } else {
            var public;
            try {
                public = boolFromString(manifest.public);
            } catch (e) {
                errs.push({
                    field: 'public',
                    code: 'Invalid',
                    message: e.toString()
                });
                return errs;
            }

            if (typeof (public) !== 'boolean') {
                errs.push({
                    field: 'public',
                    code: 'Invalid'
                });
            } else if (options && options.mode === 'public' && !public) {
                errs.push({
                    field: 'public',
                    code: 'Invalid',
                    message: 'private images are not allowed on a public ' +
                    'Images API'
                });
            } else if (options && options.mode === 'private' && public) {
                errs.push({
                    field: 'public',
                    code: 'Invalid',
                    message: 'public images are not allowed on a private ' +
                    'Images API'
                });
            }
        }
        return errs;
    },
    /*jsl:end*/

    type: function validateType(manifest) {
        var errs = [];
        if (manifest.type === undefined) {
            errs.push({ field: 'type', code: 'MissingParameter' });
        } else {
            var VALID_TYPES = {
                'zone-dataset': true,
                'zvol': true
            };
            // Allow type and os to be have 'null' values when the image has not
            // benn created yet
            if (manifest.type === 'null') {
                if (manifest.state !== 'creating' &&
                    manifest.state !== 'failed') {
                    errs.push({
                        field: 'type',
                        code: 'Invalid',
                        message: format('invalid image type, "null"')
                    });
                }
            } else if (VALID_TYPES[manifest.type] === undefined) {
                errs.push({
                    field: 'type',
                    code: 'Invalid',
                    message: format('invalid image type, "%s", must be one' +
                        'of: %s', manifest.type,
                        Object.keys(VALID_TYPES).join(', '))
                });
            }
        }
        return errs;
    },

    nic_driver: function validateNicDriver(manifest) {
        var errs = [];
        // Only push an error if type is zvol
        if (manifest.nic_driver === undefined) {
            if (manifest.type === 'zvol') {
                errs.push({ field: 'nic_driver', code: 'MissingParameter' });
            }
        } else if (manifest.nic_driver && manifest.type !== 'zvol') {
            errs.push({
                field: 'nic_driver',
                code: 'Invalid',
                message: format(
                    'invalid image nic_driver: "%s" (cannot have a value when' +
                    ' image type is zvol)', manifest.nic_driver)
            });
        } else if (typeof (manifest.nic_driver) !== 'string') {
            errs.push({
                field: 'nic_driver',
                code: 'Invalid',
                message: format(
                    'invalid image nic_driver: "%s" (must be a string)',
                    manifest.nic_driver)
            });
        }
        return errs;
    },

    disk_driver: function validateDiskDriver(manifest) {
        var errs = [];
        // Only push an error if type is zvol
        if (manifest.disk_driver === undefined) {
            if (manifest.type === 'zvol') {
                errs.push({ field: 'disk_driver', code: 'MissingParameter' });
            }
        } else if (manifest.disk_driver && manifest.type !== 'zvol') {
            errs.push({
                field: 'disk_driver',
                code: 'Invalid',
                message: format(
                    'invalid image disk_driver: "%s" (cannot have a value ' +
                    ' when image type is zvol)', manifest.disk_driver)
            });
        } else if (typeof (manifest.disk_driver) !== 'string') {
            errs.push({
                field: 'disk_driver',
                code: 'Invalid',
                message: format(
                    'invalid image disk_driver: "%s" (must be a string)',
                    manifest.disk_driver)
            });
        }
        return errs;
    },

    cpu_type: function validateCpuType(manifest) {
        var errs = [];
        // Only push an error if type is zvol
        if (manifest.cpu_type === undefined) {
            if (manifest.type === 'zvol') {
                errs.push({ field: 'cpu_type', code: 'MissingParameter' });
            }
        } else if (manifest.cpu_type && manifest.type !== 'zvol') {
            errs.push({
                field: 'cpu_type',
                code: 'Invalid',
                message: format(
                    'invalid image cpu_type: "%s" (cannot have a value when' +
                    ' image type is zvol)', manifest.cpu_type)
            });
        } else if (typeof (manifest.cpu_type) !== 'string') {
            errs.push({
                field: 'cpu_type',
                code: 'Invalid',
                message: format(
                    'invalid image cpu_type: "%s" (must be a string)',
                    manifest.cpu_type)
            });
        }
        return errs;
    },

    image_size: function validateImageSize(manifest) {
        var errs = [];
        // Only push an error if type is zvol
        if (manifest.image_size === undefined) {
            if (manifest.type === 'zvol') {
                errs.push({ field: 'image_size', code: 'MissingParameter' });
            }
        } else if (manifest.image_size && manifest.type !== 'zvol') {
            errs.push({
                field: 'image_size',
                code: 'Invalid',
                message: format(
                    'invalid image image_size: "%s" (cannot have a value when' +
                    ' image type is zvol)', manifest.image_size)
            });
        } else {
            var image_size = Number(manifest.image_size);
            if (!isPositiveInteger(image_size)) {
                errs.push({
                    field: 'image_size',
                    code: 'Invalid',
                    message: format(
                    'invalid image image_size: "%s" ' +
                    '(must be a positive integer)', manifest.image_size)
                });
            }
        }
        return errs;
    },

    os: function validateOs(manifest) {
        var errs = [];
        if (manifest.os === undefined) {
            errs.push({ field: 'os', code: 'MissingParameter' });
        } else {
            var VALID_OSES = {
                'smartos': true,
                'linux': true,
                'windows': true,
                'bsd': true,
                'illumos': true,
                'other': true
            };
            // Allow type and os to be have 'null' values when the image has not
            // benn created yet
            if (manifest.os === 'null') {
                if (manifest.state !== 'creating' &&
                    manifest.state !== 'failed') {
                    errs.push({
                        field: 'os',
                        code: 'Invalid',
                        message: format('invalid image os, "null"')
                    });
                }
            } else if (VALID_OSES[manifest.os] === undefined) {
                errs.push({
                    field: 'os',
                    code: 'Invalid',
                    message: format('invalid image os, "%s", must be one of: ' +
                        '%s', manifest.os, Object.keys(VALID_OSES).join(', '))
                });
            }
        }
        return errs;
    },

    error: function validateError(manifest) {
        var errs = [];
        if (manifest.error === undefined) {
            errs.push({ field: 'error', code: 'MissingParameter' });
        } else if (typeof (manifest.error) !== 'object') {
            errs.push({
                field: 'error',
                code: 'Invalid',
                message: format('invalid image "error" (not an object): %j',
                    manifest.error)
            });
        }
        return errs;
    },

    files: function validateFiles(manifest) {
        var errs = [];
        var VALID_FILE_COMPRESSIONS = ['gzip', 'bzip2', 'none'];
        var files = manifest.files;
        var activated = boolFromString(manifest.activated);
        // Only push an error if activated is true
        if (files === undefined) {
            if (activated === true) {
                errs.push({
                    field: 'files',
                    code: 'MissingParameter',
                    message: 'if activated is "true" files must be present'
                });
            }
            return errs;
        }

        if (!Array.isArray(files)) {
            errs.push({
                field: 'files',
                code: 'Invalid',
                message: format('invalid image "files" (not an array): %s',
                    files)
            });
        } else if (files.length > 1) {
            errs.push({
                field: 'files',
                code: 'Invalid',
                message: 'invalid image "files": too many files'
            });
        } else if (files.length === 1) {
            var file = files[0];
            if (!file.sha1) {
                errs.push({
                    field: 'files',
                    code: 'Invalid',
                    message: 'invalid image "files": file missing ' +
                    '"sha1" field'
                });
            }
            if (!file.size) {
                errs.push({
                    field: 'files',
                    code: 'Invalid',
                    message: format(
                        'invalid image "files": file missing "size" field')
                });
            }
            if (!file.compression) {
                errs.push({
                    field: 'files',
                    code: 'Invalid',
                    message: 'invalid image "files": file missing ' +
                             '"compression" field'
                });
            } else if (VALID_FILE_COMPRESSIONS.
                indexOf(file.compression) === -1) {
                errs.push({
                    field: 'files',
                    code: 'Invalid',
                    message: format(
                        'invalid image "files": invalid compression "%s" ' +
                        '(must be one of %s)', file.compression,
                        VALID_FILE_COMPRESSIONS.join(', '))
                });
            }
        }
        return errs;
    },

    icon: function validateIcon(manifest) {
        var errs = [];
        if (manifest.icon === undefined) {
            errs.push({ field: 'icon', code: 'MissingParameter' });
        } else {
            var icon = boolFromString(manifest.icon);
            if (typeof (icon) !== 'boolean') {
                errs.push({
                    field: 'icon',
                    code: 'Invalid',
                    message: format('invalid image "icon" '
                        + '(not an accepted boolean value): %j', icon)
                });
            }
        }
        return errs;
    },

    acl: function validateAcl(manifest) {
        var errs = [];
        var acl = manifest.acl;
        if (manifest.acl === undefined) {
            errs.push({ field: 'acl', code: 'MissingParameter' });
        } else if (!Array.isArray(acl)) {
            errs.push({
                field: 'acl',
                code: 'Invalid',
                message: format('invalid image "acl" (not an array): %s', acl)
            });
        } else {
            for (var i = 0; i < acl.length; i++) {
                if (! UUID_RE.test(acl[i])) {
                    errs.push({
                        field: 'acl',
                        code: 'Invalid',
                        message: format(
                            'invalid image "acl" (item %d is not a UUID): %s',
                            i, acl[i])
                    });
                    break;
                }
            }
        }
        return errs;
    },

    requirements: function validateRequirements(manifest) {
        var errs = [];
        var reqs = objCopy(manifest.requirements);
        if (reqs === undefined) {
            errs.push({ field: 'requirements', code: 'MissingParameter' });
            return errs;
        } else if (typeof (reqs) !== 'object') {
            errs.push({
                field: 'requirements',
                code: 'Invalid',
                message: format(
                    'invalid image "requirements" (not an object): %j', reqs)
            });
            return errs;
        }

        // requirements.networks
        if (reqs.networks) {
            if (!Array.isArray(reqs.networks)) {
                errs.push({
                    field: 'requirements.networks',
                    code: 'Invalid',
                    message: format(
                    'invalid image "requirements.networks" (not an array): %j',
                    reqs.networks)
                });
            } else {
                reqs.networks.forEach(function (n) {
                    if (typeof (n) !== 'object' ||
                        n.name === undefined ||
                        n.description === undefined ||
                        Object.keys(n).length !== 2) {
                        errs.push({
                            field: 'requirements.networks',
                            code: 'Invalid',
                            message: format(
                            'invalid image "requirements.networks" entry: %j',
                            n)
                        });
                    }
                });
            }
        }
        delete reqs.networks;

        // requirements.brand
        if (reqs.brand && typeof (reqs.brand) !== 'string') {
            errs.push({
                field: 'requirements.brand',
                code: 'Invalid',
                message: format(
                    'invalid image "requirements.brand" (not a string): %j',
                    reqs.brand)
            });
        }
        delete reqs.brand;

        // requirements.ssh_key
        if (reqs.ssh_key && typeof (reqs.ssh_key) !== 'boolean') {
            errs.push({
                field: 'requirements.ssh_key',
                code: 'Invalid',
                message: format(
                    'invalid image "requirements.ssh_key" (not a boolean): %j',
                    reqs.ssh_key)
            });
        }
        delete reqs.ssh_key;

        // requirements.min_ram & requirements.max_ram
        // - both are positive integers, and the interval must be sane
        var min_ram, max_ram;
        if (reqs.min_ram) {
            if (!isPositiveInteger(reqs.min_ram)) {
                errs.push({
                    field: 'requirements.min_ram',
                    code: 'Invalid',
                    message: format('invalid image "requirements.min_ram" '
                        + '(not a positive integer): %j', reqs.min_ram)
                });
            } else {
                min_ram = reqs.min_ram;
            }
        }
        delete reqs.min_ram;
        if (reqs.max_ram) {
            if (!isPositiveInteger(reqs.max_ram)) {
                errs.push({
                    field: 'requirements.max_ram',
                    code: 'Invalid',
                    message: format('invalid image "requirements.max_ram" '
                        + '(not a positive integer): %j', reqs.max_ram)
                });
            } else {
                max_ram = reqs.max_ram;
            }
        }
        delete reqs.max_ram;
        // max-min can be zero if max == min, which is allowed.
        if (max_ram && min_ram && (max_ram - min_ram < 0)) {
            errs.push({
                field: 'requirements.max_ram',
                code: 'Invalid',
                message: format('min_ram must be <= max_ram, but:'
                    + 'min_ram=%s, max_ram=%s', min_ram, max_ram)
            });
        }

        // requirements.min_platform & requirements.max_platform
        // semver, date -> { "7.0": "2012-12-10", "6.5", "2013-01-01" }
        var imgVer;
        if (reqs.min_platform) {
            if (typeof (reqs.min_platform) !== 'object' ||
                Object.keys(reqs.min_platform).length === 0) {
                errs.push({
                    field: 'requirements.min_platform',
                    code: 'Invalid',
                    message: format('invalid image "requirements.min_platform" '
                        + '(not an object): %j', reqs.min_platform)
                });
            } else {
                for (var minKey in reqs.min_platform) {
                    imgVer = reqs.min_platform[minKey];
                    if (validPlatformVersion(imgVer) === false) {
                        errs.push({
                            field: 'requirements.min_platform',
                            code: 'Invalid',
                            message: format('invalid image '
                                + '"requirements.min_platform" entry: "%s: %s" '
                                + 'not a valid platform version', minKey,
                                imgVer)
                        });
                    }
                }
            }
        }
        delete reqs.min_platform;
        if (reqs.max_platform) {
            if (typeof (reqs.max_platform) !== 'object' ||
                Object.keys(reqs.max_platform).length === 0) {
                errs.push({
                    field: 'requirements.max_platform',
                    code: 'Invalid',
                    message: format('invalid image "requirements.max_platform" '
                        + '(not an object): %j', reqs.max_platform)
                });
            } else {
                for (var maxKey in reqs.max_platform) {
                    imgVer = reqs.max_platform[maxKey];
                    if (validPlatformVersion(imgVer) === false) {
                        errs.push({
                            field: 'requirements.max_platform',
                            code: 'Invalid',
                            message: format('invalid image '
                                + '"requirements.max_platform" entry: "%s: %s" '
                                + 'not a valid platform version', maxKey,
                                imgVer)
                        });
                    }
                }
            }
        }
        delete reqs.max_platform;

        // unknown requirements
        Object.keys(reqs).forEach(function (field) {
            errs.push({
                field: field,
                code: 'Invalid',
                message: format('unsupported requirement "%s"', field)
            });
        });

        return errs;
    },

    users: function validateUsers(manifest) {
        var errs = [];
        var users = manifest.users;
        if (users === undefined) {
            errs.push({ field: 'users', code: 'MissingParameter' });
            return errs;
        }

        if (!Array.isArray(users)) {
            errs.push({
                field: 'users',
                code: 'Invalid',
                message: format('invalid image "users" (not an array): %j',
                    users)
            });
        } else {
            users.forEach(function (u) {
                if (typeof (u) !== 'object' ||
                    u.name === undefined ||
                    Object.keys(u).length !== 1) {
                    errs.push({
                        field: 'users',
                        code: 'Invalid',
                        message: format('invalid image "users" entry: %j', u)
                    });
                }
            });
        }
        return errs;
    },

    billing_tags: function validateBillingTags(manifest) {
        var errs = [];
        var bt = manifest.billing_tags;
        if (bt === undefined) {
            errs.push({ field: 'billing_tags', code: 'MissingParameter' });
            return errs;
        }

        if (!Array.isArray(bt)) {
            errs.push({
                field: 'billing_tags',
                code: 'Invalid',
                message: format('invalid image "billing_tags" ' +
                    '(not an array): %s', bt)
            });
        } else {
            bt.forEach(function (t) {
                if (typeof (t) !== 'string' ||
                    t.length > MAX_BILLING_TAG_LENGTH) {
                    errs.push({
                        field: 'billing_tags',
                        code: 'Invalid',
                        message: format('invalid image "billing_tags" entry ' +
                        ': %s', t)
                    });
                }
            });
        }
        return errs;
    },

    traits: function validateTraits(manifest) {
        var errs = [];
        var traits = manifest.traits;
        if (traits === undefined) {
            errs.push({ field: 'traits', code: 'MissingParameter' });
            return errs;
        }

        if (typeof (traits) !== 'object') {
            errs.push({
                field: 'traits',
                code: 'Invalid',
                message: format('invalid image "traits" (not an object): %j',
                    traits)
            });
        } else {
            var traitKeys = Object.keys(traits);
            for (var i = 0; i < traitKeys.length; i++) {
                var traitValue = traits[traitKeys[i]];
                // Only allow strings, arrays or booleans
                if (typeof (traitValue) !== 'string' &&
                    typeof (traitValue) !== 'boolean' &&
                    !Array.isArray(traitValue)) {
                    errs.push({
                        field: 'traits',
                        code: 'Invalid',
                        message: format('invalid image "traits" entry: ' +
                            '(%s, %j)', traitKeys[i], traitValue)
                    });
                }
            }
        }
        return errs;
    },

    tags: function validateTags(manifest) {
        var errs = [];
        var tags = manifest.tags;
        if (tags === undefined) {
            errs.push({ field: 'tags', code: 'MissingParameter' });
            return errs;
        }

        if (Array.isArray(tags) || typeof (tags) !== 'object') {
            errs.push({
                field: 'tags',
                code: 'Invalid',
                message: format('invalid image "tags" (not an object): %j',
                    tags)
            });
        } else {
            var tagsLength = JSON.stringify(tags).length;
            if (tagsLength > MAX_TAGS_LENGTH) {
                errs.push({
                    field: 'tags',
                    code: 'Invalid',
                    message: 'image "tags" string length is too long, max ' +
                    MAX_TAGS_LENGTH + ' characters'
                });
            }

            var tagKeys = Object.keys(tags);
            for (var i = 0; i < tagKeys.length; i++) {
                var tagValue = tags[tagKeys[i]];
                // Can have arbitrary objects as long as they are not functions
                if (typeof (tagValue) === 'function') {
                    errs.push({
                        field: 'tags',
                        code: 'Invalid',
                        message: format('invalid image "tags" entry: (%s, %j)',
                            tagKeys[i], tagValue.toString())
                    });
                }
            }
        }
        return errs;
    },

    generate_passwords: function validateGeneratePasswords(manifest) {
        var errs = [];
        if (manifest.generate_passwords === undefined) {
            errs.push({ field: 'generate_passwords', code: 'MissingParameter'});
        } else {
            var gp = boolFromString(manifest.generate_passwords);
            if (typeof (gp) !== 'boolean') {
                errs.push({
                    field: 'generate_passwords',
                    code: 'Invalid',
                    message: format('invalid image "generate_passwords" '
                        + '(not an accepted boolean value): %j', gp)
                });
            }
        }
        return errs;
    },

    inherited_directories: function validateInhDirectories(manifest) {
        var errs = [];
        var id = manifest.inherited_directories;
        if (manifest.inherited_directories === undefined) {
            errs.push({
                field: 'inherited_directories',
                code: 'MissingParameter'
            });
            return errs;
        }

        if (manifest.type !== 'zone-dataset') {
            errs.push({
                field: 'inherited_directories',
                code: 'Invalid',
                message: format('invalid image "inherited_directories" ' +
                    '(only valid for a type:zone-dataset image): %j', id)
            });
        } else if (!Array.isArray(id)) {
            errs.push({
                field: 'inherited_directories',
                code: 'Invalid',
                message: format(
                    'invalid image "inherited_directories" (not an array): %j',
                    id)
            });
        } else {
            id.forEach(function (ii) {
                if (typeof (ii) !== 'string') {
                    errs.push({
                        field: 'inherited_directories',
                        code: 'Invalid',
                        message: format(
                        'invalid image "inherited_directories" entry: %j', ii)
                    });
                }
            });
        }
        return errs;
    },

    origin: function validateOrigin(manifest) {
        var errs = [];
        if (manifest.origin === undefined) {
            errs.push({ field: 'origin', code: 'MissingParameter' });
        } else if (! UUID_RE.test(manifest.origin)) {
            errs.push({field: 'origin', code: 'Invalid'});
        }
        return errs;
    }

    //
    // FIELD: function validateFIELD(manifest) {
    //     var errs = [];
    //     ...
    //     return errs;
    // },
};

function validateFields(manifest, requiredFields, options) {
    assert.object(manifest, 'manifest');
    assert.arrayOfString(requiredFields, 'requiredFields');
    assert.optionalObject(options, 'options');

    var errs = []; // validation errors

    // First run the 'presence' validations that result in MissingParameter
    // errors. Each of the present fields here can be passed to the validators
    // afterwards. Then, we run the optional validations for the remaining list
    // of fields
    requiredFields.forEach(function (field) {
        validators[field](manifest, options).forEach(function (err) {
            errs.push(err);
        });
    });

    // Validate each field that is not a required field and is not undefined
    fields.forEach(function (fieldObj) {
        var field = fieldObj.name;
        if (requiredFields.indexOf(field) === -1 &&
            manifest[field] !== undefined) {
            validators[field](manifest, options).forEach(function (err) {
                errs.push(err);
            });
        }
    });

    // Error on extra spurious fields.
    var fieldNames = fields.map(function (field) { return field.name; });
    Object.keys(manifest).forEach(function (field) {
        if (fieldNames.indexOf(field) === -1) {
            errs.push({ field: field, code: 'Invalid' });
        }
    });

    return errs.length ? errs : null;
}





// ---- exports

module.exports = {
    V: V,
    fields: fields,
    upgradeManifest: upgradeManifest,
    validateMinimalManifest: validateMinimalManifest,
    validateDcManifest: validateDcManifest,
    validatePublicManifest: validatePublicManifest,
    validatePrivateManifest: validatePrivateManifest
};
