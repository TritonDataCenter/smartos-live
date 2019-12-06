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
 * fwadm tests: all and any targets
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



exports['any <-> vm: add / update'] = function (t) {
    var vm = helpers.generateVM();
    var vm2 = helpers.generateVM({ tags: { one: true } });

    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8080',
                    vm.uuid),
                enabled: true
            }
        ],
        vms: [vm, vm2]
    };

    var expRules = [clone(payload.rules[0])];
    var vmsEnabled = {};
    var v4rules, v6rules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[0].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[0].version = res.rules[0].version;
            expRules[0].log = false;

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            v4rules = helpers.defaultZoneRules(vm.uuid);
            v6rules = helpers.defaultZoneRules(vm.uuid);

            v4rules[vm.uuid].out.tcp = [
                helpers.blockPortOutTCP('any', 8080)
            ];
            v6rules[vm.uuid].out.tcp = [
                helpers.blockPortOutTCP('any', 8080)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm.owner_uuid,
                    rule: util.format('FROM any TO vm %s ALLOW tcp PORT 8081',
                        vm.uuid),
                    enabled: true
                }
            ],
            vms: [vm, vm2]
        };
        expRules.push(addPayload.rules[0]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[1].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[1].version = res.rules[0].version;
            expRules[1].log = false;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRules[1] ]
            }, 'rules returned');

            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081, 'keep state')
            ];
            v6rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081, 'keep state')
            ];
            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {

        var updatePayload = {
            rules: [
                {
                    uuid: expRules[1].uuid,
                    rule: util.format(
                        'FROM any TO (tag "one" OR vm %s) ALLOW tcp PORT 8081',
                        vm.uuid)
                }
            ],
            vms: [vm, vm2]
        };
        expRules[1].rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[1].version = res.rules[0].version;

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid, vm2.uuid ].sort(),
                rules: [ expRules[1] ]
            }, 'rules returned');

            v4rules[vm2.uuid] = helpers.defaultZoneRules();
            v6rules[vm2.uuid] = helpers.defaultZoneRules();
            v4rules[vm2.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081)
            ];
            v6rules[vm2.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[1] ],
            vm: vm2,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm,
            vms: [vm, vm2]
        }, cb);
    }, function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRules[0].uuid ],
            vms: [vm, vm2]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid ],
                rules: [ expRules[0] ]
            }, 'results returned');

            delete v4rules[vm.uuid].out.tcp;
            delete v6rules[vm.uuid].out.tcp;

            v4rules[vm.uuid].in.tcp = [ helpers.allowPortInTCP('any', 8081) ];
            v6rules[vm.uuid].in.tcp = [ helpers.allowPortInTCP('any', 8081) ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[1] ],
            vm: vm,
            vms: [vm, vm2]
        }, cb);
    }

    ], function () {
        t.done();
    });
};


exports['any <-> all vms: add / update'] = function (t) {
    var vm1 = helpers.generateVM({ nics: [ { ip: '192.168.4.1' } ] });
    var vm2 = helpers.generateVM({ nics: [ { ip: '192.168.4.2' } ] });

    var rvm1 = helpers.generateVM({ nics: [ { ip: '192.168.0.1' } ] });
    // To be added later:
    var rvm2 = helpers.generateVM({ nics: [ { ip: '192.168.0.2' } ] });

    if (printVMs) {
        console.log('vm1=%s\nvm2=%s\nrvm1=%s,\nrvm2=%s', vm1.uuid, vm2.uuid,
            rvm1.uuid, rvm2.uuid);
    }

    var payload = {
        remoteVMs: [ rvm1 ],
        rules: [
            {
                owner_uuid: vm1.owner_uuid,
                rule: util.format('FROM all vms TO vm %s BLOCK tcp PORT 8080',
                                vm1.uuid),
                enabled: true
            },
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM any TO all vms ALLOW tcp PORT 8081',
                enabled: true
            },
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM all vms TO all vms BLOCK tcp PORT 8082',
                enabled: true
            },
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM all vms TO all vms ALLOW tcp PORT 8083',
                enabled: true
            }
        ],
        vms: [vm1, vm2]
    };

    var expRules = clone(payload.rules);
    var vmsEnabled = {};
    var v4rules, v6rules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, expRules);
            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: [ rvm1.uuid ],
                rules: clone(expRules).sort(helpers.uuidSort),
                vms: [ vm1.uuid, vm2.uuid ].sort()
            }, 'rules returned');

            v4rules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);
            v6rules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);

            [ vm1.uuid, vm2.uuid ].forEach(function (uuid) {
                v4rules[uuid].out.tcp = [
                    helpers.blockPortOutTCP('192.168.4.1', 8080),
                    helpers.blockPortOutTCP('192.168.0.1', 8082),
                    helpers.blockPortOutTCP('192.168.4.1', 8082),
                    helpers.blockPortOutTCP('192.168.4.2', 8082)
                ];
                v4rules[uuid].in.tcp = [
                    helpers.allowPortInTCP('any', 8081, 'keep state'),
                    helpers.allowPortInTCP('192.168.0.1', 8083, 'keep state'),
                    helpers.allowPortInTCP('192.168.4.1', 8083, 'keep state'),
                    helpers.allowPortInTCP('192.168.4.2', 8083, 'keep state')
                ];
                v6rules[uuid].in.tcp = [
                    helpers.allowPortInTCP('any', 8081, 'keep state')
                ];
            });

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct (test)');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
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

    }, function (cb) {
        var addPayload = {
            remoteVMs: [ rvm2 ],
            vms: [vm1, vm2]
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                remoteVMs: [ rvm2.uuid ],
                vms: [ vm1.uuid, vm2.uuid ].sort(helpers.uuidSort),
                rules: [ ]
            }, 'rules returned');

            [ vm1.uuid, vm2.uuid ].forEach(function (uuid) {
                v4rules[uuid].out.tcp = [
                    helpers.blockPortOutTCP('192.168.4.1', 8080),
                    helpers.blockPortOutTCP('192.168.0.1', 8082),
                    helpers.blockPortOutTCP('192.168.0.2', 8082),
                    helpers.blockPortOutTCP('192.168.4.1', 8082),
                    helpers.blockPortOutTCP('192.168.4.2', 8082)
                ];
                v4rules[uuid].in.tcp = [
                    helpers.allowPortInTCP('any', 8081, 'keep state'),
                    helpers.allowPortInTCP('192.168.0.1', 8083, 'keep state'),
                    helpers.allowPortInTCP('192.168.0.2', 8083, 'keep state'),
                    helpers.allowPortInTCP('192.168.4.1', 8083, 'keep state'),
                    helpers.allowPortInTCP('192.168.4.2', 8083, 'keep state')
                ];
            });

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            cb();
        });

    }, function (cb) {
        helpers.testEnableDisable({
            t: t,
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);

    }, function (cb) {
        var updatePayload = {
            rules: [
                {
                    rule: util.format(
                        'FROM vm %s TO all vms ALLOW tcp PORT 8081', rvm2.uuid),
                    uuid: expRules[1].uuid
                }
            ],
            vms: [vm1, vm2]
        };
        expRules[1].rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[1].version = res.rules[0].version;

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid ].sort(),
                rules: [ expRules[1] ]
            }, 'rules returned');

            delete v6rules[vm1.uuid].in.tcp;
            delete v6rules[vm2.uuid].in.tcp;

            v4rules[vm1.uuid].in.tcp[0] =
                helpers.allowPortInTCP('192.168.0.2', 8081, 'keep state');
            v4rules[vm2.uuid].in.tcp[0] =
                helpers.allowPortInTCP('192.168.0.2', 8081, 'keep state');

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);

    }, function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRules[2].uuid ],
            vms: [vm1, vm2]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid ].sort(),
                rules: [ expRules[2] ]
            }, 'results returned');

            [vm1, vm2].forEach(function (vm) {
                v4rules[vm.uuid].out.tcp = [
                    helpers.blockPortOutTCP('192.168.4.1', 8080)
                ];
            });

            expRules = expRules.filter(function (r) {
                return r.uuid !== expRules[2].uuid;
            });

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm1,
            vms: [vm1, vm2]
        }, cb);
    }

    ], function () {
        t.done();
    });
};



