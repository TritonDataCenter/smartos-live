/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm test: tags
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



// XXX: split this into separate tests rather than using async
exports['add / update: tag to tag'] = function (t) {
    var expRules;
    var expRulesOnDisk = {};
    var vmsEnabled;
    var remoteVMsOnDisk = {};
    var tags = { tags: { one: 'fish' } };

    var vm1 = helpers.generateVM(
        mergeObjects(tags, { uuid: helpers.uuidNum(1),
            nics: [ { ip: '10.2.0.1' }, { ip: '165.225.132.33' } ] }));
    var vm2 = helpers.generateVM({ uuid: helpers.uuidNum(2),
        tags: { one: 'two', two: 'fish' },
        nics: [ { ip: '10.2.0.2' } ] });
    var vm3 = helpers.generateVM(mergeObjects(tags,
        { uuid: helpers.uuidNum(3),
            nics: [ { ip: '10.2.0.3' } ] }));

    // Not the target of rules at first:
    var vm4 = helpers.generateVM({
        uuid: helpers.uuidNum(4),
        nics: [ { ip: '10.2.0.4' } ] });
    var vm5 = helpers.generateVM(mergeObjects(tags,
        { uuid: helpers.uuidNum(5),
            nics: [ { ip: '10.2.0.5' } ] }));
    var vm6 = helpers.generateVM({
        uuid: helpers.uuidNum(6),
        nics: [ { ip: '10.2.0.6' } ] });
    // No tags, firewall disabled:
    var vm7 = helpers.generateVM({
        uuid: helpers.uuidNum(7),
        firewall_enabled: false,
        nics: [ { ip: '10.2.0.7' } ] });
    // Tag one, firewall disabled:
    var vm8 = helpers.generateVM(mergeObjects(tags,
        { uuid: helpers.uuidNum(8),
            firewall_enabled: false,
            nics: [ { ip: '10.2.0.8' } ] }));

    // Remote VM with tag one
    var vm9 = helpers.generateVM(mergeObjects(tags,
        { uuid: helpers.uuidNum(9),
            nics: [ { ip: '10.2.0.9' } ] }));

    // Remote VM with no tags
    var vm10 = helpers.generateVM({
        uuid: helpers.uuidNum(10),
        nics: [ { ip: '10.2.0.10' } ] });

    // Remote VMs
    var vm11 = helpers.generateVM({
        uuid: helpers.uuidNum(11),
        tags: { red: 'fish' },
        nics: [ { ip: '10.2.0.11' } ] });

    // Remote VMs
    var vm12 = helpers.generateVM({
        uuid: helpers.uuidNum(12),
        tags: { blue: 'fish' },
        nics: [ { ip: '10.2.0.12' } ] });

    // Local VM with no tags
    var vm13 = helpers.generateVM({
        uuid: helpers.uuidNum(13),
        nics: [ { ip: '10.2.0.13' } ] });

    var vms = [vm1, vm2, vm3, vm4].sort(helpers.uuidSort);
    var tagOneVMs = [vm1, vm2, vm3];

    var payload = {
        rules: [
            {
                rule: 'FROM tag one TO tag one ALLOW tcp PORT 80',
                owner_uuid: vm1.owner_uuid,
                enabled: true
            }
        ],
        vms: vms
    };

    var rule1 = clone(payload.rules[0]);
    var rule2;
    var rule3;
    var rule4;
    var rule5;
    var rule6;
    var rule7;

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            rule1.uuid = res.rules[0].uuid;
            rule1.version = res.rules[0].version;
            t.deepEqual(helpers.sortRes(res), {
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort(),
                rules: [ rule1 ]
            }, 'rules returned');

            var ipfRules = helpers.zoneIPFconfigs();
            expRules = helpers.defaultZoneRules(
                tagOneVMs.map(function (vm) { return vm.uuid; }));
            vmsEnabled = {};

            tagOneVMs.forEach(function (vm) {
                createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp',
                    {
                        '10.2.0.1': [ 80 ],
                        '10.2.0.2': [ 80 ],
                        '10.2.0.3': [ 80 ],
                        '165.225.132.33': [ 80 ]
                    });
                vmsEnabled[vm.uuid] = true;
            });

            t.deepEqual(ipfRules, expRules, 'firewall rules correct');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            expRulesOnDisk[rule1.uuid] = clone(rule1);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, rule1, cb);

    }, function (cb) {
        helpers.fwListEquals(t, [rule1], cb);

    }, function (cb) {
        // Simulate creating a new local VM with tag one
        vms = vms.concat(vm5).sort(helpers.uuidSort);
        tagOneVMs.push(vm5);

        var addPayload = {
            localVMs: [vm5],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            expRules = helpers.defaultZoneRules(
                tagOneVMs.map(function (vm) { return vm.uuid; }));
            vmsEnabled = {};

            tagOneVMs.forEach(function (vm) {
                createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp',
                    {
                        '10.2.0.1': [ 80 ],
                        '10.2.0.2': [ 80 ],
                        '10.2.0.3': [ 80 ],
                        '10.2.0.5': [ 80 ],
                        '165.225.132.33': [ 80 ]
                    });
                vmsEnabled[vm.uuid] = true;
            });

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules correct');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            return cb();
        });

    }, function (cb) {
        // Add another VM with no tags:
        // - rules on disk for other VMs should not change
        // - new VM should come up with the default set of rules
        vms = vms.concat(vm6).sort(helpers.uuidSort);

        var addPayload = {
            localVMs: [vm6],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: [ vm6.uuid ]
            }, 'result returned');

            expRules[vm6.uuid] = helpers.defaultZoneRules();
            vmsEnabled[vm6.uuid] = true;

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules correct');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled for VMs');

            return cb();
        });

    }, function (cb) {
        // Add another VM with firewall disabled
        // - rules on disk for other VMs should not change
        // - new VM should not have any ipf rules
        vms = vms.concat(vm7).sort(helpers.uuidSort);

        var addPayload = {
            localVMs: [vm7],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: [ ]
            }, 'result returned');

            var ipfRules = helpers.zoneIPFconfigs();

            t.deepEqual(ipfRules, expRules, 'firewall rules unchanged');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled unchanged');

            return cb();
        });

    }, function (cb) {
        // Add another VM with tag one but firewall disabled
        // - rules on disk for other VMs should have the IP for the new VM
        // - the VM itself should not have any ipf rules
        vms = vms.concat(vm8).sort(helpers.uuidSort);

        var addPayload = {
            localVMs: [vm8],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                expRules[vm.uuid]['in'].pass.tcp['10.2.0.8'] = [80];
            });

            var ipfRules = helpers.zoneIPFconfigs();

            t.deepEqual(ipfRules, expRules, 'firewall rules unchanged');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled unchanged');

            return cb();
        });

    }, function (cb) {
        // Add a remote VM for tag one
        // - rules on disk for other VMs should have the IP for the new VM

        var addPayload = {
            remoteVMs: [vm9],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: [vm9.uuid],
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                expRules[vm.uuid]['in'].pass.tcp['10.2.0.9'] = [80];
            });

            // XXX: compare VM files written to disk

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules unchanged');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled unchanged');
            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules unchanged');

            remoteVMsOnDisk[vm9.uuid] = util_vm.createRemoteVM(vm9);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk OK');

            return cb();
        });

    }, function (cb) {
        // Enable VM 8 (which has tag one):
        // - rules on disk for other VMs should not change
        // - VM 8 should now have all of the tag one rules

        vm8.firewall_enabled = true;
        tagOneVMs.push(vm8);
        var updatePayload = {
            localVMs: [vm8],
            vms: vms
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            var ipfRules = helpers.zoneIPFconfigs();
            expRules[vm8.uuid] = clone(expRules[vm1.uuid]);
            vmsEnabled[vm8.uuid] = true;

            t.deepEqual(ipfRules, expRules, 'firewall rules correct');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled for VMs');

            return cb();
        });

    }, function (cb) {
        // Add remote VM 10 with no tags:
        // - rules on disk for all VMs should not change

        var addPayload = {
            remoteVMs: [vm10],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: [vm10.uuid],
                rules: [],
                vms: []
            }, 'result returned');

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            remoteVMsOnDisk[vm10.uuid] = util_vm.createRemoteVM(vm10);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk OK');

            return cb();
        });

    }, function (cb) {
        // Update remote VM 10 to have tag one:
        // - tag one VMs should include VM 10s IPs

        vm10.tags = { one: 'two' };
        var updatePayload = {
            remoteVMs: [vm10],
            vms: vms
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: [vm10.uuid],
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                expRules[vm.uuid]['in'].pass.tcp['10.2.0.10'] = [80];
            });

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            remoteVMsOnDisk[vm10.uuid] = util_vm.createRemoteVM(vm10);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add remote VMs 11 and 12: no firewalls on disk should change

        var updatePayload = {
            remoteVMs: [vm11, vm12],
            vms: vms
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: helpers.sortedUUIDs([vm11, vm12]),
                rules: [],
                vms: []
            }, 'result returned');

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            remoteVMsOnDisk[vm11.uuid] = util_vm.createRemoteVM(vm11);
            remoteVMsOnDisk[vm12.uuid] = util_vm.createRemoteVM(vm12);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add incoming rules referencing VM11 (tagged red):

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: 'FROM tag red TO tag one ALLOW udp PORT 1000',
                    enabled: true
                },
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: 'FROM tag red TO tag one ALLOW udp PORT 1001',
                    enabled: true
                }
            ],
            vms: vms
        };

        rule2 = clone(addPayload.rules[0]);
        rule3 = clone(addPayload.rules[1]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, [rule2, rule3]);

            t.deepEqual(helpers.sortRes(res), {
                rules: [rule2, rule3].sort(helpers.uuidSort),
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                createSubObjects(expRules, vm.uuid, 'in', 'pass', 'udp',
                    {
                        '10.2.0.11': [ 1000, 1001 ]
                    });
            });

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk stay the same');

            expRulesOnDisk[rule2.uuid] = clone(rule2);
            expRulesOnDisk[rule3.uuid] = clone(rule3);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add outgoing rule referencing tag red: this should be an
        // effective no-op, since outgoing ports are allowed by default

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: 'FROM tag one TO tag red ALLOW tcp PORT 25',
                    enabled: true
                }
            ],
            vms: vms
        };

        rule4 = clone(addPayload.rules[0]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, rule4);

            t.deepEqual(helpers.sortRes(res), {
                rules: [rule4],
                vms: [],
                // This will re-write the files for tag one VMs, but the
                // file contents won't have actually changed
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk stay the same');

            expRulesOnDisk[rule4.uuid] = clone(rule4);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Update rule 2 to include tag blue (remote VM 12 has this tag):
        // - tag one VMs should have firewalls updated

        rule2.rule = 'FROM (tag blue OR tag red) TO tag one '
            + 'ALLOW udp (PORT 1000 AND PORT 1050)';

        var updatePayload = {
            rules: [
                {
                    rule: rule2.rule,
                    uuid: rule2.uuid
                }
            ],
            vms: vms
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.notEqual(res.rules[0].version, rule2.version,
                'rule version changed');
            rule2.version = res.rules[0].version;

            t.deepEqual(helpers.sortRes(res), {
                rules: [rule2],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                createSubObjects(expRules, vm.uuid, 'in', 'pass', 'udp',
                    {
                        '10.2.0.11': [ 1000, 1001, 1050 ],
                        '10.2.0.12': [ 1000, 1050 ]
                    });
            });

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules OK');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            expRulesOnDisk[rule2.uuid] = clone(rule2);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add VM 13 with no tags:
        // - It should come up with the default rule set
        // - Everything should stay the same

        vms = vms.concat(vm13).sort(helpers.uuidSort);

        var addPayload = {
            localVMs: [vm13],
            vms: vms
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: [vm13.uuid]
            }, 'result returned');

            expRules[vm13.uuid] = helpers.defaultZoneRules();
            vmsEnabled[vm13.uuid] = true;

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Update VM 13 to include tag one:
        // - It and the other tag one VMs should have tag one firewall rules

        vm13.tags = { one: 'two' };
        tagOneVMs = tagOneVMs.concat(vm13).sort(helpers.uuidSort);

        var updatePayload = {
            localVMs: [vm13],
            vms: vms
        };

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                rules: [],
                vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
            }, 'result returned');

            expRules[vm13.uuid] = clone(expRules[vm1.uuid]);
            tagOneVMs.forEach(function (vm) {
                expRules[vm.uuid]['in'].pass.tcp['10.2.0.13'] = [ 80 ];
            });

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules stay the same');
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add vm to tag rules

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: util.format(
                        'FROM vm %s TO tag one ALLOW tcp PORT 8080', vm4.uuid),
                    enabled: true
                },
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: util.format(
                        'FROM tag one TO vm %s ALLOW tcp PORT 8080', vm4.uuid),
                    enabled: true
                }
            ],
            vms: vms
        };

        rule5 = clone(addPayload.rules[0]);
        rule6 = clone(addPayload.rules[1]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, [rule5, rule6]);

            t.deepEqual(helpers.sortRes(res), {
                rules: [rule5, rule6].sort(helpers.uuidSort),
                vms: tagOneVMs.map(function (vm) {
                    return vm.uuid;
                }).concat(vm4.uuid).sort()
            }, 'result returned');

            expRules[vm4.uuid] = helpers.defaultZoneRules();
            createSubObjects(expRules, vm4.uuid, 'in', 'pass', 'tcp');

            tagOneVMs.forEach(function (vm) {
                // Add vm4 to all of the tag one rules
                expRules[vm.uuid]['in'].pass.tcp['10.2.0.4'] = [ 8080 ];
                // and add the tag one ips to vm4's rules
                vm.nics.forEach(function (nic) {
                    expRules[vm4.uuid]['in'].pass.tcp[nic.ip] = [ 8080 ];
                });
            });

            // Add the 2 remote tag one VMs (vm9, vm10) to vm4's rules
            expRules[vm4.uuid]['in'].pass.tcp[vm9.nics[0].ip] = [ 8080 ];
            expRules[vm4.uuid]['in'].pass.tcp[vm10.nics[0].ip] = [ 8080 ];


            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules updated to include vm4');

            vmsEnabled[vm4.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            expRulesOnDisk[rule5.uuid] = rule5;
            expRulesOnDisk[rule6.uuid] = rule6;
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });

    }, function (cb) {
        // Add a rule from tag one to two

        var addPayload = {
            rules: [
                {
                    owner_uuid: vm1.owner_uuid,
                    rule: 'FROM tag one TO tag two ALLOW tcp PORT 125',
                    enabled: true
                }
            ],
            vms: vms
        };

        rule7 = clone(addPayload.rules[0]);

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, rule7);

            t.deepEqual(helpers.sortRes(res), {
                rules: [rule7],
                vms: tagOneVMs.map(function (vm) {
                    return vm.uuid; }).sort()
            }, 'result returned');

            tagOneVMs.forEach(function (vm) {
                vm.nics.forEach(function (nic) {
                    expRules[vm2.uuid].in.pass.tcp[nic.ip] = [ 80, 125 ];
                });
            });

            // Add the 2 remote tag one VMs (vm9, vm10) to vm4's rules
            expRules[vm2.uuid]['in'].pass.tcp[vm9.nics[0].ip] = [ 80, 125 ];
            expRules[vm2.uuid]['in'].pass.tcp[vm10.nics[0].ip] = [ 80, 125 ];

            t.deepEqual(helpers.zoneIPFconfigs(), expRules,
                'firewall rules updated to include vm4');

            vmsEnabled[vm4.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled stays the same');

            expRulesOnDisk[rule7.uuid] = rule7;
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            return cb();
        });
    }
    ], function () {
            t.done();
    });
};


