// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that docker flag works as expected when setting/unsetting
//

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-docker',
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024
};
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

function getDockerFlags(t, state, cb) {
    VM.load(state.uuid, function (err, obj) {
        var results = {};

        t.ok(!err, 'loading obj for new VM');
        if (err) {
            cb(err);
            return;
        }

        results.docker = !!obj.docker;
        if (obj.hasOwnProperty('internal_metadata')
            && obj.internal_metadata['docker:id']) {

            results.docker_id = obj.internal_metadata['docker:id'];
        } else {
            results.docker_id = false;
        }

        if (obj.hasOwnProperty('internal_metadata_namespaces')
            && obj.internal_metadata_namespaces.indexOf('docker') !== -1) {

            results.docker_ns = true;
        } else {
            results.docker_ns = false;
        }

        results.namespaces = obj.internal_metadata_namespaces;

        cb(null, results);
    });
}

test('test docker=true on new VM', function (t) {
    var payload = common_payload;
    var prev_docker_id;
    var state = {brand: payload.brand};

    payload.docker = true;
    delete payload.internal_metadata;
    delete payload.internal_metadata_namespaces;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.ok(flags.docker_id, 'docker:id set after create: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');
                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: false}, function (err) {
                t.ok(!err, 'setting docker=false: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(!flags.docker, 'docker flag set false after update');
                t.ok(flags.docker_id, 'docker:id still set after update: '
                    + flags.docker_id);
                t.ok(flags.docker_ns,
                    'docker namespaces still set after update');

                prev_docker_id = flags.docker_id;
                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: true}, function (err) {
                t.ok(!err, 'setting docker=true again: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set true again');
                t.equal(flags.docker_id, prev_docker_id,
                    'docker:id matches previous: ' + flags.docker_id);
                t.ok(flags.docker_ns,
                    'docker namespaces still set after update');

                cb();
            });
        }
    ]);
});

test('test docker=true + docker:id + docker namespace on new VM', function (t) {
    var new_dockerid;
    var new_uuid;
    var payload = common_payload;
    var state = {brand: payload.brand};

    payload.docker = true;
    delete payload.internal_metadata;
    delete payload.internal_metadata_namespaces;

    new_uuid = libuuid.create();
    new_dockerid = (new_uuid + libuuid.create()).replace(/-/g, '');

    payload.uuid = new_uuid;
    payload.internal_metadata = {'docker:id': new_dockerid};
    payload.internal_metadata_namespaces = ['docker'];

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.equal(flags.docker_id, new_dockerid, 'docker:id set after '
                    + 'create: ' + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');

                // ensure we didn't add a duplicate value
                t.ok(flags.namespaces.length === 1,
                    'only one internal_metadata_namespace set');

                cb();
            });
        }
    ]);
});

test('test docker=true + non-docker namespace on new VM', function (t) {
    var payload = common_payload;
    var state = {brand: payload.brand};

    payload.docker = true;
    payload.internal_metadata_namespaces = ['bacon'];
    delete payload.internal_metadata;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.ok(flags.docker_id, 'docker:id set after create: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');
                t.deepEqual(flags.namespaces, ['bacon', 'docker'], 'did not '
                    + 'destroy existing internal_metadata_namespaces');

                cb();
            });
        }
    ]);
});

test('test adding docker=true on old VM', function (t) {
    var payload = common_payload;
    var state = {brand: payload.brand};

    delete payload.docker;
    delete payload.internal_metadata;
    delete payload.internal_metadata_namespaces;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(!flags.docker, 'docker flag set false after create');
                t.ok(!flags.docker_id, 'docker:id not set after create');
                t.ok(!flags.docker_ns, 'docker namespace not set after create');

                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: true}, function (err) {
                t.ok(!err, 'setting docker=true: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after update');
                t.ok(flags.docker_id, 'docker:id set after update: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after update');
                cb();
            });
        }
    ]);
});