exports['add / update: all ports'] = function (t) {
    var vm = helpers.generateVM();
    var vm2 = helpers.generateVM({ tags: { one: true } });

    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT all',
                    vm.uuid),
                enabled: true
            }
        ],
        vms: [vm, vm2]
    };

    var expRules = [clone(payload.rules[0])];
    var vmsEnabled = {};
    var v4rules, v6rules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[0].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[0].version = res.rules[0].version;
            expRules[0].log = false;

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            v4rules = helpers.defaultZoneRules(vm.uuid);
            v6rules = helpers.defaultZoneRules(vm.uuid);
            v4rules[vm.uuid].out.tcp = [ helpers.blockPortOutTCP('any') ];
            v6rules[vm.uuid].out.tcp = [ helpers.blockPortOutTCP('any') ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm.owner_uuid,
                    rule: util.format('FROM any TO vm %s ALLOW tcp PORT all',
                        vm.uuid),
                    enabled: true
                }
            ],
            vms: [vm, vm2]
        };
        expRules.push(addPayload.rules[0]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[1].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[1].version = res.rules[0].version;
            expRules[1].log = false;

            t.deepEqual(res, {
                vms: [ vm.uuid ],
                rules: [ expRules[1] ]
            }, 'rules returned');

            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', null, 'keep state')
            ];
            v6rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', null, 'keep state')
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {

        var updatePayload = {
            rules: [
                {
                    uuid: expRules[1].uuid,
                    rule: util.format(
                        'FROM any TO (tag "one" OR vm %s) ALLOW tcp PORT 8081',
                        vm.uuid)
                }
            ],
            vms: [vm, vm2]
        };
        expRules[1].rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[1].version = res.rules[0].version;
            expRules[1].log = false;

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid, vm2.uuid ].sort(),
                rules: [ expRules[1] ]
            }, 'rules returned');

            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081, 'keep state')
            ];
            v6rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081, 'keep state')
            ];

            v4rules[vm2.uuid] = helpers.defaultZoneRules();
            v6rules[vm2.uuid] = helpers.defaultZoneRules();
            v4rules[vm2.uuid].in.tcp = [ helpers.allowPortInTCP('any', 8081) ];
            v6rules[vm2.uuid].in.tcp = [ helpers.allowPortInTCP('any', 8081) ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[1] ],
            vm: vm2,
            vms: [vm, vm2]
        }, cb);

    }, function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm,
            vms: [vm, vm2]
        }, cb);
    }, function (cb) {
        // Delete the rule - the firewall should remain running, but only the
        // default rules should remain

        var delPayload = {
            uuids: [ expRules[0].uuid ],
            vms: [vm, vm2]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm.uuid ],
                rules: [ expRules[0] ]
            }, 'results returned');

            delete v4rules[vm.uuid].out.tcp;
            delete v6rules[vm.uuid].out.tcp;

            v4rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081)
            ];
            v6rules[vm.uuid].in.tcp = [
                helpers.allowPortInTCP('any', 8081)
            ];

            t.deepEqual(helpers.zoneIPFconfigs(4), v4rules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), v6rules,
                'IPv6 firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VM');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[1] ],
            vm: vm,
            vms: [vm, vm2]
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
