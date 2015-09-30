// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// NOTE: we use 169.254.169.x as *non-Private* here because it's not in the
// designated private ranges we're concerned with. It may cause problems in
// which case it can be changed to some other non-Private address.

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var vm_uuid;

var PAYLOADS = {
    create: {
        alias: 'test-update-' + process.pid,
        image_uuid: image_uuid,
        do_not_inventory: true,
        cpu_cap: 1600
    }, add_net0: {
        add_nics: [
            {
                ip: '10.254.254.254',
                ips: ['10.254.254.254/24'],
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                gateways: ['10.254.254.1'],
                mac: '01:02:03:04:05:06'
            }
        ]
    }, update_net0: {
        update_nics: [
            {
                ips: ['10.254.254.254/24', 'fd00::1/64', 'addrconf'],
                mac: '01:02:03:04:05:06'
            }
        ]
    }, add_net1: {
        add_nics: [
            {
                ip: '10.99.99.12,10.99.99.33,10.99.99.34',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 0,
                gateway: '10.254.254.1'
            }
        ]
    }, add_invalid_allow_unfiltered_promisc: {
        update_nics: [
            {
                mac: '01:02:03:04:05:06',
                allow_unfiltered_promisc: true
            }
        ]
    }, remove_net0: {
        remove_nics: [
            '01:02:03:04:05:06'
        ]
    }, add_net0_and_net1: {
        add_nics: [
            {
                ip: '10.254.254.254',
                ips: ['10.254.254.254/24'],
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                gateways: ['10.254.254.1'],
                mac: '01:02:03:04:05:06'
            }, {
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
            '01:02:03:04:05:06',
            '02:03:04:05:06:07'
        ]

    }, add_3_nics_2_non_private: {
        add_nics: [
            {
                ip: '10.254.254.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '01:02:03:04:05:06'
            }, {
                ip: '169.254.169.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 254,
                gateway: '169.254.169.1',
                mac: '02:03:04:05:06:07',
                primary: true
            }, {
                ip: '169.254.169.253',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net2',
                vlan_id: 253,
                gateway: '169.254.169.1',
                mac: '02:03:04:05:06:08'
            }
        ]
    }, add_3_nics_1_non_private: {
        add_nics: [
            {
                ip: '10.254.254.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net0',
                vlan_id: 0,
                gateway: '10.254.254.1',
                mac: '01:02:03:04:05:06'
            }, {
                ip: '169.254.169.254',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                interface: 'net1',
                vlan_id: 254,
                gateway: '169.254.169.1',
                mac: '02:03:04:05:06:07',
                primary: true
            }, {
                ip: '10.254.254.253',
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
    }, remove_net0_and_net2: {
        remove_nics: [
            '01:02:03:04:05:06',
            '02:03:04:05:06:08'
        ]
    }, add_nic_with_minimal_properties: {
        add_nics: [
            {
                mac: '01:02:03:04:05:06',
                ip: 'dhcp',
                nic_tag: 'admin'
            }
        ]
    }, set_rctls: {
        max_msg_ids: 3333,
        max_sem_ids: 2332,
        max_shm_ids: 2345,
        max_shm_memory: 1234
    }, remove_cpu_cap: {
        cpu_cap: 0
    }
};

var simple_properties = [
    ['alias', 'useless VM'],
    ['billing_id', '9.99'],
    ['hostname', 'hamburgerhelper'],
    ['owner_uuid', '36bf401a-28ef-11e1-b4a7-c344deb1a5d6'],
    ['package_name', 'really expensive package'],
    ['package_version', 'XP']
];

test('create VM', function (t) {
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

test('add net0', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net0, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var field;

                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    for (field in PAYLOADS.add_net0.add_nics[0]) {
                        if (field === 'physical') {
                            // physical is a property that gets added but not in
                            // the obj
                            continue;
                        }
                        t.deepEqual(obj.nics[0][field],
                            PAYLOADS.add_net0.add_nics[0][field],
                            'failed to set ' + field
                            + ', was ' + JSON.stringify(obj.nics[0][field])
                            + ', expected '
                            + JSON.stringify(
                                PAYLOADS.add_net0.add_nics[0][field]));
                    }
                }
                t.end();
            });
        }
    });
});

