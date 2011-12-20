// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
require.paths.push('/usr/vm/test/node-tap/node_modules');
var async = require('async');
var path = require('path');
var VM = require('VM');
var test = require('tap').test;

exports.on_new_vm = function(t, uuid, payload, state, fnlist)
{
    functions = [
        function(cb) {
            // TODO: use dsadm library to import dataset, or bailout
            if (state.brand === 'joyent') {
                path.exists('/zones/' + uuid, function (exists) {
                    if (exists) {
                        t.ok(exists, 'dataset ' + uuid + ' exists');
                    } else {
                        t.bailout('unable to find dataset ' + uuid);
                    }
                    payload.dataset_uuid = uuid;
                    cb();
                });
            } else {
                path.exists('/dev/zvol/rdsk/zones/' + uuid, function (exists) {
                    if (exists) {
                        t.ok(exists, 'dataset ' + uuid + ' exists');
                    } else {
                        t.bailout('unable to find dataset ' + uuid);
                    }
                    payload.dataset_uuid = uuid;
                    cb();
                });
            }
        }, function(cb) {
            payload.dataset_uuid = uuid;
            console.error('PAYLOAD: ' + JSON.stringify(payload));
            VM.create(payload, function (err, obj) {
                if (err) {
                    t.ok(false, 'error creating VM: ' + err.message);
                    cb(err);
                } else {
                    state.vminfo = obj;
                    state.uuid = obj.uuid;
                    e = new Error('foo');
                    console.error('BT: ' + JSON.stringify(e));
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
        VM.delete(state.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + state.uuid);
            }
            cb();
        });
    });

    async.series(functions, function (err) {
        if (err) {
            t.ok(false, err.message);
        }
        t.end();
    });
};

