// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var vm_uuid;

var PAYLOADS = {
    create: {
        alias: 'test-update-kvm-' + process.pid,
        brand: 'kvm',
        ram: 256,
        autoboot: false,
        disks: [{size: 1024, model: 'ide'}],
        do_not_inventory: true
    }, add_net0: {
        add_nics: [
            {
                model: 'e1000',
                ip: '10.254.254.254',
                ips: ['10.254.254.254/24'],
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                gateways: ['10.254.254.1'],
                mac: '00:02:03:04:05:06'
            }
        ]
    }, add_net1: {
        add_nics: [
            {
                ip: '10.254.254.253',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '02:03:04:05:06:07'
            }
        ]
    }, remove_net0: {
        remove_nics: [
            '00:02:03:04:05:06'
        ]
    }, remove_net1: {
        remove_nics: [
            '02:03:04:05:06:07'
        ]
    }, add_net0_and_net1: {
        add_nics: [
            {
                model: 'virtio',
                ip: '10.254.254.254',
                ips: ['10.254.254.254/24'],
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                gateways: ['10.254.254.1'],
                mac: '00:02:03:04:05:06'
            }, {
                model: 'virtio',
                ip: '10.254.254.253',
                ips: ['10.254.254.253/24'],
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 253,
                gateway: '10.254.254.1',
                gateways: ['10.254.254.1'],
                mac: '02:03:04:05:06:07'
            }
        ]
    }, remove_net0_and_net1: {
        remove_nics: [
            '00:02:03:04:05:06',
            '02:03:04:05:06:07'
        ]
    }, add_net0_through_net2: {
        add_nics: [
            {
                model: 'virtio',
                ip: '10.254.254.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '00:02:03:04:05:06'
            }, {
                model: 'virtio',
                ip: '10.254.254.253',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '02:03:04:05:06:07'
            }, {
                model: 'virtio',
                ip: '10.254.254.252',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net2',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '02:03:04:05:06:08'
            }
        ]
    }, remove_net1: {
        remove_nics: [
            '02:03:04:05:06:07'
        ]
    }, add_disk1: {
        add_disks: [
            {size: 1024}
        ]
    }, create_w_drivers: {
        alias: 'test-update-kvm-' + process.pid,
        brand: 'kvm',
        ram: 256,
        autoboot: false,
        nic_driver: 'e1000',
        disk_driver: 'ide',
        nics: [
            {
                model: 'virtio',
                ip: '10.254.254.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                gateway: '10.254.254.1',
                mac: '00:02:03:04:05:06'
            }
        ],
        disks: [{size: 1024, model: 'virtio'}],
        do_not_inventory: true
    }, add_nic_and_disk_wo_model: {
        add_disks: [{size: 1024}],
        add_nics: [{
            ip: '10.254.254.253',
            netmask: '255.255.255.0',
            nic_tag: 'external',
            interface: 'net1',
            vlan_id: 253,
            gateway: '10.254.254.1',
            mac: '02:03:04:05:06:07'
        }]
    }
};

simple_properties = [
    ['alias', 'useless VM'],
    ['billing_id', '9.99'],
    ['hostname', 'hamburgerhelper'],
    ['owner_uuid', '36bf401a-28ef-11e1-b4a7-c344deb1a5d6'],
    ['package_name', 'really expensive package'],
    ['package_version', 'XP'],
    ['virtio_txtimer', 150000],
    ['virtio_txtimer', '200000', 200000],
    ['virtio_txburst', 256],
    ['virtio_txburst', '128', 128]
];

test('create KVM VM', function(t) {
    VM.create(PAYLOADS.create, function (err, vmobj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
        } else {
            vm_uuid = vmobj.uuid;
            t.ok(true, 'created VM: ' + vm_uuid);
        }
        t.end();
    });
});

test('update KVM VM disk model', function(t) {

    VM.load(vm_uuid, function (err, before_obj) {
        var path;

        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }

        path = before_obj.disks[0].path;

        VM.update(vm_uuid, {'update_disks': [{'path': path, 'model': 'virtio'}]}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.disks[0].model === 'virtio'), 'obj.disks[0].model: '
                        + obj.disks[0].model + ' expected: virtio');
                    t.end();
                });
            }
        });
    });
});

// Add disk1 w/o model and ensure it gets same model as disk0 (See OS-2363)
test('add disk1 to KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_disk1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.disks.length !== 2) {
                    t.ok(false, 'VM has ' + obj.disks.length + ' != 2 disks');
                } else {
                    t.ok(obj.disks[0].model === obj.disks[1].model, 'models of disk0 and disk1 match [' + obj.disks[0].model + ',' + obj.disks[1].model + ']');
                }
                t.end();
            });
        }
    });
});

