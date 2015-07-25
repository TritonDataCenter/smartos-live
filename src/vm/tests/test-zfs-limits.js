// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var fs = require('fs');
var utils = require('/usr/vm/node_modules/utils');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var trim = utils.trim;

test('test create vm with filesystem and snapshot limits', function (t) {
    var payload = {
        alias: 'test-zfs-limits-' + process.pid,
        autoboot: true,
        brand: 'joyent-minimal',
        delegate_dataset: true,
        do_not_inventory: true,
        max_locked_memory: 512,
        max_physical_memory: 512,
        max_swap: 1024,
        zfs_filesystem_limit: 10,
        zfs_snapshot_limit: 11
    };
    var state = {brand: payload.brand};

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            // Sanity check VM metadata
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'load obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }
                t.equal(obj.zfs_filesystem_limit, 10, 'zfs_filesystem_limit');
                t.equal(obj.zfs_snapshot_limit, 11, 'zfs_snapshot_limit');
                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {
                zfs_filesystem_limit: '',
                zfs_snapshot_limit: undefined
            }, function (e) {
                t.ok(!e, 'updated VM: ' + (e ? e.message : 'success'));
                cb(e);
            });
        }, function (cb) {
            // check again, should be gone now
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'load obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }
                t.equal(obj.zfs_filesystem_limit, undefined, 'zfs_filesystem_limit');
                t.equal(obj.zfs_snapshot_limit, undefined, 'zfs_snapshot_limit');
                cb();
            });
        }
    ]);
});
