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
 * Copyright 2019 Joyent, Inc.
 *
 * fwadm tests
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
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



exports['add: no rules or VMs'] = function (t) {
    fw.add({}, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            t.done();
            return;
        }

        t.equal(err.message, 'opts.vms ([object]) required', 'VMs required');
        t.done();
    });
};


exports['add: localVM not in list'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        localVMs: [ vm ],
        vms: [ ]
    };

    fw.add(payload, function (err, res) {
        t.ok(err, 'error returned');
        t.equal(err.message, util.format('Could not find VM "%s" in VM list',
            vm.uuid), 'error message');
        t.done();
    });
};


exports['add / update: vm to IP: BLOCK'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 10.99.99.254 BLOCK tcp '
                                + 'PORT 8080', vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRule.uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;

            expRule.log = false;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm.uuid);
            var v6rules = helpers.defaultZoneRules(vm.uuid);

            v4rules[vm.uuid].out.tcp = [
                helpers.blockPortOutTCP('10.99.99.254', 8080)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                    'ipf enabled in VMs');

            cb();
        });
    },
    function (cb) {
        helpers.fwGetEquals(t, expRule, cb);
    },
    function (cb) {
        helpers.fwListEquals(t, [expRule], cb);
    },
    function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format(
                        'FROM vm %s TO (ip 10.88.88.2 OR ip 10.99.99.254) '
                        + 'BLOCK tcp PORT 8080', vm.uuid),
                    uuid: expRule.uuid
                }
            ],
            vms: [vm]
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            t.equal(res.rules[0].uuid, expRule.uuid, 'uuid is the same');
            t.ok(res.rules[0].version, 'rule has a version');
            t.notEqual(res.rules[0].version, expRule.version,
                'rule version changed');

            expRule.version = res.rules[0].version;
            expRule.rule = updatePayload.rules[0].rule;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm.uuid);
            var v6rules = helpers.defaultZoneRules(vm.uuid);

            v4rules[vm.uuid].out.tcp = [
                helpers.blockPortOutTCP('10.88.88.2', 8080),
                helpers.blockPortOutTCP('10.99.99.254', 8080)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            cb();
        });
    },
    function (cb) {
        helpers.fwGetEquals(t, expRule, cb);
    },
    function (cb) {
        helpers.fwListEquals(t, [expRule], cb);
    },
    function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRule ],
            vm: vm,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRule.uuid ],
            vms: [vm]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
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

            var vmsEnabled = {};
            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });
    },
    function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ ],
            vm: vm,
            vms: [vm]
        }, cb);
    }

    ],
    function () {
        t.done();
    });
};


exports['add / update: vm to IP: ALLOW'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 10.99.99.254 ALLOW tcp '
                                + 'PORT 8080', vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            helpers.fillInRuleBlanks(res.rules, expRule);

            t.deepEqual(res, {
                rules: [ expRule ],
                vms: [ vm.uuid ]
            }, 'rules returned');

            // Outbound allow rules from a VM are a no-op (since the default
            // outbound policy is allow), so no explicit rule will appear in
            // the zone's ipf(6).conf:
            var defaultRules = helpers.defaultZoneRules(vm.uuid);
            t.deepEqual(helpers.zoneIPFconfigs(4), defaultRules,
                'ipf.conf rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), defaultRules,
                'ipf6.conf rules correct');

            var vmsEnabled = {};
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
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule,
            vms: [vm]
        }, cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [expRule],
            vm: vm,
            vms: [vm]
        }, cb);
    }

    ], function () {
        t.done();
    });
};


exports['add: tag to IP'] = function (t) {
    var vm1 = helpers.generateVM({ tags: { foo: true } });
    var vm2 = helpers.generateVM({ tags: { foo: true } });
    var payload = {
        rules: [
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM tag "foo" TO ip 10.99.99.254 BLOCK tcp PORT 25',
                enabled: true
            }
        ],
        vms: [vm1, vm2]
    };

    var expRule = clone(payload.rules[0]);

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRule.uuid = res.rules[0].uuid;
            delete res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            delete res.rules[0].version;

            expRule.log = false;
            payload.rules[0].log = false;

            t.deepEqual(res, {
                vms: [ vm1.uuid, vm2.uuid ],
                rules: [ payload.rules[0] ]
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm1.uuid);
            var v6rules = helpers.defaultZoneRules(vm1.uuid);

            v4rules[vm1.uuid].out.tcp = [
                helpers.blockPortOutTCP('10.99.99.254', 25)
            ];

            v4rules[vm2.uuid] = v4rules[vm1.uuid];
            v6rules[vm2.uuid] = v6rules[vm1.uuid];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });
    }, function (cb) {
        fw.get({ uuid: expRule.uuid }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, expRule, 'get returns same rule');
            cb();
        });
    }, function (cb) {
        helpers.fwListEquals(t, [expRule], cb);
    }, function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: expRule,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [expRule],
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [expRule],
            vm: vm2,
            vms: [vm1, vm2]
        }, cb);
    }
    ], function () {
        t.done();
    });
};


