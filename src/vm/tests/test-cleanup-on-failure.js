// Copyright 2018 Joyent, Inc.  All rights reserved.
//
// These tests ensure that things created before a zone is created are cleaned
// up on failure. Those things created after the zone exists can be cleaned up
// by destroying the zone.
//

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-cleanup-on-failure-' + process.pid,
    autoboot: false,
    brand: 'kvm',
    disk_driver: 'virtio',
    disks: [
        {
            'boot': true,
            'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
            'image_size': vmtest.CURRENT_UBUNTU_SIZE,
            'refreservation': vmtest.CURRENT_UBUNTU_SIZE
        }, {
            'size': 1024,
            'refreservation': 1024
        }
    ],
    do_not_inventory: true,
    ram: 512,
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024,
    vcpus: 1
};

var bhyve_common_payload = {
    alias: 'test-bhyve-cleanup-on-failure-' + process.pid,
    autoboot: false,
    brand: 'bhyve',
    do_not_inventory: true,
    disks: [
        {
            size: 5120,
            boot: true,
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            model: 'virtio'
        },
        {
            size: 5120,
            model: 'virtio'
        }
    ]
};

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

/*
 * This test creates a KVM VM with a giant disk1 and 100% refreservation. This
 * provision cannot be satisfied because no system currently has enough storage.
 * Prior to OS-3648 this failure would leave behind the disk0 dataset as nothing
 * cleaned that up. This test ensures we don't leave anything behind any more
 * when provision fails to create the second KVM disk.
 */
test('test impossible disk1 refreservation', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));

    // TODO: When we have CNs with more than 10 EiB we should up this number
    // value is in MiB so:         GiB    TiB    PiB    EiB
    payload.disks[1].size = 10 * (1024 * 1024 * 1024 * 1024);
    payload.disks[1].refreservation = payload.disks[1].size;

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(true, 'failed to create VM: ' + err.message);
        } else {
            t.ok(false, 'VM created with uuid ' + obj.uuid);
        }

        // now we want to make sure there were no disks left behind
        zfs(['list', '-H', '-t', 'filesystem,volume', '-o', 'name'],
            function (e, fds) {
                var ds = fds.stdout.split('\n');
                var created_ds = [];

                t.ok(!e, 'loaded list of datasets after create');

                ds.forEach(function (d) {
                    if (d.match(obj.uuid)) {
                        t.ok(false, 'abandoned dataset: ' + d);
                        created_ds.push(d);
                    }
                });

                if (created_ds.length === 0) {
                    t.ok(true, 'no datasets abandoned');
                }

                t.end();
            }
        );
    });
});

test('test impossible bhyve flexible_disk_size', function (t) {
    var payload = JSON.parse(JSON.stringify(bhyve_common_payload));

    // TODO: When we have CNs with more than 10 EiB we should up this number
    // value is in MiB so:         GiB    TiB    PiB    EiB
    payload.flexible_disk_size = 10 * (1024 * 1024 * 1024 * 1024);

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(true, 'failed to create VM: ' + err.message);
        } else {
            t.ok(false, 'VM created with uuid ' + obj.uuid);
        }

        // now we want to make sure there were no disks left behind
        zfs(['list', '-H', '-t', 'filesystem,volume', '-o', 'name'],
            function (e, fds) {
                var ds = fds.stdout.split('\n');
                var created_ds = [];

                t.ok(!e, 'loaded list of datasets after create');

                ds.forEach(function (d) {
                    if (d.match(obj.uuid)) {
                        t.ok(false, 'abandoned dataset: ' + d);
                        created_ds.push(d);
                    }
                });

                if (created_ds.length === 0) {
                    t.ok(true, 'no datasets abandoned');
                }

                t.end();
            }
        );
    });
});
