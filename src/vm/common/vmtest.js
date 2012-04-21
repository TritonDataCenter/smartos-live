// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var async = require('async');
var path = require('path');
var VM = require('VM');
var test = require('tap').test;

exports.on_new_vm = function(t, uuid, payload, state, fnlist, callback)
{
    functions = [
        function(cb) {
            // TODO: use dsadm library to import dataset, or bailout
            if (state.brand === 'joyent') {
                path.exists('/zones/' + uuid, function (exists) {
                    if (exists) {
                        t.ok(true, 'dataset ' + uuid + ' exists');
                    } else {
                        t.ok(false, 'unable to find dataset ' + uuid);
                    }
                    payload.dataset_uuid = uuid;
                    cb();
                });
            } else if (state.brand === 'kvm' && uuid) {
                path.exists('/dev/zvol/rdsk/zones/' + uuid, function (exists) {
                    if (exists) {
                        t.ok(true, 'dataset ' + uuid + ' exists');
                    } else {
                        t.ok(false, 'unable to find dataset ' + uuid);
                    }
                    payload.dataset_uuid = uuid;
                    cb();
                });
            } else {
                // skip dataset altogether
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

