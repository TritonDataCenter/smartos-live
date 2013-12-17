/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm tests
 */

var async = require('async');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_uuid = require('node-uuid');
var util = require('util');



// --- Setup



exports['setup'] = function (t) {
    if (!fw) {
        fw = mocks.setup();
    }
    t.ok(fw, 'fw loaded');
    t.done();
};



// --- Tests



exports['empty rules'] = function (t) {
    var opts = {
        rules: [ ],
        vms: [
            helpers.generateVM()
        ]
    };

    fw.validatePayload(opts, function (err, res) {
        t.ok(err, 'Error returned');
        if (err) {
            t.equal(err.message,
                'Payload must contain one of: rules, localVMs, remoteVMs',
                'Correct error message');
        }
        t.done();
    });
};


exports['single rules'] = function (t) {
    var uuid1 = mod_uuid.v4();
    var vm = helpers.generateVM({ tags: { one: true } });
    // Stub out a rule payload - we'll change rules[0].rule for each
    // test below
    var opts = {
        rules: [
            {
                enabled: true,
                owner_uuid: vm.owner_uuid
            }
        ],
        vms: [
            vm
        ]
    };

    var rules = [
        {
            name: 'vm to ip: valid',
            rule: util.format('FROM vm %s TO ip 1.2.3.4 BLOCK tcp PORT 25',
                            vm.uuid)
        },
        {
            name: 'vm to ip: missing vm',
            rule: util.format('FROM vm %s TO ip 1.2.3.4 BLOCK tcp PORT 25',
                mod_uuid.v4()),
            errors: [ 'No VMs found that match rule: %r' ]
        },
        {
            name: 'tag to ip: valid',
            rule: 'FROM tag one TO ip 1.2.3.4 BLOCK tcp PORT 25'
        },
        {
            name: 'tag to ip: missing tag',
            rule: 'FROM tag two TO ip 1.2.3.4 BLOCK tcp PORT 25'
        },
        {
            name: 'vm to missing tag',
            rule: util.format('FROM vm %s TO tag two BLOCK tcp PORT 25',
                vm.uuid)
        },
        {
            name: 'vm to missing tag and missing vm',
            rule: util.format(
                'FROM vm %s TO (tag blue OR vm %s) BLOCK tcp PORT 25',
                vm.uuid, uuid1),
            errors: [ util.format('Missing vm %s for rule: %r', uuid1) ]
        }
    ];

    async.forEachSeries(rules, function _validate(ruleObj, cb) {
        opts.rules[0].rule = ruleObj.rule;

        fw.validatePayload(opts, function (err, res) {
            if (ruleObj.errors) {
                t.ok(err, util.format('Error returned (%s)', ruleObj.name));
                if (!err) {
                    return cb();
                }
                var errs = err.hasOwnProperty('ase_errors') ?
                    err.ase_errors : [ err ];
                var msgs = errs.map(function (e) { return e.message; }).sort();
                var expectedErrs = ruleObj.errors.map(function (e) {
                    return e.replace('%r', ruleObj.rule); }).sort();

                t.deepEqual(msgs, expectedErrs,
                    util.format('Error messages (%s)', ruleObj.name));
            } else {
                t.equal(err, null, util.format('No error (%s)', ruleObj.name));
                t.ifError(err, util.format('Error returned (%s)',
                    ruleObj.name));
            }

            return cb();
        });

    }, function (err) {
        t.ifError(err);
        t.done();
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    mocks.teardown();
    t.done();
};
