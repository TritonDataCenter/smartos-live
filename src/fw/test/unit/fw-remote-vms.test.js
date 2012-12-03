/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
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
  var rvm = helpers.generateVM();

  var expRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM machine %s TO machine %s ALLOW tcp PORT 80',
                vm.uuid, rvm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM machine %s TO machine %s ALLOW tcp PORT 80',
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
      rule: util.format('FROM machine %s TO machine %s ALLOW udp PORT 161',
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
        rule: util.format('FROM machine %s TO tag other ALLOW tcp PORT 80',
                vm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM tag other TO machine %s ALLOW tcp PORT 80',
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
      rule: util.format('FROM machine %s TO machine %s ALLOW udp PORT 161',
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
  var vm = helpers.generateVM();
  var rvm = helpers.generateVM();

  var expRules;
  var expRulesOnDisk = {};
  var remoteVMsOnDisk = {};
  var vmsEnabled = {};

  var payload = {
    remoteVMs: [rvm],
    rules: [
      {
        rule: util.format('FROM (machine %s OR machine %s) TO ip 10.0.0.1 '
          + 'ALLOW tcp PORT 80', vm.uuid, rvm.uuid),
        enabled: true
      },
      {
        rule: util.format('FROM ip 10.0.0.1 TO (machine %s OR machine %s) '
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

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
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
