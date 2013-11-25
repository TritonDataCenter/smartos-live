/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
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
var printVMs = false;



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
    var owner = mod_uuid.v4();
    var vm = mod_uuid.v4();
    var vms = [
        helpers.generateVM(),
        helpers.generateVM()
    ];

    var payload = {
        rule: {
            enabled: true,
            owner_uuid: owner,
            rule: util.format(
                'FROM vm %s TO tag role = web ALLOW tcp PORT 80', vm)
        },
        vms: vms
    };

    fw.vms(payload, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res, [], 'no VMs returned');
        return t.done();
    });
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
