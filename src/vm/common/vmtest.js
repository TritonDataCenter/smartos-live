/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

/*
 * This is the common set of functions for things like ensuring we have a
 * SmartOS and Ubuntu image to work with.
 */

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');

var DEFAULT_ZFS_PROPERTIES = {
  "type": "filesystem",
  "compressratio": "1.00x",
  "mounted": "yes",
  "reservation": "0",
  "recordsize": "131072",
  "sharenfs": "off",
  "checksum": "on",
  "compression": "off",
  "atime": "off",
  "devices": "off",
  "exec": "on",
  "setuid": "on",
  "readonly": "off",
  "zoned": "off",
  "snapdir": "hidden",
  "aclmode": "discard",
  "aclinherit": "restricted",
  "canmount": "on",
  "xattr": "on",
  "copies": "1",
  "utf8only": "off",
  "normalization": "none",
  "casesensitivity": "sensitive",
  "vscan": "off",
  "nbmand": "off",
  "sharesmb": "off",
  "primarycache": "all",
  "secondarycache": "all",
  "logbias": "latency",
  "dedup": "off",
  "mlslabel": "none",
  "sync": "standard",
  "refcompressratio": "1.00x",
  "redundant_metadata": "all"
};
var IMAGES_SOURCE = 'https://images.joyent.com/';

exports.CURRENT_DOCKER_IMAGE_UUID = process.env['DOCKER_BASE_IMAGE_UUID'];
exports.CURRENT_SMARTOS_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';

// ubuntu-14.04
exports.CURRENT_UBUNTU_LX_IMAGE_UUID = '04179d8e-188a-11e7-af4a-1349e98cbd17';

exports.CURRENT_UBUNTU_NAME = 'ubuntu-10.04';
exports.CURRENT_UBUNTU_SIZE = 5120;
exports.CURRENT_UBUNTU_UUID = '71101322-43a5-11e1-8f01-cf2a3031a7f4';

// centos-bhyve-7
exports.CURRENT_BHYVE_CENTOS_UUID = '462d1d03-8457-e134-a408-cf9ea2b9be96';

exports.on_new_vm = function(t, uuid, payload, state, fnlist, callback)
{
    if (payload.hasOwnProperty('brand') && !state.hasOwnProperty('brand')) {
        state.brand = payload.brand;
    }

    if ((['joyent', 'joyent-minimal', 'lx'].indexOf(state.brand) !== -1)
        && (!payload.hasOwnProperty('image_uuid'))) {

        payload.image_uuid = uuid;
    }

    functions = [
        function(cb) {
            VM.create(payload, function (err, obj) {
                if (err) {
                    state.create_err = err;
                    if (state.expect_create_failure) {
                        if (obj) {
                            state.vminfo = obj;
                            if (obj.uuid) {
                                state.uuid = obj.uuid;
                            }
                        }
                        t.ok(true, 'failed to create VM: ' + err.message);
                        cb();
                    } else {
                        t.ok(false, 'error creating VM: ' + err.message);
                        cb(err);
                    }
                } else if (state.expect_create_failure) {
                    state.vminfo = obj;
                    state.uuid = obj.uuid;
                    t.ok(false, 'create succeeded when expected failure.');
                    cb();
                } else {
                    state.vminfo = obj;
                    state.uuid = obj.uuid;
                    t.ok(true, 'created VM: ' + state.uuid);
                    cb();
                }
            });
        }
    ];

    if (fnlist && fnlist.length > 0) {
        functions = functions.concat(fnlist);
    }

    functions.push(function (cb) {
        if (state.hasOwnProperty('uuid')) {
            VM.delete(state.uuid, function (err) {
                if (err) {
                    if (err.code === 'ENOENT') {
                        t.ok(true, 'tried to delete VM ' + state.uuid
                            + ' but it was already gone.');
                    } else {
                        t.ok(false, 'error deleting VM: ' + err.message);
                    }
                } else {
                    t.ok(true, 'deleted VM: ' + state.uuid);
                }
                cb();
            });
        } else {
            // we didn't create a VM, don't also fail deleting.
            cb();
        }
    });

    functions.push(function (cb) {
        cb();
    });

    async.series(functions, function (err) {
        var openThingies;

        if (err) {
            t.ok(false, err.message);
        }
        if (callback) {
            // up to caller to call t.end!
            return callback();
        } else {
            t.end();

            /*

            // Helpful bit from Isaac that tells what's still open.
            openThingies = process._getActiveHandles();
            console.dir(openThingies);

            */
        }
    });
};


/*
 * This function is intended to be used on a freshly created zoneroot to ensure
 * that the default properties of that ZFS filesystem have not changed
 * unexpectedly in the platform.
 */
exports.checkDefaultZfsProperties =
function checkDefaultZfsProperties(t, dataset, message, callback) {
    var args;
    var cmd = '/usr/sbin/zfs';

    args = [
        'get', '-H', '-p', '-o', 'property,value', 'all', dataset
    ];

    cp.execFile(cmd, args, function (err, stdout, stderr) {
        var props = {};
        var propsList;

        if (err) {
            callback(err);
            return;
        }

        propsList = stdout.trim().split('\n');

        propsList.forEach(function (prop) {
            var p = prop.split('\t');
            // only include properties whose values we want to check
            if (DEFAULT_ZFS_PROPERTIES.hasOwnProperty(p[0])) {
                props[p[0]] = p[1];
            }
        });

        t.deepEqual(props, DEFAULT_ZFS_PROPERTIES, message);

        callback();
    });
};

/*
 * Adapted from usr/src/lib/libzfs/common/libzfs_dataset.c and related headers.
 */
var SPA_BLKPTRSHIFT = 7;        /* blkptr_t is 128 bytes */
var SPA_DVAS_PER_BP = 3;        /* Number of DVAs in a bp */
var DN_MAX_INDBLKSHIFT = 17;    /* 128k */
var DNODES_PER_LEVEL_SHIFT = DN_MAX_INDBLKSHIFT - SPA_BLKPTRSHIFT;
var DNODES_PER_LEVEL = 1 << DNODES_PER_LEVEL_SHIFT;

exports.zvol_volsize_to_reservation =
function zvol_volsize_to_reservation(volsize, volblocksize, copies) {
    var blocks = volsize / volblocksize;
    var numdb = 7;

    while (blocks > 1) {
        blocks = Math.floor((blocks + DNODES_PER_LEVEL - 1) / DNODES_PER_LEVEL);
        numdb += blocks;
    }

    numdb *= Math.min(SPA_DVAS_PER_BP, copies + 1);
    volsize *= copies;

    numdb *= 1 << DN_MAX_INDBLKSHIFT;
    return (volsize + numdb);
}
