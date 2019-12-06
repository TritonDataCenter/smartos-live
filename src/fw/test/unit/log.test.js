/*
 * Copyright 2019 Joyent, Inc.
 *
 * fwadm unit tests related to cfwlogging
 *
 * fw checks for existence of the /dev/ipfev file in order to add or not
 * the 'set-tag(uuid=$UUID, cfwlog)' tag to the IPF rules. The existence of
 * such file is checked only once and, therefore, we would need to do a lot
 * of reloading of mocks and cached node modules in order to test when it's
 * present and when it is not. Instead, we do all the tests w/o such file and
 * run current file with /dev/ipfev.
 */

var async = require('async');
var clone = require('clone');
var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var util = require('util');

var fs = mocks.mocks.fs;


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



exports['add / update: vm to IP: BLOCK'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO ip 10.99.99.254 BLOCK tcp '
                                + 'PORT 8080', vm.uuid),
                enabled: true,
                log: true
            }
        ],
        vms: [vm]
    };

    var expRule = clone(payload.rules[0]);

    async.series([
    function addDevIpfEv(cb) {
        fs.writeFile('/dev/ipfev', '2', cb);
    },
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

            expRule.log = true;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRule ]
            }, 'rules returned');

            var v4rules = helpers.defaultZoneRules(vm.uuid);
            var v6rules = helpers.defaultZoneRules(vm.uuid);

            v4rules[vm.uuid].out.tcp = [
                helpers.blockPortOutTCP('10.99.99.254', 8080,
                    'keep state set-tag(uuid=' + expRule.uuid + ', cfwlog)')
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
                helpers.blockPortOutTCP('10.88.88.2', 8080,
                    'keep state set-tag(uuid=' + expRule.uuid + ', cfwlog)'),
                helpers.blockPortOutTCP('10.99.99.254', 8080,
                    'keep state set-tag(uuid=' + expRule.uuid + ', cfwlog)')
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
    },
    function removeDevIpfEv(cb) {
        fs.unlink('/dev/ipfev', function () {
            // fw uses a global variable to store existence or not of the
            // /dev/ipfev file. If we want to change the value of such var
            // we need to reload the module.
            delete require.cache[require.resolve('../../lib/fw')];
            delete require.cache[require.resolve('../lib/mocks')];
            cb();
        });
    }
    ],
    function () {
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
