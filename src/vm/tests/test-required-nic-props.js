// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create works with specific options set.
//

process.env['TAP'] = 1;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var payload_missing_netmask = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true,
    'nics': [
        {
            'nic_tag': 'admin',
            'ip': '10.99.99.222',
            'gateway': '10.99.99.1'
        }
    ]
};

var payload_missing_nic_tag = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true,
    'nics': [
        {
            'ip': '10.99.99.222',
            'netmask': '255.255.255.0',
            'gateway': '10.99.99.1'
        }
    ]
};

var payload_good = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true,
    'nics': [
        {
            'mac': '01:02:03:04:05:06',
            'nic_tag': 'admin',
            'ip': '10.99.99.222',
            'netmask': '255.255.255.0',
            'gateway': '10.99.99.1'
        }
    ]
};

// for testing that we don't require netmask when dhcp
var payload_good_dhcp = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true,
    'nics': [
        {
            'nic_tag': 'admin',
            'ip': 'dhcp'
        }
    ]
};

var payload_kvm_missing_netmask = {
    'brand': 'kvm',
    'vcpus': 1,
    'ram': 256,
    'alias': 'autotest-' + process.pid,
    'autoboot': false,
    'disks': [
      {
        'boot': true,
        'model': 'virtio',
        'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
        'image_name': vmtest.CURRENT_UBUNTU_NAME,
        'image_size': vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    'nics': [
      {
        'nic_tag': 'admin',
        'model': 'virtio',
        'ip': '10.99.99.225',
        'gateway': '10.99.99.1',
        'primary': true
      }
    ]
};

var payload_kvm_missing_model = {
    'brand': 'kvm',
    'vcpus': 1,
    'ram': 256,
    'autoboot': false,
    'alias': 'autotest-' + process.pid,
    'disks': [
      {
        'boot': true,
        'model': 'virtio',
        'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
        'image_name': vmtest.CURRENT_UBUNTU_NAME,
        'image_size': vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    'nics': [
      {
        'nic_tag': 'admin',
        'ip': '10.99.99.225',
        'gateway': '10.99.99.1',
        'netmask': '255.255.255.0',
        'primary': true
      }
    ]
};

var payload_kvm_missing_model_but_have_driver = {
    'brand': 'kvm',
    'vcpus': 1,
    'ram': 256,
    'autoboot': false,
    'alias': 'autotest-' + process.pid,
    'nic_driver': 'virtio',
    'disks': [
      {
        'boot': true,
        'model': 'virtio',
        'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
        'image_name': vmtest.CURRENT_UBUNTU_NAME,
        'image_size': vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    'nics': [
      {
        'nic_tag': 'admin',
        'ip': '10.99.99.225',
        'gateway': '10.99.99.1',
        'netmask': '255.255.255.0',
        'primary': true
      }
    ]
};

var payload_kvm_good = {
    'brand': 'kvm',
    'vcpus': 1,
    'ram': 256,
    'alias': 'autotest-' + process.pid,
    'autoboot': false,
    'disks': [
      {
        'mac': '01:02:03:04:05:06',
        'boot': true,
        'model': 'virtio',
        'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
        'image_name': vmtest.CURRENT_UBUNTU_NAME,
        'image_size': vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    'nics': [
      {
        'nic_tag': 'admin',
        'model': 'virtio',
        'ip': '10.99.99.225',
        'gateway': '10.99.99.1',
        'netmask': '255.255.255.0',
        'primary': true
      }
    ]
};

// test we didn't require netmask when dhcp
var payload_kvm_good_dhcp = {
    'brand': 'kvm',
    'vcpus': 1,
    'ram': 256,
    'alias': 'autotest-' + process.pid,
    'autoboot': false,
    'disks': [
      {
        'mac': '01:02:03:04:05:06',
        'boot': true,
        'model': 'virtio',
        'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
        'image_name': vmtest.CURRENT_UBUNTU_NAME,
        'image_size': vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    'nics': [
      {
        'nic_tag': 'admin',
        'model': 'virtio',
        'ip': 'dhcp',
        'primary': true
      }
    ]
};

test('test create without netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_missing_netmask));
    state = {'brand': p.brand, 'expect_create_failure': true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create without nic_tag', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_missing_nic_tag));
    state = {'brand': p.brand, 'expect_create_failure': true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create KVM without netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_netmask));
    state = {'brand': p.brand, 'expect_create_failure': true};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create KVM without model', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_model));
    state = {'brand': p.brand, 'expect_create_failure': true};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with netmask then add nic with no netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            t.ok(true, 'state: ' + JSON.stringify(state));
            VM.update(state.uuid, {'add_nics': [{'ip': '10.99.99.223', 'nic_tag': 'admin', 'gateway': '10.99.99.1'}]}, function (err) {
                t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                    t.ok(obj && obj.nics, 'VM has nics');
                    if (obj && obj.nics) {
                        for (nic in obj.nics) {
                            nic = obj.nics[nic];
                            t.ok((nic.netmask && nic.netmask.match(/^[0-9\.]+$/)), 'Valid netmask: ' + nic.netmask);
                        }
                    }
                    cb();
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create machine then add nic with no nic_tag', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            t.ok(true, 'state: ' + JSON.stringify(state));
            VM.update(state.uuid, {'add_nics': [{'ip': '10.99.99.223', 'netmask': '255.255.255.0', 'gateway': '10.99.99.1'}]}, function (err) {
                t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                    t.ok(obj && obj.nics && obj.nics.length === 1, 'VM should have 1 NIC: ' + obj.nics.length);
                    cb();
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create good KVM then add nic with no netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.update(state.uuid, {'add_nics': [{'ip': '10.99.99.223', 'model': 'virtio', 'nic_tag': 'admin', 'gateway': '10.99.99.1'}]}, function (err) {
                t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                    if (obj && obj.nics) {
                        for (nic in obj.nics) {
                            nic = obj.nics[nic];
                            t.ok((nic.netmask && nic.netmask.match(/^[0-9\.]+$/)), 'Valid netmask: ' + nic.netmask);
                        }
                    }
                    cb();
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create good KVM then add nic with no model', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.update(state.uuid, {'add_nics': [{'ip': '10.99.99.223', 'netmask': '255.255.255.0', 'nic_tag': 'admin', 'gateway': '10.99.99.1'}]}, function (err) {
                t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                    if (obj && obj.nics) {
                        for (nic in obj.nics) {
                            nic = obj.nics[nic];
                            t.ok((nic.model && nic.model.match(/^[a-z]+$/)), 'Valid model: ' + nic.model);
                        }
                    }
                    cb();
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create with netmask add update to empty netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {'update_nics': [{'mac': '01:02:03:04:05:06', 'netmask': ''}]}, function (err) {
                    t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                    VM.load(state.uuid, function(err, obj) {
                        t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                        if (obj && obj.nics) {
                            t.ok((obj.nics.length == 1), 'Have nic after update: ' + JSON.stringify(obj.nics));
                            for (nic in obj.nics) {
                                nic = obj.nics[nic];
                                t.ok((nic.netmask && nic.netmask.match(/^[0-9\.]+$/)), 'Valid netmask: ' + nic.netmask);
                            }
                        }
                        cb();
                    });
                });
            });
        }
    ],
    function (err) {
        t.end();
    });
});

test('test create good KVM then update to empty netmask', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {'update_nics': [{'mac': '01:02:03:04:05:06', 'netmask': ''}]}, function (err) {
                    t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                    VM.load(state.uuid, function(err, obj) {
                        t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                        if (obj && obj.nics) {
                            t.ok((obj.nics.length == 1), 'Have nic after update: ' + JSON.stringify(obj.nics));
                            for (nic in obj.nics) {
                                nic = obj.nics[nic];
                                t.ok((nic.netmask && nic.netmask.match(/^[0-9\.]+$/)), 'Valid netmask: ' + nic.netmask);
                            }
                        }
                        cb();
                    });
                });
            });
        }
    ],
    function (err) {
        t.end();
    });
});

test('test create good KVM then update to empty model', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {'update_nics': [{'mac': '01:02:03:04:05:06', 'model': ''}]}, function (err) {
                    t.ok(err, 'update VM should fail' + (err ? ': ' + err.message : ''));
                    VM.load(state.uuid, function(err, obj) {
                        t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                        if (obj && obj.nics) {
                            t.ok((obj.nics.length == 1), 'Have nic after update: ' + JSON.stringify(obj.nics));
                            for (nic in obj.nics) {
                                nic = obj.nics[nic];
                                t.ok((nic.model && nic.model.match(/^[a-z]+$/)), 'Valid model: ' + nic.model);
                            }
                        }
                        cb();
                    });
                });
            });
        }
    ],
    function (err) {
        t.end();
    });
});

test('test create good OS w/ dhcp', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_good_dhcp));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                t.ok(obj.nics.length === 1, 'DHCP NIC was added');
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create good KVM w/ dhcp', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good_dhcp));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                t.ok(obj.nics.length === 1, 'DHCP NIC was added');
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test create good KVM w/o model but with nic_driver', {'timeout': 240000}, function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_model_but_have_driver));
    state = {'brand': p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok(!err, 'load VM' + state.uuid + (err ? ': ' + err.message : ''));
                t.ok(obj.nics.length === 1, 'NIC was added');
                if (obj.nics.length === 1) {
                    t.ok(obj.nics[0].model === 'virtio', 'model correctly set to nic_driver value');
                }
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});