test('boot KVM VM', function(t) {
    VM.start(vm_uuid, {}, function (err) {
        t.ok(!err, 'error starting VM' + (err ? ': ' + err.message : ''));
        t.end();
    });
});

test('add net0 to KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    for (field in PAYLOADS.add_net0.add_nics[0]) {
                        if (field === 'physical') {
                            // physical is a property that gets added but not in the obj
                            continue;
                        }
                        t.deepEqual(obj.nics[0][field],
                            PAYLOADS.add_net0.add_nics[0][field],
                            'failed to set ' + field
                            + ', was ' + JSON.stringify(obj.nics[0][field])
                            + ', expected '
                            + JSON.stringify(PAYLOADS.add_net0.add_nics[0][field]));
                    }
                }
                t.end();
            });
        }
    });
});

test('update nic model on KVM VM', function(t) {

    VM.load(vm_uuid, function (err, before_obj) {
        var mac;

        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }

        if (!before_obj || !before_obj.hasOwnProperty('nics')
            || before_obj.nics.length < 1) {

            t.ok(false, 'VM is in a broken state before NIC update');
            t.end();
            return;
        }

        mac = before_obj.nics[0].mac;

        VM.update(vm_uuid, {'update_nics': [{'mac': mac, 'model': 'virtio'}]}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.nics[0].model === 'virtio'), 'obj.nics[0].model: '
                        + obj.nics[0].model + ' expected: virtio');
                    t.end();
                });
            }
        });
    });
});

// Add net1 w/o model and ensure it gets same model as net0 (See OS-2363)
test('add net1 to KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(obj.nics[0].model === obj.nics[1].model, 'models of net0 and net1 match [' + obj.nics[0].model + ',' + obj.nics[1].model + ']');
                }
                t.end();
            });
        }
    });
});

test('remove net0 from KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 from VM');
                }
                t.end();
            });
        }
    });
});

test('remove net1 from KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 from VM');
                }
                t.end();
            });
        }
    });
});

test('add net0 and net1 to KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_and_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    for (nic in [0, 1]) {
                        for (field in PAYLOADS.add_net0_and_net1.add_nics[nic]) {
                            if (field === 'physical') {
                                // physical is a property that gets added but not in the obj
                                continue;
                            }
                            t.deepEqual(obj.nics[nic][field],
                                PAYLOADS.add_net0_and_net1.add_nics[nic][field],
                                'failed to set ' + field
                                + ', was ' + JSON.stringify(obj.nics[nic][field])
                                + ', expected '
                                + JSON.stringify(PAYLOADS.add_net0_and_net1
                                    .add_nics[nic][field]));
                        }
                    }
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net1 from KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net1, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 and net1 from VM');
                }
                t.end();
            });
        }
    });
});

test('add 3 NICs to KVM VM', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_through_net2, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 3) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 3 nics');
                } else {
                    t.ok(true, 'Successfully 3 NICs to VM');
                }
                t.end();
            });
        }
    });
});

test('remove net1 from KVM VM -- 2nd time', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(true, 'Successfully removed net1');
                }
                t.end();
            });
        }
    });
});

test('reboot KVM VM', function(t) {
    VM.stop(vm_uuid, {'force': true}, function (err) {
        t.ok(!err, 'stopping VM' + (err ? ': ' + err.message : ''));
        VM.start(vm_uuid, {}, function (err) {
            t.ok(!err, 'starting VM' + (err ? ': ' + err.message : ''));
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else {
                    t.ok(obj.state === 'running', 'VM is running after restart: ' + obj.state);
                }

                t.end();
            });
        });
    });
});

test('set then unset simple properties on KVM VM', function(t) {
    async.forEachSeries(simple_properties,
        function (item, cb) {
            var prop = item[0];
            var value = item[1];
            var expected_value = item[2];
            var payload = {};

            payload[prop] = value;

            if (expected_value === undefined) {
                expected_value = value;
            }

            VM.update(vm_uuid, payload, function(err) {
                if (err) {
                    t.ok(false, 'error updating VM: ' + err.message);
                    cb();
                } else {
                    VM.load(vm_uuid, function (err, obj) {
                        if (err) {
                            t.ok(false, 'failed reloading VM');
                            return cb();
                        } else {
                            t.ok(obj[prop] === expected_value, prop + ' is '
                                + obj[prop] + ' (' + typeof(obj[prop])
                                + '), expected: ' + expected_value + ' ('
                                + typeof(expected_value) + ')'
                            );
                        }
                        payload[prop] = undefined;
                        VM.update(vm_uuid, payload, function (err) {
                            if (err) {
                                t.ok(false, 'error updating VM: ' + err.message);
                                cb();
                            } else {
                                VM.load(vm_uuid, function (err, obj) {
                                    if (err) {
                                        t.ok(false, 'failed reloading VM');
                                        return cb();
                                    }
                                    t.ok(!obj.hasOwnProperty(prop), prop
                                        + ' is ' + obj[prop] + ' ('
                                        + typeof(obj[prop]) + '), expected: '
                                        + 'undefined');
                                    cb();
                                });
                            }
                        });
                    });
                }
            });
        },
        function (err) {
            t.end();
        }
    );
});