exports['tags with values'] = function (t) {
    var vm1 = helpers.generateVM({ uuid: helpers.uuidNum(1) });
    var vm2 = helpers.generateVM({ uuid: helpers.uuidNum(2),
        tags: { role: 'web' } });
    var vm3 = helpers.generateVM({ uuid: helpers.uuidNum(3),
        tags: { role: 'db' } });
    var vm4 = helpers.generateVM({ uuid: helpers.uuidNum(4),
        tags: { role: 'web' } });
    var vm5 = helpers.generateVM({ uuid: helpers.uuidNum(5),
        tags: { role: 'mon' } });

    var rvm1 = helpers.generateVM({ uuid: helpers.uuidNum(11) });
    var rvm2 = helpers.generateVM({ uuid: helpers.uuidNum(12),
        tags: { role: 'web' } });
    var rvm3 = helpers.generateVM({ uuid: helpers.uuidNum(13),
        tags: { role: 'db' } });
    var rvm4 = helpers.generateVM({ uuid: helpers.uuidNum(14),
        tags: { role: 'web' } });

    var allVMs = [ vm1, vm2, vm3, vm4, vm5 ];
    var payload = {
        remoteVMs: [rvm1, rvm2, rvm3],
        rules: [
            {
                owner_uuid: vm1.owner_uuid,
                rule: 'FROM any TO tag role = web ALLOW tcp PORT 80',
                enabled: true
            }
        ],
        vms: allVMs
    };

    var expRules = [clone(payload.rules[0])];
    var vmsEnabled = {};
    var remoteVMsOnDisk = {};
    var zoneRules;

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

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: helpers.sortedUUIDs([rvm1, rvm2, rvm3]),
                rules: expRules,
                vms: [ vm2.uuid, vm4.uuid ].sort()
            }, 'rules returned');

            zoneRules = helpers.defaultZoneRules([vm2.uuid, vm4.uuid]);
            [vm2, vm4].forEach(function (vm) {
                createSubObjects(zoneRules, vm.uuid, 'in', 'pass', 'tcp',
                    {
                        any: [ 80 ]
                    });
            });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            vmsEnabled[vm2.uuid] = true;
            vmsEnabled[vm4.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            remoteVMsOnDisk[rvm1.uuid] = util_vm.createRemoteVM(rvm1);
            remoteVMsOnDisk[rvm2.uuid] = util_vm.createRemoteVM(rvm2);
            remoteVMsOnDisk[rvm3.uuid] = util_vm.createRemoteVM(rvm3);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk');

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
                    owner_uuid: vm1.owner_uuid,
                    rule: 'FROM tag role = web TO tag role = mon '
                        + 'ALLOW udp PORT 514',
                    enabled: true
                }
            ],
            vms: allVMs
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

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm2.uuid, vm4.uuid, vm5.uuid ].sort(),
                rules: [ expRules[1] ]
            }, 'rules returned');

            zoneRules[vm5.uuid] = helpers.defaultZoneRules();
            var udpPorts = {};
            udpPorts[vm2.nics[0].ip] = [ 514 ];
            udpPorts[vm4.nics[0].ip] = [ 514 ];
            udpPorts[rvm2.nics[0].ip] = [ 514 ];

            createSubObjects(zoneRules, vm5.uuid, 'in', 'pass', 'udp',
                udpPorts);

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            vmsEnabled[vm5.uuid] = true;
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
            rules: [ expRules[1] ],
            vm: vm5,
            vms: allVMs
        }, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm2,
            vms: allVMs
        }, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: expRules,
            vm: vm4,
            vms: allVMs
        }, cb);

    }, function (cb) {

        var updatePayload = {
            rules: [
                {
                    uuid: expRules[0].uuid,
                    rule: 'FROM any TO (tag role = db OR tag role = web) ALLOW '
                        + 'tcp PORT 80'
                }
            ],
            vms: allVMs
        };
        expRules[0].rule = updatePayload.rules[0].rule;

        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[0].version = res.rules[0].version;

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm2.uuid, vm3.uuid, vm4.uuid ].sort(),
                rules: [ expRules[0] ]
            }, 'rules returned');

            zoneRules[vm3.uuid] = helpers.defaultZoneRules();
            createSubObjects(zoneRules, vm3.uuid, 'in', 'pass', 'tcp',
                {
                    any: [ 80 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            vmsEnabled[vm3.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });


    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[0] ],
            vm: vm3,
            vms: allVMs
        }, cb);

    }, function (cb) {
        // Disabling and re-enabling the firewall should have no effect on the
        // zone rules
        helpers.testEnableDisable({
            t: t,
            vm: vm2,
            vms: allVMs
        }, cb);

    }, function (cb) {
        helpers.testEnableDisable({
            t: t,
            vm: vm5,
            vms: allVMs
        }, cb);

    }, function (cb) {
        // Add a remote VM
        var addPayload = {
            remoteVMs: [ rvm4 ],
            vms: allVMs
        };

        fw.add(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                remoteVMs: [ rvm4.uuid ],
                vms: [ vm2.uuid, vm3.uuid, vm4.uuid, vm5.uuid ].sort(),
                rules: [ ]
            }, 'rules returned');

            zoneRules[vm5.uuid].in.pass.udp[rvm4.nics[0].ip] = [ 514 ];
            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            remoteVMsOnDisk[rvm4.uuid] = util_vm.createRemoteVM(rvm4);
            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk');

            cb();
        });

    }, function (cb) {
        // Delete the rule

        var delPayload = {
            uuids: [ expRules[0].uuid ],
            vms: allVMs
        };

        fw.del(delPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm2.uuid, vm3.uuid, vm4.uuid ],
                rules: [ expRules[0] ]
            }, 'results returned');

            [vm2, vm3, vm4].forEach(function (vm) {
                delete zoneRules[vm.uuid].in.pass;
            });

            t.deepEqual(helpers.zoneIPFconfigs(), zoneRules,
                'firewall rules correct');

            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf still enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ expRules[1] ],
            vm: vm2,
            vms: allVMs
        }, cb);
    }

    ], function () {
            t.done();
    });
};


