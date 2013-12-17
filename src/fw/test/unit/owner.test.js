/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * test rules with owner_uuid set
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



exports['tag to IP'] = function (t) {
    var owner = mod_uuid.v4();
    var vm1 = helpers.generateVM({ tags: { foo : true } });
    var vm2 = helpers.generateVM({ tags: { foo : true }, owner_uuid: owner });
    var payload = {
        rules: [
            {
                rule: 'FROM tag foo TO ip 10.99.99.254 BLOCK tcp PORT 25',
                enabled: true,
                owner_uuid: owner
            }
        ],
        vms: [vm1, vm2]
    };

    var expRule = clone(payload.rules[0]);
    var expRule2;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRule.uuid = res.rules[0].uuid;
            delete res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRule.version = res.rules[0].version;
            delete res.rules[0].version;

            t.deepEqual(res, {
                vms: [ vm2.uuid ],
                rules: [ payload.rules[0] ]
            }, 'add 1: rules returned');

            var zoneRules = helpers.zoneIPFconfigs();
            var expRules = helpers.defaultZoneRules(vm2.uuid);
            createSubObjects(expRules, vm2.uuid, 'out', 'block', 'tcp',
                        { '10.99.99.254': [ 25 ] });

            t.deepEqual(zoneRules, expRules, 'firewall rules correct');

            var vmsEnabled = {};
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in matching VM');

            cb();
        });

    }, function (cb) {
        fw.get({ uuid: expRule.uuid }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, expRule, 'get returns same rule');
            cb();
        });

    }, function (cb) {
        fw.list({ }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, [expRule], 'list returns only the rule');
            cb();
        });

    }, function (cb) {
        // Add a rule that affects the same tag, but with no owner UUID. It
        // should affect both VMs
        var payload2 = {
            rules: [
                {
                    rule: 'FROM tag foo TO ip 10.99.99.254 BLOCK tcp PORT 250',
                    enabled: true,
                    global: true
                }
            ],
            vms: [vm1, vm2]
        };

        fw.add(payload2, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');

            expRule2 = clone(res.rules[0]);
            delete res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            delete res.rules[0].version;

            t.deepEqual(res, {
                vms: [ vm1.uuid, vm2.uuid ],
                rules: [ payload2.rules[0] ]
            }, 'add 2: rules returned');

            var zoneRules = helpers.zoneIPFconfigs();
            var expRules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);
            createSubObjects(expRules, vm2.uuid, 'out', 'block', 'tcp',
                { '10.99.99.254': [ 25, 250 ] });
            createSubObjects(expRules, vm1.uuid, 'out', 'block', 'tcp',
                { '10.99.99.254': [ 250 ] });

            t.deepEqual(zoneRules, expRules, 'firewall rules correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled for both VMs');

            var ruleFiles = {};
            ruleFiles[expRule.uuid] = expRule;
            ruleFiles[expRule2.uuid] = expRule2;

            t.deepEqual(helpers.rulesOnDisk(), ruleFiles, 'rules on disk');

            cb();
        });

    }, function (cb) {
        fw.list({ }, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, [expRule, expRule2].sort(helpers.uuidSort),
                'list returns only the rule');
            cb();
        });

    }, function (cb) {
        // Change the owner of rule 2
        var payload3 = {
            rules: [
                {
                    uuid: expRule2.uuid,
                    owner_uuid: owner,
                    version: expRule2.version
                }
            ],
            vms: [vm1, vm2]
        };
        expRule2.owner_uuid = owner;
        delete expRule2.global;

        fw.update(payload3, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                // both VMs were affected: vm1 has the default rule set
                // written out, and vm2 has the default plus rule 2
                vms: [ vm2.uuid, vm1.uuid ],
                rules: [ expRule2 ]
            }, 'update: rules returned');

            var zoneRules = helpers.zoneIPFconfigs();
            var expRules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);
            createSubObjects(expRules, vm2.uuid, 'out', 'block', 'tcp',
                { '10.99.99.254': [ 25, 250 ] });

            t.deepEqual(zoneRules, expRules, 'firewall rules correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled for both VMs');

            cb();

        });

    }, function (cb) {

        var delPayload = {
            uuids: [ expRule2.uuid ],
            vms: [vm1, vm2]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                vms: [ vm2.uuid ],
                rules: [ expRule2 ]
            }, 'results returned');

            var zoneRules = helpers.zoneIPFconfigs();
            var expRules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);
            createSubObjects(expRules, vm2.uuid, 'out', 'block', 'tcp',
                { '10.99.99.254': [ 25 ] });

            t.deepEqual(zoneRules, expRules, 'firewall rules correct');

            var vmsEnabled = {};
            vmsEnabled[vm1.uuid] = true;
            vmsEnabled[vm2.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in both VMs');

            cb();
        });
    }

    ], function () {
            t.done();
    });
};



