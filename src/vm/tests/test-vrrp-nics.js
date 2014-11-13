// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// Test invalid nic tag detection
//

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var dladm = require('/usr/vm/node_modules/dladm');
var fs = require('fs');
var util = require('util');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';
var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var VM_NUM = 0;


/*
 * Update the VM at opts.state.uuid, with the expected error
 * message of opts.err
 */
function expectUpdateError(opts, cb) {
    VM.update(opts.state.uuid, opts.payload, function (err) {
        opts.t.ok(err, opts.desc + ': update error expected');
        if (err) {
            opts.t.equal(err.message, opts.err,
                opts.desc + ': update error message');
        }

        cb();
    });
}

/*
 * Generate a new unique VM alias
 */
function alias() {
    return 'autozone-' + process.pid + '-' + VM_NUM++;
}

/*
 * Create a VM with the expected error message of opts.err
 */
function expectCreateError(opts, cb) {
    var state = {brand: 'joyent-minimal', expect_create_failure: true };
    vmtest.on_new_vm(opts.t, IMAGE_UUID, {
        autoboot: false,
        do_not_inventory: true,
        alias: alias(),
        nowait: false,
        nics: opts.nics
    }, state, [], function (err) {
        opts.t.ok(state.hasOwnProperty('create_err'),
            opts.desc + ': create_err set');

        if (state.create_err) {
            opts.t.equal(state.create_err.message, opts.err,
                opts.desc + ': create error message');
        }

        if (cb) {
            return cb();
        } else {
            return opts.t.end();
        }
    });
}

