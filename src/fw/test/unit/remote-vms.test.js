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



exports['local VM to remote VM'] = function (t) {
  var vm = helpers.generateVM();
  var rvm = helpers.generateVM({
    nics: [ { ip: '10.1.1.1' }, { ip: '10.2.2.2' } ]
  });

  var expRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 80',
                vm.uuid, rvm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM vm %s TO vm %s ALLOW tcp PORT 80',
                rvm.uuid, vm.uuid),
        enabled: true
      }
    ],
    vms: [vm]
  };

  var rule1 = clone(payload.rules[0]);
  var rule2 = clone(payload.rules[1]);
  var rule3;

  if (printVMs) {
    console.log('vm=%s', vm.uuid);
    console.log('rvm=%s', rvm.uuid);
  }

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
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

      expRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp');
      expRules[vm.uuid]['in'].pass.tcp[rvm.nics[0].ip] = [ 80 ];
      expRules[vm.uuid]['in'].pass.tcp[rvm.nics[1].ip] = [ 80 ];

      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      remoteVMsOnDisk[rvm.uuid] = util_vm.createRemoteVM(rvm);

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule1.uuid] = clone(rule1);
      expRulesOnDisk[rule2.uuid] = clone(rule2);

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Add another rule referencing rvm
    rule3 = {
      enabled: true,
      rule: util.format('FROM vm %s TO vm %s ALLOW udp PORT 161',
              rvm.uuid, vm.uuid)
    };
    payload.rules = [ clone(rule3) ];

    fw.validatePayload(payload, function (err, res) {
      t.ifError(err);
      return cb();
    });

  }, function (cb) {
    fw.add(payload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, rule3);

      createSubObjects(expRules, vm.uuid, 'in', 'pass', 'udp');
      expRules[vm.uuid]['in'].pass.udp[rvm.nics[0].ip] = [ 161 ];
      expRules[vm.uuid]['in'].pass.udp[rvm.nics[1].ip] = [ 161 ];

      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule3.uuid] = clone(rule3);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Delete rule 3

    var delPayload = {
      uuids: [rule3.uuid],
      vms: [vm]
    };

    fw.del(delPayload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      delete expRules[vm.uuid]['in'].pass.udp;
      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      delete expRulesOnDisk[rule3.uuid];
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Disabling and re-enabling the firewall should have no effect on the
    // zone rules
    helpers.testEnableDisable({
      t: t,
      vm: vm,
      vms: [vm]
    }, cb);
  }

  ], function () {
      t.done();
  });
};


exports['local VM to remote tag'] = function (t) {
  var vm = helpers.generateVM();
  var rvm = helpers.generateVM({ tags: { other: true } });

  var expRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM vm %s TO tag other ALLOW tcp PORT 80',
                vm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM tag other TO vm %s ALLOW tcp PORT 80',
                vm.uuid),
        enabled: true
      }
    ],
    vms: [vm]
  };

  var rule1 = clone(payload.rules[0]);
  var rule2 = clone(payload.rules[1]);
  var rule3;

  if (printVMs) {
    console.log('vm=%s', vm.uuid);
    console.log('rvm=%s', rvm.uuid);
  }

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
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

      expRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp');
      expRules[vm.uuid]['in'].pass.tcp[rvm.nics[0].ip] = [ 80 ];

      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      remoteVMsOnDisk[rvm.uuid] = util_vm.createRemoteVM(rvm);

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule1.uuid] = clone(rule1);
      expRulesOnDisk[rule2.uuid] = clone(rule2);

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Add another rule referencing rvm
    rule3 = {
      enabled: true,
      rule: util.format('FROM vm %s TO vm %s ALLOW udp PORT 161',
              rvm.uuid, vm.uuid)
    };
    payload.rules = [ clone(rule3) ];

    fw.validatePayload(payload, function (err, res) {
      t.ifError(err);
      return cb();
    });

  }, function (cb) {
    fw.add(payload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, rule3);

      createSubObjects(expRules, vm.uuid, 'in', 'pass', 'udp');
      expRules[vm.uuid]['in'].pass.udp[rvm.nics[0].ip] = [ 161 ];

      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule3.uuid] = clone(rule3);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Delete rule 3

    var delPayload = {
      uuids: [rule3.uuid],
      vms: [vm]
    };

    fw.del(delPayload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      delete expRules[vm.uuid]['in'].pass.udp;
      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      delete expRulesOnDisk[rule3.uuid];
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }

  ], function () {
      t.done();
  });
};