test('add IPv6 to net0', function (t) {
    VM.update(vm_uuid, PAYLOADS.update_net0, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var field;

                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    for (field in PAYLOADS.update_net0.update_nics[0]) {
                        if (field === 'physical') {
                            // physical is a property that gets added but not in
                            // the obj
                            continue;
                        }
                        t.deepEqual(obj.nics[0][field],
                            PAYLOADS.update_net0.update_nics[0][field],
                            'failed to set ' + field
                            + ', was ' + JSON.stringify(obj.nics[0][field])
                            + ', expected '
                            + JSON.stringify(
                                PAYLOADS.update_net0.update_nics[0][field]));
                    }
                }
                t.end();
            });
        }
    });
});

test('add net1 -- bad IP', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net1, function (err) {
        t.ok(err, 'failed to add nic with invalid IP: '
            + (err ? err.message : ''));
        t.end();
    });
});

test('add KVM-only property to zone', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_invalid_allow_unfiltered_promisc,
        function (update_err) {

        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                    return;
                }
                t.ok(obj.nics.length === 1, 'VM has [' + obj.nics.length
                    + ' vs. 1] nics');
                if (obj.nics.length === 1) {
                    t.ok(!obj.nics[0]
                        .hasOwnProperty('allow_unfiltered_promisc'),
                        'allow_unfiltered_promisc is not set');
                }
                t.end();
            });
        }
    });
});

test('remove net0', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
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

test('add net0 and net1', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_and_net1, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var field;
                var nic;

                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    for (nic in [0, 1]) {
                        for (field in
                            PAYLOADS.add_net0_and_net1.add_nics[nic]) {

                            if (field === 'physical') {
                                // physical is a property that gets added but
                                // not in the obj
                                continue;
                            }
                            if (obj.nics[nic][field]
                                !== PAYLOADS.add_net0_and_net1
                                .add_nics[nic][field]) {

                                t.deepEqual(obj.nics[nic][field],
                                    PAYLOADS.add_net0_and_net1
                                        .add_nics[nic][field],
                                    'failed to set ' + field
                                    + ', was '
                                    + JSON.stringify(obj.nics[nic][field])
                                    + ', expected '
                                    + JSON.stringify(PAYLOADS.add_net0_and_net1
                                        .add_nics[nic][field]));
                            }
                        }
                    }
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net1', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net1, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
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

test('add 3 nics, 2 non-private', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_3_nics_2_non_private,
        function (update_err) {

        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var failures = 0;

                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 3) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(obj.nics[1].primary === true, '2nd NIC is primary: '
                        + !!obj.nics[1].primary);
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('remove net1 -- 1st time', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(true, 'Successfully removed net1 from VM');
                    t.ok(obj.nics[1].primary === true, '2nd NIC is primary: '
                        + !!obj.nics[1].primary);
                    t.ok(true, JSON.stringify(obj.nics));
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net2 -- 1st time', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net2, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 and net2 from VM');
                }
                t.end();
            });
        }
    });
});

test('add 3 nics, 1 non-private', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_3_nics_1_non_private,
        function (update_err) {

        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var failures = 0;

                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 3) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(obj.nics[1].primary === true, '2nd NIC is primary: '
                        + !!obj.nics[1].primary);
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('remove net1 -- 2nd time', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 and net1 from VM');
                    t.ok(obj.nics[0].primary === true, '1st NIC is primary: '
                        + !!obj.nics[0].primary);
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net2 -- 2nd time', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net2, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 and net2 from VM');
                }
                t.end();
            });
        }
    });
});

