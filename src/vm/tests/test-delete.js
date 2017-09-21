// Copyright 2017 Joyent, Inc.
//
// These tests ensure that delete behaves correctly.
//

var async = require('/usr/node/node_modules/async');
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

// w/ OS-2284 we sometimes blew up deleting a non-existent VM, test that we
// haven't regressed.
test('test deleting nonexistent VM', function(t) {
    var i = 0;
    async.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            i++;
            var uuid = libuuid.create();
            t.ok(uuid, 'uuid is: ' + uuid);
            VM.delete(uuid, {}, function (err) {
                if (err && err.message.match(/No such zone configured/)) {
                    t.ok(true, 'zone ' + uuid + ' already does not exist, skipping');
                } else {
                    t.ok(!err, 'deleted VM: ' + (err ? err.message : 'success'));
                }
                callback();
            });
        }, function (err, cb) {
            t.end();
        }
    );
});