test('vrrp vnics: updating', function (t) {
    var state = {brand: 'joyent-minimal'};
    var vm;
    var vm_params = {
        autoboot: true,
        do_not_inventory: true,
        alias: alias(),
        nowait: false,
        nics: [
            {
                nic_tag: 'external',
                vrrp_vrid: 1,
                ip: '172.18.1.101',
                netmask: '255.255.255.0',
                vrrp_primary_ip: '172.18.1.2'
            }, {
                nic_tag: 'external',
                vrrp_vrid: 2,
                ip: '172.18.1.102',
                netmask: '255.255.255.0',
                vrrp_primary_ip: '172.18.1.2'
            }, {
            // The primary IP
                nic_tag: 'external',
                ip: '172.18.1.2',
                netmask: '255.255.255.0'
            }, {
            // A non-VRRP nic
                nic_tag: 'external',
                ip: '172.18.1.3',
                netmask: '255.255.255.0'
            }
        ]
    };

    // Create a VM with 2 VRRP nics
    vmtest.on_new_vm(t, IMAGE_UUID, vm_params, state, [
        function (cb) {
            // Verify nic parameters
            VM.load(state.uuid, function (err, obj) {
                t.ifError(err, 'loading new VM');
                if (!obj) {
                    return cb(err);
                }

                vm = obj;
                t.equal(obj.nics.length, 4, '4 nics total');
                t.equal(obj.nics[0].vrrp_vrid, 1,
                    'nic 0 valid VRRP VID');
                t.equal(obj.nics[1].vrrp_vrid, 2,
                    'nic 1 valid VRRP VID');

                t.equal(obj.nics[0].vrrp_primary_ip, '172.18.1.2',
                    'nic 0 valid VRRP primary IP');
                t.equal(obj.nics[1].vrrp_primary_ip, '172.18.1.2',
                    'nic 1 valid VRRP primary IP');

                t.equal(obj.nics[0].mac, '00:00:5e:00:01:01',
                    'nic 0 VRRP MAC address');
                t.equal(obj.nics[1].mac, '00:00:5e:00:01:02',
                    'nic 1 VRRP MAC address');

                return cb();
            });

        }, function (cb) {
            // Verify allowed IPs for net0
            dladm.showLinkProp(vm.zonename, 'net0', VM.log,
                function (err, props) {
                t.ifError(err, 'show-linkprop for net0');
                if (err) {
                    return cb(err);
                }

                // The VRRP nics should be allowed to send as the
                // VRRP primary IP
                t.deepEqual(props['allowed-ips'].sort(),
                    ['172.18.1.101/32', '172.18.1.2/32'], 'net0 allowed-ips');

                return cb();
            });

        }, function (cb) {
            // Verify allowed IPs for net1
            dladm.showLinkProp(vm.zonename, 'net1', VM.log,
                function (err, props) {
                t.ifError(err, 'show-linkprop for net1');
                if (err) {
                    return cb(err);
                }

                // The VRRP nics should be allowed to send as the
                // VRRP primary IP
                t.deepEqual(props['allowed-ips'].sort(),
                    ['172.18.1.102/32', '172.18.1.2/32'], 'net1 allowed-ips');

                return cb();
            });

        }, function (cb) {
            // Should not allow updating to another nic's VRID
            var payload = {
                update_nics: [
                    {
                        mac: vm.nics[0].mac,
                        vrrp_vrid: 2
                    }
                ]
            };

            VM.update(state.uuid, payload, function (err) {
                t.ok(err, 'error updating to conflicting VRID');
                if (err) {
                    t.equal(err.message,
                        'Cannot add multiple NICs with the same VRID: 2',
                        'update error message');
                }

                return cb();
            });

        }, function (cb) {
            // Actually update
            var payload = {
                update_nics: [
                    {
                        mac: vm.nics[0].mac,
                        vrrp_vrid: 3
                    }
                ]
            };

            VM.update(state.uuid, payload, function (err) {
                t.ifError(err, 'update error: net0 to VRID 3');
                if (err) {
                    return cb(err);
                }

                return cb();
            });

        }, function (cb) {
            // Check the updated values
            VM.load(state.uuid, function (err, obj) {
                t.ifError(err, 'load error');
                if (err) {
                    return cb(err);
                }
                vm = obj;

                t.equal(obj.nics.length, 4, 'still 4 nics');
                t.equal(obj.nics[0].vrrp_vrid, 3,
                    'nic 0 valid VRRP VID');
                t.equal(obj.nics[1].vrrp_vrid, 2,
                    'nic 1 valid VRRP VID');

                t.equal(obj.nics[0].vrrp_primary_ip, '172.18.1.2',
                    'nic 0 valid VRRP primary IP');
                t.equal(obj.nics[1].vrrp_primary_ip, '172.18.1.2',
                    'nic 1 valid VRRP primary IP');

                t.equal(obj.nics[0].mac, '00:00:5e:00:01:03',
                    'nic 0 VRRP MAC address');
                t.equal(obj.nics[1].mac, '00:00:5e:00:01:02',
                    'nic 1 VRRP MAC address');

                return cb();
            });

        }, function (cb) {
            // Should not allow setting both mac and VRID
            expectUpdateError({
                state: state,
                payload: {
                    add_nics: [
                        {
                            mac: '52:31:98:52:5d:07:d0',
                            nic_tag: 'external',
                            ip: 'dhcp',
                            vrrp_vrid: 4
                        }
                    ]
                },
                t: t,
                err: 'Cannot set both mac and vrrp_vrid',
                desc: 'adding with both mac and vrrp_vrid set'
            }, cb);

        }, function (cb) {
            // Should not allow updating vrrp_primary_ip to an IP not in
            // this VM
            expectUpdateError({
                state: state,
                payload: {
                    update_nics: [
                        {
                            mac: vm.nics[0].mac,
                            vrrp_primary_ip: '172.18.1.254',
                            vrrp_vrid: 12
                        }
                    ]
                },
                t: t,
                err: 'vrrp_primary_ip must belong to the same VM',
                desc: 'updating to a foreign vrrp_primary_ip'
            }, cb);

        }, function (cb) {
            // Should not allow setting a VRID on a nic that's already
            // a vrrp_primary_ip
            expectUpdateError({
                state: state,
                payload: {
                    update_nics: [
                        {
                            mac: vm.nics[2].mac,
                            vrrp_vrid: 14
                        }
                    ]
                },
                t: t,
                err: 'Cannot set vrrp_primary_ip to the IP of a VRRP nic',
                desc: 'setting vrrp_vrid on a vrrp_primary_ip nic'
            }, cb);

        }, function (cb) {
            // Should not allow adding a nic with vrrp_primary_ip set
            // to a VRRP nic
            expectUpdateError({
                state: state,
                payload: {
                    add_nics: [
                        {
                            ip: 'dhcp',
                            nic_tag: 'external',
                            vrrp_vrid: 15,
                            vrrp_primary_ip: '172.18.1.101'
                        }
                    ]
                },
                t: t,
                err: 'Cannot set vrrp_primary_ip to the IP of a VRRP nic',
                desc: 'adding a nic with vrrp_primary_ip set'
            }, cb);

        }, function (cb) {
            // Should not allow adding a nic with vrrp_primary_ip set
            // to itself
            expectUpdateError({
                state: state,
                payload: {
                    add_nics: [
                        {
                            nic_tag: 'external',
                            ip: '172.18.1.117',
                            netmask: '255.255.255.0',
                            vrrp_vrid: 16,
                            vrrp_primary_ip: '172.18.1.117'
                        }
                    ]
                },
                t: t,
                err: 'Cannot set vrrp_primary_ip to the IP of a VRRP nic',
                desc: 'vrrp_primary_ip set to self'
            }, cb);

        }, function (cb) {
            // Should not allow adding a nic with a vrid but no
            // vrrp_primary_ip
            expectUpdateError({
                state: state,
                payload: {
                    add_nics: [
                        {
                            nic_tag: 'external',
                            ip: '172.18.1.118',
                            netmask: '255.255.255.0',
                            vrrp_vrid: 17
                        }
                    ]
                },
                t: t,
                err: 'vrrp_vrid set but not vrrp_primary_ip',
                desc: 'add with vrid set but not vrrp_primary_ip'
            }, cb);

        }, function (cb) {
            // Should not allow adding a nic with a vrid but no
            // vrrp_primary_ip
            expectUpdateError({
                state: state,
                payload: {
                    update_nics: [
                        {
                            mac: vm.nics[3].mac,
                            vrrp_vrid: 18
                        }
                    ]
                },
                t: t,
                err: 'vrrp_vrid set but not vrrp_primary_ip',
                desc: 'update with vrid set but not vrrp_primary_ip'
            }, cb);

        }, function (cb) {
            // Should not allow leaving only a vrrp nic
            expectUpdateError({
                state: state,
                payload: {
                    remove_nics: [
                        vm.nics[1].mac,
                        vm.nics[2].mac,
                        vm.nics[3].mac
                    ]
                },
                t: t,
                err: 'VM cannot contain only VRRP nics',
                desc: 'remove all but a VRRP nic'
            }, cb);

        }, function (cb) {
            // Should not allow leaving only 2 vrrp nics
            expectUpdateError({
                state: state,
                payload: {
                    remove_nics: [
                        vm.nics[2].mac,
                        vm.nics[3].mac
                    ]
                },
                t: t,
                err: 'VM cannot contain only VRRP nics',
                desc: 'remove all but a VRRP nic'
            }, cb);

        }, function (cb) {
            // VRID > 255 is invalid
            expectUpdateError({
                state: state,
                payload: {
                    update_nics: [
                        {
                            mac: vm.nics[0].mac,
                            vrrp_vrid: 256
                        }
                    ]
                },
                t: t,
                err: 'Invalid value(s) for: nics.*.vrrp_vrid',
                desc: 'vrrp_vrid > 255'
            }, cb);

        }, function (cb) {
            // VRID < 0 is invalid
            expectUpdateError({
                state: state,
                payload: {
                    update_nics: [
                        {
                            mac: vm.nics[0].mac,
                            vrrp_vrid: -1
                        }
                    ]
                },
                t: t,
                err: 'Invalid value(s) for: nics.*.vrrp_vrid',
                desc: 'vrrp_vrid < 0'
            }, cb);

        }, function (cb) {
            // Should not allow deleting the vrrp_primary_ip nic
            expectUpdateError({
                state: state,
                payload: {
                    remove_nics: [
                        vm.nics[2].mac
                    ]
                },
                t: t,
                err: 'vrrp_primary_ip must belong to the same VM',
                desc: 'remove the vrrp_primary_ip nic'
            }, cb);

        }, function (cb) {
            // Update vrrp_primary_ip to the other non-VRRP nic
            var payload = {
                update_nics: [
                    {
                        mac: vm.nics[0].mac,
                        vrrp_primary_ip: '172.18.1.3'
                    }
                ]
            };

            VM.update(state.uuid, payload, function (err) {
                t.ifError(err, 'update error: vrrp_primary_ip of net0');
                if (err) {
                    return cb(err);
                }

                return cb();
            });

        }, function (cb) {
            // Check the updated values
            VM.load(state.uuid, function (err, obj) {
                t.ifError(err, 'load error');
                if (err) {
                    return cb(err);
                }
                vm = obj;

                t.equal(obj.nics[0].vrrp_vrid, 3,
                    'nic 0 valid VRRP VID');
                t.equal(obj.nics[0].vrrp_primary_ip, '172.18.1.3',
                    'nic 0 valid VRRP primary IP');
                t.equal(obj.nics[0].mac, '00:00:5e:00:01:03',
                    'nic 0 VRRP MAC address');

                return cb();
            });

        }, function (cb) {
            // Allowed IPs for net0 should reflect the new vrrp_primary_ip
            dladm.showLinkProp(vm.zonename, 'net0', VM.log,
                function (err, props) {
                t.ifError(err, 'show-linkprop for net0');
                if (err) {
                    return cb(err);
                }

                t.deepEqual(props['allowed-ips'].sort(),
                    ['172.18.1.101/32', '172.18.1.3/32'], 'net0 allowed-ips');

                return cb();
            });

        }, function (cb) {
            // Should not allow creating more than 1 VM with the same VRID
            vm_params.nics = [
                {
                    nic_tag: 'external',
                    vrrp_vrid: 2,
                    ip: '172.18.1.202',
                    netmask: '255.255.255.0',
                    vrrp_primary_ip: '172.18.1.203'
                }, {
                    nic_tag: 'external',
                    ip: '172.18.1.203',
                    netmask: '255.255.255.0'
                }
            ];
            vm_params.alias = alias();
            expectCreateError({
                nics: [
                    {
                        nic_tag: 'external',
                        vrrp_vrid: 3,
                        ip: '172.18.1.202',
                        netmask: '255.255.255.0',
                        vrrp_primary_ip: '172.18.1.203'
                    },
                    {
                        nic_tag: 'external',
                        ip: '172.18.1.203',
                        netmask: '255.255.255.0'
                    }
                ],
                t: t,
                err: 'Conflict detected with another vm, please check the '
                    + 'MAC, IP, and VRID',
                desc: 'Create VM with duplicate VRID'
            }, cb);
        }

    ], function () {
        t.end();
    });
});

