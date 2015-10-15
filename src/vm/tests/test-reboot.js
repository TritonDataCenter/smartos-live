// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that reboot works.
//

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-reboot-' + process.pid,
    autoboot: true,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024
};

var common_kvm_payload = {
    alias: 'test-reboot-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    do_not_inventory: true,
    autoboot: true,
    disk_driver: 'virtio',
    disks: [
        {
            boot: true,
            image_uuid: vmtest.CURRENT_UBUNTU_UUID,
            image_size: vmtest.CURRENT_UBUNTU_SIZE
        }
    ]
};
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('test reboot SmartOS VM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var prev_boot_timestamp;
    var state = {brand: payload.brand};

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp, 'VM has boot_timestamp: '
                    + obj.boot_timestamp);
                prev_boot_timestamp = obj.boot_timestamp;
                cb();
            });
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM: ' + (err ? err.message : 'success'));
                cb();
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp, 'VM has boot_timestamp: '
                    + obj.boot_timestamp);
                t.notEqual(obj.boot_timestamp, prev_boot_timestamp,
                    'boot_timestamp changed');
                cb();
            });
        }
    ]);
});

test('test reboot stopped SmartOS VM fails', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.autoboot = false;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'stopped', 'VM is stopped');
                cb();
            });
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(err, 'failed to reboot VM: '
                    + (err ? err.message : 'succeeded'));
                cb();
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'stopped', 'VM is still stopped');
                cb();
            });
        }
    ]);
});

test('test reboot kvm', function (t) {
    var payload = JSON.parse(JSON.stringify(common_kvm_payload));
    var prev_boot_timestamp;
    var state = {brand: payload.brand};

    vmtest.on_new_vm(t, null, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp, 'VM has boot_timestamp: '
                    + obj.boot_timestamp);
                prev_boot_timestamp = obj.boot_timestamp;

                // Give the VM 20 seconds to (hopefully) boot up and start
                // paying attention to ACPI shutdown. This is a workaround until
                // we do something better for OS-4846.
                setTimeout(cb, 20000);
            });
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM: ' + (err ? err.message : 'success'));
                cb();
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is still running');
                t.notEqual(obj.boot_timestamp, prev_boot_timestamp, 'VM '
                    + 'boot_timestamp changed after reboot');
                cb();
            });
        }
    ]);
});

test('test force reboot kvm', function (t) {
    var payload = JSON.parse(JSON.stringify(common_kvm_payload));
    var prev_boot_timestamp;
    var state = {brand: payload.brand};

    vmtest.on_new_vm(t, null, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp, 'VM has boot_timestamp: '
                    + obj.boot_timestamp);
                prev_boot_timestamp = obj.boot_timestamp;
                cb();
            });
        }, function (cb) {
            VM.reboot(state.uuid, {force: true}, function (err) {
                t.ok(!err, 'rebooted VM: ' + (err ? err.message : 'success'));
                cb();
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is still running');
                t.equal(obj.boot_timestamp, prev_boot_timestamp, 'VM '
                    + 'boot_timestamp did not change through reboot');
                cb();
            });
        }
    ]);
});
