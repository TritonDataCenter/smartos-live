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
 * These tests ensure that default values don't change accidentally.
 */

var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vasync = require('/usr/vm/node_modules/vasync');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('create and destroy 50 zones', function(t) {
    var i = 0;

    vasync.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            var state = {'brand': 'joyent-minimal'};
            vmtest.on_new_vm(t, image_uuid, {
                alias: 'test-50-creates-' + i,
                autoboot: false,
                do_not_inventory: true,
                nowait: true
            }, state, [
                function (cb) {
                    VM.load(state.uuid, function(err, obj) {
                        i++;
                        if (err) {
                            t.ok(false, 'load obj from new VM: ' + err.message);
                            return cb(err);
                        }
                        t.ok(true, 'loaded obj for new VM');
                        cb();
                    });
                }
            ], callback);
        }, function (err, cb) {
            t.end();
        }
    );
});
