/*
 * Copyright 2019 Joyent, Inc.
 *
 * Integration tests for rules that allow IPsec traffic into an instance.
 */

var mod_cp = require('child_process');
var mod_fw = require('../lib/fw');
var mod_vm = require('../lib/vm');
var util = require('util');
var uuid = require('uuid');


// --- Globals

var KSKF = ' keep state keep frags';

var d = {
    owner_uuid: uuid.v4()
};


// --- Tests

exports['create vm and rules'] = {
    'create': function (t) {
        mod_vm.create(t, {
            params: {
                owner_uuid: d.owner_uuid,
                firewall_enabled: true,
                image_uuid: mod_vm.images.smartos,
                nics: [
                    {
                        nic_tag: 'admin',
                        ip: '10.4.0.30',
                        netmask: '255.255.255.0'
                    }
                ]
            },
            partialExp: {
                firewall_enabled: true
            }
        });
    },

    'fw status after create': function (t) {
        d.vm = mod_vm.lastCreated();
        t.ok(d.vm, 'have last created VM');

        mod_fw.status(t, {
            uuid: d.vm.uuid,
            partialExp: {
                running: true
            }
        });
    },

    'add rules': function (t) {
        var child = mod_cp.execFile('fwadm', [ 'add' ], {
            stdio: 'pipe'
        }, function (err, stdout, stderr) {
            t.ifError(err, '"fwadm add" error');
            if (err !== null) {
                t.equal(err.code, 0, '"fwadm add" exited non-zero');
                t.equal(stderr, '', '"fwadm add" stderr');
                t.equal(stdout, '', '"fwadm add" stdout');
            }
            t.done();
        });

        child.stdin.write(JSON.stringify({
            rules: [
                {
                    owner_uuid: d.owner_uuid,
                    rule: util.format('FROM any TO vm %s ALLOW ah', d.vm.uuid),
                    enabled: true
                },
                {
                    owner_uuid: d.owner_uuid,
                    rule: util.format('FROM any TO vm %s ALLOW esp', d.vm.uuid),
                    enabled: true
                },
                {
                    owner_uuid: d.owner_uuid,
                    rule: util.format('FROM any TO vm %s ALLOW '
                        + 'udp (PORT 500 AND PORT 4500)', d.vm.uuid),
                    enabled: true
                }
            ]
        }));

        child.stdin.end();
    },

    'check ipf rules': function (t) {
        mod_fw.statsContain(t, d.vm.uuid, [
            'pass in quick proto ah from any to any' + KSKF,
            'pass in quick proto esp from any to any' + KSKF,
            'pass in quick proto udp from any to any port = isakmp' + KSKF,
            'pass in quick proto udp from any to any port = ipsec-nat-t' + KSKF
        ], 'ipsec rules applied', function () {
            t.done();
        });
    }
};



// --- Teardown

exports['teardown'] = function (t) {
    mod_vm.delAllCreated(t, {});
};
