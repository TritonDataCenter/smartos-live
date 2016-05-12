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
 * fwadm update unit tests
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



exports['update non-existent rule'] = function (t) {
    var vm = helpers.generateVM();

    var payload = {
        rules: [
            {
                owner_uuid: vm.owner_uuid,
                rule: util.format('FROM vm %s TO any BLOCK tcp PORT 8080',
                    vm.uuid),
                uuid: mod_uuid.v4(),
                enabled: true
            }
        ],
        vms: [vm]
    };

    var expRules = [clone(payload.rules[0])];
    var vmsEnabled = {};
    var allRules;

    async.series([
    function (cb) {
        fw.update(payload, function (err) {
            t.ok(err, 'Error returned');
            return cb();
        });

    }, function (cb) {
        payload.allowAdds = true;
        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.ok(res.rules[0].uuid, 'rule has a uuid');
            expRules[0].uuid = res.rules[0].uuid;

            t.ok(res.rules[0].version, 'rule has a version');
            expRules[0].version = res.rules[0].version;

            t.deepEqual(res, {
                rules: expRules,
                vms: [ vm.uuid ]
            }, 'rules returned');

            allRules = helpers.defaultZoneRules(vm.uuid);
            createSubObjects(allRules, vm.uuid, 'out', 'block', 'tcp',
                {
                    any: [ 8080 ]
                });

            t.deepEqual(helpers.zoneIPFconfigs(4), allRules,
                'IPv4 firewall rules correct');
            t.deepEqual(helpers.zoneIPFconfigs(6), allRules,
                'IPv6 firewall rules correct');

            vmsEnabled[vm.uuid] = true;
            t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
                'ipf enabled in VMs');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);
    }

    ], function () {
            t.done();
    });
};


exports['localVM not in list'] = function (t) {
    var vm = helpers.generateVM();
    var payload = {
        localVMs: [ vm ],
        vms: [ ]
    };

    fw.update(payload, function (err, res) {
        t.ok(err, 'error returned');
        t.equal(err.message, util.format('Could not find VM "%s" in VM list',
            vm.uuid), 'error message');
        t.done();
    });
};


exports['description and created_by'] = function (t) {
    var payload = {
        rules: [
            {
                global: true,
                rule: 'FROM any TO all vms ALLOW tcp PORT 60',
                uuid: mod_uuid.v4(),
                enabled: false,
                created_by: 'fwadm',
                description: 'one',
                version: '1383163604683.062275'
            }
        ],
        vms: [ helpers.generateVM() ]
    };

    var expRules = [clone(payload.rules[0])];
    var expRulesOnDisk = {};

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                rules: expRules,
                vms: [ payload.vms[0].uuid ]
            }, 'rules returned');

            expRulesOnDisk[expRules[0].uuid] = clone(expRules[0]);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {

        payload.rules[0].created_by = 'other';
        payload.rules[0].description = 'two';

        expRules = [clone(payload.rules[0])];
        fw.update(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(res, {
                rules: expRules,
                vms: [ payload.vms[0].uuid ]
            }, 'rules returned');

            expRulesOnDisk[expRules[0].uuid] = clone(expRules[0]);
            t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk,
                'rules on disk OK');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);
    }

    ], function () {
            t.done();
    });
};


