/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm add unit tests
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_obj = require('../../lib/util/obj');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_vm = require('../../lib/util/vm');

var createSubObjects = mod_obj.createSubObjects;
var mergeObjects = mod_obj.mergeObjects;



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
    if (fw) {
        mocks.reset();
    }
    cb();
};



// --- Tests



exports['global'] = function (t) {
    var vm = helpers.generateVM();

    var payload = {
        rules: [ {
            enabled: true,
            global: true,
            rule: 'FROM any TO all vms ALLOW icmp TYPE 8 CODE 0',
            uuid: '33ed0e9a-26ba-4221-95d3-8d5184e88f06',
            version: '1369192016214.003865'
        } ],
        createdBy: 'fwapi',
        allowAdds: true,
        vms: [ vm ]
    };

    var expRules = clone(payload.rules);
    expRules[0].created_by = payload.createdBy;

    var expRulesOnDisk = {};

    async.series([
    function (cb) {
        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: expRules.sort(helpers.uuidSort),
                vms: [ vm.uuid ]
            }, 'rules returned');

            t.deepEqual(res, {
                rules: expRules,
                vms: [ payload.vms[0].uuid ]
            }, 'rules returned');

            expRulesOnDisk[expRules[0].uuid] = clone(expRules[0]);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);
    }

    ], function () {
        t.done();
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