exports['local VM and remote VM to IP'] = function (t) {
  var vm = helpers.generateVM({ uuid: '5293cc31-189c-4b10-be90-7c74c78de927' });
  var rvm = helpers.generateVM({
    uuid: 'da08034b-37a0-4788-9c97-e84f685b6561' });

  var expRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM (vm %s OR vm %s) TO ip 10.0.0.1 '
          + 'ALLOW tcp PORT 80', vm.uuid, rvm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM ip 10.0.0.1 TO (vm %s OR vm %s) '
          + 'ALLOW tcp PORT 80', vm.uuid, rvm.uuid),
        enabled: true
      }
    ],
    vms: [vm]
  };

  var rule1 = clone(payload.rules[0]);
  var rule2 = clone(payload.rules[1]);

  if (printVMs) {
    console.log('vm=%s', vm.uuid);
    console.log('rvm=%s', rvm.uuid);
  }

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
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

      expRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(expRules, vm.uuid, 'in', 'pass', 'tcp');
      expRules[vm.uuid]['in'].pass.tcp['10.0.0.1'] = [ 80 ];

      t.deepEqual(helpers.zoneIPFconfigs(), expRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      remoteVMsOnDisk[rvm.uuid] = util_vm.createRemoteVM(rvm);

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule1.uuid] = clone(rule1);
      expRulesOnDisk[rule2.uuid] = clone(rule2);

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });
  }

  ], function () {
      t.done();
  });
};


exports['all vms to local VM'] = function (t) {
  var vm = helpers.generateVM();
  var rvm = helpers.generateVM();

  var ipfRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM all vms TO vm %s ALLOW tcp PORT 44',
          vm.uuid),
        enabled: true
      }
    ],
    vms: [vm]
  };

  var rule1 = clone(payload.rules[0]);

  if (printVMs) {
    console.log('vm=%s', vm.uuid);
    console.log('rvm=%s', rvm.uuid);
  }

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
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1]);

      ipfRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(ipfRules, vm.uuid, 'in', 'pass', 'tcp');
      ipfRules[vm.uuid]['in'].pass.tcp[vm.nics[0].ip] = [ 44 ];
      ipfRules[vm.uuid]['in'].pass.tcp[rvm.nics[0].ip] = [ 44 ];

      t.deepEqual(helpers.zoneIPFconfigs(), ipfRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      remoteVMsOnDisk[rvm.uuid] = util_vm.createRemoteVM(rvm);
      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule1.uuid] = rule1;
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });
  }, function (cb) {
    // Add another unrelated rule and make sure the first rule still gets
    // picked up
    var addPayload = {
      rules: [
        {
          rule: util.format('FROM ip 10.6.0.1 TO vm %s ALLOW tcp PORT 45',
            vm.uuid),
          enabled: true
        }
      ],
      vms: [vm]
    };
    var rule2 = clone(addPayload.rules[0]);

    fw.add(addPayload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule2]);

      ipfRules[vm.uuid]['in'].pass.tcp['10.6.0.1'] = [ 45 ];

      t.deepEqual(helpers.zoneIPFconfigs(), ipfRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      remoteVMsOnDisk[rvm.uuid] = util_vm.createRemoteVM(rvm);
      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule2.uuid] = rule2;
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });
  }

  ], function () {
      t.done();
  });
};


