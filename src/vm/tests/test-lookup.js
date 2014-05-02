// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// Tests for VM.lookup()
//

var execFile = require('child_process').execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('test tag lookup', function(t) {
    state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        do_not_inventory: true,
        tags: {'bigbaddaboom': 'multipass'}
    }, state, [
        function (cb) {
            VM.lookup({'tags.bigbaddaboom': 'multipass'}, {full: true},
                function (err, vmobjs) {
                    var vm_uuid;

                    if (err) {
                        t.ok(false, 'lookup on new VM: '
                            + (err ? err.message : 'success'));
                        cb(err);
                        return;
                    }
                    t.ok(vmobjs.length === 1, 'result(s) for lookup: '
                        + vmobjs.length + ' expected: 1');

                    vm_uuid = (vmobjs[0] ? vmobjs[0].uuid : undefined);
                    t.ok(vm_uuid === state.uuid, 'vmobj result uuid is: '
                        + vm_uuid);
                    cb();
                }
            );
        }
    ]);
});
