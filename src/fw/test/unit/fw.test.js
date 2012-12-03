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



exports['add: no rules or VMs'] = function (t) {
  fw.add({}, function (err, res) {
    t.ok(err, 'error returned');
    t.equal(err.message, 'opts.vms ([object]) required', 'VMs required');
    t.done();
  });
};

exports['add / update: machine to IP: BLOCK'] = function (t) {
  var vm = helpers.generateVM();
  var payload = {
    rules: [
      {
        rule: util.format('FROM machine %s TO ip 10.99.99.254 BLOCK tcp '
                + 'port 8080', vm.uuid),
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
        return cb();
      }

      t.ok(res.rules[0].uuid, 'rule has a uuid');
      expRule.uuid = res.rules[0].uuid;
      delete res.rules[0].uuid;

      t.ok(res.rules[0].version, 'rule has a version');
      expRule.version = res.rules[0].version;
      delete res.rules[0].version;

      t.deepEqual(res, {
        vms: [ vm.uuid ],
        rules: [ payload.rules[0] ]
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
      var expRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(expRules, vm.uuid, 'out', 'block', 'tcp',
        {
          '10.99.99.254': [ 8080 ]
        });

      t.deepEqual(zoneRules, expRules, 'firewall rules correct');

      var vmsEnabled = {};
      vmsEnabled[vm.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

      cb();
    });

  }, function (cb) {
    helpers.fwGetEquals(fw, t, expRule, cb);

  }, function (cb) {
    helpers.fwListEquals(fw, t, [expRule], cb);

  }, function (cb) {
    var updatePayload = {
      rules: [
        {
          enabled: true,
          rule: util.format(
            'FROM machine %s TO (ip 10.99.99.254 OR ip 10.88.88.2) BLOCK tcp '
                  + 'port 8080', vm.uuid),
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

      t.ok(res.rules[0].uuid, 'rule has a uuid');
      t.equal(res.rules[0].uuid, expRule.uuid, 'uuid is the same');

      t.ok(res.rules[0].version, 'rule has a version');
      expRule.version = res.rules[0].version;
      delete res.rules[0].version;

      expRule.rule = res.rules[0].rule;

      t.deepEqual(res, {
        vms: [ vm.uuid ],
        rules: [ updatePayload.rules[0] ]
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
      var expRules = helpers.defaultZoneRules(vm.uuid);
      createSubObjects(expRules, vm.uuid, 'out', 'block', 'tcp',
        {
          '10.99.99.254': [ 8080 ],
          '10.88.88.2': [ 8080 ]
        });

      t.deepEqual(zoneRules, expRules, 'firewall rules correct');

      cb();
    });

  }, function (cb) {
    helpers.fwGetEquals(fw, t, expRule, cb);

  }, function (cb) {
    helpers.fwListEquals(fw, t, [expRule], cb);

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
        rules: [ expRule.uuid ]
      }, 'results returned');

      var zoneRules = helpers.getZoneRulesWritten();

      t.deepEqual(zoneRules, helpers.defaultZoneRules(vm.uuid),
        'only default firewall rules left in zone');

      var vmsEnabled = {};
      vmsEnabled[vm.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled,
        'ipf still enabled in VM');

      cb();
    });
  }

  ], function () {
      t.done();
  });
};


exports['add / update: machine to IP: ALLOW'] = function (t) {
  var vm = helpers.generateVM();
  var payload = {
    rules: [
      {
        rule: util.format('FROM machine %s TO ip 10.99.99.254 ALLOW tcp '
                + 'port 8080', vm.uuid),
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
        return cb();
      }

      helpers.fillInRuleBlanks(res.rules, expRule);

      t.deepEqual(res, {
        rules: [ expRule ],
        vms: [ vm.uuid ]
      }, 'rules returned');

      var expRules = helpers.defaultZoneRules(vm.uuid);
      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules correct');

      var vmsEnabled = {};
      vmsEnabled[vm.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

      cb();
    });

  }, function (cb) {
    helpers.fwGetEquals(fw, t, expRule, cb);

  }, function (cb) {
    helpers.fwListEquals(fw, t, [expRule], cb);
  }

  ], function () {
      t.done();
  });
};


