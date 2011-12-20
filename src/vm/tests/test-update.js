// Copyright 2011 Joyent, Inc.  All rights reserved.

process.env['TAP'] = 1;
require.paths.push('/usr/vm/test/node-tap/node_modules');
var async = require('async');
var test = require('tap').test;
var path = require('path');
var VM = require('VM');

VM.loglevel = 'DEBUG';

var dataset_uuid = '47e6af92-daf0-11e0-ac11-473ca1173ab0';
var vm_uuid;

var PAYLOADS = {
    "create": {
        "dataset_uuid": dataset_uuid,
        "alias": "autotest" + process.pid,
    }, "add_net0": {
        "add_nics": [
            {
                "ip": "10.254.254.254",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net0",
                "vlan_id": 0,
                "gateway": "10.254.254.1",
                "mac": "01:02:03:04:05:06"
            }
        ]
    }, "remove_net0": {
        "remove_nics": [
            "01:02:03:04:05:06"
        ]
    }, "add_net0_and_net1": {
        "add_nics": [
            {
                "ip": "10.254.254.254",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net0",
                "vlan_id": 0,
                "gateway": "10.254.254.1",
                "mac": "01:02:03:04:05:06"
            }, {
                "ip": "10.254.254.253",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net1",
                "vlan_id": 253,
                "gateway": "10.254.254.1",
                "mac": "02:03:04:05:06:07"
            }
        ]
    }, "remove_net0_and_net1": {
        "remove_nics": [
            "01:02:03:04:05:06",
            "02:03:04:05:06:07"
        ]
    }
};

simple_properties = [
    ['alias', 'useless VM'],
    ['billing_id', '9.99'],
    ['dns_domain', 'fail.foo'],
    ['hostname', 'hamburgerhelper'],
    ['owner_uuid', '36bf401a-28ef-11e1-b4a7-c344deb1a5d6'],
    ['package_name', 'really expensive package'],
    ['package_version', 'XP']
];

test('import dataset', function(t) {
    path.exists('/zones/' + dataset_uuid, function (exists) {
        t.ok(exists, "dataset exists");
        t.end();
    });
});

test('create zone', {'timeout': 240000}, function(t) {
    VM.create(PAYLOADS.create, function (err, vmobj) {
        console.log('callback');
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
        } else {
            vm_uuid = vmobj.uuid;
            t.ok(true, 'created VM: ' + vm_uuid);
        }
        t.end();
    });
});

test('add net0', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                failures = 0;
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
                        if (obj.nics[0][field] !== PAYLOADS.add_net0.add_nics[0][field]) {
                            t.ok(false, 'failed to set ' + field + ', was [' + obj.nics[0][field] +
                                '], expected [' + PAYLOADS.add_net0.add_nics[0][field] + ']');
                            failures++;
                        }
                    }
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('remove net0', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0, function(err) {
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

test('add net0 and net1', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_and_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                failures = 0;
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
                            if (obj.nics[nic][field] !== PAYLOADS.add_net0_and_net1.add_nics[nic][field]) {
                                t.ok(false, 'failed to set ' + field + ', was [' + obj.nics[nic][field] +
                                    '], expected [' + PAYLOADS.add_net0_and_net1.add_nics[nic][field] + ']');
                                failures++;
                            }
                        }
                    }
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net1', function(t) {
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

test('set then unset simple properties', function(t) {
    async.forEachSeries(simple_properties,
        function (item, cb) {
            var prop = item[0];
            var value = item[1];
            var payload = {};

            payload[prop] = value;

            VM.update(vm_uuid, payload, function(err) {
                if (err) {
                    t.ok(false, 'error updating VM: ' + err.message);
                    t.end();
                    cb();
                } else {
                    VM.load(vm_uuid, function (err, obj) {
                        if (err) {
                            t.ok(false, 'failed reloading VM');
                            return cb();
                        } else {
                            t.ok(obj[prop] === value, prop + ' is ' + obj[prop]
                                + ', expected: ' + value);
                        }
                        payload[prop] = undefined;
                        VM.update(vm_uuid, payload, function (err) {
                            if (err) {
                                t.ok(false, 'error updating VM: ' + err.message);
                                t.end();
                                cb();
                            } else {
                                VM.load(vm_uuid, function (err, obj) {
                                    if (err) {
                                        t.ok(false, 'failed reloading VM');
                                        return cb();
                                    }
                                    t.ok(!obj.hasOwnProperty(prop), prop +
                                        ' is ' + obj[prop] + ', expected: ' +
                                        'undefined');
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

test('delete zone', function(t) {
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

