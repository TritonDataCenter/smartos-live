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



exports['created_by'] = function (t) {
    var vm = helpers.generateVM();

    var payload = {
        rules: [
            {
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8080',
                    vm.uuid),
                uuid: vm.owner_uuid,
                owner_uuid: mod_uuid.v4(),
                enabled: true,
                version: '1383205115597.067782'
            },
            {
                created_by: 'other',
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8081',
                    vm.uuid),
                uuid: mod_uuid.v4(),
                owner_uuid: vm.owner_uuid,
                enabled: true,
                version: '1383205115597.067782'
            }
        ],
        vms: [vm],
        createdBy: 'fwadm'
    };

    var expRules = clone(payload.rules);
    expRules[0].created_by = payload.createdBy;

    var expRulesOnDisk = {};

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
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
            expRulesOnDisk[expRules[1].uuid] = clone(expRules[1]);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        payload.allowAdds = true;
        payload.rules[0].uuid = mod_uuid.v4();
        payload.rules[1].uuid = mod_uuid.v4();
        expRules = clone(payload.rules);
        expRules[0].created_by = payload.createdBy;

        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            t.deepEqual(res, {
                rules: expRules,
                vms: [ payload.vms[0].uuid ]
            }, 'rules returned');

            expRulesOnDisk[expRules[0].uuid] = clone(expRules[0]);
            expRulesOnDisk[expRules[1].uuid] = clone(expRules[1]);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

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