exports['add: tag to IP'] = function (t) {
  var vm1 = helpers.generateVM({ tags: { foo : true } });
  var vm2 = helpers.generateVM({ tags: { foo : true } });
  var payload = {
    rules: [
      {
        rule: 'FROM tag foo TO ip 10.99.99.254 BLOCK tcp port 25',
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
        return cb();
      }

      t.ok(res.rules[0].uuid, 'rule has a uuid');
      expRule.uuid = res.rules[0].uuid;
      delete res.rules[0].uuid;

      t.ok(res.rules[0].version, 'rule has a version');
      expRule.version = res.rules[0].version;
      delete res.rules[0].version;

      t.deepEqual(res, {
        vms: [ vm1.uuid, vm2.uuid ],
        rules: [ payload.rules[0] ]
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
      var expRules = helpers.defaultZoneRules(vm1.uuid);
      createSubObjects(expRules, vm1.uuid, 'out', 'block', 'tcp',
        {
          '10.99.99.254': [ 25 ]
        });
      expRules[vm2.uuid] = expRules[vm1.uuid];

      t.deepEqual(zoneRules, expRules, 'firewall rules correct');

      var vmsEnabled = {};
      vmsEnabled[vm1.uuid] = true;
      vmsEnabled[vm2.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

      cb();
    });

  }, function (cb) {
    fw.get({ uuid: expRule.uuid }, function (err, res) {
      t.ifError(err);
      t.deepEqual(res, expRule, 'get returns same rule');
      cb();
    });

  }, function (cb) {
    helpers.fwListEquals(fw, t, [expRule], cb);
  }
  ], function () {
      t.done();
  });
};


exports['add: tag to subnet'] = function (t) {
  var vm1 = helpers.generateVM({ tags: { foo : true } });
  var vm2 = helpers.generateVM({ tags: { foo : true } });
  var payload = {
    rules: [
      {
        rule: 'FROM tag foo TO subnet 10.99.99.0/24 BLOCK tcp port 25',
        enabled: true
      },
      {
        rule: 'FROM subnet 10.99.99.0/24 TO tag foo ALLOW tcp port 80',
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
      return cb();
    });

  }, function (cb) {
    fw.add(payload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

      t.deepEqual(helpers.sortRes(res), {
        vms: [ vm1.uuid, vm2.uuid ].sort(),
        rules: [ rule1, rule2 ].sort(helpers.uuidSort)
      }, 'rules returned');

      var expRules = helpers.defaultZoneRules(vm1.uuid);
      createSubObjects(expRules, vm1.uuid, 'out', 'block', 'tcp',
        {
          '10.99.99.0/24': [ 25 ]
        });
      createSubObjects(expRules, vm1.uuid, 'in', 'pass', 'tcp',
        {
          '10.99.99.0/24': [ 80 ]
        });
      expRules[vm2.uuid] = expRules[vm1.uuid];

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules correct');

      var vmsEnabled = {};
      vmsEnabled[vm1.uuid] = true;
      vmsEnabled[vm2.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

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
    helpers.fwListEquals(fw, t, [rule1, rule2].sort(helpers.uuidSort), cb);
  }
  ], function () {
      t.done();
  });
};


exports['add: machine to subnet'] = function (t) {
  var vm1 = helpers.generateVM({ tags: { foo : true } });
  // Not the target of the rule:
  var vm2 = helpers.generateVM({ tags: { foo : true } });
  var payload = {
    rules: [
      {
        rule: util.format(
          'FROM machine %s TO subnet 10.99.99.0/24 BLOCK tcp port 25',
          vm1.uuid),
        enabled: true
      },
      {
        rule: util.format(
          'FROM subnet 10.99.99.0/24 TO machine %s ALLOW tcp port 80',
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
      return cb();
    });

  }, function (cb) {
    fw.add(payload, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb(err);
      }

      helpers.fillInRuleBlanks(res.rules, [rule1, rule2]);

      t.deepEqual(helpers.sortRes(res), {
        vms: [ vm1.uuid ],
        rules: [ rule1, rule2 ].sort(helpers.uuidSort)
      }, 'rules returned');

      var expRules = helpers.defaultZoneRules(vm1.uuid);
      createSubObjects(expRules, vm1.uuid, 'out', 'block', 'tcp',
        {
          '10.99.99.0/24': [ 25 ]
        });
      createSubObjects(expRules, vm1.uuid, 'in', 'pass', 'tcp',
        {
          '10.99.99.0/24': [ 80 ]
        });

      t.deepEqual(helpers.getZoneRulesWritten(), expRules,
        'firewall rules correct');

      var vmsEnabled = {};
      vmsEnabled[vm1.uuid] = true;
      t.deepEqual(helpers.getIPFenabled(), vmsEnabled, 'ipf enabled in VMs');

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
    helpers.fwListEquals(fw, t, [rule1, rule2].sort(helpers.uuidSort), cb);
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
