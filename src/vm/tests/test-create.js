// Copyright 2014 Joyent, Inc.  All rights reserved.
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
    autoboot: false,
    brand: 'joyent-minimal',
    alias: 'autotest-' + process.pid,
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
    autoboot: false,
    brand: 'joyent-minimal',
    alias: 'autotest-' + process.pid,
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
}

var payload_with_null_alias = {
    autoboot: false,
    brand: 'joyent-minimal',
    alias: null,
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: 'dhcp'
        }
    ]
}


test('test create with invalid IP', function(t) {

    p = JSON.parse(JSON.stringify(payload_invalid_ip));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with tags', function(t) {

    var p = JSON.parse(JSON.stringify(payload_with_tags));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
            function (cb) {
                VM.load(state.uuid, {fields: ['tags']}, function (err, obj) {
                    t.ok(!err, 'reloaded VM after create: ' + (err ? err.message : 'no error'));
                    if (err) {
                        cb(err);
                        return;
                    }
                    t.ok((obj.tags.hello === 'world'), 'tags: ' + JSON.stringify(obj.tags));
                    cb();
                });
            }
        ], function (err) {
            t.end();
        }
    );
});

test('test create with null alias', function(t) {

    var p = JSON.parse(JSON.stringify(payload_with_null_alias));
    var state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, {fields: ['alias']}, function (err, obj) {
                t.ok(!err, 'reloaded VM after create: ' + (err ? err.message : 'no error'));
                if (err) {
                    cb(err);
                    return;
                }
                t.ok((obj.alias === undefined), 'alias: ' + JSON.stringify(obj.alias));
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

