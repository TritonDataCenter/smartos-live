// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create behaves correctly.
//

process.env['TAP'] = 1;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var payload_invalid_ip = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true,
    'nics': [
        {
            'nic_tag': 'admin',
            'ip': '10.99.99.12,10.99.99.33,10.99.99.34',
            'gateway': '10.99.99.1',
            'netmask': '255.255.255.0'
        }
    ]
};

test('test create with invalid IP', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_invalid_ip));
    state = {'brand': p.brand, 'expect_create_failure': true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