exports['tags that target no VMs'] = function (t) {
    var vms = [ helpers.generateVM(), helpers.generateVM() ];
    var rules = [
        {
            owner_uuid: vms[0].owner_uuid,
            rule: 'FROM any TO tag doesnotexist ALLOW tcp PORT 80',
            enabled: true
        },
        {
            owner_uuid: vms[0].owner_uuid,
            rule: 'FROM any TO tag exists = nada ALLOW tcp PORT 81',
            enabled: true
        }
    ];

    var expRules = {};
    var expRulesOnDisk = {};
    var remoteVMsOnDisk = {};
    var vmsEnabled = {};

    var payload = {
        localVMs: vms,
        rules: rules,
        vms: vms
    };

    async.series([
    function (cb) {
        fw.validatePayload(payload, function (err, res) {
            t.ifError(err);
            return cb();
        });

    }, function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            helpers.fillInRuleBlanks(res.rules, rules);
            t.deepEqual(helpers.sortRes(res), {
                vms: helpers.sortedUUIDs(vms),
                rules: [ rules[0], rules[1] ].sort(helpers.uuidSort)
            }, 'rules returned');

            helpers.addZoneRules(expRules, [
                [vms[0], 'default'],
                [vms[1], 'default']
            ]);

            t.deepEqual(helpers.zoneIPFconfigs(), expRules, 'firewall rules');

            vmsEnabled[vms[0].uuid] = true;
            vmsEnabled[vms[1].uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled');

            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk');

            expRulesOnDisk[rules[0].uuid] = clone(rules[0]);
            expRulesOnDisk[rules[1].uuid] = clone(rules[1]);

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            return cb();
        });

    }, function (cb) {
        helpers.fwListEquals(t, rules, cb);

    }, function (cb) {
        helpers.fwRulesEqual({
            t: t,
            rules: [ ],
            vm: vms[0],
            vms: vms
        }, cb);

    }, function (cb) {
        // Add a VM with the non-existent tag
        vms.push(helpers.generateVM({ tags: { doesnotexist: true } }));

        fw.add({ localVMs: [vms[2]], vms: vms }, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [vms[2].uuid],
                rules: []
            }, 'vms returned');

            helpers.addZoneRules(expRules, [
                [vms[2], 'in', 'pass', 'tcp', 'any', 80]
            ]);

            vmsEnabled[vms[2].uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'firewalls enabled');

            t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
                'remote VMs on disk');

            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

            return cb();
        });
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
