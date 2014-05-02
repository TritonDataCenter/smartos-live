/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var fs = require('fs');
var log = bunyan.createLogger({level: 'debug', name: 'test-vmload-zoneadm', serializers: bunyan.stdSerializers});
var path = require('path');
var vmload_zoneadm = require('/usr/vm/node_modules/vmload/vmload-zoneadm');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// save some typing
var getZoneRecords = vmload_zoneadm.getZoneRecords;

var TESTDIR = '/usr/vm/test/testdata/vmload-zoneadm';

var simple_tests = [
    {
        test_name: 'test w/o any zones',
        arg1: null,
        stdout: '0:global:running:/::liveimg:shared:0\n',
        json: {}
    }, {
        test_name: 'test w/ 1 OS zone',
        arg1: null,
        stdout: '0:global:running:/::liveimg:shared:0\n'
            + '1:c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e:running:/zones/c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e:c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e:joyent-minimal:excl:1\n',
        json: {
            "c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e" : {
                "zoneid" : 1,
                "zonename" : "c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e",
                "state" : "running",
                "zonepath" : "/zones/c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e",
                "uuid" : "c0f63bf1-aa36-4c78-8c3c-a9cfe3b0001e",
                "brand" : "joyent-minimal",
                "ip_type" : "excl"
            }
        }
    }
];

/*
 * TODO: logger that errors when message >= WARN
 *
 */

simple_tests.forEach(function (_test) {
    test(_test.test_name, function (t) {
        var options = {};

        options.log = log;
        if (_test.hasOwnProperty('stdout')) {
            options.zoneadm_stdout = _test.stdout;
        }
        if (_test.hasOwnProperty('stderr')) {
            options.zoneadm_stderr = _test.stderr;
        }

        getZoneRecords(_test.arg1, options, function (err, records) {
            if (err) {
                t.deepEqual(err.message, _test.err_message);
                t.end();
                return;
            }

            t.deepEqual(records, _test.json, 'comparing [' + _test.test_name
                + '] actual vs. expected');
            t.end();
        });
    });
});
