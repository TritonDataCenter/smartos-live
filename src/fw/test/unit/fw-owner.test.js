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

var createSubObjects = mod_obj.createSubObjects;



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
  mocks.reset();
  cb();
};



// --- Tests



exports['tag to IP (filter by owner_uuid)'] = function (t) {
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
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
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
          enabled: true
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
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
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
          owner_uuid: owner
        }
      ],
      vms: [vm1, vm2]
    };
    expRule2.owner_uuid = owner;

    fw.update(payload3, function (err, res) {
      t.ifError(err);
      if (err) {
        return cb();
      }

      t.deepEqual(res, {
        // both VMs were affected: vm1 has the default rule set written out,
        // and vm2 has the default plus rule 2
        vms: [ vm2.uuid, vm1.uuid ],
        rules: [ expRule2 ]
      }, 'rules returned');

      var zoneRules = helpers.getZoneRulesWritten();
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

      var zoneRules = helpers.getZoneRulesWritten();
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



// TODO:
// - test remote VMs with an owner_uuid
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