exports['add: tag to subnet'] = function (t) {
    var vm1 = helpers.generateVM({ tags: { foo: true } });
    var vm2 = helpers.generateVM({ tags: { foo: true } });
    var payload = {
        rules: [
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM tag "foo" TO subnet 10.99.99.0/24 BLOCK '
                    + 'tcp PORT 25',
                enabled: true
            },
            {
                owner_uuid: vm2.owner_uuid,
                rule: 'FROM subnet 10.99.99.0/24 TO tag "foo" ALLOW '
                    + 'tcp PORT 80',
                enabled: true
            }
        ],
        vms: [vm1, vm2]
    };

    var rule1 = clone(payload.rules[0]);
    var rule2 = clone(payload.rules[1]);

    async.series([
    function (cb) {
        fw.validatePayload(payload, function (err, res) {
            t.ifError(err);
            cb();
        });
    }, function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb(err);
                return;
            }

            helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid ].sort(),
                rules: [ rule1, rule2 ].sort(helpers.uuidSort)
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm1.uuid);
            var v6rules = helpers.defaultZoneRules(vm1.uuid);

            v4rules[vm1.uuid].out.tcp = [
                helpers.blockPortOutTCP('10.99.99.0/24', 25)
            ];
            v4rules[vm1.uuid].in.tcp = [
                helpers.allowPortInTCP('10.99.99.0/24', 80, 'keep state')
            ];

            v4rules[vm2.uuid] = v4rules[vm1.uuid];
            v6rules[vm2.uuid] = v6rules[vm1.uuid];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            var expRulesOnDisk = {};
            expRulesOnDisk[rule1.uuid] = clone(rule1);
            expRulesOnDisk[rule2.uuid] = clone(rule2);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            cb();
        });
    }, function (cb) {
        fw.get({ uuid: rule1.uuid }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, rule1, 'get returns same rule');
            cb();
        });
    }, function (cb) {
        helpers.fwListEquals(t, [rule1, rule2].sort(helpers.uuidSort), cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [rule1, rule2],
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [rule1, rule2],
            vm: vm2,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule1,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule2,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.testEnableDisable({
            t: t,
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);
    }
    ], function () {
        t.done();
    });
};


exports['add: vm to subnet'] = function (t) {
    var vm1 = helpers.generateVM({ tags: { foo: true } });
    // Not the target of the rule:
    var vm2 = helpers.generateVM({ tags: { foo: true } });
    var payload = {
        rules: [
            {
                owner_uuid: vm1.owner_uuid,
                rule: util.format(
                    'FROM vm %s TO subnet 10.99.99.0/24 BLOCK tcp PORT 25',
                    vm1.uuid),
                enabled: true
            },
            {
                owner_uuid: vm2.owner_uuid,
                rule: util.format(
                    'FROM subnet 10.99.99.0/24 TO vm %s ALLOW tcp PORT 80',
                    vm1.uuid),
                enabled: true
            }
        ],
        vms: [vm1, vm2]
    };

    var rule1 = clone(payload.rules[0]);
    var rule2 = clone(payload.rules[1]);

    async.series([
    function (cb) {
        fw.validatePayload(payload, function (err, res) {
            t.ifError(err);
            cb();
        });
    }, function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb(err);
                return;
            }

            helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid ],
                rules: [ rule1, rule2 ].sort(helpers.uuidSort)
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm1.uuid);
            var v6rules = helpers.defaultZoneRules(vm1.uuid);
            v4rules[vm1.uuid].out.tcp =
                [ helpers.blockPortOutTCP('10.99.99.0/24', 25) ];
            v4rules[vm1.uuid].in.tcp =
                [ helpers.allowPortInTCP('10.99.99.0/24', 80, 'keep state') ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            var expRulesOnDisk = {};
            expRulesOnDisk[rule1.uuid] = clone(rule1);
            expRulesOnDisk[rule2.uuid] = clone(rule2);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            cb();
        });
    }, function (cb) {
        fw.get({ uuid: rule1.uuid }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, rule1, 'get returns same rule');
            cb();
        });
    }, function (cb) {
        helpers.fwListEquals(t, [rule1, rule2].sort(helpers.uuidSort), cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [rule1, rule2],
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ ],
            vm: vm2,
            vms: [vm1, vm2]
        }, cb);
    }, function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule1,
            vms: [vm1]
        }, cb);
    }, function (cb) {
        // Ensure we can use the rule UUID to check
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule1.uuid,
            vms: [vm1]
        }, cb);
    }, function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule2,
            vms: [vm1]
        }, cb);
    }, function (cb) {
        // Ensure we can use the rule UUID to check
        helpers.vmsAffected({
            t: t,
            allVMs: [vm1, vm2],
            rule: rule2.uuid,
            vms: [vm1]
        }, cb);
    }
    ], function () {
        t.done();
    });
};


