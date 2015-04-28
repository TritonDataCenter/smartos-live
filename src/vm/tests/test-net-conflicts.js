// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// Test detection of network-related conflicts
//

var execFile = require('child_process').execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var mod_tag = require('../common/nictag');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

var payload = {
    alias: 'test-net-conflicts-' + process.pid,
    autoboot: false,
    do_not_inventory: true
};

function should_fail_with_conflict(name, payloadA, payloadB)
{
    for (p in payload) {
        payloadA[p] = payload[p];
        payloadB[p] = payload[p];
    }

    test(name, function(t) {
        vmtest.on_new_vm(t, payloadA.image_uuid, payloadA,
            {brand: payloadA.brand}, [

            function (cb) {
                vmtest.on_new_vm(t, payloadB.image_uuid, payloadB,
                    {brand: payloadB.brand, expect_create_failure: true}, [],
                    function (err) {
                        cb();
                    }
                );
            }
        ]);
    });
}

should_fail_with_conflict('KVM with same IP',
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', netmask: '255.255.255.0', model: 'virtio'}]},
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.172', netmask: '255.255.255.0', model: 'virtio'}]}
);

should_fail_with_conflict('OS with same IP',
    {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', netmask: '255.255.255.0'}]},
    {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.172', netmask: '255.255.255.0'}]}
);

should_fail_with_conflict('KVM with same MAC',
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'}]},
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.173', model: 'virtio', netmask: '255.255.255.0'}]}
);

should_fail_with_conflict('OS with same MAC',
    {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', netmask: '255.255.255.0'}]},
    {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.173', netmask: '255.255.255.0'}]}
);

should_fail_with_conflict('KVM with same IP and MAC',
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'},
        {nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.173', model: 'virtio', netmask: '255.255.255.0'}]},
    {brand: 'kvm', nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'}]}
);

// test that we *don't* fail when conflict is with an already failed VM
test('no conflict when reusing IP of failed VM', function (t) {
    var p;
    var state;
    var tagName = 'test_tag_' + process.pid;

    var payloadA = {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', netmask: '255.255.255.0'}]};
    var payloadB = {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.172', netmask: '255.255.255.0'}]};
    // Identical to B, but with a different MAC and nic_tag
    var payloadC = {brand: 'joyent-minimal', image_uuid: image_uuid, nics: [{nic_tag: tagName, mac: '0e:0e:0d:0c:0b:0b', ip: '172.17.2.172', netmask: '255.255.255.0'}]};


    for (p in payload) {
        payloadA[p] = payload[p];
        payloadB[p] = payload[p];
    }

    state = {brand: payloadA.brand};
    vmtest.on_new_vm(t, payloadA.image_uuid, payloadA, state, [
        function (cb) {
            execFile('/usr/sbin/zonecfg', ['-z', state.uuid, 'remove -F attr name=failed; add attr; set name=failed; set value="provisioning"; set type=string; end'],
                function (error, stdout, stderr) {

                if (error) {
                    t.ok(false, 'failed to set failure flag on ' + state.uuid + ': ' + stderr);
                    cb(error);
                    return;
                }
                cb();
            });
        }, function (cb) {
            vmtest.on_new_vm(t, payloadB.image_uuid, payloadB,
                {brand: payloadB.brand}, [],
                function (err) {
                    t.ok(!err, 'no error adding duplicate NIC with VM-A failed: ' + (err ? err.message : 'success'));
                    cb();
                }
            );
        }, function (cb) {
            mod_tag.list(t, function (err, tags) {
                if (err) {
                    cb(err);
                    return;
                }

                mod_tag.add(t, tagName, tags.admin, cb);
            });
        }, function (cb) {
            // Make sure we can create a VM on a different nic tag with the
            // same IP
            vmtest.on_new_vm(t, payloadC.image_uuid, payloadC,
                {brand: payloadC.brand}, [],
                function (err) {
                    t.ifError(err, 'adding VM with same IP');
                    t.ok(!err, 'no error adding VM with same IP');
                    cb();
                }
            );
        }, function (cb) {
            mod_tag.del(t, tagName, true, cb);
        }
    ]);
});

// test that we can't have two nics with the same IP or MAC
test('2 nics with same MAC', function(t) {
    input = {};
    for (p in payload) {
        input[p] = payload[p];
    }
    input.brand = 'kvm';
    input.nics = [
        {nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'},
        {nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.173', model: 'virtio', netmask: '255.255.255.0'},
    ];
    state = {brand: 'kvm', expect_create_failure: true};
    vmtest.on_new_vm(t, null, input, state, []);
});

test('2 nics with same IP', function(t) {
    input = {};
    for (p in payload) {
        input[p] = payload[p];
    }
    input.brand = 'kvm';
    input.nics = [
        {nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'},
        {nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'},
    ];
    state = {brand: 'kvm', expect_create_failure: true};
    vmtest.on_new_vm(t, null, input, state, []);
});

test('add additional nic with same IP', function(t) {
    var input = {};
    var p;
    var state;

    for (p in payload) {
        input[p] = payload[p];
    }
    input.brand = 'kvm';
    input.nics = [
        {nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'}
    ];
    state = {brand: 'kvm'};
    vmtest.on_new_vm(t, null, input, state, [
        function (cb) {
            VM.update(state.uuid,
                {
                    add_nics: [{nic_tag: 'admin', mac: '0f:0e:0d:0c:0b:0a', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'}]
                },
                function (err) {
                    t.ok(err, 'updating to add another NIC with the same IP (should fail): ' + (err.message ? err.message : 'succeeded'));
                    cb();
                }
            );
        }
    ]);
});

test('add additional nic with same MAC', function(t) {
    var input = {};
    var p;
    var state;

    for (p in payload) {
        input[p] = payload[p];
    }
    input.brand = 'kvm';
    input.nics = [
        {nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.172', model: 'virtio', netmask: '255.255.255.0'}
    ];
    state = {brand: 'kvm'};
    vmtest.on_new_vm(t, null, input, state, [
        function (cb) {
            VM.update(state.uuid,
                {
                    add_nics: [{nic_tag: 'admin', mac: '01:02:03:04:05:06', ip: '172.17.2.173', model: 'virtio', netmask: '255.255.255.0'}]
                },
                function (err) {
                    t.ok(err, 'updating to add another NIC with the same MAC (should fail): ' + (err.message ? err.message : 'succeeded'));
                    cb();
                }
            );
        }
    ]);
});