exports['FWAPI-237: Ignore rules that don\'t change'] = function (t) {
    var vm1 = helpers.generateVM({ uuid: helpers.uuidNum(1) });
    var vm2 = helpers.generateVM({ uuid: helpers.uuidNum(2) });
    var vm3 = helpers.generateVM({ uuid: helpers.uuidNum(3) });
    var vm4 = helpers.generateVM({
        owner_uuid: mod_uuid.v4(),
        uuid: helpers.uuidNum(4)
    });
    var allVMs = [ vm1, vm2, vm3, vm4 ];
    var updateUUID = mod_uuid.v4();

    var payload = {
        rules: [
            {
                rule: 'FROM any TO all vms ALLOW icmp TYPE 8 CODE 0',
                enabled: true,
                global: true
            },
            {
                uuid: updateUUID,
                owner_uuid: vm1.owner_uuid,
                rule: util.format('FROM any TO vm %s ALLOW udp PORT 514',
                    vm1.uuid),
                enabled: true
            }
        ],
        vms: allVMs
    };

    var expRules = [clone(payload.rules[0]), clone(payload.rules[1])];

    var updatePayload = {
        rules: [
            {
                uuid: updateUUID,
                owner_uuid: vm1.owner_uuid,
                rule: util.format('FROM any TO vm %s ALLOW udp PORT 515',
                    vm1.uuid),
                enabled: true
            }
        ],
        vms: allVMs
    };

    async.series([
    function (cb) {
        fw.add(payload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            for (var i in res.rules) {
                t.ok(res.rules[i].uuid, 'rule has a uuid');
                expRules[i].uuid = res.rules[i].uuid;

                t.ok(res.rules[i].version, 'rule has a version');
                expRules[i].version = res.rules[i].version;
            }

            t.deepEqual(helpers.sortRes(res), helpers.sortRes({
                rules: clone(expRules),
                vms: [ vm1.uuid, vm2.uuid, vm3.uuid, vm4.uuid ].sort()
            }), 'rules returned');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, expRules[0], cb);

    }, function (cb) {
        helpers.fwListEquals(t, expRules, cb);

    }, function (cb) {
        var globalPayload = {
            rules: [ expRules[0] ],
            vms: allVMs
        };

        fw.update(globalPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // Nothing's changed in the global rule, so nothing should
            // be updated.
            t.deepEqual(helpers.sortRes(res), { vms: [], rules: [] },
                'rules returned');

            cb();
        });

    }, function (cb) {
        var globalPayload = {
            rules: [ expRules[0] ],
            vms: allVMs
        };
        globalPayload.rules[0].rule =
            'FROM any TO all vms ALLOW icmp TYPE all';

        fw.update(globalPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // This global rule affects all VMs, so they all should be updated.
            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid, vm3.uuid, vm4.uuid ],
                rules: globalPayload.rules
            }, 'rules returned');

            cb();
        });
    }, function (cb) {
        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // This rule should only affect the VM that it mentions.
            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid ],
                rules: updatePayload.rules
            }, 'rules returned');

            cb();
        });

    }, function (cb) {
        helpers.fwGetEquals(t, updatePayload.rules[0], cb);

    }, function (cb) {
        fw.update(updatePayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // Repeating the same update again shouldn't do anything.
            t.deepEqual(helpers.sortRes(res), { vms: [], rules: [] },
                'rules returned');

            cb();
        });

    }, function (cb) {
        var vm2updated = clone(vm2);
        vm2updated.nics[0].ip = '1.2.3.4';
        var vmPayload = {
            localVMs: [ vm2updated ],
            vms: allVMs
        };

        fw.update(vmPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // None of the rules are affected by the VM's IP changing, so only
            // the modified VM is updated.
            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm2updated.uuid ],
                rules: []
            }, 'rules returned');

            cb();
        });
    }, function (cb) {
        var addPayload = {
            rules: [ {
                uuid: mod_uuid.v4(),
                rule: 'FROM all vms TO all vms ALLOW tcp PORT all',
                enabled: true,
                owner_uuid: vm1.owner_uuid
            } ],
            vms: allVMs,
            allowAdds: true
        };

        // Add a rule that affects all VMs owned by the owner of VMs 1, 2, 3
        fw.update(addPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid, vm3.uuid ],
                rules: addPayload.rules
            }, 'rules returned');

            cb();
        });
    }, function (cb) {
        var vm2updated = clone(vm2);
        vm2updated.nics[0].ip = '1.2.3.5';
        var vmPayload = {
            localVMs: [ vm2updated ],
            vms: allVMs
        };

        fw.update(vmPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // Now that there's a rule that affects all VMs of one owner,
            // updating the IP address affects those VMs, so they need their
            // active firewall rules set updated.
            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm1.uuid, vm2.uuid, vm3.uuid ],
                rules: []
            }, 'rules returned');

            cb();
        });
    }, function (cb) {
        var vm4updated = clone(vm4);
        vm4updated.nics[0].ip = '1.2.3.20';
        var vmPayload = {
            localVMs: [ vm4updated ],
            vms: allVMs
        };

        fw.update(vmPayload, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb();
            }

            // Updating the IP address of the VM that has a different owner
            // shouldn't do anything to other VMs.
            t.deepEqual(helpers.sortRes(res), {
                vms: [ vm4updated.uuid ],
                rules: []
            }, 'rules returned');

            cb();
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
