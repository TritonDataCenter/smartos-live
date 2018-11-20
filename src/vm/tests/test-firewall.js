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

var assert = require('/usr/node/node_modules/assert-plus');
var common = require('./common');
var f = require('util').format;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var PAYLOAD = {
    alias: f('test-firewall-%d', process.pid),
    autoboot: true,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    ram: 64
};

/*
 * Updates the `firewall_enabled` property of the `uuid` VM.
 */
function setVmFirewallEnabled(t, uuid, want, cb) {
    assert.ok(t, 't');
    assert.uuid(uuid, 'uuid');
    assert.bool(want, 'want');
    assert.func(cb, 'cb');

    var obj = {
        firewall_enabled: want
    };

    VM.update(uuid, obj, function (err) {
        common.ifError(t, err, f('VM.update firewall_enabled=%j', want));
        cb(err);
    });
}

/*
 * Checks to see if the `firewall_enabled` property of the `uuid` VM is set to
 * `want`.
 */
function checkVmFirewallEnabled(t, uuid, want, cb) {
    assert.ok(t, 't');
    assert.uuid(uuid, 'uuid');
    assert.bool(want, 'want');
    assert.func(cb, 'cb');

    VM.load(uuid, function (err, vmobj) {
        common.ifError(t, err, f('VM.load firewall_enabled=%j', want));
        if (err) {
            cb(err);
            return;
        }

        t.deepEqual(vmobj.firewall_enabled, want,
            f('vmobj.firewall_enabled === %j', want));
        cb();
    });
}

test('test firewall default value', function (t) {
    var state = {
        brand: PAYLOAD.brand
    };

    vmtest.on_new_vm(t, IMAGE_UUID, PAYLOAD, state, [
        // Ensure firewall disabled (default value)
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, false, cb);
        }
    ]);
});


// TRITON-881 vminfod watchForChanges timeout exceeded during vmadm update
test('test firewall update (TRITON-881)', function (t) {
    var state = {
        brand: PAYLOAD.brand
    };

    vmtest.on_new_vm(t, IMAGE_UUID, PAYLOAD, state, [
        // Ensure firewall disabled (default value)
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, false, cb);
        },

        // Enable firewall
        function (cb) {
            setVmFirewallEnabled(t, state.uuid, true, cb);
        },

        // Ensure firewall enabled
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, true, cb);
        },

        // Enable firewall (again - no effective change)
        function (cb) {
            setVmFirewallEnabled(t, state.uuid, true, cb);
        },

        // Ensure firewall enabled
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, true, cb);
        },

        // Disable firewall
        function (cb) {
            setVmFirewallEnabled(t, state.uuid, false, cb);
        },

        // Ensure firewall disabled
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, false, cb);
        },

        // Disable firewall (again - no effective change)
        function (cb) {
            setVmFirewallEnabled(t, state.uuid, false, cb);
        },

        // Ensure firewall disabled
        function (cb) {
            checkVmFirewallEnabled(t, state.uuid, false, cb);
        }
    ]);
});