test('create with both mac and vrrp_vid', function (t) {
    expectCreateError({
        nics: [ {
                mac: '52:31:98:52:5d:07:d1',
                vrrp_vrid: 9
        } ],
        t: t,
        err: 'Cannot set both mac and vrrp_vrid',
        desc: 'both mac and vrrp_vrid set'
    });
});

test('create with vrrp_primary_ip set to a VRRP nic', function (t) {
    expectCreateError({
        nics: [
            {
                ip: '172.18.1.110',
                nic_tag: 'external',
                netmask: '255.255.255.0',
                vrrp_vrid: 31
            }, {
                ip: 'dhcp',
                nic_tag: 'external',
                vrrp_vrid: 32,
                vrrp_primary_ip: '172.18.1.110'
            }
        ],
        t: t,
        err: 'Cannot set vrrp_primary_ip to the IP of a VRRP nic',
        desc: 'vrrp_primary_ip set to a VRRP nic'
    });
});

test('create with vrrp_primary_ip set to a foreign IP', function (t) {
    expectCreateError({
        nics: [
            {
                ip: '172.18.1.111',
                netmask: '255.255.255.0',
                nic_tag: 'external'
            }, {
                ip: 'dhcp',
                nic_tag: 'external',
                vrrp_vrid: 33,
                vrrp_primary_ip: '172.18.1.254'
        } ],
        t: t,
        err: 'vrrp_primary_ip must belong to the same VM',
        desc: 'vrrp_primary_ip set to foreign ip'
    });
});