exports['all vms (local and remote)'] = function (t) {
    var owner = mod_uuid.v4();

    // All with the same owner:
    var vm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.1' } ],
        owner_uuid: owner
    });
    var vm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.2' } ],
        owner_uuid: owner
    });
    var rvm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.3' } ],
        owner_uuid: owner
    });
    var rvm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.4' } ],
        owner_uuid: owner
    });

    // Different owners:
    var vm3 = helpers.generateVM({
        nics: [ { ip: '10.8.8.1' } ],
        owner_uuid: mod_uuid.v4()
    });
    var rvm3 = helpers.generateVM({
        nics: [ { ip: '10.8.8.2' } ],
        owner_uuid: mod_uuid.v4()
    });

    if (printVMs) {
        console.log('vm1=%s\nvm2=%s\nvm3=%s\nrvm1=%s,\nrvm2=%s\nrvm3=%s',
            vm1.uuid, vm2.uuid, vm3.uuid, rvm1.uuid, rvm2.uuid, rvm3.uuid);
    }

    var payload = {
        remoteVMs: [ rvm1, rvm2, rvm3 ],
        rules: [
            {
                owner_uuid: owner,
                rule: 'FROM all vms TO all vms ALLOW tcp PORT 8081',
                enabled: true
            },
            {
                owner_uuid: owner,
                rule: 'FROM all vms TO all vms BLOCK tcp PORT 8082',
                enabled: true
            }
        ],
        vms: [vm1, vm2, vm3]
    };

    var expRules = clone(payload.rules);
    var vmsEnabled = {};
    var zoneRules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, expRules);
            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: helpers.sortedUUIDs([ rvm1, rvm2, rvm3 ]),
                rules: clone(expRules).sort(helpers.uuidSort),
                vms: helpers.sortedUUIDs([ vm1, vm2 ])
            }, 'rules returned');

            zoneRules = helpers.defaultZoneRules([vm1.uuid, vm2.uuid]);

            [vm1, vm2].forEach(function (vm) {
                vmsEnabled[vm.uuid] = true;
                createSubObjects(zoneRules, vm.uuid, 'out', 'block', 'tcp',
                    {
                        '10.1.1.1': [ 8082 ],
                        '10.1.1.2': [ 8082 ],
                        '10.1.1.3': [ 8082 ],
                        '10.1.1.4': [ 8082 ]
                    });
                createSubObjects(zoneRules, vm.uuid, 'in', 'pass', 'tcp',
                    {
                        '10.1.1.1': [ 8081 ],
                        '10.1.1.2': [ 8081 ],
                        '10.1.1.3': [ 8081 ],
                        '10.1.1.4': [ 8081 ]
                    });
            });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[1], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        var addPayload = {
            rules: [
                {
                    global: true,
                    rule: 'FROM all vms TO all vms ALLOW tcp PORT 8083',
                    enabled: true
                }
            ],
            vms: [vm1, vm2, vm3]
        };
        expRules.push(clone(addPayload.rules[0]));

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, expRules[2]);
            t.deepEqual(helpers.sortRes(res), {
                vms: helpers.sortedUUIDs([ vm1, vm2, vm3 ]),
                rules: [ expRules[2] ]
            }, 'rules returned');

            [vm1, vm2].forEach(function (vm) {
                zoneRules[vm.uuid].in.pass.tcp = {
                        '10.1.1.1': [ 8081, 8083 ],
                        '10.1.1.2': [ 8081, 8083 ],
                        '10.1.1.3': [ 8081, 8083 ],
                        '10.1.1.4': [ 8081, 8083 ],
                        '10.8.8.1': [ 8083 ],
                        '10.8.8.2': [ 8083 ]
                    };
            });

            zoneRules[vm3.uuid] = helpers.defaultZoneRules();
            createSubObjects(zoneRules, vm3.uuid, 'in', 'pass', 'tcp',
                {
                    '10.1.1.1': [ 8083 ],
                    '10.1.1.2': [ 8083 ],
                    '10.1.1.3': [ 8083 ],
                    '10.1.1.4': [ 8083 ],
                    '10.8.8.1': [ 8083 ],
                    '10.8.8.2': [ 8083 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            vmsEnabled[vm3.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.testEnableDisable({
            t: t,
            vm: vm1,
            vms: [vm1, vm2, vm3]
        }, cb);

    }, function (cb) {
        // Rule update should only affect vm1 and vm2, since they have the same
        // owner as the rule
        var updatePayload = {
            rules: [
                {
                    owner_uuid: owner,
                    rule: util.format(
                        'FROM vm %s TO all vms ALLOW tcp PORT 8081',
                        rvm2.uuid),
                    uuid: expRules[0].uuid
                }
            ],
            vms: [vm1, vm2, vm3]
        };
        expRules[0].rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.notEqual(res.rules[0].version, expRules[0].version,
                'rule version changed');
            expRules[0].version = res.rules[0].version;

            t.deepEqual(helpers.sortRes(res), {
                vms: helpers.sortedUUIDs([ vm1, vm2 ]),
                rules: [ expRules[0] ]
            }, 'rules returned');


            [vm1, vm2].forEach(function (vm) {
                zoneRules[vm.uuid].in.pass.tcp = {
                        '10.1.1.1': [ 8083 ],
                        '10.1.1.2': [ 8083 ],
                        '10.1.1.3': [ 8083 ],
                        '10.1.1.4': [ 8081, 8083 ],
                        '10.8.8.1': [ 8083 ],
                        '10.8.8.2': [ 8083 ]
                    };
            });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

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
        var delPayload = {
            uuids: [ expRules[1].uuid ],
            vms: [vm1, vm2, vm3]
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: helpers.sortedUUIDs([ vm1, vm2 ]),
                rules: [ expRules[1] ]
            }, 'results returned');

            [vm1, vm2].forEach(function (vm) {
                delete zoneRules[vm.uuid].out.block;
            });

            expRules = expRules.filter(function (r) {
                return r.uuid !== expRules[1].uuid;
            });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

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


exports['remote vms: tags'] = function (t) {
    var owner = mod_uuid.v4();

    // All with the same owner:
    var vm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.1' } ],
        tags: { one: true },
        owner_uuid: owner
    });
    var vm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.2' } ],
        owner_uuid: owner
    });
    var vm3 = helpers.generateVM({
        nics: [ { ip: '10.1.1.3' } ],
        tags: { one: true }
    });

    var rvm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.4' } ],
        tags: { one: true },
        owner_uuid: owner
    });
    var rvm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.5' } ],
        tags: { one: true }
    });
    var rvm3 = helpers.generateVM({
        nics: [ { ip: '10.1.1.6' } ],
        owner_uuid: owner
    });

    if (printVMs) {
        console.log('vm1=%s\nvm2=%s\nrvm1=%s,\nrvm2=%s',
            vm1.uuid, vm2.uuid, rvm1.uuid, rvm2.uuid);
    }

    var payload = {
        remoteVMs: [ rvm1, rvm2, rvm3 ],
        rules: [
            {
                owner_uuid: owner,
                rule: util.format('FROM tag one TO vm %s ALLOW tcp PORT 8081',
                    vm1.uuid),
                enabled: true
            }
        ],
        vms: [vm1, vm2, vm3]
    };

    var expRules = clone(payload.rules);
    var vmsEnabled = {};
    var zoneRules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, expRules);
            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: helpers.sortedUUIDs([ rvm1, rvm2, rvm3 ]),
                rules: clone(expRules).sort(helpers.uuidSort),
                vms: [ vm1.uuid ]
            }, 'rules returned');

            zoneRules = helpers.defaultZoneRules(vm1.uuid);

            vmsEnabled[vm1.uuid] = true;
            createSubObjects(zoneRules, vm1.uuid, 'in', 'pass', 'tcp',
                {
                    '10.1.1.1': [ 8081 ],
                    '10.1.1.4': [ 8081 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.testEnableDisable({
            t: t,
            vm: vm1,
            vms: [vm1, vm2, vm3]
        }, cb);
    }

    ], function () {
            t.done();
    });
};


