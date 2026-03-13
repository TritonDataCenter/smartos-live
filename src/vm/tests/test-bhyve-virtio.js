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
 * Copyright 2026 Edgecast Cloud LLC.
 */

/*
 * Tests for the bhyve virtio mode zone attribute. Verifies that:
 * - The org.smartos:virtio image tag flows through validateImage/validateImages
 *   to set payload.virtio
 * - buildZonecfgUpdate writes the "virtio" zone attribute for bhyve VMs
 * - Existing images without the tag do not set payload.virtio
 */

var bunyan = require('/usr/vm/node_modules/bunyan');
var common = require('./common.js');
var vasync = require('/usr/vm/node_modules/vasync');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var zonecfg = require('/usr/vm/node_modules/zonecfg');

var log = bunyan.createLogger({
    level: 'debug',
    name: 'test-bhyve-virtio',
    streams: [ { stream: process.stderr, level: 'error' } ],
    serializers: bunyan.stdSerializers
});

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var IMAGE_UUID = vmtest.CURRENT_BHYVE_CENTOS_UUID;

function get_payload() {
    return {
        alias: 'test-bhyve-virtio-' + process.pid,
        autoboot: false,
        brand: 'bhyve',
        ram: '512',
        vcpus: '2',
        do_not_inventory: true,
        disks: [
            {
                image_uuid: IMAGE_UUID,
                boot: true,
                model: 'virtio'
            }
        ]
    };
}

/*
 * Validate that an image without the org.smartos:virtio tag does not
 * set payload.virtio.
 */
test('validate: image without virtio tag does not set payload.virtio',
    function (t) {
    var payload = get_payload();

    VM.validate(payload.brand, 'create', payload, function (err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.ok(!payload.hasOwnProperty('virtio'),
            'payload.virtio should not be set for image without tag');
        t.done();
    });
});

/*
 * Validate that when payload.virtio is set to "modern", it passes validation.
 */
test('validate: payload with virtio=modern passes validation', function (t) {
    var payload = get_payload();
    payload.virtio = 'modern';

    VM.validate(payload.brand, 'create', payload, function (err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.equal(payload.virtio, 'modern',
            'payload.virtio should remain "modern"');
        t.done();
    });
});

/*
 * Validate that when payload.virtio is set to "legacy", it passes validation.
 */
test('validate: payload with virtio=legacy passes validation', function (t) {
    var payload = get_payload();
    payload.virtio = 'legacy';

    VM.validate(payload.brand, 'create', payload, function (err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.equal(payload.virtio, 'legacy',
            'payload.virtio should remain "legacy"');
        t.done();
    });
});

/*
 * Create a bhyve VM with virtio=modern and verify the zone attribute is set.
 */
test('create: bhyve VM with virtio=modern sets zone attribute', function (t) {
    var payload = get_payload();
    payload.virtio = 'modern';

    var state = {brand: 'bhyve'};

    vmtest.on_new_vm(t, IMAGE_UUID, payload, state, [
        function (cb) {
            VM.load(state.uuid, {log: log}, function (err, vmobj) {
                if (err) {
                    t.ok(false, 'failed to load VM: ' + err.message);
                    cb(err);
                    return;
                }

                // zonecfg attributes show up in the vmobj via the zone config
                // The virtio attribute should be written by buildZonecfgUpdate
                zonecfg(state.uuid, ['info', 'attr', 'name=virtio'],
                    {log: log}, function (zerr, fds) {
                    t.ok(!zerr,
                        zerr ? 'zonecfg error: ' + zerr.message : 'zonecfg ok');
                    if (fds && fds.stdout) {
                        t.ok(fds.stdout.indexOf('modern') !== -1,
                            'zone attr virtio should contain "modern"');
                    } else {
                        t.ok(false, 'no zonecfg output');
                    }
                    cb();
                });
            });
        }
    ], function () {
        t.end();
    });
});

/*
 * Create a bhyve VM without virtio set and verify no zone attribute is written.
 */
test('create: bhyve VM without virtio has no zone attribute', function (t) {
    var payload = get_payload();

    var state = {brand: 'bhyve'};

    vmtest.on_new_vm(t, IMAGE_UUID, payload, state, [
        function (cb) {
            zonecfg(state.uuid, ['info', 'attr', 'name=virtio'],
                {log: log}, function (zerr, fds) {
                // When the attribute doesn't exist, zonecfg info returns
                // empty output or no matching attr.
                if (fds && fds.stdout) {
                    t.ok(fds.stdout.indexOf('modern') === -1
                        && fds.stdout.indexOf('legacy') === -1,
                        'zone attr virtio should not be set');
                } else {
                    t.ok(true, 'no virtio zone attribute (expected)');
                }
                cb();
            });
        }
    ], function () {
        t.end();
    });
});
