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
 * Copyright (c) 2016, Joyent, Inc. All rights reserved.
 *
 * fwadm tests : ICMP
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



exports['add / update ICMPv4'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM ip 10.99.99.254 TO vm %s ALLOW icmp '
                                + 'TYPE 8', vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);
    var vmsEnabled = {};
    var v4rules = helpers.defaultZoneRules(vm.uuid);
    var v6rules = helpers.defaultZoneRules(vm.uuid);

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRule.uuid = res.rules[0].uuid;
            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            createSubObjects(v4rules, vm.uuid, 'in', 'pass', 'icmp',
                {
                    '10.99.99.254': [ '8' ]
                });

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
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);

    }, function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format('FROM ip 10.99.99.254 TO vm %s ALLOW '
                                    + 'icmp TYPE 8 CODE 0', vm.uuid),
                    uuid: expRule.uuid
                }
            ],
            vms: [vm]
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            expRule.rule = res.rules[0].rule;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            v4rules[vm.uuid].in.pass.icmp['10.99.99.254'] = [ '8:0' ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);

    }, function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format('FROM ip 10.99.99.254 TO vm %s ALLOW '
                                    + 'icmp TYPE ALL', vm.uuid),
                    uuid: expRule.uuid
                }
            ],
            vms: [vm]
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            expRule.rule = res.rules[0].rule;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            v4rules[vm.uuid].in.pass.icmp['10.99.99.254'] = [ 'all' ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);


    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRule ],
            vm: vm,
            vms: [vm]
        }, cb);

    }, function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm,
            vms: [vm]
        }, cb);
    }, function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRule.uuid ],
            vms: [vm]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'results returned');

            var defaultRules = helpers.defaultZoneRules(vm.uuid);

            t.deepEqual(helpers.zoneIPFconfigs(4), defaultRules,
                'only default IPv4 firewall rules left in zone');
            t.deepEqual(helpers.zoneIPFconfigs(6), defaultRules,
                'only default IPv6 firewall rules left in zone');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ ],
            vm: vm,
            vms: [vm]
        }, cb);
    }

    ], function () {
            t.done();
    });
};

exports['add / update ICMPv6'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip fe80::92b8:d0ff:fe4b:c73b TO vm %s ALLOW icmp6 '
                    + 'TYPE 128', vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);
    var vmsEnabled = {};
    var v4rules = helpers.defaultZoneRules(vm.uuid);
    var v6rules = helpers.defaultZoneRules(vm.uuid);

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRule.uuid = res.rules[0].uuid;
            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            createSubObjects(v6rules, vm.uuid, 'in', 'pass', 'icmp6',
                {
                    'fe80::92b8:d0ff:fe4b:c73b': [ '128' ]
                });

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
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);

    }, function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format(
                        'FROM ip fe80::92b8:d0ff:fe4b:c73b TO vm %s ALLOW '
                        + 'icmp6 TYPE 128 CODE 0', vm.uuid),
                    uuid: expRule.uuid
                }
            ],
            vms: [vm]
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            expRule.rule = res.rules[0].rule;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            v6rules[vm.uuid].in.pass.icmp6['fe80::92b8:d0ff:fe4b:c73b'] =
                [ '128:0' ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);

    }, function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format(
                        'FROM ip fe80::92b8:d0ff:fe4b:c73b TO vm %s ALLOW '
                        + 'icmp6 TYPE ALL', vm.uuid),
                    uuid: expRule.uuid
                }
            ],
            vms: [vm]
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            expRule.rule = res.rules[0].rule;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            v6rules[vm.uuid].in.pass.icmp6['fe80::92b8:d0ff:fe4b:c73b'] =
                [ 'all' ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRule, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRule ],
            vm: vm,
            vms: [vm]
        }, cb);

    }, function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm,
            vms: [vm]
        }, cb);
    }, function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRule.uuid ],
            vms: [vm]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'results returned');

            var defaultRules = helpers.defaultZoneRules(vm.uuid);

            t.deepEqual(helpers.zoneIPFconfigs(4), defaultRules,
                'only default IPv4 firewall rules left in zone');
            t.deepEqual(helpers.zoneIPFconfigs(6), defaultRules,
                'only default IPv6 firewall rules left in zone');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ ],
            vm: vm,
            vms: [vm]
        }, cb);
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
