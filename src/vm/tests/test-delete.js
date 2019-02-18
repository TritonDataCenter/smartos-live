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
 * Copyright (c) 2019, Joyent, Inc.
 *
 * These tests ensure that delete behaves correctly.
 */

var assert = require('/usr/node/node_modules/assert-plus');
var common = require('./common');
var f = require('util').format;
var libuuid = require('/usr/node/node_modules/uuid');
var vasync = require('/usr/vm/node_modules/vasync');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

// w/ OS-2284 we sometimes blew up deleting a non-existent VM, test that we
// haven't regressed.
test('test deleting nonexistent VM', function(t) {
    var i = 0;
    vasync.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            i++;
            var uuid = libuuid.create();
            t.ok(uuid, 'uuid is: ' + uuid);
            VM.delete(uuid, {}, function (err) {
                if (err && err.code === 'ENOENT') {
                    t.ok(true, 'zone ' + uuid + ' already does not exist, skipping');
                } else {
                    t.ok(!err, 'deleted VM: ' + (err ? err.message : 'success'));
                }
                callback();
            });
        }, function (err, cb) {
            t.end();
        }
    );
});

// Test deleting a VM that is in state "configured"
test('test deleting "configured" VM', function (t) {
    /*
     * A zone will go into "configured" if it is created with a LOFS mount that
     * does not exist in the GZ.
     */

    var source_fs = '/this/path/does/not/exist/nor/should/it';
    var target_fs = '/foo';

    var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
    var payload = {
        alias: 'test-delete-configure-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        autoboot: false,
        do_not_inventory: true,
        filesystems: [
            {
                source: source_fs,
                target: target_fs,
                type: 'lofs',
                option: [
                    'ro'
                ]
            }

        ]
    };
    var uuid;

    vasync.pipeline({funcs: [
        function (_, cb) {
            /*
             * We expect an error here that looks like:
             *
             * /could not verify fs $target_fs: could not access $source_fs/
             */
            var expectedError = f('could not verify fs %s: ' +
                'could not access %s', target_fs, source_fs);

            VM.create(payload, function (err, vmobj) {
                t.ok(err, 'error creating VM');

                if (err) {
                    assert.string(err.message, 'err.message');
                    t.ok(err.message.indexOf(expectedError) >= 0,
                        'found expected error message: ' + expectedError);
                }

                uuid = vmobj && vmobj.uuid;
                t.ok(uuid, 'VM uuid found: ' + uuid);
                assert.uuid(uuid, 'uuid');

                cb();
            });
        },
        function (_, cb) {
            /*
             * The load should succeed and the state should be "configured".
             */
            VM.load(uuid, function (err, vmobj) {
                common.ifError(t, err, 'VM.load ' + uuid);

                var state = vmobj && vmobj.state;
                t.equal(state, 'configured', 'VM in state configured');

                cb();
            });
        },
        function (_, cb) {
            /*
             * Delete the "configured" VM - this should succeed without issue.
             */
            VM.delete(uuid, function (err) {
                common.ifError(t, err, 'VM.delete ' + uuid);

                cb();
            });
        }
    ]}, function (err) {
        t.end();
    });
});