exports['owner_uuid filtering'] = function (t) {
  var ownerA = mod_uuid.v4();
  var ownerB = mod_uuid.v4();
  var vm = helpers.generateVM({ owner_uuid: ownerA, tags: { one: true } });
  var rvm1 = helpers.generateVM({ owner_uuid: ownerA, tags: { one: true } });
  var rvm2 = helpers.generateVM({ owner_uuid: ownerB, tags: { one: true } });

  var ipfRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    rules: [
      {
        rule: util.format('FROM tag one TO vm %s ALLOW tcp PORT 25',
                vm.uuid),
        owner_uuid: ownerA,
        enabled: true
      }
    ],
    vms: [vm]
  };

  var rule1 = clone(payload.rules[0]);

  if (printVMs) {
    console.log('vm=%s', vm.uuid);
    console.log('rvm1=%s', rvm1.uuid);
    console.log('rvm2=%s', rvm2.uuid);
  }

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
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, rule1);
      t.deepEqual(helpers.sortRes(res), {
        rules: [ rule1 ],
        vms: [ vm.uuid ]
      }, 'rules returned');

      ipfRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(ipfRules, vm.uuid, 'in', 'pass', 'tcp');
      ipfRules[vm.uuid]['in'].pass.tcp[vm.nics[0].ip] = [ 25 ];

      t.deepEqual(helpers.zoneIPFconfigs(), ipfRules,
        'firewall rules');

      vmsEnabled[vm.uuid] = true;

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'firewalls enabled');

      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      expRulesOnDisk[rule1.uuid] = clone(rule1);
      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    fw.validatePayload({ vms: [ vm ], remoteVMs: [ rvm1 ] },
      function (err, res) {
      t.ifError(err);
      return cb();
    });

  }, function (cb) {
    // Add rvm1
    fw.add({ vms: [ vm ], remoteVMs: [ rvm1 ] }, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      t.deepEqual(helpers.sortRes(res), {
        rules: [ ],
        vms: [ vm.uuid ]
      }, 'rules returned');

      ipfRules[vm.uuid]['in'].pass.tcp[rvm1.nics[0].ip] = [ 25 ];
      t.deepEqual(helpers.zoneIPFconfigs(), ipfRules, 'firewall rules');

      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'firewalls enabled');

      remoteVMsOnDisk[rvm1.uuid] = util_vm.createRemoteVM(rvm1);
      t.deepEqual(helpers.remoteVMsOnDisk(), remoteVMsOnDisk,
        'remote VMs on disk');

      t.deepEqual(helpers.rulesOnDisk(), expRulesOnDisk, 'rules on disk');

      return cb();
    });

  }, function (cb) {
    // Add rvm2 - since it has a different owner_uuid, no rules should change
    fw.add({ vms: [ vm ], remoteVMs: [ rvm2 ] }, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      t.deepEqual(helpers.sortRes(res), {
        rules: [ ],
        vms: [ ]
      }, 'rules returned');

      t.deepEqual(helpers.zoneIPFconfigs(), ipfRules, 'firewall rules');
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'firewalls enabled');

      remoteVMsOnDisk[rvm2.uuid] = util_vm.createRemoteVM(rvm2);
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


exports['remote VM with same UUID as local VM'] = function (t) {
  var vm = helpers.generateVM({ uuid: mod_uuid.v4() });
  var rvm = helpers.generateVM({ uuid: vm.uuid });

  var payload = {
    remoteVMs: [rvm],
    vms: [vm]
  };

  var errMsg = util.format(
      'Remote VM "%s" must not have the same UUID as a local VM', vm.uuid);

  async.series([
  function (cb) {
    fw.validatePayload(payload, function (err, res) {
      t.ok(err, 'Error returned');
      if (!err) {
        return cb();
      }

      t.equal(err.message, errMsg, 'Error message');
      return cb();
    });

  }, function (cb) {
    fw.add(payload, function (err, res) {
      t.ok(err, 'Error returned');
      if (!err) {
        return cb();
      }

      t.equal(err.message, errMsg, 'Error message');
      return cb();
    });

  }, function (cb) {
    fw.update(payload, function (err, res) {
      t.ok(err, 'Error returned');
      if (!err) {
        return cb();
      }

      t.equal(err.message, errMsg, 'Error message');
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