test('create with vrrp_primary_ip set to self', function (t) {
    expectCreateError({
        nics: [
            {
                nic_tag: 'external',
                ip: '172.18.1.127',
                netmask: '255.255.255.0',
                vrrp_vrid: 26,
                vrrp_primary_ip: '172.18.1.127'
            }, {
                ip: 'dhcp',
                nic_tag: 'external'
            }
        ],
        t: t,
        err: 'Cannot set vrrp_primary_ip to the IP of a VRRP nic',
        desc: 'vrrp_primary_ip set to self'
    });
});

test('create with vrrp_vrid set but not vrrp_primary_ip', function (t) {
    expectCreateError({
        nics: [
            {
                nic_tag: 'external',
                ip: '172.18.1.127',
                netmask: '255.255.255.0',
                vrrp_vrid: 27
            }, {
                ip: 'dhcp',
                nic_tag: 'external'
            }
        ],
        t: t,
        err: 'vrrp_vrid set but not vrrp_primary_ip',
        desc: 'vrrp_vrid set but not vrrp_primary_ip'
    });
});

test('create with only a VRRP nic', function (t) {
    expectCreateError({
        nics: [ {
            nic_tag: 'external',
            ip: '172.18.1.127',
            netmask: '255.255.255.0',
            vrrp_vrid: 27,
            vrrp_primary_ip: '172.18.1.2'
        } ],
        t: t,
        err: 'VM cannot contain only VRRP nics',
        desc: 'create with only a VRRP nic'
    });
});

test('create: 2 nics with same VRID', function (t) {
    expectCreateError({
        nics: [ {
                ip: '172.18.1.127',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                vrrp_vrid: 27,
                vrrp_primary_ip: '172.18.1.129'
            }, {
                ip: '172.18.1.128',
                netmask: '255.255.255.0',
                nic_tag: 'external',
                vrrp_vrid: 27,
                vrrp_primary_ip: '172.18.1.129'
            }, {
                ip: '172.18.1.128',
                netmask: '255.255.255.0',
                nic_tag: 'external'
            }
        ],
        t: t,
        err: 'Cannot add multiple NICs with the same VRID: 27',
        desc: 'create: 2 nics with same VRID'
    });
});
