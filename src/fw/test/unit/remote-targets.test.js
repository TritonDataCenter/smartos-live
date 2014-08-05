/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * remoteTargets tests
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



exports['no matches'] = function (t) {
    var owner = mod_uuid.v4();
    var owner2 = mod_uuid.v4();
    var vms = [
        helpers.generateVM({ tags: { foo : true, mult: 'one' } }),
        helpers.generateVM({ tags: { foo : true }, owner_uuid: owner }),
        // different owner:
        helpers.generateVM({ tags: { some : 'thing', mult: 'two' },
            owner_uuid: owner2 })
    ];

    var payload = {
        rules: [
            {
                enabled: true,
                owner_uuid: owner
            }
        ],
        vms: vms
    };

    async.forEachSeries([
        'FROM any TO all vms BLOCK tcp PORT 25',
        'FROM ip 10.0.2.1 TO all vms BLOCK tcp PORT 25',
        'FROM any TO tag foo ALLOW tcp PORT 25',
        'FROM subnet 10.2.0.0/16 TO tag foo BLOCK tcp PORT 25',
        'FROM tag foobar TO tag noexist BLOCK tcp PORT 25',
        'FROM tag foobar TO tag some BLOCK tcp PORT 25',
        'FROM tag foobar TO tag mult=two BLOCK tcp PORT 25',
        util.format('FROM tag foobar2 TO vm %s BLOCK tcp PORT 25', vms[2].uuid)
    ], function (rule, cb) {
        payload.rules[0].rule = rule;
        fw.remoteTargets(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {}, rule);
            return cb();
        });
    }, function () {
        t.done();
    });
};


exports['matches'] = function (t) {
    var owner = mod_uuid.v4();
    var owner2 = mod_uuid.v4();

    var rvm1 = mod_uuid.v4();

    var vms = [
        helpers.generateVM({
            tags: { foo : true },
            owner_uuid: owner
        }),
        helpers.generateVM({
            tags: { foo : true },
            owner_uuid: owner2
        }),
        helpers.generateVM({
            tags: { multi : 1 },
            owner_uuid: owner
        })
    ];

    async.forEachSeries([
        {
            rule: 'FROM (tag one=two OR tag one=three) TO '
                    + 'all vms BLOCK tcp PORT 25',
            res: { tags: { one: [ 'two', 'three' ] } }
        },
        {
            rule: 'FROM tag foo TO all vms BLOCK tcp PORT 25',
            res: { tags: { foo: true }, allVMs: true }
        },
        {
            rule: 'FROM tag other TO all vms BLOCK tcp PORT 25',
            res: { tags: { other: true } }
        },
        {
            rule: util.format(
                'FROM (tag one=two OR vm %s) TO all vms BLOCK tcp PORT 25',
                rvm1),
            res: { tags: { one: 'two' }, vms: [ rvm1 ] }
        },
        {
            rule: 'FROM all vms TO all vms ALLOW tcp PORT 22',
            res: { allVMs: true }
        },
        {
            rule: util.format('FROM all vms TO vm %s ALLOW tcp PORT 22',
                vms[0].uuid),
            res: { allVMs: true }
        },
        {
            rule: util.format('FROM all vms TO vm %s BLOCK tcp PORT 22',
                vms[0].uuid),
            res: { allVMs: true }
        },
        {
            rule: 'FROM (tag multi = 1 OR tag multi = 2) '
                + 'TO (tag multi = 1 OR tag multi = 2) ALLOW tcp PORT 5984',
            res: { tags: { multi: [ 1, 2 ] } }
        }

    ], function (data, cb) {
        var payload = {
            rules: [ {
                rule: data.rule,
                owner_uuid: owner,
                enabled: true
            } ],
            vms: vms
        };

        fw.remoteTargets(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            [res.tags, data.res.tags].forEach(function (obj) {
                for (var tag in obj) {
                    if (util.isArray(obj[tag])) {
                        obj[tag] = obj[tag].sort();
                    }
                }
            });

            t.deepEqual(res, data.res, data.rule);
            return cb();
        });
    }, function () {
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
