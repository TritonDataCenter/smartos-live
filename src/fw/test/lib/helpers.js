/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * mocks for tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var fwrule = require('fwrule');
var mod_obj = require('../../lib/util/obj');
var mocks = require('./mocks');
var mod_uuid = require('node-uuid');
var util = require('util');

var createSubObjects = mod_obj.createSubObjects;


// --- Globals



var DEBUG_FILES = process.env.PRINT_IPF_CONFS;
var IP_NUM = 2;
var SYN_LINE = 'pass out quick proto tcp from any to any flags S/SA keep state';


// --- Internal functions



// stolen from node-jsprim
function startsWith(str, prefix)
{
  return (str.substr(0, prefix.length) == prefix);
}


// stolen from node-jsprim
function endsWith(str, suffix)
{
  return (str.substr(str.length - suffix.length, suffix.length) == suffix);
}



// --- Exports



/**
 * Returns the default rule set for a zone
 */
function defaultZoneRules(uuids) {
  var toReturn = {};
  if (!uuids) {
    createSubObjects(toReturn, 'out', 'pass', { any: 'any' });
    createSubObjects(toReturn, 'in', 'block', { any: 'any' });
    return toReturn;
  }

  if (typeof (uuids) !== 'object') {
    uuids = [ uuids ];
  }

  uuids.forEach(function (uuid) {
    createSubObjects(toReturn, uuid, 'out', 'pass', { any: 'any' });
    createSubObjects(toReturn, uuid, 'in', 'block', { any: 'any' });
  });

  return toReturn;
}


/**
 * Using the rules in res, fill in the blank fields for rules in incomplete
 */
function fillInRuleBlanks(res, incomplete) {
  var toFill = incomplete;
  if (!mod_obj.isArray(incomplete)) {
    toFill = [incomplete];
  }

  toFill.forEach(function (rule) {
    var match = findRuleInList(rule, res);
    if (!match) {
      return;
    }

    for (var p in match) {
      if (!rule.hasOwnProperty(p)) {
        rule[p] = match[p];
      }
    }
  });
}

/**
 * Finds a rule in the list by rule text
 */
function findRuleInList(findRule, list) {
  var findRuleObj = fwrule.create(findRule);

  for (var r in list) {
    var ruleObj = fwrule.create(list[r]);
    if (findRuleObj.text() == ruleObj.text()) {
      return list[r];
    }
  }

  return null;
}


/**
 * Does a fw.get() for rule and a deepEqual to confirm the retrieved
 * rule is the same
 */
function fwGetEquals(t, rule, callback) {
  return mocks.fw.get({ uuid: rule.uuid }, function (err, res) {
    t.ifError(err);
    t.deepEqual(res, rule, 'get returned the same rule');
    return callback();
  });
}


/**
 * Does a fw.list() for rules and a deepEqual to confirm the retrieved
 * list is the same
 */
function fwListEquals(t, rules, callback) {
  mocks.fw.list({ }, function (err, res) {
    t.ifError(err);

    // clone the input rules in case order is important to the caller:
    t.deepEqual(res.sort(uuidSort), clone(rules).sort(uuidSort),
      'rule list is equal');
    return callback();
  });
}


/**
 * Does a fw.rules() for a VM and a deepEqual to confirm the retrieved
 * list is the same
 */
function fwRulesEqual(opts, callback) {
  assert.object(opts, 'opts');
  assert.arrayOfObject(opts.rules, 'opts.rules');
  assert.object(opts.t, 'opts.t');
  assert.object(opts.vm, 'opts.vm');
  assert.arrayOfObject(opts.vms, 'opts.vms');

  mocks.fw.rules({ vm: opts.vm.uuid, vms: opts.vms }, function (err, res) {
    opts.t.ifError(err);
    if (err) {
      return callback();
    }

    // clone the input rules in case order is important to the caller:
    opts.t.deepEqual(res.sort(uuidSort), clone(opts.rules).sort(uuidSort),
      'fw.rules() correct for ' + opts.vm.uuid);

    return callback();
  });
}


function testEnableDisable(opts, callback) {
  assert.object(opts, 'opts');
  assert.object(opts.t, 'opts.t');
  assert.object(opts.vm, 'opts.vm');
  assert.arrayOfObject(opts.vms, 'opts.vms');

  var vmsEnabled;
  var rvmsBefore = remoteVMsOnDisk();
  var rulesBefore = rulesOnDisk();
  var t = opts.t;
  var zoneRules = zoneIPFconfigs();

  mocks.fw.disable({ vm: opts.vm }, function (err, res) {
    t.ifError(err);
    if (err) {
      return callback(err);
    }

    // Disabling the firewall should have moved ipf.conf:
    t.deepEqual(zoneIPFconfigs()[opts.vm.uuid], undefined,
      'no firewall rules after disable');

    vmsEnabled = getIPFenabled();
    t.deepEqual(vmsEnabled[opts.vm.uuid], false, 'firewall not enabled');

    mocks.fw.enable({ vm: opts.vm, vms: opts.vms }, function (err2, res2) {
      t.ifError(err2);
      if (err2) {
        return callback(err2);
      }

      t.deepEqual(zoneIPFconfigs(), zoneRules,
        'firewall rules the same after enable');

      vmsEnabled = getIPFenabled();
      t.deepEqual(vmsEnabled[opts.vm.uuid], true, 'firewall enabled');

      t.deepEqual(remoteVMsOnDisk(), rvmsBefore,
        'remote VMs on disk the same');

      t.deepEqual(rulesOnDisk(), rulesBefore, 'rules on disk the same');

      return callback();
    });
  });
}


/**
 * Returns the ipf.conf data for all zones from the mock fs module as a
 * an object keyed by zone UUID
 */