exports['remote vms: vms'] = function (t) {
    var owner = mod_uuid.v4();

    // All with the same owner:
    var vm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.1' } ],
        owner_uuid: owner
    });
    var vm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.2' } ]
    });

    var rvm1 = helpers.generateVM({
        nics: [ { ip: '10.1.1.4' } ],
        owner_uuid: owner
    });
    var rvm2 = helpers.generateVM({
        nics: [ { ip: '10.1.1.5' } ],
        tags: { one: true }
    });

    if (printVMs) {
        console.log('vm1=%s\nvm2=%s\nrvm1=%s,\nrvm2=%s',
            vm1.uuid, vm2.uuid, rvm1.uuid, rvm2.uuid);
    }

    var payload = {
        remoteVMs: [ rvm1, rvm2 ],
        rules: [
            {
                owner_uuid: owner,
                rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 8081',
                    rvm1.uuid, vm1.uuid),
                enabled: true
            }
        ],
        vms: [vm1, vm2]
    };

    var expRules = clone(payload.rules);
    var vmsEnabled = {};
    var zoneRules;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, expRules);
            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: helpers.sortedUUIDs([ rvm1, rvm2 ]),
                rules: clone(expRules).sort(helpers.uuidSort),
                vms: [ vm1.uuid ]
            }, 'rules returned');

            zoneRules = helpers.defaultZoneRules(vm1.uuid);

            vmsEnabled[vm1.uuid] = true;
            createSubObjects(zoneRules, vm1.uuid, 'in', 'pass', 'tcp',
                {
                    '10.1.1.4': [ 8081 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

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



// TODO:
// - test remote VMs with an owner_uuid
//    - with tags
//    - with VMs
// - test machines with owner_uuid: try making a rule to a machine
//   that's owned by someone else



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