exports['sorting: multiple ip and subnet rules'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM subnet 10.99.99.0/24 TO vm %s ALLOW tcp PORT 25',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM subnet 10.88.88.0/24 TO vm %s ALLOW tcp PORT 25',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM subnet 10.66.66.0/24 TO vm %s ALLOW tcp PORT 25',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 10.77.77.77 TO vm %s ALLOW tcp PORT 25',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 10.77.77.99 TO vm %s ALLOW tcp PORT 25',
                    vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var rule1 = clone(payload.rules[0]);
    var rule2 = clone(payload.rules[1]);
    var rule3 = clone(payload.rules[2]);
    var rule4 = clone(payload.rules[3]);
    var rule5 = clone(payload.rules[4]);

    var rules = [ rule1, rule2, rule3, rule4, rule5 ];

    async.series([
    function (cb) {
        fw.validatePayload(payload, function (err, res) {
            t.ifError(err);
            cb();
        });
    },
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb(err);
                return;
            }

            helpers.fillInRuleBlanks(res.rules, rules);
            rules.sort(helpers.uuidSort);

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid ],
                rules: rules
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm.uuid);
            var v6rules = helpers.defaultZoneRules(vm.uuid);
            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('10.66.66.0/24', 25),
                helpers.allowPortInTCP('10.77.77.77', 25),
                helpers.allowPortInTCP('10.77.77.99', 25),
                helpers.allowPortInTCP('10.88.88.0/24', 25),
                helpers.allowPortInTCP('10.99.99.0/24', 25)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            var expRulesOnDisk = {};
            expRulesOnDisk[rule1.uuid] = clone(rule1);
            expRulesOnDisk[rule2.uuid] = clone(rule2);
            expRulesOnDisk[rule3.uuid] = clone(rule3);
            expRulesOnDisk[rule4.uuid] = clone(rule4);
            expRulesOnDisk[rule5.uuid] = clone(rule5);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            cb();
        });
    },
    function (cb) {
        helpers.fwListEquals(t, rules.sort(helpers.uuidSort), cb);
    },
    function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: rules,
            vm: vm,
            vms: [vm]
        }, cb);
    }
    ], function () {
        t.done();
    });
};


