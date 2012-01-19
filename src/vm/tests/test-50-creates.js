// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var async = require('async');
var test = require('tap').test;
var path = require('path');
var VM = require('VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var dataset_uuid = '47e6af92-daf0-11e0-ac11-473ca1173ab0';

test('create and destroy 50 zones', {'timeout': 240000}, function(t) {
    var i;

    i = 0;
    async.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            var state = {'brand': 'joyent'};
            vmtest.on_new_vm(t, dataset_uuid, {'autoboot': false,
                'alias': 'autozone-' + i, 'nowait': true}, state, [
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
