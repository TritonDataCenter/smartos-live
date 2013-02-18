/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm tests
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
    mergeObjects(tags,
      { nics: [ { ip: '10.2.0.1' }, { ip: '165.225.132.33' } ] }));
  var vm2 = helpers.generateVM({ tags: { one: 'two', two: 'fish' },
    nics: [ { ip: '10.2.0.2' } ] });
  var vm3 = helpers.generateVM(mergeObjects(tags,
    { nics: [ { ip: '10.2.0.3' } ] }));

  // Not the target of rules at first:
  var vm4 = helpers.generateVM({ nics: [ { ip: '10.2.0.4' } ] });
  var vm5 = helpers.generateVM(mergeObjects(tags,
    { nics: [ { ip: '10.2.0.5' } ] }));
  var vm6 = helpers.generateVM({ nics: [ { ip: '10.2.0.6' } ] });
  // No tags, firewall disabled:
  var vm7 = helpers.generateVM({ firewall_enabled: false,
    nics: [ { ip: '10.2.0.7' } ] });
  // Tag one, firewall disabled:
  var vm8 = helpers.generateVM(mergeObjects(tags,
    { firewall_enabled: false, nics: [ { ip: '10.2.0.8' } ] }));

  // Remote VM with tag one
  var vm9 = helpers.generateVM(mergeObjects(tags,
    { nics: [ { ip: '10.2.0.9' } ] }));

  // Remote VM with no tags
  var vm10 = helpers.generateVM({ nics: [ { ip: '10.2.0.10' } ] });

  // Remote VMs
  var vm11 = helpers.generateVM({ tags: { red: 'fish' },
    nics: [ { ip: '10.2.0.11' } ] });

  // Remote VMs
  var vm12 = helpers.generateVM({ tags: { blue: 'fish' },
    nics: [ { ip: '10.2.0.12' } ] });

  // Local VM with no tags
  var vm13 = helpers.generateVM({ nics: [ { ip: '10.2.0.13' } ] });

  var vm14 = helpers.generateVM({ tags: { blue: 'fish' },
    nics: [ { ip: '10.2.0.14' } ] });

  var vms = [vm1, vm2, vm3, vm4].sort(helpers.uuidSort);
  var tagOneVMs = [vm1, vm2, vm3];

  if (false) {
    var allVMs = [vm1, vm2, vm3, vm4, vm5, vm6, vm7, vm8, vm9, vm10, vm11,
      vm12, vm13, vm14];
    for (var v in allVMs) {
      console.log('vm%d=%s', Number(v) + 1, allVMs[v].uuid);
    }
  }

  var payload = {
    rules: [
      {
        rule: 'FROM tag one TO tag one ALLOW tcp PORT 80',
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

      var ipfRules = helpers.getZoneRulesWritten();
      expRules = helpers.defaultZoneRules(
        tagOneVMs.map(function (vm) { return vm.uuid; }));
      vmsEnabled = {};

      tagOneVMs.forEach(function (vm) {
        createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp',
          {
            '10.2.0.1': [ 80 ],
            '10.2.0.2': [ 80 ],
            '10.2.0.3': [ 80 ],
            '10.2.0.3': [ 80 ],
            '165.225.132.33': [ 80 ]
          });
        vmsEnabled[vm.uuid] = true;
      });

      t.deepEqual(ipfRules, expRules, 'firewall rules correct');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

      expRulesOnDisk[rule1.uuid] = clone(rule1);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

      cb();
    });

  }, function (cb) {
    helpers.fwGetEquals(fw, t, rule1, cb);

  }, function (cb) {
    helpers.fwListEquals(fw, t, [rule1], cb);

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

      var ipfRules = helpers.getZoneRulesWritten();
      expRules = helpers.defaultZoneRules(
        tagOneVMs.map(function (vm) { return vm.uuid; }));
      vmsEnabled = {};

      tagOneVMs.forEach(function (vm) {
        createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp',
          {
            '10.2.0.1': [ 80 ],
            '10.2.0.2': [ 80 ],
            '10.2.0.3': [ 80 ],
            '10.2.0.3': [ 80 ],
            '10.2.0.5': [ 80 ],
            '165.225.132.33': [ 80 ]
          });
        vmsEnabled[vm.uuid] = true;
      });

      t.deepEqual(ipfRules, expRules, 'firewall rules correct');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

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

      var ipfRules = helpers.getZoneRulesWritten();
      expRules[vm6.uuid] = helpers.defaultZoneRules();
      vmsEnabled[vm6.uuid] = true;

      t.deepEqual(ipfRules, expRules, 'firewall rules correct');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled for VMs');

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

      var ipfRules = helpers.getZoneRulesWritten();

      t.deepEqual(ipfRules, expRules, 'firewall rules unchanged');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled unchanged');

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

      var ipfRules = helpers.getZoneRulesWritten();

      t.deepEqual(ipfRules, expRules, 'firewall rules unchanged');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled unchanged');

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
        rules: [],
        vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
      }, 'result returned');

      tagOneVMs.forEach(function (vm) {
        expRules[vm.uuid]['in'].pass.tcp['10.2.0.9'] = [80];
      });

      // XXX: compare VM files written to disk

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules unchanged');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled unchanged');
      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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

    tagOneVMs.push(vm8);
    vm8.firewall_enabled = true;
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

      var ipfRules = helpers.getZoneRulesWritten();
      expRules[vm8.uuid] = clone(expRules[vm1.uuid]);
      vmsEnabled[vm8.uuid] = true;

      t.deepEqual(ipfRules, expRules, 'firewall rules correct');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled for VMs');

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
        rules: [],
        vms: []
      }, 'result returned');

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
        rules: [],
        vms: tagOneVMs.map(function (vm) { return vm.uuid; }).sort()
      }, 'result returned');

      tagOneVMs.forEach(function (vm) {
        expRules[vm.uuid]['in'].pass.tcp['10.2.0.10'] = [80];
      });

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
        rules: [],
        vms: []
      }, 'result returned');

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
          rule: 'FROM tag red TO tag one ALLOW udp PORT 1000',
          enabled: true
        },
        {
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules stay the same');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk stay the same');

      expRulesOnDisk[rule2.uuid] = clone(rule2);
      expRulesOnDisk[rule3.uuid] = clone(rule3);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

      return cb();
    });

  }, function (cb) {
    // Add outgoing rule referencing tag red: this should be an
    // effective no-op, since outgoing ports are allowed by default

    var addPayload = {
      rules: [
        {
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules stay the same');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk stay the same');

      expRulesOnDisk[rule4.uuid] = clone(rule4);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules OK');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      expRulesOnDisk[rule2.uuid] = clone(rule2);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules stay the same');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules stay the same');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

      return cb();
    });

  }, function (cb) {
    // Add vm to tag rules

    var addPayload = {
      rules: [
        {
          rule: util.format('FROM vm %s TO tag one ALLOW tcp PORT 8080',
            vm4.uuid),
          enabled: true
        },
        {
          rule: util.format('FROM tag one TO vm %s ALLOW tcp PORT 8080',
            vm4.uuid),
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


      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules updated to include vm4');

      vmsEnabled[vm4.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      expRulesOnDisk[rule5.uuid] = rule5;
      expRulesOnDisk[rule6.uuid] = rule6;
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

      return cb();
    });

  }, function (cb) {
    // Add a rule from tag one to two

    var addPayload = {
      rules: [
        {
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
        rules: [rule7].sort(helpers.uuidSort),
        // vm4 gets added because it has tag one on the other side of its rule:
        vms: tagOneVMs.map(function (vm) {
          return vm.uuid; }).concat(vm4.uuid).sort()
      }, 'result returned');

      tagOneVMs.forEach(function (vm) {
        vm.nics.forEach(function (nic) {
          expRules[vm2.uuid].in.pass.tcp[nic.ip] = [ 80, 125 ];
        });
      });

      // Add the 2 remote tag one VMs (vm9, vm10) to vm4's rules
      expRules[vm2.uuid]['in'].pass.tcp[vm9.nics[0].ip] = [ 80, 125 ];
      expRules[vm2.uuid]['in'].pass.tcp[vm10.nics[0].ip] = [ 80, 125 ];

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules updated to include vm4');

      vmsEnabled[vm4.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled stays the same');

      expRulesOnDisk[rule7.uuid] = rule7;
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk OK');

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
