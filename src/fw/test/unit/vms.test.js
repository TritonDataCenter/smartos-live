/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * fw.vms() tests
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_obj = require('../../lib/util/obj');
var mod_uuid = require('node-uuid');
var util = require('util');

var createSubObjects = mod_obj.createSubObjects;



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var d = {};
var printVMs = false;



// --- Internal


/**
 * Runs fw.vms() with the payload and compares its output against exp
 */
function vmsExpected(t, payload, exp) {
    fw.vms(payload, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res.sort(), exp.sort(), 'expected return');
        return t.done();
    });
}



// --- Setup



exports['setup'] = function (t) {
    fw = mocks.setup();
    t.ok(fw, 'fw loaded');
    t.done();
};


// run before every test
exports.setUp = function (cb) {
    mocks.reset();
    cb();
};



// --- Tests



exports['missing vms'] = function (t) {
    fw.vms({ }, function (err, res) {
        t.ok(err, 'error returned');
        t.equal(err.message, 'opts.vms ([object]) required',
            'error message');
        return t.done();
    });
};


exports['missing rule'] = function (t) {
    fw.vms({ vms: [ helpers.generateVM() ] }, function (err, res) {
        t.ok(err, 'error returned');
        t.equal(err.message, 'opts.rule ([string] or [object]) required',
            'error message');
        return t.done();
    });
};


exports['non-existent VM'] = function (t) {
    var vm = mod_uuid.v4();
    var payload = {
        rule: {
            enabled: true,
            owner_uuid: mod_uuid.v4(),
            rule: util.format(
                'FROM vm %s TO tag role = web ALLOW tcp PORT 80', vm)
        },
        vms: [
            helpers.generateVM(),
            helpers.generateVM()
        ]
    };

    vmsExpected(t, payload, []);
};


exports['all vms -> local VM'] = function (t) {
    var owner = mod_uuid.v4();
    var vms = [ helpers.generateVM({ owner_uuid: owner }),
        helpers.generateVM() ];

    var payload = {
        rule: {
            enabled: true,
            owner_uuid: owner,
            rule: util.format('FROM all vms TO vm %s ALLOW tcp PORT all',
                vms[0].uuid)
        },
        vms: vms
    };

    vmsExpected(t, payload, [ vms[0].uuid ]);
};


exports['tags with boolean values'] = function (t) {
    var owner = mod_uuid.v4();
    var payload = {
        rule: {
            enabled: true,
            owner_uuid: owner,
            rule: 'FROM ip 10.0.1.1 TO tag private = true ALLOW tcp PORT all'
        },
        vms: [
            helpers.generateVM({ owner_uuid: owner }),
            helpers.generateVM({
                owner_uuid: owner, tags: { private: 'true' }
            }),
            helpers.generateVM({ owner_uuid: owner, tags: { private: true } }),
            helpers.generateVM()
        ]
    };

    vmsExpected(t, payload, [ payload.vms[1].uuid, payload.vms[2].uuid ]);
};


exports['firewall disabled'] = {
    'setup': function (t) {
        var owners = [ mod_uuid.v4(), mod_uuid.v4() ];

        d.vms = [
            helpers.generateVM({
                owner_uuid: owners[0],
                tags: { role: 'web' }
            }),
            helpers.generateVM({
                firewall_enabled: false,
                owner_uuid: owners[0],
                tags: { role: 'web' }
            }),
            helpers.generateVM({
                owner_uuid: owners[1],
                tags: { role: 'web' }
            })
        ];

        delete d.vms[0].firewall_enabled;

        d.rule = {
            enabled: true,
            owner_uuid: owners[0],
            rule: 'FROM ip 10.0.1.1 TO tag role = web ALLOW tcp PORT 80'
        };

        return t.done();
    },

    'no disabled VMs included': function (t) {
        var payload = {
            rule: d.rule,
            vms: d.vms
        };

        vmsExpected(t, payload, []);
    },

    'disabled VMs included': function (t) {
        var payload = {
            includeDisabled: true,
            rule: d.rule,
            vms: d.vms
        };

        vmsExpected(t, payload, [ d.vms[0].uuid, d.vms[1].uuid ]);
    }
};


exports['rule disabled'] = function (t) {
    var owner = mod_uuid.v4();
    var vm = helpers.generateVM({ owner_uuid: owner });
    var payload = {
        rule: {
            enabled: false,
            owner_uuid: owner,
            rule: util.format('FROM ip 10.0.1.1 TO vm %s ALLOW tcp PORT 2020',
                vm.uuid)
        },
        vms: [ vm ]
    };

    vmsExpected(t, payload, [ vm.uuid ]);
};


exports['ip, vm, vm -> ip, vm, vm'] = function (t) {
    var owners = [ mod_uuid.v4() ];
    var otherVM = mod_uuid.v4();

    d.vms = [
        helpers.generateVM({
            owner_uuid: owners[0]
        })
    ];

    var payload = {
        rule: {
            enabled: true,
            owner_uuid: owners[0],
            rule: util.format('FROM (ip 239.0.0.1 OR vm %s OR vm %s) '
                + 'TO (ip 239.0.0.1 OR vm %s OR vm %s) '
                + 'ALLOW udp (PORT 4803 AND PORT 4804)',
                otherVM, d.vms[0].uuid, otherVM, d.vms[0].uuid)
        },
        vms: d.vms
    };

    vmsExpected(t, payload, [ d.vms[0].uuid ]);
};



// --- Teardown



exports['teardown'] = function (t) {
    mocks.teardown();
    t.done();
};


// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