function zoneIPFconfigs() {
  var root = mocks.values.fs;
  var firewalls = {};

  for (var dir in root) {
    if (!startsWith(dir, '/zones') || !endsWith(dir, '/config')) {
      continue;
    }
    if (!root[dir].hasOwnProperty('ipf.conf')) {
      continue;
    }

    if (DEBUG_FILES) {
      console.log('%s:\n+-', dir);
    }
    root[dir]['ipf.conf'].split('\n').forEach(function (l) {
      if (DEBUG_FILES) {
        console.log('| ' + l);
      }

      if (startsWith(l, '#') || l === '') {
        return;
      }

      // block out quick proto tcp from any to 10.99.99.254 port = 3000
      // pass in quick proto tcp from 10.2.0.1 to any port = 80
      var zone = dir.split('/')[2];
      var tok = l.split(' ');
      var action = tok[0];
      var d = tok[1];

      if (l === 'block in all'
        || l === SYN_LINE
        || l === 'pass out quick proto icmp from any to any keep state'
        || l === 'pass out proto icmp from any to any'
        || /^pass out proto \w+ from any to any/.test(l)) {
        var act = createSubObjects(firewalls, zone, d, action);
        act.any = 'any';
        return;
      }

      var proto = tok[4];
      var dest = action === 'block' ? tok[8] : tok[6];
      var port;
      if (proto === 'icmp') {
        /* JSSTYLED */
        port = l.match(/icmp-type (\d+)/)[1];
        /* JSSTYLED */
        var code = l.match(/code (\d+)/);
        if (code) {
          port = port + ':' + code[1];
        }
      } else {
        var portMatch = l.match(/port = (\d+)/);
        if (portMatch) {
          port = portMatch[1];
        } else {
          port = 'all';
        }
      }

      // block out quick proto tcp to any port = 8080
      if (tok[6] === 'any' && tok.length < 12) {
        dest = 'any';
      }

      // console.log('%s > %s %s %s %s %s', zone, action, d, proto, dest, port);

      var dests = createSubObjects(firewalls, zone, d, action, proto);
      if (!dests.hasOwnProperty(dest)) {
        dests[dest] = [];
      }

      if (dests[dest].indexOf(port) == -1) {
        dests[dest] = dests[dest].concat([port]).sort(function (a, b) {
          return (a - b); });
      }
    });

    if (DEBUG_FILES) {
      console.log('+-');
    }
  }

  return firewalls;
}


/**
 * Extracts the firewall data from the mock fs module and presents it in
 * a hash
 */
function getIPFenabled() {
  var ipfZones = mocks.values.ipf;
  var res = {};
  for (var z in ipfZones) {
    res[z] = ipfZones[z].enabled || false;
  }
  return res;
}


/**
 * Returns an easily identifiable UUID based on the number
 */
function uuidNum(num) {
  return '00000000-0000-0000-0000-0000000000'
    + (Number(num) < 9 ? '0' + num : num);
}


/**
 * Returns a fake VM object, overriding defaults with the values in override.
 * To unset a value, set its value in override to null.
 */
function generateVM(override) {
  var uuid = mod_uuid.v4();
  var vm = {
    firewall_enabled: true,
    nics: [
      {
        ip: util.format('10.88.88.%d', IP_NUM++)
      }
    ],
    owner_uuid: '00000000-0000-0000-0000-000000000000',
    state: 'running',
    tags: {},
    uuid: uuid
  };

  if (override) {
    for (var o in override) {
      if (override[o] === null) {
        delete vm[o];
      } else {
        vm[o] = override[o];
      }
    }
  }

  if (!vm.hasOwnProperty('zonepath')) {
    vm.zonepath = util.format('/zones/%s', vm.uuid);
  }

  return vm;
}


/**
 * Gets the remote VM files stored on disk in /var/fw/vms
 */
function remoteVMsOnDisk(fw) {
  var onDisk = {};
  var dir = mocks.values.fs['/var/fw/vms'];
  if (!dir) {
    return {};
  }

  for (var f in dir) {
    if (!endsWith(f, '.json')) {
      continue;
    }
    onDisk[f.replace('.json', '')] = JSON.parse(dir[f]);
  }

  return onDisk;
}


/**
 * Gets the firewall rule files stored on disk in /var/fw/rules
 */
function rulesOnDisk(fw) {
  var onDisk = {};
  var dir = mocks.values.fs['/var/fw/rules'];
  if (!dir) {
    return {};
  }

  for (var f in dir) {
    if (!endsWith(f, '.json')) {
      continue;
    }
    onDisk[f.replace('.json', '')] = JSON.parse(dir[f]);
  }

  return onDisk;
}


/**
 * Sort the various fields of a fw.js results object
 */
function sortRes(res) {
  if (res.hasOwnProperty('vms')) {
    res.vms.sort();
  }

  if (res.hasOwnProperty('rules')) {
    res.rules.sort(uuidSort);
  }

  return res;
}


/**
 * Sort by rule UUID
 */
function uuidSort(a, b) {
  return (a.uuid > b.uuid) ? 1 : -1;
}



module.exports = {
  defaultZoneRules: defaultZoneRules,
  fillInRuleBlanks: fillInRuleBlanks,
  findRuleInList: findRuleInList,
  fwGetEquals: fwGetEquals,
  fwListEquals: fwListEquals,
  fwRulesEqual: fwRulesEqual,
  getIPFenabled: getIPFenabled,
  generateVM: generateVM,
  remoteVMsOnDisk: remoteVMsOnDisk,
  rulesOnDisk: rulesOnDisk,
  sortRes: sortRes,
  testEnableDisable: testEnableDisable,
  uuidNum: uuidNum,
  uuidSort: uuidSort,
  zoneIPFconfigs: zoneIPFconfigs
};
