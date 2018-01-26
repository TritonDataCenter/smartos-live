/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2018, Joyent, Inc. All rights reserved.
 *
 * fwadm tests: AH and ESP protocols for IPsec
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_obj = require('../../lib/util/obj');
var mod_uuid = require('uuid');
var util = require('util');
var util_vm = require('../../lib/util/vm');


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

exports['IPsec rules and keepstate'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 1.2.3.4 TO vm %s ALLOW ah', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 1.2.3.4 TO vm %s ALLOW esp', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK ah', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK esp', vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRules = clone(payload.rules);
    var vmsEnabled = {};
    var v4rules = helpers.defaultZoneRules(vm.uuid);
    var v6rules = helpers.defaultZoneRules(vm.uuid);

    async.series([
    function addAndCheckRules(cb) {
        fw.add(payload, function checkRules(err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            helpers.fillInRuleBlanks(res.rules, expRules);

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            v4rules[vm.uuid].in.ah = [
                helpers.allowInAH('1.2.3.4', 'keep state')
            ];

            v4rules[vm.uuid].in.esp = [
                helpers.allowInESP('1.2.3.4', 'keep state')
            ];

            v4rules[vm.uuid].out.ah = [
                helpers.blockOutAH('any')
            ];

            v4rules[vm.uuid].out.esp = [
                helpers.blockOutESP('any')
            ];

            v6rules[vm.uuid].out = clone(v4rules[vm.uuid].out);

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[2], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[3], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

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
