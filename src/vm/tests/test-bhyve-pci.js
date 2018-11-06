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
 */

/*
 * There's a lot more bhyve testing that could be done; this just covers some
 * basic sanity testing of PCI passthrough validation.
 */

var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var payload = {
    alias: 'test-bhyve-pci-' + process.pid,
    autoboot: false,
    brand: 'bhyve',
    ram: 1024,
    vcpus: 2,
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp',
            model: 'virtio'
        }
    ],
    disks: [
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            boot: true,
            model: 'virtio'
        }
    ]
};

function validate_bad_value(t, prop, devs) {
    var propname = 'pci_devices.0.' + prop;

    payload.pci_devices = devs;

    VM.validate(payload.brand, 'create',  payload, function (errors) {
        t.ok(errors, 'invalid payload');
        if (errors) {
            t.ok(errors.bad_values.indexOf(propname) !== -1,
                'bad value should be listed: ' + JSON.stringify(errors));
        }
        t.end();
    });
}

function validate_missing_property(t, prop, devs) {
    var propname = 'pci_devices.0.' + prop;

    payload.pci_devices = devs;

    VM.validate(payload.brand, 'create',  payload, function (errors) {
        t.ok(errors, 'invalid payload');
        if (errors) {
            t.ok(errors.missing_properties.indexOf(propname) !== -1,
                'missing property should be listed: ' + JSON.stringify(errors));
        }
        t.end();
    });
}

test('test validate with bad pci_device path', function (t) {
    validate_bad_value(t, 'path', [
        {
            path: '/notdevices/pci@0,0/',
            pci_slot: '5:0:0'
        }
    ]);
});

test('test validate with bad pci_slot', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: 'foo'
        }
    ]);
});

test('test validate with bad pci_slot (2)', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '4:0:0:0'
        }
    ]);
});

test('test validate with bad pci_slot (3)', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '256:0:0'
        }
    ]);
});

test('test validate with bad pci_slot (4)', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '-1:0:0'
        }
    ]);
});


test('test validate with bad pci_slot (5)', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '4:32:0'
        }
    ]);
});

test('test validate with bad pci_slot (6)', function (t) {
    validate_bad_value(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '4:0:8'
        }
    ]);
});

test('test validate with bad model)', function (t) {
    validate_bad_value(t, 'model', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1',
            pci_slot: '4:0:0',
            model: 'passover'
        }
    ]);
});

test('test validate with missing path', function (t) {
    validate_missing_property(t, 'path', [
        {
            pci_slot: '4:0:0'
        }
    ]);
});

test('test validate with missing pci_slot', function (t) {
    validate_missing_property(t, 'pci_slot', [
        {
            path: '/devices/pci@0,0/pci8086,6f0a@3,2/pci15d9,1528@9,1'
        }
    ]);
});
