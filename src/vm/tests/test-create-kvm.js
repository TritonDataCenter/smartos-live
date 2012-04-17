// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// These tests ensure that create works with specific options set.
//

process.env['TAP'] = 1;
var test = require('tap').test;
var path = require('path');
var VM = require('VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var payload = {
    'brand': 'kvm',
    'do_not_inventory': true,
    'virtio_txtimer': 123000,
    'virtio_txburst': 123
};

test('test create with virtio_tx*', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, payload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(obj.virtio_txtimer === payload.virtio_txtimer,
                    'set correct virtio_txtimer');
                t.ok(obj.virtio_txburst === payload.virtio_txburst,
                    'set correct virtio_txburst');
                state.vmobj = obj;
                cb();
            });
        }
    ]);
});
