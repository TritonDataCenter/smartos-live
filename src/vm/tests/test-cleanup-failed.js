//
// Copyright 2019 Joyent, Inc.
//
// This test ensures that we can halt and delete a failed zone.
//

var child_process = require('child_process');

var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('create failed VM', function(t) {
    state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-cleanup-failed-' + process.pid,
        do_not_inventory: true,
        autoboot: true
    }, state, [
        function (cb) {
            child_process.execFile('/usr/sbin/zonecfg', [
                '-z', state.uuid,
                'add attr; ' +
                'set name=failed; set type=string; set value=provisioning; end'
            ], function _onExec(err, stdout, stderr) {
                t.ok(!err, 'should not have error running zonecfg' +
                    (!err ? '' : ': ' + JSON.stringify({
                        msg: err.message,
                        stderr: stderr.toString(),
                        stdout: stdout.toString()
                    })));

                VM.load(state.uuid, {loadManually: true}, function (err, obj) {
                    t.ok(!err, 'reloaded VM after create: '
                        + (err ? err.message : 'no error'));
                    if (err) {
                        cb(err);
                        return;
                    }

                    t.equal(obj.state, 'failed', 'state should be failed');

                    VM.stop(state.uuid, {force: true}, cb);
                });
            });
        }
    ]);
});
