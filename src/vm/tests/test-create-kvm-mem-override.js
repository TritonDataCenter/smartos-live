// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

var async = require('/usr/node/node_modules/async');
var VM = require('/usr/vm/node_modules/VM');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var vm_uuid;
var payload = {
    brand: 'kvm',
    alias: 'autotest-vm' + process.pid,
    do_not_inventory: true,
    ram: 256,
    swap_in_bytes: 2147483648,
    ram_in_bytes: 1073741824,
    max_physical_memory: 256,
    max_swap: 512
};


test('create zone', function(t) {
    VM.create(payload, function (err, vmobj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
        } else {
            vm_uuid = vmobj.uuid;
            t.ok(true, 'created VM: ' + vm_uuid);
        }
        t.end();
    });
});

test('ensure memory values were bumped', function(t) {
    if (!vm_uuid) {
        t.ok(false, 'no zone, can\'t check memory');
        t.end();
        return;
    }
    VM.load(vm_uuid, function(err, obj) {
        var n;
        var update_mac;

        t.ok(!err, 'VM.load: ' + (err ? err.message : 'ok'));
        if (err) {
            t.end();
            return;
        }

        t.ok((obj.ram === payload.ram), 'ram was set properly: '
            + obj.ram + ' === ' + payload.ram);
        t.ok((obj.max_physical_memory > obj.ram), 'max_physical was set properly: '
            + obj.max_physical_memory + ' > ' + obj.ram);
        t.ok((obj.max_locked_memory > obj.ram), 'max_locked was set properly: '
            + obj.max_locked_memory + ' > ' + obj.ram);
        t.ok((obj.max_swap >= obj.max_physical_memory), 'max_swap was set properly: '
            + obj.max_swap + ' >= ' + obj.max_physical_memory);
        t.end();
    });
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
