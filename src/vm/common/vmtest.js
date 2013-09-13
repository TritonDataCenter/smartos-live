// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This is the common set of functions for things like ensuring we have a
// SmartOS and Ubuntu image to work with.
//

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var test = require('tap').test;
var vmtest = this;

var IMAGES_SOURCE = 'https://images.joyent.com/';

exports.CURRENT_SMARTOS_UUID = '01b2c898-945f-11e1-a523-af1afbe22822';
exports.CURRENT_SNGL_UUID = '4bf9530a-7ae5-11e2-bb4e-3bad5fbc3de9';
exports.CURRENT_UBUNTU_UUID = '71101322-43a5-11e1-8f01-cf2a3031a7f4';
exports.CURRENT_UBUNTU_NAME = 'ubuntu-10.04';
exports.CURRENT_UBUNTU_SIZE = 5120;

// will be set to true the first time we've run ensureCurrentImags() so we
// don't run twice.
var ensured_images = false;


function ensureSources(t, callback)
{
    var cmd = '/usr/sbin/imgadm';

    cp.execFile(cmd, ['sources', '-a', IMAGES_SOURCE], function (err, stdout, stderr) {
        t.ok(!err, 'added source ' + IMAGES_SOURCE + ': ' + JSON.stringify({err: err, stdout: stdout, stderr: stderr}));
        callback();
    });
}

exports.ensureCurrentImages = function(passed_t, to_ensure, callback) {
    var cmd = '/usr/sbin/imgadm';

    if (to_ensure && !callback) {
        callback = to_ensure;
        to_ensure = null;
    }

    if (ensured_images) {
        // We've already confirmed images are installed.
        if (callback) {
            callback();
        }
        return;
    }

    if (!to_ensure) {
        to_ensure = [vmtest.CURRENT_SMARTOS_UUID, vmtest.CURRENT_UBUNTU_UUID, vmtest.CURRENT_SNGL_UUID];
    }

    function ensure(t, do_end, cb) {
        ensureSources(t, function () {
            async.forEachSeries(to_ensure, function (image, cb) {
                console.error('# Importing image: ' + image);
                // ensure this image is installed
                t.ok(true, 'importing: ' + image);
                cp.execFile(cmd, ['import', image], function (err, stdout, stderr) {
                    // fix some sillyness where it's an error to already exist instead of NOOP
                    if (err && err.message.match(/ImageAlreadyInstalled/)) {
                        err = undefined;
                    }
                    t.ok(!err, 'installed ' + image + ': ' + JSON.stringify({err: err, stdout: stdout, stderr: stderr}));
                    cb(err);
                });
            }, function (err) {
                if (!err) {
                    ensured_images = true;
                }
                if (do_end) {
                    t.end();
                }
                if (cb) {
                    cb();
                }
            });
        });
    }

    if (!passed_t) {
        test('ensure current images installed', {'timeout': 600000}, function (t) {
            ensure(t, true, callback);
        });
    } else {
        ensure(passed_t, false, callback);
    }
};

exports.on_new_vm = function(t, uuid, payload, state, fnlist, callback)
{
    if (payload.hasOwnProperty('brand') && !state.hasOwnProperty('brand')) {
        state.brand = payload.brand;
    }

    if ((['joyent', 'joyent-minimal', 'sngl'].indexOf(state.brand) !== -1)
        && (!payload.hasOwnProperty('image_uuid'))) {

        payload.image_uuid = uuid;
    }

    functions = [
        function (cb) {
            if (state.hasOwnProperty('ensure_images')) {
                vmtest.ensureCurrentImages(t, state.ensure_images, cb);
            } else {
                vmtest.ensureCurrentImages(t, cb);
            }
        }, function(cb) {
            VM.create(payload, function (err, obj) {
                if (err) {
                    state.create_err = err;
                    if (state.expect_create_failure) {
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
                    t.ok(false, 'error deleting VM: ' + err.message);
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

