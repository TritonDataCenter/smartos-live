/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fw.list() unit tests
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



exports['fields'] = function (t) {
    var vm = helpers.generateVM();

    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8080',
                    vm.uuid),
                uuid: mod_uuid.v4(),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                created_by: 'other',
                rule: util.format(
                    'FROM (vm %s OR tag foo) TO any BLOCK tcp PORT 8081',
                    vm.uuid),
                enabled: false
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8082',
                    vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var rules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            rules = res.rules.sort(helpers.uuidSort);
            return cb(err);
        });

    }, function (cb) {
        var opts = { fields: [ 'rule', 'enabled' ] };
        fw.list(opts, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            t.equal(Object.keys(res[0]).length, opts.fields.length,
                'correct number of fields');
            t.deepEqual(res, rules.map(function (r) {
                    var newR = {};
                    opts.fields.forEach(function (f) {
                        newR[f] = r[f];
                    });
                    return newR;
                }), 'rule fields');

            return cb();
        });

    }, function (cb) {
        var opts = { fields: [ 'uuid', 'version' ] };
        fw.list(opts, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            t.equal(Object.keys(res[0]).length, opts.fields.length,
                'correct number of fields');
            t.deepEqual(res, rules.map(function (r) {
                    var newR = {};
                    opts.fields.forEach(function (f) {
                        newR[f] = r[f];
                    });
                    return newR;
                }), 'rule fields');

            return cb();
        });
    }

    ], function () {
            t.done();
    });
};


exports['invalid fields'] = function (t) {
    var opts = {
        fields: ['uuid', 'bbb', 'asdf']
    };

    fw.list(opts, function (err, res) {
        t.ok(err);
        if (err) {
            t.equal(err.message, 'Invalid display fields: asdf, bbb');
        }

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
