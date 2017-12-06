// Copyright 2018 Joyent, Inc.  All rights reserved.
//
// Test setting antispoof opts on nics
//

var async = require('/usr/node/node_modules/async');
var VM = require('/usr/vm/node_modules/VM');
var dladm = require('/usr/vm/node_modules/dladm');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var smartos_uuid = vmtest.CURRENT_SMARTOS_UUID;
var ubuntu_uuid = vmtest.CURRENT_UBUNTU_UUID;


/*
 * Compare the dladm link properties of opts.nic from zone opts.uuid with
 * the antispoof properties in opts.props and allowed IPs in opts.allowed_ips.
 */
function nic_link_props(opts, callback) {
    dladm.showLinkProp(opts.uuid, opts.nic, VM.log,
        function (err, props) {
        if (err) {
            opts.t.ok(false, opts.nic + ': dladm for ' + opts.uuid + ': '
                + err.message);
            return callback(err);
        }

        opts.t.deepEqual(props.protection.sort(), opts.props,
            opts.nic + ': antispoof options ' + opts.desc);
        opts.t.deepEqual(props['allow-all-dhcp-cids'],
            (opts.allowed_dhcp_cids[0] === '*').toString(),
            opts.nic + ': all client identifiers allowed ' + opts.desc);
        opts.t.deepEqual(props['allowed-dhcp-cids'].sort(),
            opts.allowed_dhcp_cids.map(function (cid) {
                return (cid === '*' ? '--' : cid);
            }),
            opts.nic + ': allowed client identifiers ' + opts.desc);
        opts.t.deepEqual(props['allowed-ips'].sort(),
            opts.allowed_ips.map(function (ip) {
                if (ip == '--') {
                    return ip;
                }

                return ip + '/32';
            }),
            opts.nic + ': allowed-ips ' + opts.desc);
        opts.t.deepEqual(props['dynamic-methods'].sort(),
            opts.dynamic_methods,
            opts.nic + ': dynamic methods ' + opts.desc);

        return callback();
    });
}


/*
 * Compare the properties in the object props with the vmadm nic with the
 * given name.
 */
function nic_antispoof_props(t, nic, name, props) {
    var sProps = ['allowed_ips', 'allow_dhcp_spoofing', 'allow_ip_spoofing',
        'allow_mac_spoofing', 'allow_restricted_traffic', 'primary'];

    for (var p in sProps) {
        var prop = sProps[p];
        var desc = name + ': ' + prop + ' ';

        if (props.hasOwnProperty(prop)) {
            t.ok(nic.hasOwnProperty(prop), desc + 'present');
            if (props[prop]) {
                t.ok(nic[prop], desc + 'set');
            } else {
                t.notOk(nic[prop], desc + 'not set');
            }
        } else {
            t.notOk(nic.hasOwnProperty(prop), desc + 'not present');
        }
    }
}


