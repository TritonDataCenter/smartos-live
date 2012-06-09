// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var async = require('async');
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var VM = require('VM');
var test = require('tap').test;
var vmtest = this;

var DATASETS_IP = '8.19.41.72';

exports.CURRENT_SMARTOS = '01b2c898-945f-11e1-a523-af1afbe22822';
exports.CURRENT_UBUNTU = '56108678-1183-11e1-83c3-ff3185a5b47f';

exports.getImage = function(t, uuid, callback)
{
    cp.exec('curl -k -o /var/tmp/' + uuid + '.json https://'
        + DATASETS_IP + '/datasets/' + uuid,
        function (err) {
            if (err) {
                t.ok(false, 'failed downloading manifest: ' + err.message)
                callback(err);
                return;
            }
            t.ok(true, 'downloaded manifest');

            fs.readFile('/var/tmp/' + uuid + '.json',
                function (error, data) {

                if (error) {
                    t.ok(false, 'cannot read manifest: ' + error.message);
                    callback(error);
                    return;
                } else {
                    t.ok(true, 'got manifest');
                    data = JSON.parse(data.toString());
                    cp.exec('curl -k -o /var/tmp/' + uuid + '.zvol.gz '
                        + data.files[0].url.replace('datasets.joyent.com',
                            DATASETS_IP), function (e) {

                        if (e) {
                            t.ok(false, 'failed downloading zvol: ' + e.message);
                            callback(e);
                            return;
                        }
                        t.ok(true, 'downloaded zvol');

                        cp.exec('/usr/img/sbin/imgadm install -m /var/tmp/' + uuid
                            + '.manifest -f /var/tmp/' + uuid + '.zvol.gz',
                            function (imgadm_err) {
                                if (err) {
                                    t.ok(false, 'failed installing image: ' + imgadm_err.message);
                                } else {
                                    t.ok(true, 'downloaded image successfully');
                                }
                                callback(imgadm_err);
                            }
                        );
                    });
                }
            });
        }
    );
}

exports.ensureImage = function(t, checkpath, uuid, callback)
{
    path.exists(checkpath, function (exists) {
        if (exists) {
            t.ok(true, 'image ' + uuid + ' exists');
            callback();
        } else {
            vmtest.getImage(t, uuid, function (err) {
                if (err) {
                    t.ok(false, 'failed downloading image ' + uuid + ': '
                        + err.message);
                    callback(err);
                } else {
                    t.ok(true, 'downloaded image ' + uuid);
                    path.exists(checkpath, function (exists) {
                        t.ok(exists, 'now have image ' + uuid);
                        if (exists) {
                            callback();
                        } else {
                            callback(new Error('unable to download image '
                                + uuid));
                        }
                    });
                }
            });
        }
    });
}

exports.on_new_vm = function(t, uuid, payload, state, fnlist, callback)
{
    if (payload.hasOwnProperty('brand') && !state.hasOwnProperty('brand')) {
        state.brand = payload.brand;
    }

    functions = [
        function(cb) {
            // make sure we have image, otherwise get it.
            if (state.brand === 'joyent' || state.brand === 'joyent-minimal') {
                vmtest.ensureImage(t, '/zones/' + uuid, uuid, function (e) {
                    if (!e) {
                        payload.image_uuid = uuid;
                    }
                    cb(e);
                });
            } else if (state.brand === 'kvm' && uuid) {
                vmtest.ensureImage(t, '/dev/zvol/rdsk/zones/' + uuid, uuid,
                    function (e) {
                        cb(e);
                    }
                );
            } else {
                // skip image altogether
                cb();
            }
        }, function(cb) {
            VM.create(payload, function (err, obj) {
                if (err) {
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

    if (fnlist) {
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
        if (err) {
            t.ok(false, err.message);
        }
        if (callback) {
            // up to caller to call t.end!
            return callback();
        } else {
             t.end();
        }
    });
};

