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

var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var imgadm = require('/usr/img/lib/cli.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var uefi_img_uuid = '45d86edd-8cf4-6c7c-f018-8e27b24c550e';

function get_payload() {
    var payload = {
        alias: 'test-bhyve-uefi-' + process.pid,
        autoboot: false,
        brand: 'bhyve',
        ram: "512",
        vcpus: "2",
        do_not_inventory: true,
        disks: [
            {
                image_uuid: uefi_img_uuid,
                boot: true,
            }
        ],
    };

    return JSON.parse(JSON.stringify(payload))
}

test('validate unspecified requirements.bootrom with uefi image', function(t) {
    payload = get_payload();
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.ok(payload.hasOwnProperty('bootrom') && payload.bootrom == 'uefi',
            'payload.bootrom updated to "uefi"');
        t.done();
    });
});

test('validate uefi payload with uefi image as boot disk', function(t) {
    payload = get_payload();
    payload.bootrom = 'uefi';
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.ok(payload.bootrom == 'uefi', 'payload.bootrom is still "uefi"');
        t.done();
    });
});

test('validate bios payload with uefi image as boot disk', function(t) {
    payload = get_payload();
    payload.bootrom = 'bios';
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(err && err.bad_values.indexOf('bootrom') !== -1,
            'bad bootrom detected');
        t.done();
    });
});

test('validate uefi payload with bios image as boot disk', function(t) {
    payload = get_payload();
    payload.bootrom = 'uefi';
    payload.disks[0].image_uuid = vmtest.CURRENT_BHYVE_CENTOS_UUID;
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(err && err.bad_values.indexOf('bootrom') !== -1,
            'bad bootrom detected');
        t.done();
    });
});

test('validate bios payload with bios image as boot disk', function(t) {
    payload = get_payload();
    payload.bootrom = 'bios';
    payload.disks[0].image_uuid = vmtest.CURRENT_BHYVE_CENTOS_UUID;
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.ok(payload.bootrom == 'bios', 'payload.bootrom is still "bios"');
        t.done();
    });
});

test('validate bios/uefi boot/data disks with unspecified bootrom',
    function(t) {
    payload = get_payload();
    payload.disks = [
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            boot: true,
        },
        {
            image_uuid: uefi_img_uuid
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.done();
    });
});

test('validate bios/uefi boot/data disks with bios bootrom', function(t) {
    payload = get_payload();
    payload.bootrom = 'bios';
    payload.disks = [
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            boot: true,
        },
        {
            image_uuid: uefi_img_uuid
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.done();
    });
});

test('validate bios/uefi boot/data disks with uefi bootrom', function(t) {
    payload = get_payload();
    payload.bootrom = 'uefi';
    payload.disks = [
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            boot: true,
        },
        {
            image_uuid: uefi_img_uuid
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(err && err.bad_values.indexOf('bootrom') !== -1,
            'bad bootrom detected');
        t.done();
    });
});

test('validate uefi/bios boot/data disks with bios bootrom', function(t) {
    payload = get_payload();
    payload.bootrom = 'bios';
    payload.disks = [
        {
            image_uuid: uefi_img_uuid,
            boot: true,
        },
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(err && err.bad_values.indexOf('bootrom') !== -1,
            'bad bootrom detected');
        t.done();
    });
});

test('validate uefi/bios boot/data disks with unspecified bootrom',
    function(t) {
    payload = get_payload();
    payload.disks = [
        {
            image_uuid: uefi_img_uuid,
            boot: true,
        },
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.done();
    });
});

test('validate uefi/bios boot/data disks with uefi bootrom', function(t) {
    payload = get_payload();
    payload.bootrom = 'uefi';
    payload.disks = [
        {
            image_uuid: uefi_img_uuid,
            boot: true,
        },
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID
        }];
    VM.validate(payload.brand, 'create', payload, function(err) {
        t.ok(!err, err ? JSON.stringify(err) : 'payload validated');
        t.ok(payload.hasOwnProperty('bootrom') && payload.bootrom == 'uefi',
            'payload.bootrom updated to "uefi"');
        t.done();
    });
});
