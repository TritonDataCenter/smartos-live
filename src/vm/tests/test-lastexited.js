/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

/*
 * These tests ensure that exit_status and exit_timestamp fields work as
 * expected when starting/stopping/zone exits
 */

var child_process = require('child_process');
var execFile = child_process.execFile;
var fs = require('fs');
var path = require('path');
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
var old_timestamp;

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
            if (obj
                && obj.zone_state === 'installed'
                && old_timestamp !== obj.exit_timestamp) {

                old_timestamp = obj.exit_timestamp;
                t.ok(true, 'have lastexited');
                callback();
                return;
            }

            setTimeout(_checkExists, 100);
        });
    }
    _checkExists();
}

function writeInit(uuid, contents, callback) {
    var filename = path.join('/zones', uuid, 'root/root/init');
    var opts = {
        encoding: 'utf8',
        mode: parseInt('0755', 8)
    };

    fs.writeFile(filename, contents, opts, function (err) {
        if (err) {
            callback(err);
            return;
        }

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
                t.ok(fields.exit_timestamp !== undefined, 'exit timestamp: '
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
                t.ok(fields.exit_timestamp !== undefined, 'exit timestamp: '
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
                t.ok(fields.exit_timestamp !== undefined, 'exit timestamp: '
                    + fields.exit_timestamp);
                cb();
            });
        }
    ]);
});
