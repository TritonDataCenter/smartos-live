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
 * Copyright 2019 Joyent, Inc.
 */

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var properties = require('/usr/vm/node_modules/props');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var vm_uuid;

var PAYLOADS = {
    create: {
        alias: 'test-update-bhyve-' + process.pid,
        brand: 'bhyve',
        ram: 1024,
        autoboot: false,
        flexible_disk_size: 10240, // 10G
        disks: [
            {size: 1024, model: 'virtio', compression: 'off'}
        ],
        do_not_inventory: true
    }, add_net0: {
        add_nics: [
            {
                primary: true,
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
                primary: true,
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
                primary: true,
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
    }, remove_net1_2nd_time: {
        remove_nics: [
            '02:03:04:05:06:07'
        ]
    }, add_disk1: {
        add_disks: [
            {size: 1024, compression: 'off'}
        ]
    }
};

var simple_properties = [
    ['alias', 'useless VM'],
    ['billing_id', '9.99'],
    ['hostname', 'hamburgerhelper'],
    ['owner_uuid', '36bf401a-28ef-11e1-b4a7-c344deb1a5d6'],
    // Bhyve only properties.
    ['bhyve_extra_opts', '-c sockets=1,cores=2,threads=2'],
    ['bootrom', 'uefi']
];


test('create bhyve VM', function (t) {
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

// Add disk1 w/o model and ensure it gets same model as disk0 (See OS-2363)
test('add disk1 to bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_disk1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
            return;
        }

        VM.load(vm_uuid, function (err2, obj) {
            if (err2) {
                t.ok(false, 'failed loading VM: ' + err2.message);
            } else if (obj.disks.length !== 2) {
                t.ok(false, 'VM has ' + obj.disks.length + ' != 2 disks');
            } else {
                t.ok(obj.disks[0].model === obj.disks[1].model,
                    'models of disk0 and disk1 match [' + obj.disks[0].model
                    + ',' + obj.disks[1].model + ']');
            }
            t.end();
        });
    });
});

test('start bhyve VM', function (t) {
    VM.start(vm_uuid, {}, function (err) {
        t.ok(!err, 'error starting VM' + (err ? ': ' + err.message : ''));
        t.end();
    });
});

test('add net0 to bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net0, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    for (var field in PAYLOADS.add_net0.add_nics[0]) {
                        if (field === 'physical') {
                            // physical is a property that gets added but not
                            // in the obj
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

test('update nic model on bhyve VM', function (t) {

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

        var params = {
            update_nics: [
                {'mac': mac, 'model': 'virtio'}
            ]
        };

        VM.update(vm_uuid, params, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
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
test('add net1 to bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    t.ok(obj.nics[0].model === obj.nics[1].model,
                        'models of net0 and net1 match [' + obj.nics[0].model
                        + ',' + obj.nics[1].model + ']');
                }
                t.end();
            });
        }
    });
});

