// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create works with specific options set.
//

var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var payload_missing_netmask = {
    alias: 'test-required-nic-props-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            nic_tag: 'admin',
            ip: '10.99.99.222',
            gateway: '10.99.99.1'
        }
    ]
};

var payload_missing_nic_tag = {
    alias: 'test-required-nic-props-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            ip: '10.99.99.222',
            netmask: '255.255.255.0',
            gateway: '10.99.99.1'
        }
    ]
};

var payload_good = {
    alias: 'test-required-nic-props-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            mac: '01:02:03:04:05:06',
            nic_tag: 'admin',
            ip: '10.99.99.222',
            netmask: '255.255.255.0',
            gateway: '10.99.99.1'
        }
    ]
};

// for testing that we don't require netmask when dhcp
var payload_good_dhcp = {
    alias: 'test-required-nic-props-' + process.pid,
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

var payload_kvm_missing_netmask = {
    alias: 'test-required-nic-props-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    do_not_inventory: true,
    autoboot: false,
    disks: [
      {
        boot: true,
        model: 'virtio',
        image_uuid: vmtest.CURRENT_UBUNTU_UUID,
        image_name: vmtest.CURRENT_UBUNTU_NAME,
        image_size: vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    nics: [
      {
        nic_tag: 'admin',
        model: 'virtio',
        ip: '10.99.99.225',
        gateway: '10.99.99.1',
        primary: true
      }
    ]
};

var payload_kvm_missing_model = {
    alias: 'test-required-nic-props-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    autoboot: false,
    do_not_inventory: true,
    disks: [
      {
        boot: true,
        model: 'virtio',
        image_uuid: vmtest.CURRENT_UBUNTU_UUID,
        image_name: vmtest.CURRENT_UBUNTU_NAME,
        image_size: vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    nics: [
      {
        nic_tag: 'admin',
        ip: '10.99.99.225',
        gateway: '10.99.99.1',
        netmask: '255.255.255.0',
        primary: true
      }
    ]
};

var payload_kvm_missing_model_but_have_driver = {
    alias: 'test-required-nic-props-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    autoboot: false,
    do_not_inventory: true,
    nic_driver: 'virtio',
    disks: [
      {
        boot: true,
        model: 'virtio',
        image_uuid: vmtest.CURRENT_UBUNTU_UUID,
        image_name: vmtest.CURRENT_UBUNTU_NAME,
        image_size: vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    nics: [
      {
        nic_tag: 'admin',
        ip: '10.99.99.225',
        gateway: '10.99.99.1',
        netmask: '255.255.255.0',
        primary: true
      }
    ]
};

var payload_kvm_good = {
    alias: 'test-required-nic-props-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    do_not_inventory: true,
    autoboot: false,
    disks: [
      {
        mac: '01:02:03:04:05:06',
        boot: true,
        model: 'virtio',
        image_uuid: vmtest.CURRENT_UBUNTU_UUID,
        image_name: vmtest.CURRENT_UBUNTU_NAME,
        image_size: vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    nics: [
      {
        nic_tag: 'admin',
        model: 'virtio',
        ip: '10.99.99.225',
        gateway: '10.99.99.1',
        netmask: '255.255.255.0',
        primary: true
      }
    ]
};

// test we didn't require netmask when dhcp
var payload_kvm_good_dhcp = {
    alias: 'test-required-nic-props-' + process.pid,
    brand: 'kvm',
    vcpus: 1,
    ram: 256,
    do_not_inventory: true,
    autoboot: false,
    disks: [
      {
        mac: '01:02:03:04:05:06',
        boot: true,
        model: 'virtio',
        image_uuid: vmtest.CURRENT_UBUNTU_UUID,
        image_name: vmtest.CURRENT_UBUNTU_NAME,
        image_size: vmtest.CURRENT_UBUNTU_SIZE
      }
    ],
    nics: [
      {
        nic_tag: 'admin',
        model: 'virtio',
        ip: 'dhcp',
        primary: true
      }
    ]
};

var payload_network_uuid = {
    alias: 'test-required-nic-props-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            mac: '01:02:01:01:01:02',
            nic_tag: 'admin',
            network_uuid: '6e868da4-ce12-11e2-bf66-27709b9e398b',
            ip: '10.99.99.226',
            netmask: '255.255.255.0'
        }
    ]
};

var payload_network_uuid_invalid = {
    alias: 'test-required-nic-props-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    nics: [
        {
            mac: '01:02:01:01:01:03',
            nic_tag: 'admin',
            network_uuid: 'asdf',
            ip: '10.99.99.227',
            netmask: '255.255.255.0'
        }
    ]
};

test('test create without netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_missing_netmask));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create without nic_tag', function(t) {

    p = JSON.parse(JSON.stringify(payload_missing_nic_tag));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create KVM without netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_netmask));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create KVM without model', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_model));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});

test('test create with netmask then add nic with no netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            t.ok(true, 'state: ' + JSON.stringify(state));
            VM.update(state.uuid, {add_nics: [{ip: '10.99.99.223', nic_tag: 'admin', gateway: '10.99.99.1'}]}, function (err) {
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

test('test create machine then add nic with no nic_tag', function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            t.ok(true, 'state: ' + JSON.stringify(state));
            VM.update(state.uuid, {add_nics: [{ip: '10.99.99.223', netmask: '255.255.255.0', gateway: '10.99.99.1'}]}, function (err) {
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

test('test create good KVM then add nic with no netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.update(state.uuid, {add_nics: [{ip: '10.99.99.223', model: 'virtio', nic_tag: 'admin', gateway: '10.99.99.1'}]}, function (err) {
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

test('test create good KVM then add nic with no model', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.update(state.uuid, {add_nics: [{ip: '10.99.99.223', netmask: '255.255.255.0', nic_tag: 'admin', gateway: '10.99.99.1'}]}, function (err) {
                t.ok(!err, 'update VM should succeed: ' + (err ? ': ' + err.message : ''));
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

test('test create with netmask add update to empty netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {update_nics: [{mac: '01:02:03:04:05:06', netmask: ''}]}, function (err) {
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

test('test create good KVM then update to empty netmask', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {update_nics: [{mac: '01:02:03:04:05:06', netmask: ''}]}, function (err) {
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

test('test create good KVM then update to empty model', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok((obj.nics.length == 1), 'Have nic after create: ' + JSON.stringify(obj.nics));
                VM.update(state.uuid, {update_nics: [{mac: '01:02:03:04:05:06', model: ''}]}, function (err) {
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

test('test create good OS w/ dhcp', function(t) {

    p = JSON.parse(JSON.stringify(payload_good_dhcp));
    state = {brand: p.brand};

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

test('test create good KVM w/ dhcp', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_good_dhcp));
    state = {brand: p.brand};

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

test('test create good KVM w/o model but with nic_driver', function(t) {

    p = JSON.parse(JSON.stringify(payload_kvm_missing_model_but_have_driver));
    state = {brand: p.brand};

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

test('test create good OS w/ network_uuid', function(t) {

    p = JSON.parse(JSON.stringify(payload_network_uuid));
    state = {brand: p.brand};

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ok(!err, 'load VM' + state.uuid
                    + (err ? ': ' + err.message : ''));
                t.ok(obj.nics.length === 1, 'NIC was added');
                t.equal(obj.nics[0].network_uuid,
                    payload_network_uuid.nics[0].network_uuid,
                    'network_uuid was added');

                cb();
            });

        }, function (cb) {
            var uuid2 = '8231fca4-ce34-11e2-a865-bbf227a0fb8d';
            VM.update(state.uuid, {update_nics: [
                {mac: payload_network_uuid.nics[0].mac, network_uuid: uuid2}
                ]}, function (err, obj) {

                t.ifError(err, 'error updating network_uuid');
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid
                        + (err ? ': ' + err.message : ''));

                    t.equal(obj.nics[0].network_uuid, uuid2,
                        'network_uuid was added');

                    cb();
                });
            });

        }, function (cb) {
            var uuid3 = '1ce9deee-ce38-11e2-8c7c-7f348665d851';
            VM.update(state.uuid, {add_nics: [ {
                    ip: '10.99.99.228',
                    nic_tag: 'admin',
                    netmask: '255.255.255.0',
                    network_uuid: uuid3
                } ]},
                function (err, obj) {

                t.ifError(err, 'error adding nic');
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM' + state.uuid
                        + (err ? ': ' + err.message : ''));
                    if (err) {
                        cb();
                        return;
                    }

                    t.ok(obj.nics.length === 2, 'NIC was added');
                    t.equal(obj.nics[1].network_uuid, uuid3,
                        'network_uuid is correct');

                    cb();
                });
            });

        }, function (cb) {
            VM.update(state.uuid, {
                update_nics: [
                    {mac: payload_network_uuid.nics[0].mac, network_uuid: 'asdf'}
                ]}, function (err) {

                t.ok(err, 'update VM should fail'
                    + (err ? ': ' + err.message : ''));

                cb();
            });
        }
    ], function () {
        t.end();
    });
});

test('test create w/ invalid network_uuid', function(t) {

    p = JSON.parse(JSON.stringify(payload_network_uuid_invalid));
    state = {brand: p.brand, expect_create_failure: true};

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_UUID, p, state, [],
        function (err) {
            t.end();
        }
    );
});
