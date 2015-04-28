// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

var async = require('/usr/node/node_modules/async');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var fs = require('fs');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('create and destroy 50 zones', function(t) {
    var i;

    i = 0;
    async.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            var state = {'brand': 'joyent-minimal'};
            vmtest.on_new_vm(t, image_uuid, {
                alias: 'test-50-creates-' + i,
                autoboot: false,
                do_not_inventory: true,
                nowait: true
            }, state, [
                function (cb) {
                    VM.load(state.uuid, function(err, obj) {
                        i++;
                        if (err) {
                            t.ok(false, 'load obj from new VM: ' + err.message);
                            return cb(err);
                        }
                        t.ok(true, 'loaded obj for new VM');
                        cb();
                    });
                }
            ], callback);
        }, function (err, cb) {
            t.end();
        }
    );
});