test('update KVM VM quota', function(t) {
    VM.update(vm_uuid, {'quota': 13}, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                } else if (obj.quota !== 13) {
                    t.ok(false, 'VM has ' + obj.quota + ' != 13');
                    t.end();
                } else {
                    execFile('/usr/sbin/zfs', ['get', '-H', '-o', 'value', 'quota', obj.zonepath.substr(1)],
                        function (error, stdout, stderr) {
                            var res;
                            if (error) {
                                t.ok(false, 'Failed to get quota from zfs: ' + e.message);
                            } else {
                                res = stdout.replace(new RegExp('[\\s]+$', 'g'), '');
                                t.ok(res === '13G', 'updated quota now: ' + res + ' vs 13G');
                            }
                            t.end();
                        }
                    );
                }
            });
        }
    });
});

test('remove KVM VM quota', function(t) {
    VM.update(vm_uuid, {'quota': 0}, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                } else if (obj.quota !== 0) {
                    t.ok(false, 'VM has ' + obj.quota + ' != 0');
                    t.end();
                } else {
                    execFile('/usr/sbin/zfs', ['get', '-H', '-o', 'value', 'quota', obj.zonepath.substr(1)],
                        function (error, stdout, stderr) {
                            var res;
                            if (error) {
                                t.ok(false, 'Failed to get quota from zfs: ' + e.message);
                            } else {
                                res = stdout.replace(new RegExp('[\\s]+$', 'g'), '');
                                t.ok(res === 'none', 'updated quota now: ' + res + ' vs none');
                            }
                            t.end();
                        }
                    );
                }
            });
        }
    });
});

function test_update_ram(ram)
{
    test('update ram ' + ram, function(t) {
        VM.update(vm_uuid, {'ram': ram}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                    }

                    t.ok((obj.ram === ram), 'vm.ram: ' + obj.ram + ' expected: ' + ram);
                    t.ok((obj.max_physical_memory === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_physical_memory: '
                        + obj.max_physical_memory + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.ok((obj.max_locked_memory === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_locked_memory: '
                        + obj.max_locked_memory + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.ok((obj.max_swap === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.end();
                });
            }
        });
    });
}

// We started at 256, double that
test_update_ram(512);
// Update to a lower value should lower everything...
test_update_ram(128);
// Now something bigger
test_update_ram(1024);

// now try *just* updating swap
test('update KVM VM max_swap', function(t) {
    var test_value = 2560;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating swap, and to a lower than RAM.
test('update KVM VM max_swap to lower value than RAM', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = (before_obj.max_physical_memory - 64);
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // We expect that it was raised to match max_physical_memory
                    t.ok((obj.max_swap === before_obj.max_physical_memory),
                        'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory to a value: ram + 256
test('update max_physical_memory to RAM + 256', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 256;
        VM.update(vm_uuid, {'max_physical_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory === test_value),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + test_value);
                    t.ok((obj.max_locked_memory === test_value),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + test_value);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory to a value: ram + 1024
test('update max_physical_memory to RAM + 1024', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 1024;
        VM.update(vm_uuid, {'max_physical_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory === test_value),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + test_value);
                    t.ok((obj.max_locked_memory === test_value),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + test_value);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_swap to a value: ram - 64
test('update max_swap to RAM - 64', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram - 64;
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
                return;
            }
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                    return;
                }
                // should have been raised.
                t.ok((obj.max_swap === before_obj.max_physical_memory),
                    'vm.max_swap: ' + obj.max_swap + ' expected: '
                    + before_obj.max_physical_memory);
                t.end();
            });
        });
    });
});

// now try *just* updating max_locked_memory, high value (should get clamped)
test('update max_locked_memory to high value', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.max_physical_memory + 256;
        VM.update(vm_uuid, {'max_locked_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === before_obj.max_swap), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_swap);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    // should have been clamped
                    t.ok((obj.max_locked_memory == before_obj.max_physical_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.end();
                });
            }
        });
    });
});

