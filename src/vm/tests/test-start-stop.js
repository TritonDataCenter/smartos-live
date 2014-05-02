// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

var async = require('/usr/node/node_modules/async');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var loops = 10;

test('create zone', function(t) {
    var state = {brand: 'joyent-minimal'};
    var functions = [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    abort = true;
                } else {
                    t.ok(true, 'loaded obj for new VM');
                }
                cb();
            });
        }
    ];

    for (; loops > 0; loops--) {
        functions.push(
            function (cb) {
                if (abort === true) {
                    return cb();
                }
                VM.start(state.uuid, {}, function(err, obj) {
                    if (err) {
                        t.ok(false, 'unable to start VM: ' + err.message);
                        abort = true;
                    } else {
                        t.ok(true, 'started VM');
                    }
                    cb();
                });
            }
        );
        functions.push(
            function (cb) {
                if (abort === true) {
                    return cb();
                }
                VM.stop(state.uuid, {}, function(err, obj) {
                    if (err) {
                        t.ok(false, 'unable to start VM: ' + err.message);
                        abort = true;
                    } else {
                        t.ok(true, 'stopped VM');
                    }
                    cb();
                });
            }
        );
    }

    vmtest.on_new_vm(t, image_uuid, {
        autoboot: false,
        do_not_inventory: true,
        alias: 'autozone-' + process.pid,
    }, state, functions);
});

