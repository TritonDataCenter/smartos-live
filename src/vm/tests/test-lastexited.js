// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that exit_status and exit_timestamp fields work as
// expected when starting/stopping/zone exits
//

var async = require('/usr/node/node_modules/async');
var child_process = require('child_process');
var exec = child_process.exec;
var execFile = child_process.execFile;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-lastexited-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024
};
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

function getExitFields(t, state, callback) {
    VM.load(state.uuid, function (err, obj) {
        var results = {};

        t.ok(!err, 'loading obj for new VM');
        if (err) {
            callback(err);
            return;
        }

        results.zone_state = obj.zone_state;
        results.exit_status = obj.exit_status;
        results.exit_timestamp = obj.exit_timestamp;

        callback(null, results);
    });
}

function waitInstalled(t, uuid, callback)
{
    function _checkExists() {
        VM.load(uuid, function (err, obj) {
            if (!fs.existsSync('/zones/' + uuid + '/lastexited')
                || !obj || (obj.zone_state !== 'installed')) {

                setTimeout(_checkExists, 100);
            } else {
                t.ok(true, 'have lastexited');
                callback();
            }
        });
    }
    _checkExists();
}

function writeInit(uuid, contents, callback) {
    var filename = '/zones/' + uuid + '/root/root/init';

    fs.writeFile(filename, contents, function (err) {
        if (err) {
            callback(err);
            return;
        }

        /*jsl:ignore*/
        fs.chmodSync(filename, 0755);
        /*jsl:end*/
        callback();
    });
}

function zoneadm(args, callback)
{
    var cmd = '/usr/sbin/zoneadm';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

test('test lastexited not set, then set', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.autoboot = false;
    payload.docker = true; // restart_init will also be set false
    payload.init_name = '/root/init';

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getExitFields(t, state, function (err, fields) {
                t.ok(!err, 'getting fields: '
                    + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(fields.zone_state, 'installed', 'zone is stopped');
                t.equal(fields.exit_status, undefined, 'no exit status');
                t.equal(fields.exit_timestamp, undefined, 'no exit timestamp');
                cb();
            });
        }, function (cb) {
            writeInit(state.uuid, '#!/usr/bin/bash\nexit 0',
                function (err) {
                    t.ok(!err, 'wrote init replacement (exit 0)');
                    cb(err);
                }
            );
        }, function (cb) {
            // Start using zoneadm because it will exit right away
            zoneadm(['-z', state.uuid, 'boot'], function (err, fds) {
                t.ok(!err, 'starting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            // wait for /zones/<uuid>/lastexited to exist
            waitInstalled(t, state.uuid, cb);
        }, function (cb) {
            getExitFields(t, state, function (err, fields) {
                t.ok(!err, 'getting fields: '
                    + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(fields.zone_state, 'installed', 'zone is stopped');
                t.equal(fields.exit_status, 0, 'exit status 0');
                t.ok(fields.exit_timestamp != undefined, 'exit timestamp: '
                    + fields.exit_timestamp);
                cb();
            });
        }, function (cb) {
            writeInit(state.uuid, '#!/usr/bin/bash\nexit 13',
                function (err) {
                    t.ok(!err, 'wrote init replacement (exit 13)');
                    cb(err);
                }
            );
        }, function (cb) {
            // Start using zoneadm because it will exit right away
            zoneadm(['-z', state.uuid, 'boot'], function (err, fds) {
                t.ok(!err, 'starting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            // wait for /zones/<uuid>/lastexited to exist
            waitInstalled(t, state.uuid, cb);
        }, function (cb) {
            getExitFields(t, state, function (err, fields) {
                t.ok(!err, 'getting fields: '
                    + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(fields.zone_state, 'installed', 'zone is stopped');
                t.equal(fields.exit_status, 13, 'exit status 13');
                t.ok(fields.exit_timestamp != undefined, 'exit timestamp: '
                    + fields.exit_timestamp);
                cb();
            });
        }, function (cb) {
            writeInit(state.uuid, '#!/usr/bin/bash\nkill -9 $$\n',
                function (err) {
                    t.ok(!err, 'wrote init replacement (kills self)');
                    cb(err);
                }
            );
        }, function (cb) {
            // Start using zoneadm because it will exit right away
            zoneadm(['-z', state.uuid, 'boot'], function (err, fds) {
                t.ok(!err, 'starting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            // wait for /zones/<uuid>/lastexited to exist
            waitInstalled(t, state.uuid, cb);
        }, function (cb) {
            getExitFields(t, state, function (err, fields) {
                t.ok(!err, 'getting fields: '
                    + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(fields.zone_state, 'installed', 'zone is stopped');
                t.equal(fields.exit_status, -9, 'exit status -9');
                t.ok(fields.exit_timestamp != undefined, 'exit timestamp: '
                    + fields.exit_timestamp);
                cb();
            });
        }
    ]);
});
