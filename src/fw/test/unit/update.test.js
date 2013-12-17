/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm update unit tests
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



exports['update non-existent rule'] = function (t) {
    var vm = helpers.generateVM();

    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8080',
                    vm.uuid),
                uuid: mod_uuid.v4(),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRules = [clone(payload.rules[0])];
    var vmsEnabled = {};
    var zoneRules;

    async.series([
    function (cb) {
        fw.update(payload, function (err) {
            t.ok(err, 'Error returned');
            return cb();
        });

    }, function (cb) {
        payload.allowAdds = true;
        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[0].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[0].version = res.rules[0].version;

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            zoneRules = helpers.defaultZoneRules(vm.uuid);
            createSubObjects(zoneRules, vm.uuid, 'out', 'block', 'tcp',
                {
                    any: [ 8080 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);
    }

    ], function () {
            t.done();
    });
};


exports['localVM not in list'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        localVMs: [ vm ],
        vms: [ ]
    };

    fw.update(payload, function (err, res) {
        t.ok(err, 'error returned');
        t.equal(err.message, util.format('Could not find VM "%s" in VM list',
            vm.uuid), 'error message');
        t.done();
    });
};


exports['description and created_by'] = function (t) {
    var payload = {
        rules: [
            {
                global: true,
                rule: 'FROM any TO all vms ALLOW tcp PORT 60',
                uuid: mod_uuid.v4(),
                enabled: false,
                created_by: 'fwadm',
                description: 'one',
                version: '1383163604683.062275'
            }
        ],
        vms: [ helpers.generateVM() ]
    };

    var expRules = [clone(payload.rules[0])];
    var expRulesOnDisk = {};

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

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

    }, function (cb) {

        payload.rules[0].created_by = 'other';
        payload.rules[0].description = 'two';

        expRules = [clone(payload.rules[0])];
        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

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
