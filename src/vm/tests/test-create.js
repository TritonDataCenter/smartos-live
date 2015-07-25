// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create behaves correctly.
//

var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var payload_invalid_ip = {
    alias: 'test-create-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: '10.99.99.12,10.99.99.33,10.99.99.34',
            gateway: '10.99.99.1',
            netmask: '255.255.255.0'
        }
    ]
};

var payload_with_tags = {
    alias: 'test-create-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    tags: {
        hello: 'world'
    },
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp'
        }
    ]
};

var payload_with_null_alias = {
    alias: null,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp'
        }
    ]
};

var payload_with_zvol_as_zoneroot = {
    alias: 'test-create-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    image_uuid: vmtest.CURRENT_UBUNTU_UUID,
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp'
        }
    ]
};

var payload_with_smartos_zoneroot = {
    alias: 'test-create-' + process.pid,
    autoboot: false,
    brand: 'lx',
    image_uuid: vmtest.CURRENT_SMARTOS_UUID,
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp'
        }
    ]
};

var payload_with_rctls = {
    alias: 'test-create-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    max_physical_memory: 1024,
    max_shm_memory: 4096,
    max_shm_ids: 256,
    max_sem_ids: 256,
    max_msg_ids: 256
};

test('test create with invalid IP', function (t) {
    var p = JSON.parse(JSON.stringify(payload_invalid_ip));
    var state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with tags', function (t) {

    var p = JSON.parse(JSON.stringify(payload_with_tags));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
            function (cb) {
                VM.load(state.uuid, {fields: ['tags']}, function (err, obj) {
                    t.ok(!err, 'reloaded VM after create: '
                        + (err ? err.message : 'no error'));
                    if (err) {
                        cb(err);
                        return;
                    }
                    t.ok((obj.tags.hello === 'world'), 'tags: '
                        + JSON.stringify(obj.tags));
                    cb();
                });
            }
        ], function (err) {
            t.end();
        }
    );
});

test('test create with null alias', function (t) {

    var p = JSON.parse(JSON.stringify(payload_with_null_alias));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, {fields: ['alias']}, function (err, obj) {
                t.ok(!err, 'reloaded VM after create: '
                    + (err ? err.message : 'no error'));
                if (err) {
                    cb(err);
                    return;
                }
                t.ok((obj.alias === undefined), 'alias: '
                    + JSON.stringify(obj.alias));
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create with wrong image_uuid type (KVM for OS VM)', function (t) {

    var p = JSON.parse(JSON.stringify(payload_with_zvol_as_zoneroot));
    var state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, p.image_uuid, p, state, [], function (err) {
        t.end();
    });
});

test('test create with wrong image_uuid type (SmartOS for LX)', function (t) {

    var p = JSON.parse(JSON.stringify(payload_with_smartos_zoneroot));
    var state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, p.image_uuid, p, state, [], function (err) {
        t.end();
    });
});

test('test create with rctls', function (t) {

    var p = JSON.parse(JSON.stringify(payload_with_rctls));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, {}, function (err, obj) {
                t.ok(!err, 'reloaded VM after create: '
                    + (err ? err.message : 'no error'));
                if (err) {
                    cb(err);
                    return;
                }
                t.ok((obj.max_msg_ids === payload_with_rctls.max_msg_ids),
                    'max_msg_ids: ' + obj.max_msg_ids);
                t.ok((obj.max_sem_ids === payload_with_rctls.max_sem_ids),
                    'max_sem_ids: ' + obj.max_sem_ids);
                t.ok((obj.max_shm_ids === payload_with_rctls.max_shm_ids),
                    'max_shm_ids: ' + obj.max_shm_ids);
                t.ok((obj.max_shm_memory === payload_with_rctls.max_shm_memory),
                    'max_shm_memory: ' + obj.max_shm_memory);
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});