// setting vnc_port=-1 should disable VNC
test('set vnc_port=-1', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'vnc_port': -1}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.vnc_port === -1), 'vm.vnc_port: ' + obj.vnc_port
                        + ' expected: ' + -1);
                    t.end();
                });
            }
        });
    });
});

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

test('enable / disable compression', function(t) {
    VM.load(vm_uuid, function (err, vmobj) {
        var disk0;
        var disk1;

        if (err) {
            t.ok(false, 'error loading VM: ' + err.message);
            t.end();
            return;
        }
        if (!vmobj.hasOwnProperty('disks') || vmobj.disks.length !== 2) {
            t.ok(false, 'cannot find disk: ' + vmobj.disks);
            t.end();
            return;
        }
        disk0 = vmobj.disks[0];
        disk1 = vmobj.disks[1];

        t.ok(disk0.compression === 'off', 'disk0 has compression off: ' + disk0.compression);
        t.ok(disk1.compression === 'off', 'disk1 has compression off: ' + disk1.compression);
        VM.update(vmobj.uuid, {'update_disks': [{path: disk0.path, compression: 'gzip'}, {path: disk1.path, compression: 'gzip'}]}, function (err) {
            if (err) {
                t.ok(false, 'VM.update failed to update disks: ' + err.message);
                t.end();
                return;
            }

            VM.load(vm_uuid, function (err, vmobj_disabled) {
                if (err) {
                    t.ok(false, 'error loading VM: ' + err.message);
                    t.end();
                    return;
                }

                disk0 = vmobj_disabled.disks[0];
                disk1 = vmobj_disabled.disks[1];

                t.ok(disk0.compression === 'gzip', 'disk0 has compression=gzip: ' + disk0.compression);
                t.ok(disk1.compression === 'gzip', 'disk1 has compression=gzip: ' + disk1.compression);
                VM.update(vmobj.uuid, {'update_disks': [{path: disk0.path, compression: 'off'}, {path: disk1.path, compression: 'off'}]}, function (err) {
                    if (err) {
                        t.ok(false, 'VM.update failed to update disks: ' + err.message);
                        t.end();
                        return;
                    }

                    VM.load(vm_uuid, function (err, vmobj_enabled) {
                        if (err) {
                            t.ok(false, 'error loading VM: ' + err.message);
                            t.end();
                            return;
                        }

                        disk0 = vmobj_enabled.disks[0];
                        disk1 = vmobj_enabled.disks[1];

                        t.ok(disk0.compression === 'off', 'disk0 has compression=off: ' + disk0.compression);
                        t.ok(disk1.compression === 'off', 'disk1 has compression=off: ' + disk1.compression);

                        t.end();
                    });
                });
            });
        });
    });
});

// VM should at this point be running, so removing the disk should fail.
// Stopping and removing should succeed.
// Adding should also succeed at that point.
test('remove KVM disks', function(t) {
    VM.load(vm_uuid, function (err, vmobj) {
        var disk0;
        var disk1;

        if (err) {
            t.ok(false, 'error loading VM: ' + err.message);
            t.end();
            return;
        }
        if (vmobj.state !== 'running') {
            t.ok(false, 'VM is not running: ' + vmobj.state);
            t.end();
            return;
        }
        if (!vmobj.hasOwnProperty('disks') || vmobj.disks.length !== 2) {
            t.ok(false, 'cannot find disk: ' + vmobj.disks);
            t.end();
            return;
        }
        disk0 = vmobj.disks[0];
        disk1 = vmobj.disks[1];
        t.ok(disk0.hasOwnProperty('path'), 'disk0 has a path: ' + disk0.path);
        t.ok(disk1.hasOwnProperty('path'), 'disk1 has a path: ' + disk1.path);
        VM.update(vmobj.uuid, {'remove_disks': [disk0.path, disk1.path]}, function (err) {
            // expect an error
            t.ok(err, 'VM.update failed to remove disks: ' + (err ? err.message : err));
            if (!err) {
                t.end();
                return;
            }
            VM.stop(vmobj.uuid, {'force': true}, function (err) {
                t.ok(!err, 'VM.stop');
                if (!err) {
                    VM.load(vm_uuid, function (err, obj) {
                        t.ok(!err, 'loaded VM after stop');
                        t.ok(obj.state === 'stopped', 'VM is stopped.');
                        if (obj.state === 'stopped') {
                            // same update
                            VM.update(vmobj.uuid, {'remove_disks': [disk0.path, disk1.path]}, function (err) {
                                t.ok(!err, 'removed disk: ' + (err ? err.message : err));
                                // check that zfs filesystem is gone, also
                                // reload and check that disk is no longer in list
                                zfs(['list', disk0.zfs_filesystem], function (err, fds) {
                                    t.ok(err
                                        && err.hasOwnProperty('message')
                                        && err.message.match('dataset does not exist'),
                                        'ensure dataset no longer exists');
                                    VM.load(vmobj.uuid, function (err, final_obj) {
                                        t.ok(!err, 'loaded VM after delete');
                                        t.ok(final_obj.hasOwnProperty('disks'), 'no disks member for final_obj');
                                        if (final_obj.hasOwnProperty('disks')) {
                                            t.ok(final_obj.disks.length === 0, 'disks list empty: '
                                                + JSON.stringify(final_obj.disks));
                                        }
                                        t.end();
                                    });
                                });
                            });
                        } else {
                            t.end();
                        }
                    });
                } else {
                    t.end();
                }
            });
        });
    });
});