exports['sorting: multiple icmp types'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM any TO vm %s ALLOW icmp TYPE 1',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 1.2.3.4 TO vm %s ALLOW icmp TYPE all',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM ip 1.2.3.5 TO vm %s ALLOW icmp TYPE all',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM any TO vm %s ALLOW icmp TYPE 5 CODE 1',
                    vm.uuid),
                enabled: true
            },
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format(
                    'FROM any TO vm %s ALLOW icmp TYPE 5 CODE 3',
                    vm.uuid),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var rule1 = clone(payload.rules[0]);
    var rule2 = clone(payload.rules[1]);
    var rule3 = clone(payload.rules[2]);
    var rule4 = clone(payload.rules[3]);
    var rule5 = clone(payload.rules[4]);

    var rules = [ rule1, rule2, rule3, rule4, rule5 ];

    async.series([
    function (cb) {
        fw.validatePayload(payload, function (err, res) {
            t.ifError(err);
            cb();
        });
    },
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb(err);
                return;
            }

            helpers.fillInRuleBlanks(res.rules, rules);
            rules.sort(helpers.uuidSort);

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid ],
                rules: rules
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm.uuid);
            var v6rules = helpers.defaultZoneRules(vm.uuid);
            v4rules[vm.uuid].in.icmp = [
                helpers.allowInICMP('1.2.3.4'),
                helpers.allowInICMP('1.2.3.5'),
                helpers.allowInICMP('any', 1),
                helpers.allowInICMP('any', 5, 1),
                helpers.allowInICMP('any', 5, 3)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            var vmsEnabled = {};
            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            var expRulesOnDisk = {};
            expRulesOnDisk[rule1.uuid] = clone(rule1);
            expRulesOnDisk[rule2.uuid] = clone(rule2);
            expRulesOnDisk[rule3.uuid] = clone(rule3);
            expRulesOnDisk[rule4.uuid] = clone(rule4);
            expRulesOnDisk[rule5.uuid] = clone(rule5);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            cb();
        });
    },
    function (cb) {
        helpers.fwListEquals(t, rules.sort(helpers.uuidSort), cb);
    },
    function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: rules,
            vm: vm,
            vms: [vm]
        }, cb);
    }
    ], function () {
        t.done();
    });
};


exports['enable / disable rule'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 192.168.5.2 BLOCK tcp '
                                + 'PORT 25', vm.uuid),
                enabled: false,
                log: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);
    var expRule2;
    var vmsEnabled = {};
    var v4rules, v6rules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            helpers.fillInRuleBlanks(res.rules, expRule);

            t.deepEqual(res, {
                rules: [ expRule ],
                vms: [ vm.uuid ]
            }, 'rules returned');

            v4rules = helpers.defaultZoneRules(vm.uuid);
            v6rules = helpers.defaultZoneRules(vm.uuid);
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });
    },
    function (cb) {
        helpers.fwGetEquals(t, expRule, cb);
    },
    function (cb) {
        helpers.fwListEquals(t, [expRule], cb);
    },
    function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [expRule],
            vm: vm,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        // Even though the rule is disabled, it should still show up as
        // affected
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        // Update the rule - it should still not affect the VM
        var updatePayload = {
            rules: [
                {
                    uuid: expRule.uuid,
                    rule: util.format('FROM vm %s TO ip 192.168.5.2 BLOCK tcp '
                                    + 'PORT 26', vm.uuid)
                }
            ],
            vms: [vm]
        };
        expRule.rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            expRule.version = res.rules[0].version;
            t.deepEqual(res, {
                rules: [ expRule ],
                vms: [ vm.uuid ]
            }, 'rules returned');

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files still the same');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files still the same');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });
    },
    function (cb) {
        // Add an enabled rule - disabled rule should still not affect the vm
        var addPayload = {
            rules: [
                {
                    owner_uuid: vm.owner_uuid,
                    rule: 'FROM any TO all vms ALLOW tcp PORT 33',
                    enabled: true,
                    log: true
                }
            ],
            vms: [vm]
        };
        expRule2 = clone(addPayload.rules[0]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                cb();
                return;
            }

            helpers.fillInRuleBlanks(res.rules, expRule2);
            t.deepEqual(res, {
                rules: [ expRule2 ],
                vms: [ vm.uuid ]
            }, 'rules returned');

            v4rules[vm.uuid].in.tcp =
                [ helpers.allowPortInTCP('any', 33) ];
            v6rules[vm.uuid].in.tcp =
                [ helpers.allowPortInTCP('any', 33) ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'zone ipf.conf files still the same');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'zone ipf6.conf files still the same');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled');

            cb();
        });
    },
    function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule,
            vms: [vm]
        }, cb);
    },
    function (cb) {
        helpers.vmsAffected({
            t: t,
            allVMs: [vm],
            rule: expRule2,
            vms: [vm]
        }, cb);
    }

    ], function () {
        t.done();
    });
};



exports['del: no uuids or rvmUUIDs'] = function (t) {
    fw.del({ vms: [ helpers.generateVM() ] }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            t.done();
            return;
        }

        t.equal(err.message, 'Payload must contain one of: rvmUUIDs, uuids',
            'Error message');
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