function brand_test(brand, image, t) {
    var state = { brand: brand };
    var ips = ['10.3.0.200', '10.4.0.200', '10.5.0.200', '10.6.0.200'];
    var payload = {
        alias: 'test-spoof-opts-' + process.pid,
        autoboot: true,
        brand: brand,
        do_not_inventory: true,
        nowait: false,
        nics: [
            {
                nic_tag: 'admin',
                ip: ips[0],
                netmask: '255.255.255.0'
            }, {
                nic_tag: 'external',
                ip: ips[1],
                netmask: '255.255.255.0'
            }, {
                nic_tag: 'external',
                ip: ips[2],
                netmask: '255.255.255.0'
            }, {
                nic_tag: 'admin',
                ip: ips[3],
                netmask: '255.255.255.0',
                allow_dhcp_spoofing: true,
                allow_mac_spoofing: true,
                allowed_ips: [ '10.6.0.201', '10.6.0.202', '10.6.0.0/25' ]
            }, {
                nic_tag: 'admin',
                ips: [ 'addrconf' ]
            }
        ]
    };

    if (brand === 'kvm') {
        payload.nics.forEach(function (nic) {
            nic.model = 'virtio';
        });
    }

    vmtest.on_new_vm(t, image, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                t.equal(obj.brand, brand, 'created with brand ' + brand);
                state.nics = obj.nics;

                t.ok(obj.nics[0].primary, 'net0 is primary');
                nic_antispoof_props(t, obj.nics[0], 'net0', { primary: true });
                nic_antispoof_props(t, obj.nics[1], 'net1', {});
                nic_antispoof_props(t, obj.nics[2], 'net2', {});
                nic_antispoof_props(t, obj.nics[3], 'net3', {
                    allowed_ips: true,
                    allow_dhcp_spoofing: true,
                    allow_mac_spoofing: true
                });
                nic_antispoof_props(t, obj.nics[4], 'net4', {});

                t.deepEqual(obj.nics[3].allowed_ips,
                    [ '10.6.0.201', '10.6.0.202', '10.6.0.0/25' ],
                    'net3: allowed_ips set correctly');

                return cb();
            });
        }, function (cb) {
            // Check link props
            async.map([0, 1, 2], function (i, cb2) {
                nic_link_props({
                    desc: 'after provision',
                    uuid: state.uuid,
                    nic: 'net' + i,
                    t: t,
                    allowed_dhcp_cids: [ '--' ],
                    props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                        'restricted' ],
                    dynamic_methods: [ '--' ],
                    allowed_ips: [ ips[i] ]
                }, cb2);
            }, cb);

        }, function (cb) {
            nic_link_props({
                desc: 'after provision',
                uuid: state.uuid,
                nic: 'net4',
                t: t,
                allowed_dhcp_cids: [ '*' ],
                props: [
                    'dhcp-nospoof', 'ip-nospoof',
                    'mac-nospoof', 'restricted'
                ],
                dynamic_methods: [ 'dhcpv6', 'slaac' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // Updating a nic to have more than 13 allowed_ips should fail
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.5.0.201', '10.5.0.202', '10.5.0.202',
                    '10.5.0.203', '10.5.0.204', '10.5.0.205', '10.5.0.206',
                    '10.5.0.207', '10.5.0.208', '10.5.0.209', '10.5.0.210',
                    '10.5.0.211', '10.5.0.212', '10.5.0.213', '10.5.0.214' ]
            } ]}, function (e) {
                t.ok(e, 'error returned');
                if (!e) {
                    return cb();
                }

                t.equal(e.message, 'Maximum of 13 allowed_ips per nic',
                    'allowed_ips error message');

                return cb();
            });

        }, function (cb) {
            // Updating a nic to have more than 20 allowed_dhcp_cids should fail
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_dhcp_cids: [
                    '0x01', '0x02', '0x03', '0x04', '0x05', '0x06', '0x07',
                    '0x08', '0x09', '0x0a', '0x0b', '0x0c', '0x0d', '0x0e',
                    '0x0f', '0x10', '0x11', '0x12', '0x13', '0x14', '0x15',
                    '0x16', '0x17', '0x18', '0x19', '0x1a', '0x1b', '0x1c',
                    '0x1d', '0x1e', '0x1f', '0x20', '0x21'
                ]
            } ]}, function (e) {
                t.ok(e, 'error returned');
                if (e) {
                    t.equal(e.message, 'nics.*.allowed_dhcp_cids contains '
                        + '33 Client Identifiers, but is limited to 20',
                        'allowed_dhcp_cids error message');
                }

                cb();
            });

        }, function (cb) {
            // Updating a nic to have more allowed_dhcp_cids with a total length
            // of at least 1024 when stored with zonecfg should fail.
            var cids = [
                '0x0100020003000400050006000701000200030004000500060007010203',
                '0x080009000a000b000c000d000e080009000a000b000c000d000e010203',
                '0x0f0010001100120013001400150f001000110012001300140015010203',
                '0x16001700180019001a001b001c16001700180019001a001b001c010203',
                '0x1d001e001f00200021002200231d001e001f0020002100220023010203'
            ];

            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_dhcp_cids: cids.concat(cids, cids, cids)
            } ]}, function (e) {
                t.ok(e, 'error returned');
                if (e) {
                    t.equal(e.message, 'nics.*.allowed_dhcp_cids contains '
                        + 'too many long Client Identifiers');
                }

                cb();
            });

        }, function (cb) {
            // allowed_dhcp_cids must start with "0x"
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_dhcp_cids: [ '1234' ]
            } ]}, function (e) {
                t.ok(e, 'error returned');
                if (e) {
                    t.equal(e.message,
                        'Invalid value(s) for: nics.*.allowed_dhcp_cids',
                        'allowed_dhcp_cids error message');
                }

                cb();
            });

        }, function (cb) {
            // allowed_dhcp_cids must be hex
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_dhcp_cids: [ '0xqz' ]
            } ]}, function (e) {
                t.ok(e, 'error returned');
                if (e) {
                    t.equal(e.message,
                        'Invalid value(s) for: nics.*.allowed_dhcp_cids',
                        'allowed_dhcp_cids error message');
                }

                cb();
            });

        }, function (cb) {
            // update nics:
            //   net0: set ip and mac spoofing
            //   net1: allow all spoofing
            //   net2: change allowed_ips only
            //   net3: no changes, should remain the same
            //   net3: add allowed Client Identifier 0x1234
            VM.update(state.uuid, { update_nics: [
                {
                    mac: state.nics[0].mac,
                    allow_ip_spoofing: true,
                    allow_mac_spoofing: true
                }, {
                // disable all
                    mac: state.nics[1].mac,
                    allow_ip_spoofing: true,
                    allow_mac_spoofing: true,
                    allow_dhcp_spoofing: true,
                    allow_restricted_traffic: true
                },
                {
                    mac: state.nics[2].mac,
                    allowed_ips: [ '10.5.0.201', '10.5.0.202' ]
                },
                {
                    mac: state.nics[4].mac,
                    allowed_dhcp_cids: [ '0x4321' ]
                }
            ]}, function (e) {

                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                return VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    nic_antispoof_props(t, obj.nics[0], 'net0', {
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        primary: true
                    });

                    // net1
                    nic_antispoof_props(t, obj.nics[1], 'net1', {
                        allow_dhcp_spoofing: true,
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        allow_restricted_traffic: true
                    });

                    // net2
                    nic_antispoof_props(t, obj.nics[2], 'net2', {
                        allowed_ips: true
                    });

                    // net3
                    nic_antispoof_props(t, obj.nics[3], 'net3', {
                        allowed_ips: true,
                        allow_dhcp_spoofing: true,
                        allow_mac_spoofing: true
                    });

                    // net4
                    nic_antispoof_props(t, obj.nics[4], 'net4', {
                        allowed_dhcp_cids: [ '0x4321' ]
                    });

                    t.deepEqual(obj.nics[2].allowed_ips,
                        [ '10.5.0.201', '10.5.0.202' ],
                        'net2: allowed_ips set correctly');

                    return cb();
                });
            });

        }, function (cb) {
            // Check net0's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // Check net1's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ '--' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // Check net2's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);

        }, function (cb) {
            // Check net4's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net4',
                t: t,
                allowed_dhcp_cids: [ '0x4321' ],
                props: [
                    'dhcp-nospoof', 'ip-nospoof',
                    'mac-nospoof', 'restricted'
                ],
                dynamic_methods: [ 'dhcpv6', 'slaac' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // update net1 to disable dhcp spoofing
            VM.update(state.uuid, {update_nics: [ {
                    mac: state.nics[1].mac,
                    allow_dhcp_spoofing: false
            } ] }, function (e) {
                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                return VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    // net0 - should still be the same
                    nic_antispoof_props(t, obj.nics[0], 'net0', {
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        primary: true
                    });

                    // net1 - should now have dhcp spoofing disabled
                    nic_antispoof_props(t, obj.nics[1], 'net1', {
                        allow_dhcp_spoofing: false,
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        allow_restricted_traffic: true
                    });

                    // net2 - should still be the same
                    nic_antispoof_props(t, obj.nics[2], 'net2', {
                        allowed_ips: true
                    });

                    return cb();
                });
            });

        }, function (cb) {
            // net0's link props should stay the same
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // net1's link props should have changed to add dhcp-nospoof
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // net2's link props should stay the same
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);

        }, function (cb) {
            // The changes should persist across reboots
            VM.reboot(state.uuid, {force: true}, function (err) {
                if (err) {
                    t.ok(false, 'VM reboot: ' + err.message);
                    return cb(err);
                }

                return VM.load(state.uuid, function (err2, obj) {
                    if (err2) {
                        t.ok(false, 'VM.load: ' + err2.message);
                        return cb(err2);
                    }

                    // net0 - should still be the same
                    nic_antispoof_props(t, obj.nics[0], 'net0', {
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        primary: true
                    });

                    // net1 - should still be the same
                    nic_antispoof_props(t, obj.nics[1], 'net1', {
                        allow_dhcp_spoofing: false,
                        allow_ip_spoofing: true,
                        allow_mac_spoofing: true,
                        allow_restricted_traffic: true
                    });

                    // net2 - should still be the same
                    nic_antispoof_props(t, obj.nics[2], 'net2', {
                        allowed_ips: true
                    });

                    t.deepEqual(obj.nics[2].allowed_ips,
                        [ '10.5.0.201', '10.5.0.202' ],
                        'net2: allowed_ips set correctly');

                    return cb();
                });
            });

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                allowed_dhcp_cids: [ '--' ],
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                dynamic_methods: [ '--' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);
        }, function (cb) {
            // update net2 to have a v4 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.88.88.0/24' ]
            } ] }, function (e) {
                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                return VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    t.ok(obj.nics[2].allowed_ips[0] == '10.88.88.0/24',
                        'single allowed-ips IPv4 prefix');

                    return cb();
                });
            });
        }, function (cb) {
            // update net2 to have a v6 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '2600:3c00::f03c:91ff:fe96:a260/124' ]
            } ] }, function (e) {
                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                return VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    t.ok(obj.nics[2].allowed_ips[0] ==
                        '2600:3c00::f03c:91ff:fe96:a260/124',
                        'single allowed-ips IPv6 prefix');

                    return cb();
                });
            });
        }, function (cb) {
            // update net2 to have an invalid v4 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.88.88.0/36' ]
            } ] }, function (e) {
                t.ok(e, 'v4 prefix too large');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v4 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.88.88.0/0' ]
            } ] }, function (e) {
                t.ok(e, 'v4 prefix too small');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v4 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.88.88.0/-3' ]
            } ] }, function (e) {
                t.ok(e, 'v4 prefix invalid number');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v4 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '10.88.88.0/' ]
            } ] }, function (e) {
                t.ok(e, 'v4 prefix missing number');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v6 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '2600:3c00::f03c:91ff:fe96:a260/129' ]
            } ] }, function (e) {
                t.ok(e, 'v6 prefix too large');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v6 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '2600:3c00::f03c:91ff:fe96:a260/0' ]
            } ] }, function (e) {
                t.ok(e, 'v6 prefix too small');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v6 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '2600:3c00::f03c:91ff:fe96:a260/-5' ]
            } ] }, function (e) {
                t.ok(e, 'v6 prefix invalid number');

                return cb();
            });
        }, function (cb) {
            // update net2 to have an invalid v6 prefix for IP antispoof
            VM.update(state.uuid, { update_nics: [ {
                mac: state.nics[2].mac,
                allowed_ips: [ '2600:3c00::f03c:91ff:fe96:a260/' ]
            } ] }, function (e) {
                t.ok(e, 'v6 prefix missing number');
                return cb();
            });
        }
    ], function (err) {
        t.end();
    });
}


test('joyent-minimal: antispoof options update without reboot',
    function (t) {
    brand_test('joyent-minimal', smartos_uuid, t);
});

test('joyent: antispoof options update without reboot',
    function (t) {
    brand_test('joyent', smartos_uuid, t);
});

test('kvm: antispoof options update without reboot',
    function (t) {
    brand_test('kvm', ubuntu_uuid, t);
});