test('remove net0 from bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
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

test('remove net1 from bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
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

test('add net0 and net1 to bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_and_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    var nics = PAYLOADS.add_net0_and_net1.add_nics;
                    for (var nic in [0, 1]) {
                        for (var field in nics[nic]) {
                            if (field === 'physical') {
                                // physical is a property that gets added but
                                // not in the obj
                                continue;
                            }
                            t.deepEqual(obj.nics[nic][field],
                                nics[nic][field],
                                'failed to set ' + field
                                + ', was ' + JSON.stringify(
                                    obj.nics[nic][field])
                                + ', expected '
                                + JSON.stringify(nics[nic][field]));
                        }
                    }
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net1 from bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
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

test('add 3 NICs to bhyve VM', function (t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_through_net2, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
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

test('remove net1 from bhyve VM -- 2nd time', function (t) {
    VM.update(vm_uuid, PAYLOADS.remove_net1_2nd_time, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err2, obj) {
                if (err2) {
                    t.ok(false, 'failed loading VM: ' + err2.message);
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

test('restart bhyve VM', function (t) {
    VM.stop(vm_uuid, {'force': true}, function (err) {
        t.ok(!err, 'stopping VM' + (err ? ': ' + err.message : ''));
        VM.start(vm_uuid, {}, function (err2) {
            t.ok(!err, 'starting VM' + (err2 ? ': ' + err2.message : ''));
            VM.load(vm_uuid, function (err3, obj) {
                if (err3) {
                    t.ok(false, 'failed loading VM: ' + err3.message);
                } else {
                    t.ok(obj.state === 'running',
                        'VM is running after restart: ' + obj.state);
                }

                t.end();
            });
        });
    });
});

test('set simple properties on bhyve VM', function (t) {
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

            VM.update(vm_uuid, payload, function (err) {
                if (err) {
                    t.ok(false, 'error updating VM: ' + err.message);
                    cb();
                    return;
                }

                VM.load(vm_uuid, function (err2, obj) {
                    if (err2) {
                        t.ok(false, 'failed loading VM: ' + err2.message);
                    } else {
                        t.ok(obj[prop] === expected_value, prop + ' is '
                            + obj[prop] + ' (' + typeof (obj[prop])
                            + '), expected: ' + expected_value + ' ('
                            + typeof (expected_value) + ')'
                        );
                    }
                    cb();
                });
            });
        },
        function (err) {
            t.end();
        }
    );
});

test('update bhyve VM flexible_disk_size', function (t) {
    var newSize = PAYLOADS.create.flexible_disk_size + 1024;
    VM.update(vm_uuid, {'flexible_disk_size': newSize}, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
            return;
        }

        VM.load(vm_uuid, function (err2, obj) {
            if (err2) {
                t.ok(false, 'failed loading VM: ' + err2.message);
            } else {
                t.equal(obj.flexible_disk_size, newSize,
                    'VM has ' + obj.flexible_disk_size + ' != ' + newSize);
            }
            t.end();
        });
    });
});

var unique_id = 0;

function test_update_ram(ram)
{
    unique_id += 1; // Ensures each test has it's own unique id.

    test('update ram ' + ram + ' (' +unique_id + ')', function (t) {
        VM.update(vm_uuid, {'ram': ram}, function (err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err2, obj) {
                    if (err2) {
                        t.ok(false, 'failed loading VM: ' + err2.message);
                        t.end();
                    }

                    var overhead = VM.BHYVE_MEM_OVERHEAD;
                    t.ok((obj.ram === ram), 'vm.ram: ' + obj.ram
                        + ' expected: ' + ram);
                    t.ok((obj.max_physical_memory === (ram + overhead)),
                        'vm.max_physical_memory: '
                        + obj.max_physical_memory + ' expected: '
                        + (ram + overhead));
                    t.ok((obj.max_locked_memory === (ram + overhead)),
                        'vm.max_locked_memory: '
                        + obj.max_locked_memory + ' expected: '
                        + (ram + overhead));
                    t.ok((obj.max_swap === (ram + overhead)), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + (ram + overhead));
                    t.end();
                });
            }
        });
    });
}

// Now something bigger
test_update_ram(2048);
// Update to a lower value should lower everything...
test_update_ram(1024);
// Update to use the same size (should be a no-op).
test_update_ram(1024);

// TRITON-1910 Test the setting both ram and max_physical_memory together.
test('update mixed mem properties on BHYVE VM', function (t) {
    var mixed_mem_properties = {
        'ram': 2048,
        'max_physical_memory': 2048
    };

    var payload = JSON.parse(JSON.stringify(mixed_mem_properties));

    VM.update(vm_uuid, payload, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
            return;
        }

        VM.load(vm_uuid, function (err2, obj) {
            if (err2) {
                t.ok(false, 'failed reloading VM');
                t.end();
                return;
            }

            var min_overhead = (properties.BRAND_OPTIONS['bhyve'].features.
                min_memory_overhead);
            var ram = mixed_mem_properties.ram;

            t.ok((obj.ram === ram), 'vm.ram: ' + obj.ram + ' expected: ' + ram);
            t.ok((obj.max_locked_memory === (ram + min_overhead)),
                'vm.max_locked_memory: ' + obj.max_locked_memory + ' expected: '
                + (ram + min_overhead));
            // All other memory values should be the same as the locked memory.
            t.ok((obj.max_swap === (ram + min_overhead)), 'vm.max_swap: '
                + obj.max_swap + ' expected: ' + (ram + min_overhead));
            t.ok((obj.max_physical_memory === (ram + min_overhead)),
                'vm.max_physical_memory: ' + obj.max_physical_memory
                + ' expected: ' + (ram + min_overhead));

            t.end();
        });
    });
});

