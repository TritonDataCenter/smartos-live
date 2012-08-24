// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create works with specific options set.
//

process.env['TAP'] = 1;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

// This tests both that the txtimer + txburst can be set, but also a payload
// typical of one that might be used for installing a new OS. Two cdrom devices
// and a blank zvol. We don't boot it because the ISOs don't exist.
// With the passed-in UUID we also test for smartos-live#112
var payload = {
    'autoboot': false,
    'brand': 'kvm',
    'uuid': '3f5592c4-edb1-11e1-a15f-e72adbb11c67',
    'do_not_inventory': true,
    'virtio_txtimer': 123000,
    'virtio_txburst': 123,
    'boot': 'order=cd,once=d',
    'disks': [
        {
            'size': 2048,
            'model': 'virtio'
        },
        {
            'media': 'cdrom',
            'path': '/foo.iso',
            'model': 'ide'
        },
        {
            'media': 'cdrom',
            'path': '/bar.iso',
            'model': 'ide'
        }
    ]
};

test('test create with virtio_tx*', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, payload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var disks;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(obj.virtio_txtimer === payload.virtio_txtimer,
                    'set correct virtio_txtimer');
                t.ok(obj.virtio_txburst === payload.virtio_txburst,
                    'set correct virtio_txburst');
                disks = obj.disks;
                t.ok(disks.length === 3, 'VM has 3 disks');
                t.ok(disks[0].media === 'disk', 'first disk has media type \'disk\'');
                t.ok(disks[1].media === 'cdrom', 'second disk has media type \'cdrom\'');
                t.ok(disks[1].path === '/foo.iso', 'second disk has correct path ['
                    + disks[1].path + ',' + '/foo.iso]');
                t.ok(disks[2].media === 'cdrom', 'third disk has media type \'cdrom\'');
                t.ok(disks[2].path === '/bar.iso', 'third disk has correct path ['
                    + disks[2].path + ',' + '/bar.iso]');
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});
