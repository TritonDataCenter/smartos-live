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
 * Copyright (c) 2017, Joyent, Inc.
 *
 * These tests ensure that delete behaves correctly.
 */

var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vasync = require('/usr/vm/node_modules/vasync');

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
                if (err && err.message.match(/No such zone configured/)) {
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

