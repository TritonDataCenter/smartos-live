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

var image_uuid = vmtest.CURRENT_SMARTOS;

test('antispoof options should update without reboot',
    {'timeout': 240000},function(t) {
    var state = {'brand': 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid,
        { 'autoboot': true,
          'do_not_inventory': true,
          'alias': 'autozone-' + process.pid,
          'nowait': false,
          'nics': [
            { 'nic_tag': 'admin', 'ip': 'dhcp' },
            { 'nic_tag': 'external', 'ip': 'dhcp' }
          ]
        }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                state.nics = obj.nics;

                for (n in obj.nics) {
                    n = obj.nics[n];
                    t.notOk(n.hasOwnProperty('allow_dhcp_spoofing'),
                        'allow_dhcp_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_ip_spoofing'),
                        'allow_ip_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_mac_spoofing'),
                        'allow_mac_spoofing property not set');
                    t.notOk(n.hasOwnProperty('allow_restricted_traffic'),
                        'allow_restricted_traffic property not set');
                }

                cb();
            });
        }, function (cb) {
            // Check net0's link props
            dladm.showLinkProp(state.uuid, 'net0', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net0: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection.sort(), [ 'dhcp-nospoof',
                  'ip-nospoof', 'mac-nospoof', 'restricted' ],
                  'All antispoof options set for net0');
                cb();
            });

        }, function (cb) {
            // Check net1's link props
            dladm.showLinkProp(state.uuid, 'net1', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net1: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection.sort(), [ 'dhcp-nospoof',
                  'ip-nospoof', 'mac-nospoof', 'restricted' ],
                  'All antispoof options set for net0');
                cb();
            });

        }, function (cb) {
            // update nics:
            //   net0: set ip and mac spoofing
            //   net1: allow all spoofing
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

                    // net0
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

                    // net1
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
                    t.ok(obj.nics[1].allow_dhcp_spoofing,
                      'net1: dhcp spoofing enabled');
                    t.ok(obj.nics[1].allow_restricted_traffic,
                      'net1: restricted traffic enabled');

                    cb();
                });
            });

        }, function (cb) {
            // Check net0's link props
            dladm.showLinkProp(state.uuid, 'net0', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net0: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection.sort(),
                  [ 'dhcp-nospoof', 'restricted' ],
                  'net0: dhcp and restricted antispoof options set');
                cb();
            });

        }, function (cb) {
            // Check net1's link props
            dladm.showLinkProp(state.uuid, 'net1', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net1: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection, '--',
                  'net1: No antispoof options set');
                cb();
            });

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
            dladm.showLinkProp(state.uuid, 'net0', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net0: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection.sort(),
                  [ 'dhcp-nospoof', 'restricted' ],
                  'net0: dhcp and restricted antispoof options set');
                cb();
            });

        }, function (cb) {
            // Check net1's link props should have changed
            dladm.showLinkProp(state.uuid, 'net1', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net1: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection, 'dhcp-nospoof',
                  'net1: No antispoof options set');
                cb();
            });

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

                    // net1 - should still be the same
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
            dladm.showLinkProp(state.uuid, 'net0', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net0: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection.sort(),
                  [ 'dhcp-nospoof', 'restricted' ],
                  'net0: dhcp and restricted antispoof options set');
                cb();
            });

        }, function (cb) {
            // net1's link props should stay the same
            dladm.showLinkProp(state.uuid, 'net1', VM.log,
                function(err, props) {
                if (err) {
                    t.ok(false, 'dladm for ' + state.uuid + ' / net1: '
                        + err.message);
                    return cb(err);
                }
                t.deepEqual(props.protection, 'dhcp-nospoof',
                  'net1: No antispoof options set');
                cb();
            });

        }

    ], function (err) {
        t.end();
    });
});
