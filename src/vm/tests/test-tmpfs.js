// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that tmpfs works as expected when setting/unsetting
//

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

function grabZoneInfo(zonename, callback) {
    var cmd = 'zlogin ' + zonename + ' "mount | grep /tmp || /bin/true; '
        + 'grep \'/tmp\' /etc/vfstab" || /bin/true';
    var result = {};

    /* BEGIN JSSTYLED */
    // Output should be approximately:
    // /tmp on swap read/write/setuid/nodevices/xattr/size=4096m/zone=47a8ae00-014b-4b69-97d8-7bed6fe02c7a/dev=89c003e on Mon Sep 22 20:56:57 2014
    // swap        -   /tmp                tmpfs    -   yes    size=4096m
    /* END JSSTYLED */
    exec(cmd, function (error, stdout, stderr) {
        if (error) {
            callback(error);
            return;
        }

        stdout.split('\n').forEach(function (line) {
            var matches;
            if (line.match(/^\/tmp on swap/)) {
                result.tmp_mounted = true;
                /* JSSTYLED */
                matches = line.match(/\/size=([0-9a-z]+)\//);
                if (matches) {
                    result.tmp_mounted_size = matches[1];
                }
            } else if (line.match(/^swap.*\/tmp/)) {
                result.vfstab_has_line = true;
                /* JSSTYLED */
                matches = line.match(/size=([0-9a-z]+)/);
                if (matches) {
                    result.vfstab_size = matches[1];
                }
            }
        });
        callback(null, result);
    });
}

function waitForSvc(t, zonename, svc, state, callback) {
    var cmd = '/usr/bin/svcs -z ' + zonename + ' -Ho state ' + svc;
    var cur_state = '';

    async.until(function () {
        return (cur_state === state);
    }, function (cb) {
        exec(cmd, function (error, stdout, stderr) {
            var result = stdout.split('\n')[0];
            if (result && result.length > 0) {
                cur_state = result;
            }
            cb();
        });
    }, function (err) {
        t.equal(cur_state, state, svc + ' went "' + cur_state + '"');
        callback(err);
    });
}

test('test with default tmpfs', function (t) {
    var payload = {
        alias: 'test-tmpfs',
        autoboot: true,
        brand: 'joyent',
        do_not_inventory: true,
        max_locked_memory: 512,
        max_physical_memory: 512,
        max_swap: 1024
    };
    var state = {brand: payload.brand};

    function checkTmpfs(expected, string, cb) {
        VM.load(state.uuid, function (err, obj) {
            t.ok(!err, 'load obj for new VM');
            if (err) {
                cb(err);
                return;
            }
            t.equal(obj.tmpfs, expected, string);
            cb();
        });
    }

    function checkZoneState(expected, string, cb) {
        grabZoneInfo(state.uuid, function (err, info) {
            t.ok(!err, 'grabZoneInfo' + (err ? ': ' + err.message : ''));
            if (err) {
                cb(err);
                return;
            }

            t.deepEqual(info, expected, string);
            cb();
        });
    }

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            checkTmpfs(payload.max_physical_memory,
                'check that tmpfs === max_physical_memory', cb);
        }, function (cb) {
            checkZoneState({
                tmp_mounted: true,
                tmp_mounted_size: payload.max_physical_memory + 'm',
                vfstab_has_line: true,
                vfstab_size: payload.max_physical_memory + 'm'
            }, 'zone files/mounts are as expected', cb);
        }, function (cb) {
            VM.update(state.uuid, {tmpfs: 0}, function (err) {
                t.ok(!err, 'updated VM with tmpfs=0');
                cb(err);
            });
        }, function (cb) {
            // wait for mdata:fetch
            waitForSvc(t, state.uuid, 'svc:/smartdc/mdata:fetch', 'online', cb);
        }, function (cb) {
            // Should be 0 value in the object
            checkTmpfs(0, 'check that tmpfs === 0 after update', cb);
        }, function (cb) {
            checkZoneState({
                tmp_mounted: true,
                tmp_mounted_size: payload.max_physical_memory + 'm'
            }, 'zone files/mounts are as expected after update', cb);
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM after update');
                cb(err);
            });
        }, function (cb) {
            // None of the things should be here.
            checkZoneState({},
                'zone files/mounts are as expected after reboot', cb);
        }
    ]);
});

test('test with tmpfs=0', function (t) {
    var payload = {
        alias: 'test-tmpfs',
        autoboot: true,
        brand: 'joyent',
        do_not_inventory: true,
        max_locked_memory: 512,
        max_physical_memory: 512,
        max_swap: 1024,
        tmpfs: 0
    };
    var state = {brand: payload.brand};

    function checkTmpfs(expected, string, cb) {
        VM.load(state.uuid, function (err, obj) {
            t.ok(!err, 'load obj for new VM');
            if (err) {
                cb(err);
                return;
            }
            t.equal(obj.tmpfs, expected, string);
            cb();
        });
    }

    function checkZoneState(expected, string, cb) {
        grabZoneInfo(state.uuid, function (err, info) {
            t.ok(!err, 'grabZoneInfo' + (err ? ': ' + err.message : ''));
            if (err) {
                cb(err);
                return;
            }

            t.deepEqual(info, expected, string);
            cb();
        });
    }

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            checkTmpfs(0, 'check that tmpfs === 0', cb);
        }, function (cb) {
            checkZoneState({}, 'zone files/mounts have no tmpfs', cb);
        }, function (cb) {
            VM.update(state.uuid, {tmpfs: 256}, function (err) {
                t.ok(!err, 'updated VM with tmpfs=256');
                cb(err);
            });
        }, function (cb) {
            // wait for mdata:fetch
            waitForSvc(t, state.uuid, 'svc:/smartdc/mdata:fetch', 'online', cb);
        }, function (cb) {
            // Should be 256 value in the object
            checkTmpfs(256, 'check that tmpfs === 256 after update', cb);
        }, function (cb) {
            checkZoneState({
                vfstab_has_line: true,
                vfstab_size: '256m'
            }, 'zone files/mounts are as expected after update', cb);
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM after update');
                cb(err);
            });
        }, function (cb) {
            // wait for filesystem/minimal:default to mount /tmp
            waitForSvc(t, state.uuid, 'svc:/system/filesystem/minimal:default',
                'online', cb);
        }, function (cb) {
            checkZoneState({
                tmp_mounted: true,
                tmp_mounted_size: '256m',
                vfstab_has_line: true,
                vfstab_size: '256m'
            }, 'zone files/mounts are as expected after reboot', cb);
        }
    ]);
});
