// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Test setting antispoof opts on nics
//

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var dladm = require('/usr/vm/node_modules/dladm');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var test_opts = {'timeout': 240000};
var smartos_uuid = vmtest.CURRENT_SMARTOS_UUID;
var ubuntu_uuid = vmtest.CURRENT_UBUNTU_UUID;

function nic_link_props(opts, callback) {
    dladm.showLinkProp(opts.uuid, opts.nic, VM.log,
        function(err, props) {
        if (err) {
            opts.t.ok(false, opts.nic + ': dladm for ' + state.uuid + ': '
                + err.message);
            callback(err);
            return;
        }

        opts.t.deepEqual(props.protection.sort(), opts.props,
          opts.nic + ': antispoof options ' + opts.desc);
        opts.t.deepEqual(props['allowed-ips'].sort(), opts.allowed_ips,
          opts.nic + ': allowed-ips ' + opts.desc);

        callback();
        return;
    });
}

function brand_test(brand, image, t) {
    var state = { 'brand': brand };
    var ips = ['10.3.0.200', '10.4.0.200', '10.5.0.200', '10.6.0.200'];
    var payload = {
        'autoboot': true,
        'brand': brand,
        'do_not_inventory': true,
        'alias': 'autozone-' + process.pid,
        'nowait': false,
        'nics': [
          { 'nic_tag': 'admin',
            'ip': ips[0],
            'netmask': '255.255.255.0' },
          { 'nic_tag': 'external',
            'ip': ips[1],
            'netmask': '255.255.255.0' },
          { 'nic_tag': 'external',
            'ip': ips[2],
            'netmask': '255.255.255.0' },
          { 'nic_tag': 'admin',
            'ip': ips[3],
            'netmask': '255.255.255.0',
            'allow_dhcp_spoofing': true,
            'allow_mac_spoofing': true,
            'allowed_ips': [ '10.6.0.201', '10.6.0.202', '10.6.0.0/25' ]
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
            VM.load(state.uuid, function(err, obj) {
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                t.equal(obj.brand, brand, 'created with brand ' + brand);
                state.nics = obj.nics;

                t.ok(obj.nics[0].primary, 'net0 is primary');

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.ip == ips[3]) {
                        continue;
                    }

                    t.notOk(n.hasOwnProperty('allow_dhcp_spoofing'),
                        'allow_dhcp_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_ip_spoofing'),
                        'allow_ip_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_mac_spoofing'),
                        'allow_mac_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_restricted_traffic'),
                        'allow_restricted_traffic property not set');
                    t.notOk(n.hasOwnProperty('allowed_ips'),
                        'allowed_ips property not set');
                }

                // net3
                t.ok(obj.nics[3].hasOwnProperty('allow_dhcp_spoofing'),
                    'net3: allow_dhcp_spoofing property set');
                t.notOk(obj.nics[3].hasOwnProperty('allow_ip_spoofing'),
                    'net3: allow_ip_spoofing property not set');
                t.ok(obj.nics[3].hasOwnProperty('allow_mac_spoofing'),
                    'net3: allow_mac_spoofing property set');
                t.notOk(obj.nics[3].hasOwnProperty('allow_restricted_traffic'),
                    'net3: allow_restricted_traffic property not set');
                t.ok(obj.nics[3].hasOwnProperty('allowed_ips'),
                    'net3: allowed_ips property set');

                t.ok(obj.nics[3].allow_dhcp_spoofing,
                  'net3: dhcp spoofing enabled');
                t.ok(obj.nics[3].allow_mac_spoofing,
                  'net3: mac spoofing enabled');

                t.deepEqual(obj.nics[3].allowed_ips,
                    [ '10.6.0.201', '10.6.0.202', '10.6.0.0/25' ],
                    'net3: allowed_ips set correctly');

                cb();
            });
        }, function (cb) {
            // Check link props
            async.map([0, 1, 2], function (i, cb2) {
                var iface = 'net' + i;
                dladm.showLinkProp(state.uuid, iface, VM.log,
                    function(err, props) {
                    if (err) {
                        t.ok(false, 'dladm for ' + state.uuid + ', ' +
                            iface + + err.message);
                        return cb2(err);
                    }

                    t.deepEqual(props.protection.sort(), [ 'dhcp-nospoof',
                      'ip-nospoof', 'mac-nospoof', 'restricted' ],
                      'All antispoof options set for net0');
                    t.deepEqual(props['allowed-ips'], [ips[i]],
                      iface + ': allowed-ips set to assigned IP');

                    cb2();
                });
            }, cb);

        }, function (cb) {
            // Updating a nic to have more than 13 allowed_ips should fail
            VM.update(state.uuid, {'update_nics': [
                { 'mac': state.nics[2].mac,
                  'allowed_ips': [ '10.5.0.201', '10.5.0.202', '10.5.0.202',
                    '10.5.0.203', '10.5.0.204', '10.5.0.205', '10.5.0.206',
                    '10.5.0.207', '10.5.0.208', '10.5.0.209', '10.5.0.210',
                    '10.5.0.211', '10.5.0.212', '10.5.0.213', '10.5.0.214' ]
                }
            ]}, function (e) {
                t.ok(e, 'error returned');
                if (!e) {
                    cb();
                    return;
                }

                t.equal(e.message, 'Maximum of 13 allowed_ips per nic',
                    'allowed_ips error message');
                cb();
            });

        }, function (cb) {
            // update nics:
            //   net0: set ip and mac spoofing
            //   net1: allow all spoofing
            //   net1: change allowed_ips only
            VM.update(state.uuid, {'update_nics': [
                { 'mac': state.nics[0].mac,
                  'allow_ip_spoofing': true,
                  'allow_mac_spoofing': true,
                },
                // disable all
                { 'mac': state.nics[1].mac,
                  'allow_ip_spoofing': true,
                  'allow_mac_spoofing': true,
                  'allow_dhcp_spoofing': true,
                  'allow_restricted_traffic': true
                },
                { 'mac': state.nics[2].mac,
                  'allowed_ips': [ '10.5.0.201', '10.5.0.202' ]
                }
            ]}, function (e) {

                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    // net0
                    t.notOk(obj.nics[0].hasOwnProperty('allow_dhcp_spoofing'),
                        'net0: allow_dhcp_spoofing property not set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_ip_spoofing'),
                        'net0: allow_ip_spoofing property set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_mac_spoofing'),
                        'net0: allow_mac_spoofing property set');
                    t.notOk(obj.nics[0].hasOwnProperty('allow_restricted_traffic'),
                        'net0: allow_restricted_traffic property not set');
                    t.notOk(obj.nics[0].hasOwnProperty('allowed_ips'),
                        'net0: allowed_ips property not set');

                    t.ok(obj.nics[0].allow_mac_spoofing,
                      'net0: mac spoofing enabled');
                    t.ok(obj.nics[0].allow_ip_spoofing,
                      'net0: ip spoofing enabled');

                    t.ok(obj.nics[0].primary, 'net0 is still primary');

                    // net1
                    t.ok(obj.nics[1].hasOwnProperty('allow_dhcp_spoofing'),
                        'net1: allow_dhcp_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_ip_spoofing'),
                        'net1: allow_ip_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_mac_spoofing'),
                        'net1: allow_mac_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_restricted_traffic'),
                        'net1: allow_restricted_traffic property set');
                    t.notOk(obj.nics[1].hasOwnProperty('allowed_ips'),
                        'net1: allowed_ips property not set');

                    t.ok(obj.nics[1].allow_mac_spoofing,
                      'net1: mac spoofing enabled');
                    t.ok(obj.nics[1].allow_ip_spoofing,
                      'net1: ip spoofing enabled');
                    t.ok(obj.nics[1].allow_dhcp_spoofing,
                      'net1: dhcp spoofing enabled');
                    t.ok(obj.nics[1].allow_restricted_traffic,
                      'net1: restricted traffic enabled');

                    // net2
                    t.notOk(obj.nics[2].hasOwnProperty('allow_dhcp_spoofing'),
                        'net2: allow_dhcp_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_ip_spoofing'),
                        'net2: allow_ip_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_mac_spoofing'),
                        'net2: allow_mac_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_restricted_traffic'),
                        'net2: allow_restricted_traffic property not set');
                    t.ok(obj.nics[2].hasOwnProperty('allowed_ips'),
                        'net2: allowed_ips property set');

                    t.deepEqual(obj.nics[2].allowed_ips,
                        [ '10.5.0.201', '10.5.0.202' ],
                        'net2: allowed_ips set correctly');

                    cb();
                });
            });

        }, function (cb) {
            // Check net0's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                props: [ 'dhcp-nospoof', 'restricted' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // Check net1's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                props: [ '--' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // Check net2's link props
            nic_link_props({
                desc: 'after first update',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);

        }, function (cb) {
            // update net1 to disable dhcp spoofing
            VM.update(state.uuid, {'update_nics': [
                { 'mac': state.nics[1].mac,
                  'allow_dhcp_spoofing': false,
                }]},
                function (e) {

                if (e) {
                    t.ok(false, 'VM.update: ' + e.message);
                    return cb(e);
                }

                VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    // net0 - should still be the same
                    t.notOk(obj.nics[0].hasOwnProperty('allow_dhcp_spoofing'),
                        'allow_dhcp_spoofing property not set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_ip_spoofing'),
                        'allow_ip_spoofing property set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_mac_spoofing'),
                        'allow_mac_spoofing property set');
                    t.notOk(obj.nics[0].hasOwnProperty('allow_restricted_traffic'),
                        'allow_restricted_traffic property not set');

                    t.ok(obj.nics[0].allow_mac_spoofing,
                      'net0: mac spoofing enabled');
                    t.ok(obj.nics[0].allow_ip_spoofing,
                      'net0: ip spoofing enabled');

                    t.ok(obj.nics[0].primary, 'net0 is still primary');

                    // net1 - should now have dhcp spoofing disabled
                    t.ok(obj.nics[1].hasOwnProperty('allow_dhcp_spoofing'),
                        'allow_dhcp_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_ip_spoofing'),
                        'allow_ip_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_mac_spoofing'),
                        'allow_mac_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_restricted_traffic'),
                        'allow_restricted_traffic property set');

                    t.ok(obj.nics[1].allow_mac_spoofing,
                      'net1: mac spoofing enabled');
                    t.ok(obj.nics[1].allow_ip_spoofing,
                      'net1: ip spoofing enabled');
                    t.notOk(obj.nics[1].allow_dhcp_spoofing,
                      'net1: dhcp spoofing disabled');
                    t.ok(obj.nics[1].allow_restricted_traffic,
                      'net1: restricted traffic enabled');

                    cb();
                });
            });

        }, function (cb) {
            // net0's link props should stay the same
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                props: [ 'dhcp-nospoof', 'restricted' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // net1's link props should have changed to add dhcp-nospoof
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                props: [ 'dhcp-nospoof' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            // net2's link props should stay the same
            nic_link_props({
                desc: 'after net1 update',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);

        }, function (cb) {
            // The changes should persist across reboots
            VM.reboot(state.uuid, {}, function(err) {
                if (err) {
                    t.ok(false, 'VM reboot: ' + err.message);
                    return cb(err);
                }
                VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'VM.load: ' + err.message);
                        return cb(err);
                    }

                    // net0 - should still be the same
                    t.notOk(obj.nics[0].hasOwnProperty('allow_dhcp_spoofing'),
                        'net0: allow_dhcp_spoofing property not set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_ip_spoofing'),
                        'net0: allow_ip_spoofing property set');
                    t.ok(obj.nics[0].hasOwnProperty('allow_mac_spoofing'),
                        'net0: allow_mac_spoofing property set');
                    t.notOk(obj.nics[0].hasOwnProperty('allow_restricted_traffic'),
                        'net0: allow_restricted_traffic property not set');
                    t.notOk(obj.nics[0].hasOwnProperty('allowed_ips'),
                        'net0: allowed_ips property not set');

                    t.ok(obj.nics[0].allow_mac_spoofing,
                      'net0: mac spoofing enabled');
                    t.ok(obj.nics[0].allow_ip_spoofing,
                      'net0: ip spoofing enabled');

                    t.ok(obj.nics[0].primary, 'net0 is still primary');

                    // net1 - should still be the same
                    t.ok(obj.nics[1].hasOwnProperty('allow_dhcp_spoofing'),
                        'net1: allow_dhcp_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_ip_spoofing'),
                        'net1: allow_ip_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_mac_spoofing'),
                        'net1: allow_mac_spoofing property set');
                    t.ok(obj.nics[1].hasOwnProperty('allow_restricted_traffic'),
                        'net1: allow_restricted_traffic property set');
                    t.notOk(obj.nics[1].hasOwnProperty('allowed_ips'),
                        'net1: allowed_ips property not set');

                    t.ok(obj.nics[1].allow_mac_spoofing,
                      'net1: mac spoofing enabled');
                    t.ok(obj.nics[1].allow_ip_spoofing,
                      'net1: ip spoofing enabled');
                    t.notOk(obj.nics[1].allow_dhcp_spoofing,
                      'net1: dhcp spoofing not enabled');
                    t.ok(obj.nics[1].allow_restricted_traffic,
                      'net1: restricted traffic enabled');

                    // net2 - should still be the same
                    t.notOk(obj.nics[2].hasOwnProperty('allow_dhcp_spoofing'),
                        'net2: allow_dhcp_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_ip_spoofing'),
                        'net2: allow_ip_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_mac_spoofing'),
                        'net2: allow_mac_spoofing property not set');
                    t.notOk(obj.nics[2].hasOwnProperty('allow_restricted_traffic'),
                        'net2: allow_restricted_traffic property not set');
                    t.ok(obj.nics[2].hasOwnProperty('allowed_ips'),
                        'net2: allowed_ips property set');

                    t.deepEqual(obj.nics[2].allowed_ips,
                        [ '10.5.0.201', '10.5.0.202' ],
                        'net2: allowed_ips set correctly');

                    cb();
                });
            });

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net0',
                t: t,
                props: [ 'dhcp-nospoof', 'restricted' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net1',
                t: t,
                props: [ 'dhcp-nospoof' ],
                allowed_ips: [ '--' ]
            }, cb);

        }, function (cb) {
            nic_link_props({
                desc: 'after reboot',
                uuid: state.uuid,
                nic: 'net2',
                t: t,
                props: [ 'dhcp-nospoof', 'ip-nospoof', 'mac-nospoof',
                    'restricted' ],
                allowed_ips: [ips[2], '10.5.0.201', '10.5.0.202']
            }, cb);
        }

    ], function (err) {
        t.end();
    });
}


test('joyent-minimal: antispoof options update without reboot', test_opts,
    function (t) {
    brand_test('joyent-minimal', smartos_uuid, t);
    return;
});

test('joyent: antispoof options update without reboot', test_opts,
    function (t) {
    brand_test('joyent', smartos_uuid, t);
    return;
});

test('kvm: antispoof options update without reboot', test_opts,
    function (t) {
    brand_test('kvm', ubuntu_uuid, t);
    return;
});