test('delete KVM VM', function(t) {
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + vm_uuid);
            }
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('create KVM VM w/ *_drivers', function(t) {
    var state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, PAYLOADS['create_w_drivers'], state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var has_primary = 0;
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                // ensure nic_driver + disk_driver properties are set, we expect
                // model to be virtio since we explicitly set, when we add
                // another it should be the *_driver value
                t.ok(obj.nic_driver === 'e1000', 'VM has nic_driver');
                t.ok(obj.disk_driver === 'ide', 'VM has disk_driver');
                t.ok(obj.nics[0].model === 'virtio', 'VM has correct nic.model');
                t.ok(obj.disks[0].model === 'virtio', 'VM has correct disk.model');

                cb();
            });
        }, function (cb) {

            // add a disk and a nic w/o model and ensure they've also got the correct.model
            // matching *_driver not the first nic.
            VM.update(state.uuid, PAYLOADS['add_nic_and_disk_wo_model'], function(err) {
                t.ok(!err, 'updating VM: ' + (err ? err.message : 'success'));
                if (err) {
                    return cb();
                }
                VM.load(state.uuid, function(err, obj) {
                    t.ok(!err, 'load VM: ' + (err ? err.message : 'success'));
                    if (err) {
                        return cb(err);
                    }
                    t.ok(obj.disks[1].model === obj.disk_driver, 'disk1 model is ' + obj.disks[1].model + ' expected ' + obj.disk_driver);
                    t.ok(obj.nics[1].model === obj.nic_driver, 'nic1 model is ' + obj.nics[1].model + ' expected ' + obj.nic_driver);

                    cb();
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('test 100%/10% refreservation, change to 50%/75%', function(t) {
    p = {
        'alias': 'test-update-kvm-' + process.pid,
        'brand': 'kvm',
        'vcpus': 1,
        'ram': 256,
        'do_not_inventory': true,
        'autoboot': false,
        'disk_driver': 'virtio',
        'disks': [
          {
            'boot': true,
            'image_uuid': vmtest.CURRENT_UBUNTU_UUID,
            'image_size': vmtest.CURRENT_UBUNTU_SIZE,
            'refreservation': vmtest.CURRENT_UBUNTU_SIZE
          }, {
            'size': 1024,
            'refreservation': 10
          }
        ]
    };
    state = {'brand': p.brand};
    vmtest.on_new_vm(t, null, p, state, [
        function (cb) {
            VM.load(state.uuid, function(err, vmobj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                VM.update(state.uuid, {update_disks: [
                    {path: vmobj.disks[0].path, refreservation: (vmobj.disks[0].size * 0.5)},
                    {path: vmobj.disks[1].path, refreservation: (vmobj.disks[1].size * 0.75)}
                    ]}, function(err) {

                    t.ok(!err, 'updating VM: ' + (err ? err.message : 'success'));
                    if (err) {
                        return cb();
                    }
                    VM.load(state.uuid, function(err, obj) {
                        var disks;
                        t.ok(!err, 'load VM: ' + (err ? err.message : 'success'));
                        if (err) {
                            return cb(err);
                        }

                        disks = obj.disks;
                        t.ok(disks[0].refreservation === (disks[0].size * 0.5), 'disk 0 has correct refreservation: ' + disks[0].refreservation + '/' + (disks[0].size * 0.5));
                        t.ok(disks[1].refreservation === (disks[1].size * 0.75), 'disk 1 has correct refreservation: ' + disks[1].refreservation + '/' + (disks[1].size * 0.75));
                        state.vmobj = obj;
                        cb();
                    });
                });
            });
        }
    ]);
});

