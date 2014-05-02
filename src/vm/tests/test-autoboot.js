// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('check autoboot when autoboot=true', function(t) {
    state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        do_not_inventory: true,
        autoboot: true
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                if (obj.hasOwnProperty('autoboot')) {
                    if (obj.autoboot === true) {
                        t.ok(true, 'autoboot was true as set');
                    } else {
                        t.ok(false, 'autoboot was false when set true');
                    }
                } else {
                    t.ok(false, 'new VM is missing autoboot');
                }
                cb();
            });
        }
    ]);
});

test('check autoboot when autoboot=false', function(t) {
    state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        do_not_inventory: true,
        autoboot: false
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                if (obj.hasOwnProperty('autoboot')) {
                    if (obj.autoboot === false) {
                        t.ok(true, 'autoboot was false as set');
                    } else {
                        t.ok(false, 'autoboot was true when set false');
                    }
                } else {
                    t.ok(false, 'new VM is missing autoboot');
                }
                cb();
            });
        }
    ]);
});

test('check kvm autoboot when autoboot=true', function(t) {
    state = {brand: 'kvm'};
    vmtest.on_new_vm(t, null, {
        brand: 'kvm',
        do_not_inventory: true,
        autoboot: true
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                if (obj.hasOwnProperty('autoboot')) {
                    if (obj.autoboot === true) {
                        t.ok(true, 'autoboot was true as set');
                    } else {
                        t.ok(false, 'autoboot was false when set true');
                    }
                } else {
                    t.ok(false, 'new VM is missing autoboot');
                }
                cb();
            });
        }
    ]);
});

test('check kvm autoboot when autoboot=false', function(t) {
    state = {brand: 'kvm'};
    vmtest.on_new_vm(t, null, {
        brand: 'kvm',
        do_not_inventory: true,
        autoboot: false
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                if (obj.hasOwnProperty('autoboot')) {
                    if (obj.autoboot === false) {
                        t.ok(true, 'autoboot was false as set');
                    } else {
                        t.ok(false, 'autoboot was true when set false');
                    }
                } else {
                    t.ok(false, 'new VM is missing autoboot');
                }
                cb();
            });
        }
    ]);
});
