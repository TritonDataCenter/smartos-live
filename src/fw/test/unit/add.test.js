/*
 * Copyright 2019 Joyent, Inc.
 *
 * fwadm add unit tests
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_uuid = require('uuid');
var util = require('util');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;



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
                uuid: mod_uuid.v4(),
                owner_uuid: vm.owner_uuid,
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
    expRules[0].log = false;
    expRules[1].log = false;

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
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            // We're adding rules that we've already added, so nothing
            // should be updated, and everything on disk should remain
            // the same.
            t.deepEqual(helpers.sortRes(res), { vms: [], rules: [] },
                'rules returned');

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        var changing = payload.rules[0];
        changing.version = '2383205215597.167882';
        expRules = clone(payload.rules);
        expRules[0].created_by = payload.createdBy;
        expRules[0].log = false;
        expRulesOnDisk[changing.uuid].version = changing.version;

        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            // We changed the version, so the rule on disk and the VM's
            // firewall should get updated.
            t.deepEqual(helpers.sortRes(res), {
                rules: [ expRules[0] ],
                vms: [ vm.uuid ]
            }, 'rules returned');

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        payload.allowAdds = true;
        payload.rules[0].uuid = mod_uuid.v4();
        payload.rules[1].uuid = mod_uuid.v4();
        expRules = clone(payload.rules);
        expRules[0].created_by = payload.createdBy;
        expRules[0].log = false;
        expRules[1].log = false;

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
