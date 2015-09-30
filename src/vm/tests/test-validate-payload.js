// Copyright 2015 Joyent, Inc.  All rights reserved.

var brand;
var os_brands = ['joyent', 'joyent-minimal'];
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var smartos_image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var ubuntu_image_uuid = vmtest.CURRENT_UBUNTU_UUID;
var ubuntu_image_name = vmtest.CURRENT_UBUNTU_NAME;
var ubuntu_image_size = vmtest.CURRENT_UBUNTU_SIZE;

VM.loglevel = 'DEBUG';

test('test nonexistent brand', function (t) {
    VM.validate('gorilla', 'create', {hello: 'world'}, function (errors) {
        t.ok(errors, 'bail on gorilla brand: ' + JSON.stringify(errors));
        if (errors) {
            t.ok(errors.hasOwnProperty('bad_brand'), 'invalid brand message: ' + JSON.stringify(errors.bad_brand));
        }
        t.end();
    });
});

// These tests we'll do with both joyent and joyent-minimal
for (brand in os_brands) {
    brand = os_brands[brand];

    // should fail with all keys since none are valid for this action
    test('test nonexistent action', function (t) {
        VM.validate(brand, 'detonate', {hello: 'world', goodbye: 'world'}, function (errors) {
            t.ok(errors, 'bail on detonation: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_properties.length > 0, 'invalid properties for detonate: ' + JSON.stringify(errors.bad_properties));
            }
            t.end();
        });
    });

    test('test valid property wrong action', function (t) {
        VM.validate(brand, 'update', {uuid: 'doogle', alias: 'foo'}, function (errors) {
            t.ok(errors, 'fail on updating uuid: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_properties.length === 1
                    && errors.bad_properties[0] === 'uuid', 'uuid is the only invalid property');
            }
            t.end();
        });
    });

    test('minimal joyent payload', function (t) {
        VM.validate(brand, 'create', {brand: brand, image_uuid: smartos_image_uuid}, function (errors) {
            t.ok(!errors, 'creating minimal joyent: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set invalid autoboot parameter', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            autoboot: 'aardvark'
            }, function (errors) {

            t.ok(errors, 'invalid payload');
            if (errors) {
                t.ok(errors.bad_values.indexOf('autoboot') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set non-string alias', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            alias: 42
            }, function (errors) {

            t.ok(errors, 'invalid payload');
            if (errors) {
                t.ok(errors.bad_values.indexOf('alias') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set invalid max_swap', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            max_swap: 128
            }, function (errors) {

            t.ok(errors, 'invalid payload');
            if (errors) {
                t.ok(errors.bad_values.indexOf('max_swap') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set non-integer cpu_cap', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            cpu_cap: 'doogle'
            }, function (errors) {

            t.ok(errors, 'invalid payload');
            if (errors) {
                t.ok(errors.bad_values.indexOf('cpu_cap') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set non-existent zpool', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            zpool: 'doogle'
            }, function (errors) {

            t.ok(errors, 'invalid payload');
            if (errors) {
                t.ok(errors.bad_values.indexOf('zpool') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set zones zpool', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            zpool: 'zones'
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set fs_allowed (string)', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            fs_allowed: 'ufs,pcfs,tmpfs'
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set fs_allowed (array)', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            fs_allowed: ['ufs', 'pcfs', 'tmpfs']
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set bad customer metadata', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            customer_metadata: {hello: {complicated: 'world'}}
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('customer_metadata') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set good customer metadata', function (t) {
        VM.validate(brand, 'create', {
            brand: brand,
            image_uuid: smartos_image_uuid,
            customer_metadata: {
                hello: 'world',
                'these keys should be valid': true,
                'how about a number?': 42 }
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('customer_metadata') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set good array fs_allowed', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                fs_allowed: ['ufs', 'tmpfs', 'pcfs']
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set bad array fs_allowed', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                fs_allowed: ['ufs,tmpfs,pcfs']
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('fs_allowed') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set bad object fs_allowed', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                fs_allowed: {hello: 'world'}
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('fs_allowed') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set mtu too low', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 500
                } ]
         }, function (errors) {
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics.*.mtu') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
         });
    });

    test('set mtu too high', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 10000
                } ]
         }, function (errors) {
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics.*.mtu') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
         });
    });

    test('set good nic list', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [{nic_tag: 'admin', ip: 'dhcp'}]
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('invalid mtu, fractional value', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 1500.3
                } ]
         }, function (errors) {
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics.*.mtu') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
         });
    });

    test('invalid mtu, string', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 'Ah Elbereth, Gilthoniel!'
                } ]
         }, function (errors) {
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics.*.mtu') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
         });
    });

    test('invalid mtu, object', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: { "hello": "world" }
                } ]
         }, function (errors) {
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics.*.mtu') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
         });
    });

    test('set bad nic obj', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: {}
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('valid mtu, low', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 576
                } ]
         }, function (errors) {
            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
         });
    });

    test('valid mtu, mid', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 4242
                } ]
         }, function (errors) {
            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
         });
    });

    test('valid mtu, high', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: 9000
                } ]
         }, function (errors) {
            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
         });
    });

    test('valid mtu, string', function (t) {
         VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: [ {
                        nic_tag: 'admin',
                        ip: 'dhcp',
                        mtu: '2323'
                } ]
         }, function (errors) {
            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
         });
    });


    test('set bad nic string', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                nics: '[{\'nic_tag\': \'admin\', \'ip\': \'dhcp\'}]'
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_values.indexOf('nics') !== -1, 'confirm that it is bad values breaking: ' + JSON.stringify(errors));
            }
            t.end();
        });
    });

    test('set update nics good fails on create', function (t) {
        VM.validate(brand, 'create', {
                brand: brand,
                image_uuid: smartos_image_uuid,
                update_nics: [{mac: '01:02:03:0a:0b:0c', nic_tag: 'external'}]
            }, function (errors) {

            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('set update nics good succeeds on update', function (t) {
        VM.validate(brand, 'update', {
                update_nics: [{mac: '01:02:03:0a:0b:0c', nic_tag: 'external'}]
            }, function (errors) {

            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.end();
        });
    });

    test('typical joyent smartdc_role create payload', function (t) {
        var payload = {
            alias: 'zapi0',
            autoboot: true,
            brand: 'joyent',
            tags: {
                smartdc_role: 'zapi',
                smartdc_type: 'core',
            },
            zfs_storage_pool_name: 'zones',
            dataset_name: 'smartos-1.6.3',
            image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822',
            cpu_shares: 64,
            cpu_cap: 100,
            zfs_io_priority: 10,
            max_lwps: 1000,
            max_physical_memory: 64,
            max_locked_memory: 64,
            max_swap: 256,
            quota: 10,
            internal_metadata: {
                package_version: '1.0.0',
                package_name: 'sdc_64'
            },
            uuid: '91273098-cc0a-4fdd-9e6d-8f7496f3db80',
            owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853',
            customer_metadata: {
                'assets-ip': '10.99.99.9',
                'sdc-datacenter-name': 'coal',
                'sdc-datacenter-headnode-id': '0',
                'user-script': '$!/bin/bash'
            },
            nics: [{
                ip: '10.99.99.19',
                netmask: '255.255.255.0',
                gateway: '10.99.99.7',
                nic_tag: 'admin',
                vlan_id: 0,
                primary: true,
                mac: 'c2:de:e7:ec:99:68',
                physical: 'net0'
            }],
            zonename: '91273098-cc0a-4fdd-9e6d-8f7496f3db80',
            zpool: 'zones',
            dns_domain: 'local',
            tmpfs: 64,
            limit_priv: ['default'],
            billing_id: '01b2c898-945f-11e1-a523-af1afbe22822',
            zonepath: '/zones/91273098-cc0a-4fdd-9e6d-8f7496f3db80'
        };

        VM.validate(brand, 'create', payload, function (errors) {
            // we expect some errors
            t.ok(errors, 'valid payload, errors: ' + JSON.stringify(errors));
            t.ok(errors.bad_properties.indexOf('dataset_name') !== -1, 'dataset_name is invalid');
            // nics.*.physical does nothing.
            t.ok(errors.bad_properties.indexOf('nics.*.physical') !== -1, 'nics.*.physical is invalid');
            t.ok(errors.bad_values.length === 0, 'no bad values');
            t.end();
        });
    });

    test('all options on joyent create payload', function (t) {
        var payload = {
            alias: 'maximumpower',
            autoboot: 'true',
            billing_id: '0445e934-a736-11e1-921c-df8fa4e4f3b6',
            brand: brand,
            cpu_cap: 800,
            cpu_shares: 20,
            customer_metadata: {'fancy machine': 'with all options'},
            image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822',
            delegate_dataset: 'true',
            do_not_inventory: 'true',
            dns_domain: 'joyent.com',
            filesystems: [{type: 'lofs', source: '/var/tmp', target: '/gztmp', options: ['ro', 'nodevices']}],
            fs_allowed: ['ufs', 'tmpfs', 'pcfs'],
            hostname: 'maximumpower',
            internal_metadata: {'fancy internal metadata': 'with some options too'},
            limit_priv: ['proc_info', '-proc_session'],
            max_locked_memory: 600,
            max_lwps: 1800,
            max_physical_memory: 800,
            max_swap: 256,
            nics: [{
                blocked_outgoing_ports: [1,2,3],
                dhcp_server: true,
                gateway: '10.88.88.2',
                interface: 'net0',
                ip: '10.88.88.200',
                nic_tag: 'external',
                primary: true,
                vlan_id: 400,
                mtu: 1500
            }],
            owner_uuid: '9258cc86-a737-11e1-995c-bbd52ce4e9c1',
            package_name: 'crazypackage',
            package_version: 'XP',
            quota: 10000,
            resolvers: ['8.8.8.8', '8.8.4.4'],
            tags: {spoon_tag: 'bork', fork_tag: 'bork'},
            tmpfs: 1024,
            uuid: 'e6b34a72-a737-11e1-9b5d-1739e973d7b5',
            zfs_data_compression: 'gzip-3',
            zfs_data_recsize: 16384,
            zfs_io_priority: 100,
            zfs_root_compression: 'off',
            zfs_root_recsize: 8192,
            zonename: 'maximumpower',
            zpool: 'zones'
        };

        VM.validate(brand, 'create', payload, function (errors) {
            // we expect no errors
            t.ok(!errors, 'valid payload, errors: ' + JSON.stringify(errors));
            if (errors) {
                t.ok(errors.bad_properties.length === 0, 'no invalid values');
                t.ok(errors.bad_values.length === 0, 'no bad values');
                t.ok(errors.missing_properties.length === 0, 'no invalid values');
            }
            t.end();
        });
    });
}

// Now test some KVM payloads

test('empty kvm payload', function (t) {
    VM.validate('kvm', 'create', {}, function (errors) {
        t.ok(errors, 'fail because of no brand');
        if (errors) {
            t.ok(errors.missing_properties.indexOf('brand') !== -1, 'missing required parameters: ' + JSON.stringify(errors.missing_properties));
        }
        t.end();
    });
});

test('minimal kvm payload', function (t) {
    VM.validate('kvm', 'create', {brand: 'kvm'}, function (errors) {
        t.ok(!errors, 'creating minimal kvm: ' + JSON.stringify(errors));
        t.end();
    });
});

test('man page kvm create payload', function (t) {
    var payload = {
       brand: 'kvm',
       vcpus: 1,
       ram: 256,
       disks: [
         {
           boot: true,
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           image_name: ubuntu_image_name,
           image_size: ubuntu_image_size
         }
       ],
       nics: [
         {
           nic_tag: 'external',
           model: 'virtio',
           ip: '10.88.88.51',
           netmask: '255.255.255.0',
           gateway: '10.88.88.2',
           primary: true
         }
       ]
    };
    VM.validate('kvm', 'create', payload, function (errors) {
        t.ok(!errors, 'creating example kvm: ' + JSON.stringify(errors));
        t.end();
    });
});

test('man page kvm add nic payload', function (t) {
    var payload = {
       add_nics: [
         {
           interface: 'net1',
           nic_tag: 'external',
           mac: 'b2:1e:ba:a5:6e:71',
           ip: '10.2.121.71',
           netmask: '255.255.0.0',
           gateway: '10.2.121.1'
         }
       ]
    };
    VM.validate('kvm', 'update', payload, function (errors) {
        t.ok(!errors, 'update (add nic) example kvm: ' + JSON.stringify(errors));
        t.end();
    });
});

test('add disk with both size and image_uuid should fail', function (t) {
    var payload = {
       add_disks: [
         {
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           size: ubuntu_image_size
         }
       ]
    };
    VM.validate('kvm', 'update', payload, function (errors) {
        t.ok(errors, 'add disk with size and image_uuid should fail: ' + JSON.stringify(errors));
        t.end();
    });
});

test('kvm create with bad disk (image_uuid + size)', function (t) {
    var payload = {
       brand: 'kvm',
       vcpus: 1,
       ram: 256,
       disks: [
         {
           boot: true,
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           image_name: ubuntu_image_name,
           size: ubuntu_image_size
         }
       ],
       nics: [
         {
           nic_tag: 'external',
           model: 'virtio',
           ip: '10.88.88.51',
           netmask: '255.255.255.0',
           gateway: '10.88.88.2',
           primary: true
         }
       ]
    };
    VM.validate('kvm', 'create', payload, function (errors) {
        t.ok(errors, 'create with bad disk (image_uuid + size): ' + JSON.stringify(errors));
        t.end();
    });
});

test('kvm create with bad disk (image_uuid + block_size)', function (t) {
    var payload = {
       brand: 'kvm',
       vcpus: 1,
       ram: 256,
       disks: [
         {
           boot: true,
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           image_name: ubuntu_image_name,
           image_size: ubuntu_image_size,
           block_size: 8192
         }
       ],
       nics: [
         {
           nic_tag: 'external',
           model: 'virtio',
           ip: '10.88.88.51',
           netmask: '255.255.255.0',
           gateway: '10.88.88.2',
           primary: true
         }
       ]
    };
    VM.validate('kvm', 'create', payload, function (errors) {
        t.ok(errors, 'create with bad disk (image_uuid + block_size): ' + JSON.stringify(errors));
        t.end();
    });
});


test('add disk with both image_size and image_uuid should succeed', function (t) {
    var payload = {
       add_disks: [
         {
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           image_size: ubuntu_image_size
         }
       ]
    };
    VM.validate('kvm', 'update', payload, function (errors) {
        t.ok(!errors, 'add disk with image_size and image_uuid: ' + JSON.stringify(errors));
        t.end();
    });
});

test('kvm create with good disk (image_uuid + image_size)', function (t) {
    var payload = {
       brand: 'kvm',
       vcpus: 1,
       ram: 256,
       disks: [
         {
           boot: true,
           model: 'virtio',
           image_uuid: ubuntu_image_uuid,
           image_name: ubuntu_image_name,
           image_size: ubuntu_image_size
         }
       ],
       nics: [
         {
           nic_tag: 'external',
           model: 'virtio',
           ip: '10.88.88.51',
           netmask: '255.255.255.0',
           gateway: '10.88.88.2',
           primary: true
         }
       ]
    };
    VM.validate('kvm', 'create', payload, function (errors) {
        t.ok(!errors, 'create with good disk (image_uuid + image_size): ' + JSON.stringify(errors));
        t.end();
    });
});

test('add disk with just size should succeed', function (t) {
    var payload = {
       add_disks: [
         {
           model: 'virtio',
           size: 5120
         }
       ]
    };
    VM.validate('kvm', 'update', payload, function (errors) {
        t.ok(!errors, 'add disk with just size: ' + JSON.stringify(errors));
        t.end();
    });
});

test('kvm create with good disk (just size)', function (t) {
    var payload = {
       brand: 'kvm',
       vcpus: 1,
       ram: 256,
       disks: [
         {
           boot: true,
           model: 'virtio',
           size: 5120
         }
       ],
       nics: [
         {
           nic_tag: 'external',
           model: 'virtio',
           ip: '10.88.88.51',
           netmask: '255.255.255.0',
           gateway: '10.88.88.2',
           primary: true
         }
       ]
    };
    VM.validate('kvm', 'create', payload, function (errors) {
        t.ok(!errors, 'create with good disk (just size): ' + JSON.stringify(errors));
        t.end();
    });
});

test('create OS VM with non-existent image_uuid', function (t) {
    VM.validate('joyent-minimal', 'create', {
        brand: 'joyent-minimal',
        image_uuid: 'a1fac27c-85fb-11e2-ae84-276612e8990c',
        ram: 256
        }, function (errors) {

        t.ok(errors, 'invalid payload');
        if (errors) {
            t.ok(errors.bad_values.indexOf('image_uuid') !== -1, 'confirm that it is image_uuid breaking: ' + JSON.stringify(errors));
        }
        t.end();
    });
});

test('create KVM VM with non-existent image_uuid', function (t) {
    VM.validate('kvm', 'create', {
        brand: 'kvm',
        disks: [{image_uuid: 'a1fac27c-85fb-11e2-ae84-276612e8990c', image_size: 5120, model: 'virtio'}],
        ram: 256
        }, function (errors) {

        t.ok(errors, 'invalid payload');
        if (errors) {
            t.ok(errors.bad_values.indexOf('disks.0.image_uuid') !== -1, 'confirm that it is image_uuid breaking: ' + JSON.stringify(errors));
        }
        t.end();
    });
});

test('add disk to KVM VM with non-existent image_uuid', function (t) {
    VM.validate('kvm', 'update', {
        add_disks: [{image_uuid: 'a1fac27c-85fb-11e2-ae84-276612e8990c', image_size: 5120, model: 'virtio'}],
        }, function (errors) {

        t.ok(errors, 'invalid payload');
        if (errors) {
            t.ok(errors.bad_values.indexOf('add_disks.0.image_uuid') !== -1, 'confirm that it is image_uuid breaking: ' + JSON.stringify(errors));
        }
        t.end();
    });
});
