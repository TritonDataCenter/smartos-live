// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS;

test('create and destroy 50 zones', {'timeout': 240000}, function(t) {
    var i;

    i = 0;
    async.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            var state = {'brand': 'joyent-minimal'};
            vmtest.on_new_vm(t, image_uuid, {'autoboot': false,
                'do_not_inventory': true, 'alias': 'autozone-' + i,
                'nowait': true}, state, [
                function (cb) {
                    VM.load(state.uuid, function(err, obj) {
                        if (err) {
                            t.ok(false, 'load obj from new VM: ' + err.message);
                            return cb(err);
                        }
                        t.ok(true, 'loaded obj for new VM');
                        cb();
                        i++;
                    });
                }
            ], callback);
        }, function (err, cb) {
            t.end();
        }
    );
});