test('add NIC with minimal properties', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_nic_with_minimal_properties,
        function (update_err) {

        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                var nic;
                var prop;

                t.ok(!err, 'failed reloading VM');
                if (err) {
                    return;
                }
                t.ok(obj.nics.length === 1, 'VM has ' + obj.nics.length
                    + ' nics, expected: 1');
                nic = obj.nics[0];
                for (prop in nic) {
                    t.ok((['interface', 'mac', 'nic_tag', 'ip', 'ips']
                        .indexOf(prop) !== -1), 'prop is expected: ' + prop);
                    t.ok(nic[prop] !== 'undefined', 'prop ' + prop
                        + ' is not undefined');
                }
                t.end();
            });
        }
    });
});

test('set then unset simple properties', function (t) {
    async.forEachSeries(simple_properties,
        function (item, cb) {
            var prop = item[0];
            var value = item[1];
            var payload = {};

            payload[prop] = value;

            VM.update(vm_uuid, payload, function (update_err) {
                if (update_err) {
                    t.ok(false, 'error updating VM: ' + update_err.message);
                    t.end();
                    cb();
                } else {
                    VM.load(vm_uuid, function (err, obj) {
                        if (err) {
                            t.ok(false, 'failed reloading VM: ' + err.message);
                            cb();
                            return;
                        } else {
                            t.ok(obj[prop] === value, prop + ' is ' + obj[prop]
                                + ', expected: ' + value);
                        }
                        payload[prop] = undefined;
                        VM.update(vm_uuid, payload, function (up_err) {
                            if (up_err) {
                                t.ok(false, 'error updating VM: '
                                    + up_err.message);
                                t.end();
                                cb();
                            } else {
                                VM.load(vm_uuid, function (l_err, l_obj) {
                                    if (l_err) {
                                        t.ok(false, 'failed reloading VM: '
                                            + l_err.message);
                                        cb();
                                        return;
                                    }
                                    t.ok(!l_obj.hasOwnProperty(prop), prop
                                        + ' is ' + l_obj[prop] + ', expected: '
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

test('update quota', function (t) {
    VM.update(vm_uuid, {quota: 13}, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
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
                    execFile('/usr/sbin/zfs', [
                        'get',
                        '-H',
                        '-o', 'value',
                        'quota',
                        obj.zonepath.substr(1)
                    ], function (error, stdout, stderr) {
                        var res;
                        if (error) {
                            t.ok(false, 'Failed to get quota from zfs: '
                                + error.message);
                        } else {
                            res = stdout
                                .replace(new RegExp('[\\s]+$', 'g'), '');
                            t.ok(res === '13G', 'updated quota now: ' + res
                                + ' vs 13G');
                        }
                        t.end();
                    });
                }
            });
        }
    });
});

test('remove quota', function (t) {
    VM.update(vm_uuid, {quota: 0}, function (update_err) {
        if (update_err) {
            t.ok(false, 'error updating VM: ' + update_err.message);
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
                    execFile('/usr/sbin/zfs', [
                        'get',
                        '-H',
                        '-o', 'value',
                        'quota',
                        obj.zonepath.substr(1)
                    ], function (error, stdout, stderr) {
                        var res;
                        if (error) {
                            t.ok(false, 'Failed to get quota from zfs: '
                                + error.message);
                        } else {
                            res = stdout
                                .replace(new RegExp('[\\s]+$', 'g'), '');
                            t.ok(res === 'none', 'updated quota now: ' + res
                                + ' vs none');
                        }
                        t.end();
                    });
                }
            });
        }
    });
});

function test_update_ram(ram)
{
    test('update ram ' + ram, function (t) {
        VM.update(vm_uuid, {ram: ram}, function (update_err) {
            if (update_err) {
                t.ok(false, 'error updating VM: ' + update_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                    }

                    t.ok((obj.max_physical_memory === Number(ram)),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + ram);
                    t.ok((obj.max_locked_memory === Number(ram)),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + ram);
                    if (ram > 256) {
                        t.ok((obj.max_swap === Number(ram)), 'vm.max_swap: '
                            + obj.max_swap + ' expected: ' + ram);
                    } else {
                        t.ok((obj.max_swap === 256), 'vm.max_swap: '
                            + obj.max_swap + ' expected: ' + 256);
                    }
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
// test updating with string to higher
test_update_ram('256');
// now lower
test_update_ram('64');
// Now something bigger
test_update_ram(1024);

// now try *just* updating swap
test('update max_swap (up)', function (t) {
    var test_value = 1536;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {max_swap: test_value}, function (update_err) {
            if (update_err) {
                t.ok(false, 'error updating VM: ' + update_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (l_err, obj) {
                    if (l_err) {
                        t.ok(false, 'failed reloading VM: ' + l_err.message);
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + test_value);
                    t.ok((obj.tmpfs == before_obj.tmpfs), 'vm.tmpfs: '
                        + obj.tmpfs + ' expected: ' + before_obj.tmpfs);
                    t.ok((obj.max_physical_memory
                        == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory
                        == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating swap, and to a lower than RAM.
test('update max_swap (down)', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = (before_obj.max_physical_memory - 64);
        VM.update(vm_uuid, {'max_swap': test_value}, function (up_err) {
            if (up_err) {
                t.ok(false, 'error updating VM: ' + up_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (l_err, obj) {
                    if (l_err) {
                        t.ok(false, 'failed reloading VM: ' + l_err.message);
                        t.end();
                        return;
                    }
                    // We expect that it was raised to match max_physical_memory
                    t.ok((obj.max_swap === before_obj.max_physical_memory),
                        'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.tmpfs == before_obj.tmpfs), 'vm.tmpfs: '
                        + obj.tmpfs + ' expected: ' + before_obj.tmpfs);
                    t.ok((obj.max_physical_memory
                        == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory
                        == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory (up)
test('update max_physical_memory (up)', function (t) {
    var test_value = 2048;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'max_physical_memory': test_value},
            function (up_err) {

            if (up_err) {
                t.ok(false, 'error updating VM: ' + up_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (l_err, obj) {
                    if (l_err) {
                        t.ok(false, 'failed reloading VM: ' + l_err.message);
                        t.end();
                        return;
                    }

                    // everything else should have been bumped too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + test_value);
                    t.ok((obj.tmpfs === test_value), 'vm.tmpfs: ' + obj.tmpfs
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

// now try *just* updating max_physical_memory (down)
test('update max_physical_memory (down)', function (t) {
    var test_value = 512;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'max_physical_memory': 512}, function (up_err) {
            if (up_err) {
                t.ok(false, 'error updating VM: ' + up_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (l_err, obj) {
                    if (l_err) {
                        t.ok(false, 'failed reloading VM: ' + l_err.message);
                        t.end();
                        return;
                    }

                    // everything else should have been lowered
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + test_value);
                    t.ok((obj.tmpfs === test_value), 'vm.tmpfs: ' + obj.tmpfs
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

// now try *just* updating max_locked_memory, high value (should get clamped)
test('update max_locked_memory', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.max_physical_memory + 256;
        VM.update(vm_uuid, {'max_locked_memory': test_value},
            function (up_err) {

            if (up_err) {
                t.ok(false, 'error updating VM: ' + up_err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (l_err, obj) {
                    if (l_err) {
                        t.ok(false, 'failed reloading VM: ' + l_err.message);
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === before_obj.max_swap), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + before_obj.max_swap);
                    t.ok((obj.tmpfs == before_obj.tmpfs), 'vm.tmpfs: '
                        + obj.tmpfs + ' expected: ' + before_obj.tmpfs);
                    t.ok((obj.max_physical_memory
                        == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    // should have been clamped
                    t.ok((obj.max_locked_memory
                        == before_obj.max_physical_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.end();
                });
            }
        });
    });
});

function zonecfg(args, callback)
{
    var cmd = '/usr/sbin/zonecfg';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {stdout: stdout, stderr: stderr});
        } else {
            callback(null, {stdout: stdout, stderr: stderr});
        }
    });
}

test('update resolvers when no resolvers', function (t) {

    zonecfg([
        '-z', vm_uuid,
        'remove attr name=resolvers;'
    ], function (err, fds) {
        VM.update(vm_uuid, {resolvers: ['4.2.2.1', '4.2.2.2']},
            function (up_err) {
                t.ok(!up_err, 'no error adding resolvers: '
                    + (up_err ? up_err.message : 'ok'));
                t.end();
            }
        );
    });
});

test('update resolvers to empty when already empty', function (t) {
    zonecfg(['-z', vm_uuid, 'remove attr name=resolvers;'],
        function (err, fds) {

        VM.load(vm_uuid, function (l_err, before_obj) {
            if (l_err) {
                t.ok(false, 'loading VM: ' + l_err.message);
                t.end();
                return;
            }

            t.deepEqual(before_obj.resolvers, [], 'initial state has no '
                + 'resolvers: ' + JSON.stringify(before_obj.resolvers));
            VM.update(vm_uuid, {'resolvers': []}, function (up_err) {
                if (up_err) {
                    t.ok(false, 'updating resolvers: ' + up_err.message);
                    t.end();
                    return;
                }

                VM.load(vm_uuid, function (error, after_obj) {
                    if (error) {
                        t.ok(false, 'loading VM (after): ' + error.message);
                        t.end();
                        return;
                    }

                    t.deepEqual(after_obj.resolvers, [], 'no resolvers after '
                        + 'update: ' + JSON.stringify(after_obj.resolvers));
                    t.end();
                });
            });
        });
    });
});

test('update shm rctls', function (t) {
    var payload_copy = JSON.parse(JSON.stringify(PAYLOADS.set_rctls));

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'loading VM: ' + err.message);
            t.end();
            return;
        }

        // Ensure the values are not already what we're changing them to
        Object.keys(PAYLOADS.set_rctls).forEach(function (k) {
            t.ok(before_obj[k] !== PAYLOADS.set_rctls[k], k + ' value before '
                + 'test: ' + before_obj[k]);
        });

        VM.update(vm_uuid, payload_copy, function (up_err) {
            if (up_err) {
                t.ok(false, 'updating rctls: ' + up_err.message);
                t.end();
                return;
            }

            VM.load(vm_uuid, function (l_err, after_obj) {
                if (l_err) {
                    t.ok(false, 'loading VM (after): ' + l_err.message);
                    t.end();
                    return;
                }

                Object.keys(PAYLOADS.set_rctls).forEach(function (k) {
                    t.equal(after_obj[k], PAYLOADS.set_rctls[k], k + ' value '
                        + 'after test: ' + after_obj[k]);
                });
                t.end();
            });
        });
    });
});

test('remove cpu_cap', function (t) {
    var payload_copy = JSON.parse(JSON.stringify(PAYLOADS.remove_cpu_cap));

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'loading VM (before): ' + err.message);
            t.end();
            return;
        }

        t.equal(before_obj.cpu_cap, 1600, 'cpu_cap is 1600 to start');

        VM.update(vm_uuid, payload_copy, function (up_err) {
            if (up_err) {
                t.ok(false, 'updating VM: ' + up_err.message);
                t.end();
                return;
            }

            VM.load(vm_uuid, function (l_err, after_obj) {
                if (l_err) {
                    t.ok(false, 'loading VM (after): ' + l_err.message);
                    t.end();
                    return;
                }

                t.equal(after_obj.cpu_cap, undefined, 'cpu_cap is gone');
                t.end();
            });
        });
    });
});

test('delete zone', function (t) {
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
