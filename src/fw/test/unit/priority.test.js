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
 * fwadm tests: Sorting based on PRIORITY keyword
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


exports['Overriding inbound rules'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.254 TO vm %s BLOCK '
                    + 'tcp PORT 22 PRIORITY 2', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM subnet 10.99.99.0/24 TO vm %s BLOCK '
                    + 'tcp PORT all PRIORITY 1', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.254 TO vm %s ALLOW '
                    + 'tcp PORTS 15 - 30 PRIORITY 1', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM any TO vm %s ALLOW tcp PORT all',
                    vm.uuid),
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
    function (cb) {
        fw.add(payload, function (err, res) {
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

            v4rules[vm.uuid].in.tcp = [
                helpers.blockPortInTCP('10.99.99.254', 22),
                helpers.allowRangeInTCP('10.99.99.254', 15, 30),
                helpers.blockPortInTCP('10.99.99.0/24'),
                helpers.allowPortInTCP('any')
            ];

            v6rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any')
            ];

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
        helpers.fwListEquals(t, expRules, cb);

    }

    ], function () {
        t.done();
    });
};

exports['Overriding outbound rules'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 10.99.99.254 ALLOW '
                    + 'udp PORT 22 PRIORITY 15', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO subnet 10.99.99.0/24 ALLOW '
                    + 'udp PORT all PRIORITY 2', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 10.99.99.254 BLOCK '
                    + 'udp PORTS 15 - 30 PRIORITY 2', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK udp PORT all',
                    vm.uuid),
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
    function (cb) {
        fw.add(payload, function (err, res) {
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

            v4rules[vm.uuid].out.udp = [
                helpers.allowPortOutUDP('10.99.99.254', 22, 'keep state'),
                helpers.blockRangeOutUDP('10.99.99.254', 15, 30),
                helpers.allowPortOutUDP('10.99.99.0/24', '', 'keep state'),
                helpers.blockPortOutUDP('any')
            ];

            v6rules[vm.uuid].out.udp = [
                helpers.blockPortOutUDP('any')
            ];

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
        helpers.fwListEquals(t, expRules, cb);

    }

    ], function () {
        t.done();
    });
};

exports['Priority levels sorted correctly'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        /*
         * The goal here is to assert that we sort the priority levels
         * correctly: higher priorities come earlier than lower priorities,
         * and priority levels are sorted numerically and not lexicographically.
         * That is, 100 > 23 > 2 > 1, and not 23 > 2 > 100 > 1.
         */
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.1 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 1', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.2 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 100', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.3 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 10', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.4 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 15', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.5 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 2', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.6 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 23', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.7 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 25', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.8 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 55', vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.9 TO vm %s ALLOW '
                    + 'tcp PORT all PRIORITY 50', vm.uuid),
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
    function (cb) {
        fw.add(payload, function (err, res) {
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

            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('10.99.99.2'),
                helpers.allowPortInTCP('10.99.99.8'),
                helpers.allowPortInTCP('10.99.99.9'),
                helpers.allowPortInTCP('10.99.99.7'),
                helpers.allowPortInTCP('10.99.99.6'),
                helpers.allowPortInTCP('10.99.99.4'),
                helpers.allowPortInTCP('10.99.99.3'),
                helpers.allowPortInTCP('10.99.99.5'),
                helpers.allowPortInTCP('10.99.99.1')
            ];

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