// now try *just* updating swap
test('update bhyve VM max_swap', function (t) {
    var test_value = 4096;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'max_swap': test_value}, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory ==
                            before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory ==
                            before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating swap, and to a lower than RAM.
test('update bhyve VM max_swap to lower value than RAM', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = (before_obj.max_physical_memory - 64);
        VM.update(vm_uuid, {'max_swap': test_value}, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
                        t.end();
                        return;
                    }

                    // We expect that it was raised to match max_physical_memory
                    t.ok((obj.max_swap === before_obj.max_physical_memory),
                        'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_physical_memory ==
                            before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory ==
                            before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory to a value: ram + 256
test('update max_physical_memory to RAM + 256', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 256;
        VM.update(vm_uuid, {'max_physical_memory': test_value},
                function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap
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
test('update max_physical_memory to RAM + 1024', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 1024;
        VM.update(vm_uuid, {'max_physical_memory': test_value},
                function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: '
                        + obj.max_swap
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
test('update max_swap to RAM - 64', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram - 64;
        VM.update(vm_uuid, {'max_swap': test_value}, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
                return;
            }
            VM.load(vm_uuid, function (err3, obj) {
                if (err3) {
                    t.ok(false, 'failed loading VM: ' + err3.message);
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
test('update max_locked_memory to high value', function (t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.max_physical_memory + 256;
        VM.update(vm_uuid, {'max_locked_memory': test_value}, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === before_obj.max_swap),
                        'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_swap);
                    t.ok((obj.max_physical_memory ==
                            before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    // should have been clamped
                    t.ok((obj.max_locked_memory ==
                            before_obj.max_physical_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.end();
                });
            }
        });
    });
});

// setting vnc_port=-1 should disable VNC
test('set vnc_port=-1', function (t) {
    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'vnc_port': -1}, function (err2) {
            if (err2) {
                t.ok(false, 'error updating VM: ' + err2.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err3, obj) {
                    if (err3) {
                        t.ok(false, 'failed loading VM: ' + err3.message);
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

test('enable / disable compression', function (t) {
    VM.load(vm_uuid, function (err, vmobj) {
        var disk0;
        var disk1;
        var params;

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

        t.ok(disk0.compression === 'off',
            'disk0 has compression off: ' + disk0.compression);
        t.ok(disk1.compression === 'off',
            'disk1 has compression off: ' + disk1.compression);

        params = {
            update_disks: [
                {path: disk0.path, compression: 'gzip'},
                {path: disk1.path, compression: 'gzip'}
            ]
        };

        VM.update(vmobj.uuid, params, function (err2) {
            if (err2) {
                t.ok(false, 'VM.update failed to update disks: '
                    + err2.message);
                t.end();
                return;
            }

            VM.load(vm_uuid, function (err3, vmobj_disabled) {
                if (err3) {
                    t.ok(false, 'error loading VM: ' + err3.message);
                    t.end();
                    return;
                }

                disk0 = vmobj_disabled.disks[0];
                disk1 = vmobj_disabled.disks[1];

                t.ok(disk0.compression === 'gzip',
                    'disk0 has compression=gzip: ' + disk0.compression);
                t.ok(disk1.compression === 'gzip',
                    'disk1 has compression=gzip: ' + disk1.compression);

                params = {
                    update_disks: [
                        {path: disk0.path, compression: 'off'},
                        {path: disk1.path, compression: 'off'}
                    ]
                };

                VM.update(vmobj.uuid, params, function (err4) {
                    if (err4) {
                        t.ok(false, 'VM.update failed to update disks: '
                            + err4.message);
                        t.end();
                        return;
                    }

                    VM.load(vm_uuid, function (err5, vmobj_enabled) {
                        if (err5) {
                            t.ok(false, 'error loading VM: ' + err5.message);
                            t.end();
                            return;
                        }

                        disk0 = vmobj_enabled.disks[0];
                        disk1 = vmobj_enabled.disks[1];

                        t.ok(disk0.compression === 'off',
                            'disk0 has compression=off: ' + disk0.compression);
                        t.ok(disk1.compression === 'off',
                            'disk1 has compression=off: ' + disk1.compression);

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
test('remove bhyve disks', function (t) {
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
        VM.update(vmobj.uuid, {'remove_disks': [disk0.path, disk1.path]},
                function (err2) {
            // expect an error
            t.ok(err2, 'VM.update failed to remove disks: '
                + (err2 ? err2.message : err2));
            if (!err2) {
                t.end();
                return;
            }
            VM.stop(vmobj.uuid, {'force': true}, function (err3) {
                t.ok(!err3, 'VM.stop');
                if (!err3) {
                    VM.load(vm_uuid, function (err4, obj) {
                        t.ok(!err4, 'loaded VM after stop');
                        t.ok(obj.state === 'stopped', 'VM is stopped.');
                        if (obj.state === 'stopped') {
                            // same update
                            VM.update(vmobj.uuid,
                                    {'remove_disks': [disk0.path, disk1.path]},
                                    function (err5) {
                                t.ok(!err5, 'removed disk: '
                                    + (err5 ? err5.message : err5));
                                // check that zfs filesystem is gone, also
                                // reload and check that disk is no longer in
                                // list
                                zfs(['list', disk0.zfs_filesystem],
                                        function (err6, fds) {
                                    t.ok(err6
                                        && err6.hasOwnProperty('message')
                                        && err6.message.match(
                                            'dataset does not exist'),
                                        'ensure dataset no longer exists');
                                    VM.load(vmobj.uuid,
                                            function (err7, final_obj) {
                                        t.ok(!err7, 'loaded VM after delete');
                                        t.ok(final_obj.hasOwnProperty('disks'),
                                            'no disks member for final_obj');
                                        if (final_obj.hasOwnProperty('disks')) {
                                            t.ok(final_obj.disks.length === 0,
                                                'disks list empty: '
                                                + JSON.stringify(
                                                    final_obj.disks));
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

test('delete bhyve VM', function (t) {
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

test('test 100%/10% refreservation, change to 50%/75%', function (t) {
    var p = {
        'alias': 'test-update-bhyve-' + process.pid,
        'brand': 'bhyve',
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
    var state = {'brand': p.brand};

    vmtest.on_new_vm(t, null, p, state, [
        function (cb) {
            VM.load(state.uuid, function (err, vmobj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    cb(err);
                    return;
                }

                var params = {
                    update_disks: [
                        {
                            path: vmobj.disks[0].path,
                            refreservation: (vmobj.disks[0].size * 0.5)
                        },
                        {
                            path: vmobj.disks[1].path,
                            refreservation: (vmobj.disks[1].size * 0.75)
                        }
                    ]
                };

                VM.update(state.uuid, params, function (err2) {

                    t.ok(!err2,
                        'updating VM: ' + (err2 ? err2.message : 'success'));
                    if (err2) {
                        cb();
                        return;
                    }
                    VM.load(state.uuid, function (err3, obj) {
                        var disks;
                        t.ok(!err3,
                            'load VM: ' + (err3 ? err3.message : 'success'));
                        if (err3) {
                            cb(err3);
                            return;
                        }

                        disks = obj.disks;
                        t.ok(disks[0].refreservation === (disks[0].size * 0.5),
                            'disk 0 has correct refreservation: '
                            + disks[0].refreservation + '/'
                            + (disks[0].size * 0.5));
                        t.ok(disks[1].refreservation === (disks[1].size * 0.75),
                            'disk 1 has correct refreservation: '
                            + disks[1].refreservation + '/'
                            + (disks[1].size * 0.75));
                        state.vmobj = obj;
                        cb();
                    });
                });
            });
        }
    ]);
});
