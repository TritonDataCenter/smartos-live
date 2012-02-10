// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var test = require('tap').test;
var path = require('path');
var VM = require('VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var dataset_uuid = '47e6af92-daf0-11e0-ac11-473ca1173ab0';
//var vm_dataset_uuid = '56108678-1183-11e1-83c3-ff3185a5b47f';

test('check autoboot when autoboot=true', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent'};
    vmtest.on_new_vm(t, dataset_uuid, {'do_not_inventory': true,
        'autoboot': true}, state, [
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

test('check autoboot when autoboot="true"', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent'};
    vmtest.on_new_vm(t, dataset_uuid, {'do_not_inventory': true,
        'autoboot': 'true'}, state, [
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

test('check autoboot when autoboot=false', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent'};
    vmtest.on_new_vm(t, dataset_uuid, {'do_not_inventory': true,
        'autoboot': false}, state, [
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

test('check autoboot when autoboot="false"', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent'};
    vmtest.on_new_vm(t, dataset_uuid, {'do_not_inventory': true,
        'autoboot': 'false'}, state, [
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

test('check kvm autoboot when autoboot=true', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, {'brand': 'kvm', 'do_not_inventory': true,
        'autoboot': true}, state, [
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

test('check kvm autoboot when autoboot="true"', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, {'brand': 'kvm', 'do_not_inventory': true,
        'autoboot': 'true'}, state, [
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

test('check kvm autoboot when autoboot=false', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, {'brand': 'kvm', 'do_not_inventory': true,
        'autoboot': false}, state, [
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

test('check kvm autoboot when autoboot="false"', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, {'brand': 'kvm', 'do_not_inventory': true,
        'autoboot': 'false'}, state, [
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
