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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: Main entry points
 */

var assert = require('assert-plus');
var clone = require('clone');
var fs = require('fs');
var log = require('./util/log');
var mkdirp = require('mkdirp');
var mod_ipf = require('./ipf');
var mod_obj = require('./util/obj');
var mod_rule = require('fwrule');
var pipeline = require('./pipeline').pipeline;
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var util_vm = require('./util/vm');
var vasync = require('vasync');
var verror = require('verror');

var createSubObjects = mod_obj.createSubObjects;
var forEachKey = mod_obj.forEachKey;
var objEmpty = mod_obj.objEmpty;
var mergeObjects = mod_obj.mergeObjects;



// --- Globals



var DIRECTIONS = ['from', 'to'];
var LOG;
var RULE_PATH = '/var/fw/rules';
var VM_PATH = '/var/fw/vms';
var IPF_CONF = '%s/config/ipf.conf';
var IPF_CONF_OLD = '%s/config/ipf.conf.old';



// --- Internal helper functions



/**
 * Initialize the fw.js logger. This is intended to be called at every API
 * entry point.
 */
function logEntry(opts, action) {
  LOG = log.entry(opts, action);
}


/**
 * Creates a MultiError from an array of errors, or if there's only one in the
 * list, just returns that error.
 */
function createMultiError(errs) {
  if (errs.length == 1) {
    return errs[0];
  }

  var details = [];
  var err = new verror.MultiError(errs);

  errs.forEach(function (e) {
    if (e.hasOwnProperty('details')) {
      details.push(e.details);
    }
  });

  if (details.length !== 0) {
    err.details = details;
  }

  return err;
}


/**
 * Adds to a 3-level deep object
 */
function addToHash3(hash, key1, key2, key3, obj) {
  if (!hash.hasOwnProperty(key1)) {
    hash[key1] = {};
  }
  if (!hash[key1].hasOwnProperty(key2)) {
    hash[key1][key2] = {};
  }
  if (!hash[key1][key2].hasOwnProperty(key3)) {
    hash[key1][key2][key3] = obj;
  }
}


/**
 * For a rule and a direction, return whether or not we actually need to
 * write ipf rules. FROM+ALLOW and TO+BLOCK are essentially no-ops, as
 * they will be caught by the block / allow catch-all default rules.
 */
function noRulesNeeded(dir, rule) {
  if ((dir === 'from' && rule.action === 'allow')
      || (dir === 'to' && rule.action === 'block')) {
    return true;
  }
  return false;
}


/**
 * For each rule in rules, call cb for each target present in the rule,
 * passing the rule, target type and target itself.
 *
 * @param rules {Array} : rule objects to process
 * @param types {Array} : (optional)
 */
function ruleTypeWalk(rules, types, cb) {
  if (typeof (types) === 'function') {
    cb = types;
    types = ['ips', 'tags', 'vms'];
  }

  rules.forEach(function (rule) {
    types.forEach(function (type) {
      rule[type].forEach(function (t) {
        cb(rule, type, t);
      });
    });
  });
}


/**
 * For each rule in rules, call cb for each target present in the rule,
 * passing the rule, direction, target type and target itself.
 *
 * @param rules {Array} : rule objects to process
 */
function ruleTypeDirWalk(rules, cb) {
  rules.forEach(function (rule) {
    DIRECTIONS.forEach(function (dir) {
      ['ips', 'tags', 'vms'].forEach(function (type) {
        if (rule[dir].hasOwnProperty(type)) {
          rule[dir][type].forEach(function (t) {
            cb(rule, dir, type, t);
          });
        }
      });
    });
  });
}


/**
 * Returns a list of rules with duplicates removed. Rules in list1 will
 * override rules in list2
 */
function dedupRules(list1, list2) {
  var seenUUIDs = {};
  var toReturn = [];

  list1.concat(list2).forEach(function (r) {
    if (r.hasOwnProperty('uuid') && !seenUUIDs.hasOwnProperty(r.uuid)) {
      toReturn.push(r);
      seenUUIDs[r.uuid] = 1;
    }
  });

  return toReturn;
}


/**
 * Starts ipf and reloads the rules for a VM
 */
function startIPF(opts, callback) {
  var ipfConf = util.format(IPF_CONF, opts.zonepath);

  return mod_ipf.start(opts.vm, LOG, function (err) {
    if (err) {
      return callback(err);
    }
    return mod_ipf.reload(opts.vm, ipfConf, LOG, callback);
  });
}



// --- Internal functions



/**
 * Validates the payload passed to the exported functions. Throws an error
 * if not in the right format
 */
function validateOpts(opts) {
  assert.object(opts, 'opts');
  assert.arrayOfObject(opts.vms, 'opts.vms');
}


/**
 * Create rule objects from the rules
 *
 * @param {Array} inRules : raw rule input objects to create
 * @param {Function} callback : of the form f(err, newRules)
 */
function createRules(inRules, callback) {
  var errors = [];
  var rules = [];
  var ver = mod_rule.generateVersion();

  if (!inRules || inRules.length === 0) {
    return callback(null, []);
  }

  inRules.forEach(function (payloadRule) {
    var rule = clone(payloadRule);
    if (!rule.hasOwnProperty('version')) {
      rule.version = ver;
    }

    try {
      var r = mod_rule.create(rule);
      rules.push(r);
    } catch (err) {
      errors.push(err);
    }
  });

  if (errors.length !== 0) {
    return callback(createMultiError(errors));
  }

  return callback(null, rules);
}


/**
 * Merge updates from the rules in payload, and return the updated
 * rule objects
 */
function createUpdatedRules(rules, payload, callback) {
  LOG.trace('createUpdatedRules: entry');
  if (!payload.rules || payload.rules.length === 0) {
    return callback(null, []);
  }

  var updates = {};

  payload.rules.forEach(function (r) {
    updates[r.uuid] = r;
  });

  LOG.debug({payloadRules: updates, rules: rules },
    'createUpdatedRules: merging rules');

  var updatedRules = rules.map(function (rule) {
    return mergeObjects(updates[rule.uuid], rule.serialize());
  });

  LOG.debug(updatedRules, 'createUpdatedRules: rules merged');
  return createRules(updatedRules, callback);
}


/**
 * Turns a list of VMs from VM.js into a lookup table, keyed by the various
 * properties we'd like to filter VMs by (tags, ips, and vms),
 * like so:
 *   {
 *     all: { uuid1: <vm 1> }
 *     tags: { tag2: <vm 2> }
 *     vms: { uuid1: <vm 1> }
 *     ips: { 10.0.0.1: <vm 3> }
 *     ips: { 10.0.0.1: <vm 3> }
 *   }
 */
function createVMlookup(vms, callback) {
  LOG.trace('createVMlookup: entry');

  var vmStore = {
    all: {},
    ips: {},
    vms: {},
    subnets: {},
    tags: {}
  };

  vms.forEach(function (fullVM) {
    var vm = {
      enabled: fullVM.firewall_enabled || false,
      ips: fullVM.nics.map(function (n) { return (n.ip); }).filter(
        function (i) { return (i !== 'dhcp'); }),
      owner_uuid: fullVM.owner_uuid,
      state: fullVM.state,
      tags: Object.keys(fullVM.tags),
      uuid: fullVM.uuid,
      zonepath: fullVM.zonepath
    };
    LOG.trace(vm, 'Adding VM "%s" to lookup', vm.uuid);

    vmStore.all[vm.uuid] = vm;
    addToHash3(vmStore, 'vms', vm.uuid, vm.uuid, vm);

    vm.tags.forEach(function (tag) {
      addToHash3(vmStore, 'tags', tag, vm.uuid, vm);
    });
    vm.ips.forEach(function (ip) {
      addToHash3(vmStore, 'ips', ip, vm.uuid, vm);
    });
    // XXX: subnet
  });

  if (LOG.debug()) {
    var truncated = { };
    ['vms', 'tags', 'ips'].forEach(function (type) {
      truncated[type] = {};
      if (!vmStore.hasOwnProperty(type)) {
        return;
      }

      Object.keys(vmStore[type]).forEach(function (t) {
        truncated[type][t] = Object.keys(vmStore[type][t]);
      });
    });

    LOG.debug(truncated, 'vmStore');
  }

  return callback(null, vmStore);
}


/**
 * Create a lookup table for remote VMs
 */
function createRemoteVMlookup(remoteVMs, callback) {
  LOG.trace('createRemoteVMlookup: entry');

  var remoteVMlookup = {
    ips: {},
    vms: {},
    subnets: {},
    tags: {}
  };

  if (!remoteVMs || objEmpty(remoteVMs)) {
    return callback(null, remoteVMlookup);
  }

  var rvmList = remoteVMs;
  if (!mod_obj.isArray(rvmList)) {
    rvmList = [ remoteVMs ];
  }

  rvmList.forEach(function (rvmObj) {
    forEachKey(rvmObj, function (uuid, rvm) {
      // Make vms match the layout of tags, eg: tags[key][uuid] = { obj }
      remoteVMlookup.vms[uuid] = {};
      remoteVMlookup.vms[uuid][uuid] = rvm;

      if (rvm.hasOwnProperty('tags')) {
        for (var t in rvm.tags) {
          createSubObjects(remoteVMlookup.tags, t, uuid, rvm);
        }
      }
    });
  });

  return callback(null, remoteVMlookup);
}


/**
 * Load a single rule from disk, returning a rule object
 *
 * @param {String} file : file to load the rule from
 * @param {Function} callback : of the form f(err, rule)
 * - Where vm is a rule object
 */
function loadRule(file, callback) {
  LOG.debug('loadRule: loading rule file "%s"', file);
  return fs.readFile(file, function (err, raw) {
    if (err) {
      return callback(err);
    }
    var rule;

    try {
      var parsed = JSON.parse(raw);
      LOG.trace(parsed, 'loadRule: loaded rule file "%s"', file);
      // XXX: validate that the rule has a uuid
      rule = mod_rule.create(parsed);
    } catch (err2) {
      LOG.error(err2, 'loadRule: error creating rule');
      return callback(err2);
    }

    if (LOG.trace()) {
      LOG.trace(rule.toString(), 'loadRule: created rule');
    }

    return callback(null, rule);
  });
}


/**
 * Loads all rules from disk
 */
function loadAllRules(callback) {
  var rules = [];

  fs.readdir(RULE_PATH, function (err, files) {
    if (err) {
      if (err.code === 'ENOENT') {
        return callback(null, []);
      }
      return callback(err);
    }

    return vasync.forEachParallel({
      inputs: files,
      func: function (file, cb) {
        if (file.indexOf('.json', file.length - 5) === -1) {
          return cb(null);
        }

        var rpath = util.format('%s/%s', RULE_PATH, file);
        return loadRule(rpath, function (err2, rule) {
          if (rule) {
            rules.push(rule);
          }
          return cb(err2);
        });
      }
    }, function (err3, res) {
      if (err3) {
        LOG.error(err3, 'loadAllRules: return');
        return callback(err3);
      }

      LOG.debug({ fullRules: rules }, 'loadAllRules: return');
      return callback(null, rules);
    });
  });
}


/*
 * Saves rules to disk
 *
 * @param {Array} rules : rule objects to save
 * @param {Function} callback : of the form f(err)
 */
function saveRules(rules, callback) {
  var uuids = [];
  var versions = {};
  LOG.debug({ rules: rules }, 'saveRules: entry');

  return vasync.pipeline({
    funcs: [
      function _mkdir(_, cb) { mkdirp(RULE_PATH, cb); },
      function _writeRules(_, cb) {
        return vasync.forEachParallel({
          inputs: rules,
          func: function _writeRule(rule, cb2) {
            var ser = rule.serialize();
            // XXX: allow overriding version in the payload
            var filename = util.format('%s/%s.json.%s', RULE_PATH,
              rule.uuid, rule.version);
            LOG.trace(ser, 'writing "%s"', filename);

            return fs.writeFile(filename, JSON.stringify(ser, null, 2),
              function (err) {
              if (err) {
                return cb2(err);
              }
              uuids.push(rule.uuid);
              versions[rule.uuid] = rule.version;

              return cb2(null);
            });
          }
        // XXX: if there are failures here, we want to delete these files
        }, cb);
      },
      function _renameRules(_, cb) {
        return vasync.forEachParallel({
          inputs: uuids,
          func: function _renameRule(uuid, cb2) {
            var before = util.format('%s/%s.json.%s', RULE_PATH, uuid,
              versions[uuid]);
            var after = util.format('%s/%s.json', RULE_PATH, uuid);
            LOG.trace('renaming "%s" to "%s"', before, after);
            fs.rename(before, after, cb2);
          }
        }, cb);
      }
    ]}, callback);
}


/*
 * Deletes rules on disk
 *
 * @param {Array} rules : rule objects to delete
 * @param {Function} callback : of the form f(err)
 */
function deleteRules(rules, callback) {
  LOG.debug({ rules: rules }, 'deleteRules: entry');

  return vasync.forEachParallel({
    inputs: rules.map(function (r) { return r.uuid; }),
    func: function _delRule(uuid, cb) {
      var filename = util.format('%s/%s.json', RULE_PATH, uuid);
      LOG.trace('deleting "%s"', filename);

      fs.unlink(filename, function (err) {
        if (err && err.code == 'ENOENT') {
          return cb();
        }

        return cb(err);
      });
    }
  }, callback);
}


/**
 * Load a single remote VM from disk, returning the object
 *
 * @param {String} file : file to load the remote VM from
 * @param {Function} callback : of the form f(err, vm)
 * - Where vm is a remote VM object
 */
function loadRemoteVM(file, callback) {
  LOG.trace('loadRemoteVM: loading file "%s"', file);

  return fs.readFile(file, function (err, raw) {
    if (err) {
      return callback(err);
    }
    var parsed;

    try {
      parsed = JSON.parse(raw);
      LOG.trace(parsed, 'loadRemoteVM: loaded rule file "%s"', file);
      // XXX: validate that the VM has a uuid
    } catch (err2) {
      LOG.error(err2, 'loadRemoteVM: error parsing VM file "%s"', file);
      return callback(err2);
    }

    if (LOG.trace()) {
      LOG.trace(parsed, 'loadRemoteVM: created rule');
    }

    return callback(null, parsed);
  });
}


/**
 * Loads all remote VMs from disk
 *
 * @param {Function} callback : of the form f(err, vms)
 * - Where vms is an object containing the remote VMs, keyed by UUID
 */
function loadAllRemoteVMs(callback) {
  var vms = {};

  fs.readdir(VM_PATH, function (err, files) {
    if (err) {
      if (err.code === 'ENOENT') {
        return callback(null, {});
      }
      return callback(err);
    }

    return vasync.forEachParallel({
      inputs: files,
      func: function (file, cb) {
        if (file.indexOf('.json', file.length - 5) === -1) {
          return cb(null);
        }
        var uuid = file.split('.')[0];

        var path = util.format('%s/%s', VM_PATH, file);
        return loadRemoteVM(path, function (err2, rvm) {
          if (rvm) {
            vms[uuid] = rvm;
          }
          return cb(err2);
        });
      }
    }, function (err3, res) {
      return callback(err3, vms);
    });
  });
}


/*
 * Saves remote VMs to disk
 *
 * @param {Object} vms : remote VM objects to save, keyed by UUID
 * @param {Function} callback : of the form f(err)
 */
function saveRemoteVMs(vms, callback) {
  LOG.trace('saveRemoteVMs: entry');

  if (!vms || objEmpty(vms)) {
    return callback();
  }

  var uuids = [];
  // XXX: allow overriding version in the payload
  var versions = {};
  var ver = mod_rule.generateVersion();

  return vasync.pipeline({
    funcs: [
      function _mkdir(_, cb) { mkdirp(VM_PATH, cb); },
      function _writeVMs(_, cb) {
        return vasync.forEachParallel({
          inputs: Object.keys(vms),
          func: function _writeVM(uuid, cb2) {
            var vm = vms[uuid];
            var filename = util.format('%s/%s.json.%s', VM_PATH, uuid, ver);
            LOG.trace(vm, 'writing "%s"', filename);

            return fs.writeFile(filename, JSON.stringify(vm, null, 2),
              function (err) {
              if (err) {
                return cb2(err);
              }

              uuids.push(uuid);
              versions[uuid] = ver;

              return cb2(null);
            });
          }
        // XXX: if there are failures here, we want to delete these files
        }, cb);
      },
      function _renameRules(_, cb) {
        return vasync.forEachParallel({
          inputs: uuids,
          func: function _renameRule(uuid, cb2) {
            var before = util.format('%s/%s.json.%s', VM_PATH, uuid,
              versions[uuid]);
            var after = util.format('%s/%s.json', VM_PATH, uuid);
            LOG.trace('renaming "%s" to "%s"', before, after);
            fs.rename(before, after, cb2);
          }
        }, cb);
      }
    ]}, callback);
}


/**
 * Loads rules and remote VMs from disk
 */
function loadDataFromDisk(callback) {
  var onDisk = {};

  vasync.parallel({
    funcs: [
      function _diskRules(cb) {
        loadAllRules(function (err, res) {
          if (res) {
            onDisk.rules = res;
          }

          return cb(err);
        });
      },

      function _diskRemoteVMs(cb) {
        loadAllRemoteVMs(function (err, res) {
          if (res) {
            onDisk.remoteVMs = res;
          }

          return cb(err);
        });
      }
    ]
  }, function (err) {
    if (err) {
      return callback(err);
    }

    return callback(null, onDisk);
  });
}


/**
 * Finds rules in the list, returning an error if they can't be found
 */
function findRules(allRules, rules, callback) {
  LOG.trace('findRules: entry');

  if (!rules || rules.length === 0) {
    return callback(null, []);
  }

  var errs = [];
  var found = [];
  var uuids = {};
  rules.forEach(function (r) {
    if (!r.hasOwnProperty('uuid')) {
      errs.push(new verror.VError('Missing UUID of rule: %j', r));
      return;
    }
    uuids[r.uuid] = 1;
  });
  LOG.debug(uuids, 'findRules: rules');

  allRules.forEach(function (r) {
    if (!r.hasOwnProperty('uuid')) {
      errs.push(new verror.VError('Missing UUID of rule: %j', r));
    }

    if (uuids.hasOwnProperty(r.uuid)) {
      delete uuids[r.uuid];
      found.push(r);
    }
  });

  if (!objEmpty(uuids)) {
    Object.keys(uuids).forEach(function (uuid) {
      errs.push(new verror.VError('Unknown rule: %s', uuid));
    });
  }

  if (LOG.debug()) {
    LOG.debug({ rules: found, missing: Object.keys(uuids) },
      'findRules: return');
  }

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

  return callback(null, found);
}


/**
 * Returns an object of the VMs the given rules apply to
 *
 * @param vms {Object}: VM lookup table, as returned by createVMlookup()
 * @param rules {Array}: array of rule objects
 * @param callback {Function} `function (err, matchingVMs)`
 * - Where matchingVMs contains VM objects keyed by uuid, like:
 *     { vm_uuid: vmObj }
 */
function filterVMsByRules(vms, rules, callback) {
  LOG.debug({ rules: rules }, 'filterVMsByRules: entry');
  var matchingVMs = {};

  ruleTypeWalk(rules, function _matchingVMs(rule, type, t) {
    if (!vms[type].hasOwnProperty(t)) {
      LOG.debug('filterVMsByRules: type=%s, t=%s, rule=%s: not in VM hash',
        type, t, rule);
      return;
    }

    var owner_uuid = rule.owner_uuid;

    Object.keys(vms[type][t]).forEach(function (uuid) {
      var vm = vms[type][t][uuid];
      if (owner_uuid && vm.owner_uuid != owner_uuid) {
        LOG.debug('filterVMsByRules: type=%s, t=%s, VM=%s: rule owner uuid'
          + ' (%s) did not match VM owner uuid (%s): %s',
          type, t, uuid, owner_uuid, vm.owner_uuid, rule);
        return;
      }
      LOG.debug('filterVMsByRules: type=%s, t=%s, VM=%s: matched rule: %s',
        type, t, uuid, rule);
      matchingVMs[uuid] = vm;
    });
  });

  LOG.debug({ vms: matchingVMs }, 'filterVMsByRules: return');
  return callback(null, matchingVMs);
}


/**
 * Filter the list of rules, returning only the rules that contain VMs
 * in the given remote VM lookup table
 *
 * @param remoteVMs {Object}: remote VM lookup table, as returned by
 *  createRemoteVMlookup()
 * @param rules {Array}: array of rule objects
 * @param callback {Function} `function (err, matchingRules)`
 *
 */
function filterRulesByRemoteVMs(remoteVMs, rules, callback) {
  LOG.trace('filterRulesByRemoteVMs: entry');

  if (!remoteVMs || objEmpty(remoteVMs)) {
    return callback(null, []);
  }

  var matchingRules = [];

  // XXX: filter by owner_uuid here
  ruleTypeWalk(rules, ['tags', 'vms'], function (rule, type, t) {
    if (remoteVMs[type].hasOwnProperty(t)) {
      matchingRules.push(rule);
    }
    return;
  });

  LOG.debug({ rules: matchingRules }, 'filterRulesByRemoteVMs: return');
  return callback(null, matchingRules);
}


/**
 * Find rules that match a set of UUIDs. Warns if any of the UUIDs can't be
 * found.
 *
 * @param rules {Array} : list of rules to filter
 * @param uuids {Array} : UUIDs of rules to filter
 * @param callback {Function} : `function (err, rules)`
 * - Where matching is an object:
 *     { matching: [ <rules> ], notMatching: [ <rules> ] }
 */
function filterRulesByUUIDs(rules, uuids, callback) {
  LOG.debug(uuids, 'filterRulesByUUIDs: entry');
  var results = {
    matching: [],
    notMatching: []
  };
  var uuidHash = uuids.reduce(function (acc, u) {
    acc[u] = 1;
    return acc;
  }, {});

  rules.forEach(function (rule) {
    if (uuidHash.hasOwnProperty(rule.uuid)) {
      delete uuidHash[rule.uuid];
      results.matching.push(rule);
    } else {
      results.notMatching.push(rule);
    }
  });

  if (!objEmpty(uuidHash)) {
    LOG.warn(Object.keys(uuidHash), 'Trying to delete unknown rules');
  }

  LOG.debug({ rules: results.matching }, 'filterRulesByUUIDs: return');
  return callback(null, results);
}


/**
 * Find rules that apply to a set of VMs
 *
 * @param allVMs {Object} : VM lookup table
 * @param vms {Object} : hash of VM UUIDs to find rules for
 * - e.g. : { uuid1: 1, uuid2: 2 }
 * @param rules {Array} : list of rules to filter
 * @param callback {Function} : `function (err, matching)`
 * - Where matching is an array of the matching rule objects
 */
function filterRulesByVMs(allVMs, vms, rules, callback) {
  LOG.debug({ vms: vms }, 'filterRulesByVMs: entry');
  var matchingRules = [];
  var matchingUUIDs = {};

  ruleTypeWalk(rules, function _filterByVM(rule, type, t) {
    LOG.trace('filterRulesByVMs: type=%s, t=%s, rule=%s',
      type, t, rule);
    if (!allVMs[type].hasOwnProperty(t)) {
      return;
    }

    var owner_uuid = rule.owner_uuid;

    for (var uuid in allVMs[type][t]) {
      if (!vms.hasOwnProperty(uuid)) {
        continue;
      }

      if (owner_uuid && allVMs[type][t][uuid].owner_uuid != owner_uuid) {
        LOG.trace('filterRulesByVMs: VM %s owner_uuid=%s does not match '
          + 'rule owner_uuid=%s: %s', allVMs[type][t][uuid].owner_uuid,
          owner_uuid, rule);
        continue;
      }

      if (!matchingUUIDs[rule.uuid]) {
        matchingRules.push(rule);
        matchingUUIDs[rule.uuid] = true;
      }

      return;
    }
  });

  LOG.debug({ rules: matchingRules }, 'filterRulesByVMs: return');
  return callback(null, matchingRules);
}


/**
 * Looks up the given VMs in the VM lookup object, and returns an
 * object mapping UUIDs to VM lookup objects
 */
function lookupVMs(allVMs, vms, callback) {
  LOG.debug({ vms: vms }, 'lookupVMs: entry');

  if (!vms || vms.length === 0) {
    LOG.debug('lookupVMs: no VMs to lookup: returning');
    return callback(null, {});
  }

  var toReturn = {};
  var errs = [];
  vms.forEach(function (vm) {
    if (!vm.hasOwnProperty('uuid')) {
      errs.push(new verror.VError('VM missing uuid property: %j', vm));
      return;
    }
    if (!allVMs.all.hasOwnProperty(vm.uuid)) {
      errs.push(new verror.VError('Could not find VM "%s" in VM list'));
      return;
    }
    toReturn[vm.uuid] = allVMs.all[vm.uuid];
  });

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

  LOG.debug({ vms: toReturn }, 'lookupVMs: return');
  return callback(null, toReturn);
}


/**
 * Validates the list of rules, ensuring that there's enough information
 * to write each rule to disk
 *
 * @param vms {Object}: VM lookup table, as returned by createVMlookup()
 * @param rvms {Object}: remote VM lookup table, as returned by
 *  createRemoteVMlookup()
 * @param rules {Array}: array of rule objects
 * @param callback {Function} `function (err)`
 */
function validateRules(vms, rvms, rules, callback) {
  LOG.trace(rules, 'validateRules: entry');
  var sideData = {};
  var errs = [];
  var rulesLeft = rules.reduce(function (h, r) {
    h[r.uuid] = r;
    return h;
  }, {});

  // XXX: make owner uuid aware

  // First go through the rules finding all the VMs we need rules for
  ruleTypeDirWalk(rules, function _getRuleData(rule, dir, type, t) {
    // XXX: for now
    if (type == 'ips') {
      return;
    }

    createSubObjects(sideData, rule.uuid, dir, 'missing', type);
    createSubObjects(sideData, rule.uuid, dir, 'vms');

    if (vms[type].hasOwnProperty(t)) {
      for (var vm in vms[type][t]) {
        sideData[rule.uuid][dir].vms[vm] = 1;
      }
      delete rulesLeft[rule.uuid];

    } else if (rvms[type].hasOwnProperty(t)) {

      delete rulesLeft[rule.uuid];
    } else {
      sideData[rule.uuid][dir].missing[type][t] = 1;
    }
  });

  for (var uuid in rulesLeft) {
    errs.push(new verror.VError('No VMs found that match rule: %s',
        rulesLeft[uuid].text()));
  }

  rules.forEach(function (rule) {
    var missing = sideData[rule.uuid];

    DIRECTIONS.forEach(function (dir) {
      var otherSide = (dir == 'to' ? 'from' : 'to');

      if (!missing.hasOwnProperty(dir) || objEmpty(missing[dir].vms)
        || !missing.hasOwnProperty(otherSide)) {
        return;
      }

      for (var type in missing[otherSide].missing) {
        for (var t in missing[otherSide].missing[type]) {
          errs.push(new verror.VError('Missing %s %s for rule: %s',
              type.replace(/s$/, ''), t, rule.text()));
        }
      }
    });
  });

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

  return callback();
}


/**
 * Returns an object containing all ipf files to be written to disk, based
 * on the given rules
 *
 * @param opts {Object} :
 * - @param allVMs {Object} : VM lookup table, as returned by createVMlookup()
 * - @param remoteVMs {Array} : array of remote VM objects (optional)
 * - @param rules {Array} : array of rule objects
 * - @param vms {Array} : object mapping VM UUIDs to VM objects (optional).
 *   This is used to specify VMs that might not have rules that target them,
 *   but we still want to generate conf files for. This covers cases where
 *   a rule used to target a VM, but no longer does.
 * @param callback {Function} `function (err)`
 */
function prepareIPFdata(opts, callback) {
  var allVMs = opts.allVMs;
  var rules = opts.rules;
  var vms = opts.vms || {};
  var remoteVMlookup = opts.remoteVMs || { ips: {}, vms: {}, tags: {} };

  var errs = [];
  var fileData = {};
  var ipfData = {};

  // XXX: log remoteVMs here too
  LOG.debug({ rules: rules, vms: vms }, 'prepareIPFdata: entry');

  var vmsLeft = Object.keys(vms).reduce(function (acc, vl) {
    acc[vl] = 1;
    return acc;
  }, {});

  rules.forEach(function (rule) {
    var ips = { from: {}, to: {} };
    var matchingVMs = { from: {}, to: {} };
    var owner_uuid = rule.owner_uuid;

    LOG.debug(rule.raw(), 'prepareIPFdata: finding matching VMs');

    // XXX: don't add rule if it's disabled (but still want to find missing
    // data for it!)

    // Using the VM store, find VMs on each side
    DIRECTIONS.forEach(function (dir) {
      Object.keys(rule[dir]).forEach(function (type) {
        rule[dir][type].forEach(function (t) {
          if (!allVMs[type].hasOwnProperty(t)) {
            LOG.debug('prepareIPFdata: dir=%s, type=%s, t=%s: not found in VMs',
              dir, type, t);
            return;
          }

          var matchingUUIDs = Object.keys(allVMs[type][t]);
          LOG.debug(matchingUUIDs,
            'prepareIPFdata: dir=%s, type=%s, t=%s: found', dir, type, t);

          matchingUUIDs.forEach(function (uuid) {
            if (!allVMs.all.hasOwnProperty(uuid)) {
              LOG.debug('prepareIPFdata: uuid %s not in VM store', uuid);
              return;
            }

            if (owner_uuid && owner_uuid != allVMs.all[uuid].owner_uuid) {
              LOG.trace('prepareIPFdata: VM %s owner_uuid=%s does not match '
                + 'rule owner_uuid=%s for rule: %s', uuid,
                allVMs.all[uuid].owner_uuid, owner_uuid, rule);
              return;
            }

            matchingVMs[dir][uuid] = allVMs[type][t][uuid];

            if (!noRulesNeeded(dir, rule)) {
              delete vmsLeft[uuid];
            }
          });
        });
      });
    });

    LOG.debug(matchingVMs, 'prepareIPFdata: rule "%s" matching VMs', rule.uuid);

    if (objEmpty(matchingVMs.from) && objEmpty(matchingVMs.to)) {
      errs.push(new verror.VError(
        'No matching VMs found for rule: %s', rule.text()));
      return;
    }

    // Fill out the ipfData hash: for each matching VM for a rule, we
    // want all of the IP data from the other side of the rule (eg: for
    // tags and vms)
    DIRECTIONS.forEach(function (dir) {
      var otherSide = dir === 'from' ? 'to' : 'from';
      var missing = {};

      if (noRulesNeeded(dir, rule)) {
        LOG.trace('prepareIPFdata: rule %s (%s): ignoring side %s',
          rule.uuid, rule.action, dir);
        return;
      }

      // Get the tags, vms, etc. for the other side
      Object.keys(rule[otherSide]).forEach(function (type) {
        rule[otherSide][type].forEach(function (t) {
          var matched = false;
          if (type === 'ips' || type === 'subnets') {
            // We don't need to have a VM associated with an IP or subnet:
            // we already have all of the information needed to write a rule
            // with it
            return;
          }

          LOG.trace(rule[otherSide],
            'prepareIPFdata: rule=%s, otherSide=%s, type=%s, t=%s',
            rule.uuid, otherSide, type, t);

          if (allVMs[type].hasOwnProperty(t)) {
            createSubObjects(ips[dir], type, t);
            Object.keys(allVMs[type][t]).forEach(function (uuid) {
              LOG.debug('prepareIPFdata: Adding VM "%s" (%s=%s) ips',
                uuid, type, t);
              allVMs.all[uuid].ips.forEach(function (ip) {
                ips[dir][type][t][ip] = 1;
              });
            });
            matched = true;
          }

          // XXX: filter by owner_uuid
          if (remoteVMlookup[type].hasOwnProperty(t)) {
            forEachKey(remoteVMlookup[type][t], function (uuid, rvm) {
              createSubObjects(ips[dir], type, t);
              rvm.ips.forEach(function (ip) {
                ips[dir][type][t][ip] = 1;
              });
            });
            matched = true;
          }

          if (!matched) {
            createSubObjects(missing, type);
            missing[type][t] = 1;
            return;
          }

        });
      });

      LOG.debug(ips, 'prepareIPFdata: rule "%s" ips', rule.uuid);

      if (!objEmpty(missing)) {
        // XXX: should this maybe be a warning for some types?
        Object.keys(missing).forEach(function (type) {
          var items = Object.keys(missing[type]).sort();
          errs.push(new verror.VError('rule "%s": missing %s%s: %s',
            rule.uuid, type, items.length === 1 ? '' : 's',
            items.join(', ')));
        });
        return;
      }

      Object.keys(matchingVMs[dir]).forEach(function (uuid) {
        createSubObjects(ipfData, uuid, 'ips');
        createSubObjects(ipfData[uuid], 'rules');
        ipfData[uuid].rules[rule.uuid] = rule;
        createSubObjects(ipfData[uuid], 'directions', rule.uuid);
        ipfData[uuid].directions[rule.uuid][dir] = 1;

        Object.keys(ips[dir]).forEach(function (type) {
          createSubObjects(ipfData[uuid].ips, type);
          Object.keys(ips[dir][type]).forEach(function (t) {
            createSubObjects(ipfData[uuid].ips[type], t);
            Object.keys(ips[dir][type][t]).forEach(function (ip) {
              ipfData[uuid].ips[type][t][ip] = 1;
            });
          });
        });
      });

    });   // DIRECTIONS.forEach()
  });   // rules.forEach()

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

  // Add any leftover VMs left in vmsLeft: these need default conf files
  // written out for them, even if they don't have rules targeting them.
  for (var v in vmsLeft) {
    if (!ipfData.hasOwnProperty(v)) {
      ipfData[v] = {};
    }
  }

  // Finally, generate the ipf files, unless the firewall is disabled for
  // the VM
  var disabled = [];
  var enabled = [];
  for (var vm in ipfData) {
    if (!allVMs.all[vm].enabled) {
      disabled.push(vm);
      continue;
    }

    enabled.push(vm);
    var vmData = ipfFileData(vm, ipfData[vm]);
    for (var name in vmData) {
      var filename = util.format('%s/config/%s.conf',
        allVMs.all[vm].zonepath, name);
      fileData[filename] = vmData[name];
    }
  }

  LOG.debug({ vms: enabled, disabledVMs: disabled  },
    'prepareIPFdata: return');
  return callback(null, { vms: enabled, files: fileData });
}


/*
 * Generates ipf files for the given VM
 */
function ipfFileData(vmUUID, vm) {
  LOG.debug(vm, 'ipfFileData: generating ipf rules for VM "%s"', vmUUID);

  var date = new Date();
  var ipf = [
    '# DO NOT EDIT THIS FILE. THIS FILE IS AUTO-GENERATED BY fwadm(1M)',
    '# AND MAY BE OVERWRITTEN AT ANY TIME.',
    '#',
    '# File generated at ' + date.toString(),
    '#',
    ''];

  var sortBy = {};
  // XXX: not needed right now:
  var toSort = {};

  // Categorize rules by: ips, vms, tags
  for (var r in vm.rules) {
    var rule = vm.rules[r];
    var ruleData = { uuid: rule.uuid, version: rule.version };

    for (var vdir in vm.directions[r]) {
      var oppositeSide = (vdir === 'from') ? 'to' : 'from';

      for (var vtype in rule[oppositeSide]) {
        rule[oppositeSide][vtype].forEach(function (t) {
          var actionHash = createSubObjects(sortBy,
            (vdir === 'from') ? 'out' : 'in',
            vtype, t, rule.protocol, rule.action);

          rule.ports.forEach(function (p) {
            actionHash[p] = ruleData;
            var ipfDir = (vdir === 'from') ? 'out' : 'in';
            var key = util.format('%s/%s/%s/%s/%s/%d',
              ipfDir, vtype, t, rule.protocol, rule.action,
              Number(p));
            toSort[key] = {
              action: rule.action,
              dir: ipfDir,
              port: p,
              proto: rule.protocol,
              rule: ruleData,
              t: t,
              type: vtype
            };
          });
        });
      }
    }
  }

  LOG.debug({ toSort: toSort }, 'ipfFileData: VM "%s" sorted ipf data',
    vmUUID);

  // This is super ugly, but it works. Figure out a better way to do this.
  Object.keys(sortBy).sort().forEach(function (dir) {
    Object.keys(sortBy[dir]).sort().forEach(function (type) {
      Object.keys(sortBy[dir][type]).sort().forEach(function (t) {
        Object.keys(sortBy[dir][type][t]).sort().forEach(function (proto) {
          Object.keys(sortBy[dir][type][t][proto]).sort().forEach(
            function (action) {
            Object.keys(sortBy[dir][type][t][proto][action]).sort().forEach(
              function (p) {
              var sortedRuleData = sortBy[dir][type][t][proto][action][p];
              var targets;

              // XXX: Use pools for tags
              if (type === 'ips' || type === 'subnets') {
                targets = [t];
              } else {
                targets = Object.keys(vm.ips[type][t]);
              }

              ipf.push(util.format(
                '# rule=%s, version=%s, %s=%s', sortedRuleData.uuid,
                sortedRuleData.version, type.slice(0, -1), t));

              LOG.debug({
                rule: sortedRuleData.uuid,
                dir: dir,
                proto: proto,
                action: action,
                targets: targets
              }, 'Adding targets');

              targets.forEach(function (target) {
                ipf.push(util.format(
                  '%s %s quick proto %s from %s to %s port = %d',
                  action === 'allow' ? 'pass' : 'block',
                  dir, proto,
                  dir === 'in' ? target : 'any',
                  dir === 'in' ? 'any' : target,
                  Number(p)));
              });
            });
          });
        });
      });
    });
  });

  [ '',
    '# fwadm fallbacks',
    'block in all',
    'pass out all keep state'].forEach(function (line) {
    ipf.push(line);
  });

  return { ipf: ipf.join('\n') + '\n' };
}


/**
 * Saves all of the files in ipfData to disk
 */
function saveIPFfiles(ipfData, callback) {
  var ver = Date.now(0) + '.' + sprintf('%06d', process.pid);

  return vasync.forEachParallel({
    inputs: Object.keys(ipfData),
    func: function _apply(file, cb) {
      var tempFile = util.format('%s.%s', file, ver);
      var oldFile = util.format('%s.old', file);

      vasync.pipeline({
        funcs: [
          function _write(_, cb2) {
            LOG.trace('saveIPFfiles: writing temp file "%s"', tempFile);
            return fs.writeFile(tempFile, ipfData[file], cb2);
          },
          function _renameOld(_, cb2) {
            return fs.rename(file, oldFile, function (err) {
              if (err && err.code === 'ENOENT') {
                return cb2(null);
              }
              return cb2(err);
            });
          },
          function _renameTemp(_, cb2) {
            return fs.rename(tempFile, file, cb2);
          }
        ]}, cb);
    }
  }, function (err, res) {
    // XXX: rollback if renaming failed
    return callback(err, res);
  });
}


/**
 * Restart the firewalls for VMs listed in uuids
 *
 * @param vms {Object}: VM lookup table, as returned by createVMlookup()
 * @param rules {Array}: array of VM UUIDs to restart
 * @param callback {Function} `function (err, restarted)`
 * - Where restarted is a list of UUIDs for VMs that were actually restarted
 */
function restartFirewalls(vms, uuids, callback) {
  LOG.trace(uuids, 'restartFirewalls: entry');
  var restarted = [];

  return vasync.forEachParallel({
    inputs: uuids,
    func: function _restart(uuid, cb) {
      if (!vms.all[uuid].enabled || vms.all[uuid].state !== 'running') {
        LOG.debug('restartFirewalls: VM "%s": not restarting '
          + '(enabled=%s, state=%s)', uuid, vms.all[uuid].enabled,
          vms.all[uuid].state);
        return cb(null);
      }

      LOG.debug('restartFirewalls: reloading firewall for VM "%s" '
        + '(enabled=%s, state=%s)', uuid, vms.all[uuid].enabled,
        vms.all[uuid].state);

      // Start the firewall just in case
      return startIPF({ vm: uuid, zonepath: vms.all[uuid].zonepath },
        function (err) {
          restarted.push(uuid);
          return cb(err);
        });
    }
  }, function (err, res) {
    // XXX: Does this stop on the first error?
    return callback(err, restarted);
  });
}


/**
 * Create remote VM objects
 *
 * @param allVMs {Object}: VM lookup table, as returned by createVMlookup()
 * @param vms {Array}: array of VM objects to turn into remote VMs
 * @param callback {Function} `function (err, remoteVMs)`
 * - Where remoteVMs is an object of remote VMs, keyed by UUID
 */
function createRemoteVMs(allVMs, vms, callback) {
  LOG.trace(vms, 'createRemoteVMs: entry');
  if (!vms || vms.length === 0) {
    return callback();
  }

  var remoteVMs = {};
  var errs = [];

  vms.forEach(function (vm) {
    try {
      var rvm = util_vm.createRemoteVM(vm);
      if (allVMs.all.hasOwnProperty(rvm.uuid)) {
        var err = new verror.VError(
          'Remote VM "%s" must not have the same UUID as a local VM');
        err.details = vm;
        throw err;
      }
      remoteVMs[rvm.uuid] = rvm;
    } catch (err2) {
      errs.push(err2);
    }
  });

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

  return callback(null, remoteVMs);
}


/**
 * Applies firewall changes:
 * - saves / deletes rule files as needed
 * - writes out ipf conf files
 * - starts or restarts ipf in VMs
 *   - allVMs {Array of Objects} : all local VMs
 *   - vms {Object} : Mapping of UUID to VM object - VMs to write out
 *     firewalls for
 *
 * @param {Object} opts : options
 */
function applyChanges(opts, callback) {
  assert.object(opts, 'opts');
  assert.optionalObject(opts.allVMs, 'opts.allVMs');
  assert.optionalObject(opts.allRemoteVMs, 'opts.allRemoteVMs');
  assert.optionalArrayOfObject(opts.rules, 'opts.rules');
  assert.optionalObject(opts.vms, 'opts.vms');
  assert.optionalObject(opts.save, 'opts.save');

  pipeline({
    funcs: [
      // Generate the ipf files for each VM
      function ipfData(res, cb) {
        prepareIPFdata({
          allVMs: opts.allVMs,
          remoteVMs: opts.allRemoteVMs,
          rules: opts.rules,
          vms: opts.vms
        }, cb);
      },

      // Save the remote VMs
      function saveVMs(res, cb) {
        if (opts.dryrun || !opts.save || !opts.save.remoteVMs
          || objEmpty(opts.save.remoteVMs)) {
          return cb(null);
        }
        saveRemoteVMs(opts.save.remoteVMs, cb);
      },

      // Save rule files (if specified)
      function save(res, cb) {
        if (opts.dryrun || !opts.save || !opts.save.rules
          || opts.save.rules.length === 0) {
          return cb(null);
        }
        saveRules(opts.save.rules, cb);
      },

      // Delete rule files (if specified)
      function delRules(res, cb) {
        if (opts.dryrun || !opts.del || !opts.del.rules
          || opts.del.rules.length === 0) {
          return cb(null);
        }
        deleteRules(opts.del.rules, cb);
      },

      // Write the new ipf files to disk
      function writeIPF(res, cb) {
        if (opts.dryrun) {
          return cb(null);
        }
        saveIPFfiles(res.ipfData.files, cb);
      },

      // Restart the firewalls for all of the affected VMs
      function restart(res, cb) {
        if (opts.dryrun) {
          return cb(null);
        }
        restartFirewalls(opts.allVMs, res.ipfData.vms, cb);
      }
    ]
  }, function (err, res) {
    if (err) {
      return callback(err);
    }

    var toReturn = {
      vms: res.state.ipfData.vms
    };

    if (opts.save && opts.save.rules) {
      toReturn.rules = opts.save.rules.map(function (r) {
        return r.serialize();
      });
    }

    if (opts.del && opts.del.rules) {
      toReturn.rules = opts.del.rules.map(function (r) {
        return r.serialize();
      });
    }

    if (opts.filecontents) {
      toReturn.files = res.state.ipfData.files;
    }
    return callback(null, toReturn);
  });
}



// --- Exported functions



/**
 * Add rules, local VMs or remote VMs
 *
 * @param {Object} opts : options
 *   - localVMs {Array} : list of local VMs to update
 *   - remoteVMs {Array} : list of remote VMs to add
 *   - rules {Array} : list of rules
 *   - vms {Array} : list of VMs from vmadm
 * @param {Function} callback : of the form f(err, res)
 */
function add(opts, callback) {
  try {
    validateOpts(opts);
    assert.optionalArrayOfObject(opts.rules, 'opts.rules');
    assert.optionalArrayOfObject(opts.localVMs, 'opts.localVMs');
    assert.optionalArrayOfObject(opts.remoteVMs, 'opts.remoteVMs');

    var optRules = opts.rules || [];
    var optLocalVMs = opts.localVMs || [];
    var optRemoteVMs = opts.remoteVMs || [];
    if (optRules.length === 0 && optLocalVMs.length === 0
      && optRemoteVMs.length === 0) {
      throw new Error(
        'Payload must contain one of: rules, localVMs, remoteVMs');
    }
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'add');

  pipeline({
    funcs: [
      function rules(_, cb) { return createRules(opts.rules, cb); },

      function vms(_, cb) { createVMlookup(opts.vms, cb); },

      function disk(_, cb) { loadDataFromDisk(cb); },

      function newRemoteVMs(res, cb) {
        createRemoteVMs(res.vms, opts.remoteVMs, cb);
      },

      // Create remote VMs (if any) from payload
      function remoteVMs(res, cb) {
        createRemoteVMlookup(res.newRemoteVMs, cb);
      },

      // Create a combined remote VM lookup of remote VMs on disk plus
      // new remote VMs in the payload
      function allRemoteVMs(res, cb) {
        createRemoteVMlookup([res.disk.remoteVMs, res.newRemoteVMs], cb);
      },

      // Get any rules that the remote VMs target
      function remoteVMrules(res, cb) {
        filterRulesByRemoteVMs(res.remoteVMs, res.disk.rules, cb);
      },

      // Get VMs the rules affect
      function matchingVMs(res, cb) {
        filterVMsByRules(res.vms, res.rules.concat(res.remoteVMrules), cb);
      },

      function localVMs(res, cb) {
        lookupVMs(res.vms, opts.localVMs, cb);
      },

      function mergedVMs(res, cb) {
        return cb(null, mergeObjects(res.matchingVMs, res.localVMs));
      },

      // Now find all rules that apply to those VMs
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, res.mergedVMs, res.disk.rules, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.rules.concat(res.vmRules),
          save: {
            rules: res.rules,
            remoteVMs: res.newRemoteVMs
          },
          vms: res.mergedVMs
        }, cb);
      }
    ]}, function (err, res) {
      if (err) {
        LOG.error(err, 'add: return');
        return callback(err);
      }

      var toReturn = res.state.apply;
      LOG.debug({ vms: toReturn.vms, serializedRules: toReturn.rules },
        'add: return');
      return callback(err, toReturn);
    });
}


/**
 * Delete rules
 *
 * @param {Object} opts : options
 *   - uuids {Array} : list of rules
 *   - vms {Array} : list of VMs from vmadm
 * @param {Function} callback : of the form f(err, res)
 */
function del(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.arrayOfString(opts.uuids, 'opts.uuids');
    assert.arrayOfObject(opts.vms, 'vms');
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'del');

  pipeline({
    funcs: [
      function vms(_, cb) { createVMlookup(opts.vms, cb); },

      function disk(_, cb) { loadDataFromDisk(cb); },

      function allRemoteVMs(state, cb) {
        createRemoteVMlookup(state.disk.remoteVMs, cb);
      },

      function rules(res, cb) {
        filterRulesByUUIDs(res.disk.rules, opts.uuids, cb);
      },

      // Get VMs the rules affect
      function matchingVMs(res, cb) {
        filterVMsByRules(res.vms, res.rules.matching, cb);
      },

      // Now find all rules that apply to those VMs
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, res.matchingVMs,
          res.rules.notMatching, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.vmRules,
          del: {
            rules: res.rules.matching
          },
          vms: res.matchingVMs
        }, cb);
      }
    ]}, function (err, res) {
      if (err) {
        LOG.error(err, 'del: return');
        return callback(err);
      }

      var toReturn = res.state.apply;
      LOG.debug(toReturn, 'del: return');
      return callback(err, toReturn);
    });
}


/**
 * Returns a rule
 *
 * @param opts {Object} : options:
 * - uuid {String} : UUID of rule to get
 * @param callback {Function} : `function (err, rule)`
 */
function getRule(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
  } catch (err) {
    return callback(err);
  }
  opts.readOnly = true;
  logEntry(opts, 'get');

  var file = util.format('%s/%s.json', RULE_PATH, opts.uuid);
  return loadRule(file, function (err, rule) {
    if (err) {
      if (err.code == 'ENOENT') {
        return callback(new verror.VError('Unknown rule "%s"', opts.uuid));
      }

      LOG.error(err, 'getRule: return');
      return callback(err);
    }

    return callback(null, rule.serialize());
  });
}


/**
 * List rules
 */
function listRules(opts, callback) {
  try {
    assert.object(opts, 'opts');
  } catch (err) {
    return callback(err);
  }
  opts.readOnly = true;
  logEntry(opts, 'list');

  loadAllRules(function (err, res) {
    if (err) {
      LOG.error(err, 'listRules: return');
      return callback(err);
    }

    // XXX: support sorting by other fields, filtering
    // (eg: enabled=true vm=<uuid>)
    var sortFn = function _sort(a, b) {
      return (a.uuid > b.uuid) ? 1: -1;
    };

    return callback(null,
      res.map(function (r) { return r.serialize(); }).sort(sortFn));
  });
}


/**
 * Enable the firewall for a VM. If the VM is running, start ipf for that VM.
 *
 * @param opts {Object} : options:
 * - vms {Array} : array of VM objects (as per VM.js)
 * - vm {Object} : VM object for the VM to enable
 * - dryrun {Boolean} : don't write any files to disk (Optional)
 * - filecontents {Boolean} : return contents of files written to
 *   disk (Optional)
 * @param callback {Function} `function (err, res)`
 * - Where res is an object, optionall containing a files subhash
 *   if opts.filecontents is set
 */
function enableVM(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.object(opts.vm, 'opts.vm');
    assert.arrayOfObject(opts.vms, 'opts.vms');
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'enable');

  var vmFilter = {};
  vmFilter[opts.vm.uuid] = 1;

  pipeline({
    funcs: [
      function vms(_, cb) { createVMlookup(opts.vms, cb); },

      function disk(_, cb) { loadDataFromDisk(cb); },

      // Find all rules that apply to the VM
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, vmFilter, res.disk.rules, cb);
      },

      function allRemoteVMs(res, cb) {
        createRemoteVMlookup(res.disk.remoteVMs, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.vmRules
        }, cb);
      }
    ]}, function _afterEnable(err, res) {
      if (err) {
        LOG.error(err, 'enableVM: return');
        return callback(err);
      }

      var toReturn = {};
      if (opts.filecontents) {
        toReturn.files = res.state.ipfData.files;
      }

      LOG.debug(toReturn, 'enableVM: return');
      return callback(null, toReturn);
    });
}


/**
 * Disable the firewall for a VM. If the VM is running, stop ipf for that VM.
 *
 * @param opts {Object} : options:
 * - vm {Object} : VM object for the VM to disable
 * @param callback {Function} `function (err)`
 */
function disableVM(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.object(opts.vm, 'opts.vm');
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'disable');

  pipeline({
    funcs: [
      function moveConf(_, cb) {
        // Move ipf.conf out of the way - on zone boot, the firewall will start
        // again if it's present
        return fs.rename(util.format(IPF_CONF, opts.vm.zonepath),
          util.format(IPF_CONF_OLD, opts.vm.zonepath), function (err) {
          // If the file's already gone, that's OK
          if (err && err.code !== 'ENOENT') {
            return cb(err);
          }

          return cb(null);
        });
      },
      function stop(_, cb) {
        if (opts.vm.state !== 'running') {
          LOG.debug('disableVM: VM "%s" not stopping ipf (state=%s)',
            opts.vm.uuid, opts.vm.state);
          return cb(null);
        }

        LOG.debug('disableVM: stopping ipf for VM "%s"', opts.vm.uuid);
        return mod_ipf.stop(opts.vm.uuid, LOG, cb);
      }
    ]}, callback);
}


/**
 * Gets the firewall status for a VM
 *
 * @param opts {Object} : options:
 * - uuid {String} : VM UUID
 * @param callback {Function} `function (err, res)`
 */
function vmStatus(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
  } catch (err) {
    return callback(err);
  }
  opts.readOnly = true;
  logEntry(opts, 'status');

  return mod_ipf.status(opts.uuid, LOG, function (err, res) {
    if (err) {
      // 'No such device' is returned when the zone is down
      if (res && res.stderr
        && res.stderr.indexOf('Could not find running zone') !== -1) {
        return callback(null, { running: false });
      }
      return callback(err);
    }

    return callback(null, res);
  });
}


/**
 * Gets the firewall statistics for a VM
 *
 * @param opts {Object} : options:
 * - uuid {String} : VM UUID
 * @param callback {Function} `function (err, res)`
 */
function vmStats(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
  } catch (err) {
    return callback(err);
  }
  opts.readOnly = true;
  logEntry(opts, 'stats');

  return mod_ipf.ruleStats(opts.uuid, LOG, function (err, res) {
    if (err) {
      if (res && res.stderr) {
        // Zone is down
        if (res.stderr.indexOf('Could not find running zone') !== -1) {
          return callback(new verror.VError(
            'Firewall is not running for VM "%s"', opts.uuid));
        }

        // No rules loaded
        if (res.stderr.indexOf('empty list') !== -1) {
          return vmStatus(opts, function (err2, res2) {
            if (err2) {
              return callback(err2);
            }

            if (res2.running) {
              return callback(null, { rules: [] });
            } else {
              return callback(new verror.VError(
                'Firewall is not running for VM "%s"', opts.uuid));
            }
          });
        }
      }

      return callback(err);
    }

    return callback(null, { rules: res });
  });
}


/**
 * Update rules, local VMs or remote VMs
 *
 * @param {Object} opts : options
 *   - localVMs {Array} : list of local VMs to update
 *   - remoteVMs {Array} : list of remote VMs to update
 *   - rules {Array} : list of rules
 *   - vms {Array} : list of VMs from vmadm
 * @param {Function} callback : of the form f(err, res)
 */
function update(opts, callback) {
  try {
    validateOpts(opts);
    assert.optionalArrayOfObject(opts.rules, 'opts.rules');
    assert.optionalArrayOfObject(opts.localVMs, 'opts.localVMs');
    assert.optionalArrayOfObject(opts.remoteVMs, 'opts.remoteVMs');

    var optRules = opts.rules || [];
    var optLocalVMs = opts.localVMs || [];
    var optRemoteVMs = opts.remoteVMs || [];
    if (optRules.length === 0 && optLocalVMs.length === 0
      && optRemoteVMs.length === 0) {
      throw new Error(
        'Payload must contain one of: rules, localVMs, remoteVMs');
    }
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'update');

  pipeline({
    funcs: [
      function disk(_, cb) { loadDataFromDisk(cb); },

      // Make sure the rules exist: might want to relax this restriction?
      function originalRules(res, cb) {
        findRules(res.disk.rules, opts.rules, cb);
      },

      // Apply updates to the found rules
      function rules(res, cb) {
        createUpdatedRules(res.originalRules, opts, cb);
      },

      // Create the VM lookup
      function vms(_, cb) { createVMlookup(opts.vms, cb); },

      // Create remote VMs (if any) from payload
      function newRemoteVMs(res, cb) {
        createRemoteVMs(res.vms, opts.remoteVMs, cb);
      },

      // Create a lookup for the new remote VMs
      function newRemoteVMsLookup(res, cb) {
        createRemoteVMlookup(res.newRemoteVMs, cb);
      },

      function allRemoteVMs(res, cb) {
        createRemoteVMlookup([res.disk.remoteVMs, res.newRemoteVMs], cb);
      },

      // Lookup any local VMs in the payload
      function localVMs(res, cb) {
        lookupVMs(res.vms, opts.localVMs, cb);
      },

      // Get the VMs the rules applied to before the update
      function originalVMs(res, cb) {
        filterVMsByRules(res.vms, res.originalRules, cb);
      },

      // Now get the VMs the updated rules apply to
      function matchingVMs(res, cb) {
        filterVMsByRules(res.vms, res.rules, cb);
      },

      function mergedVMs(res, cb) {
        var ruleVMs = mergeObjects(res.originalVMs, res.matchingVMs);
        return cb(null, mergeObjects(ruleVMs, res.localVMs));
      },

      // Get any rules that the added remote VMs target
      function remoteVMrules(res, cb) {
        filterRulesByRemoteVMs(res.newRemoteVMsLookup, res.disk.rules, cb);
      },

      // Replace the rules with their updated versions
      function dedupedRules(res, cb) {
        return cb(null, dedupRules(res.rules, res.disk.rules));
      },

      // Get the rules that need to be written out for all VMs, before and
      // after the update
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, res.mergedVMs, res.dedupedRules, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.vmRules.concat(res.remoteVMrules),
          save: {
            rules: res.rules,
            remoteVMs: res.newRemoteVMs
          },
          vms: res.mergedVMs
        }, cb);
      }
    ]}, function (err, res) {
      if (err) {
        LOG.error(err, 'update: return');
        return callback(err);
      }

      var toReturn = res.state.apply;
      LOG.debug({ vms: toReturn.vms, serializedRules: toReturn.rules },
        'update: return');
      return callback(err, toReturn);
    });
}


/**
 * Gets rules that apply to a VM
 *
 * @param opts {Object} : options:
 * - vms {Array} : array of VM objects (as per VM.js)
 * - vm {UUID} : UUID of VM to get the rules for
 * @param callback {Function} `function (err, rules)`
 * - Where rules is an array of rules that apply to the VM
 */
function getVMrules(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.string(opts.vm, 'opts.vm');
    assert.arrayOfObject(opts.vms, 'opts.vms');
  } catch (err) {
    return callback(err);
  }
  opts.readOnly = true;
  logEntry(opts, 'rules');

  var toFind = {};
  toFind[opts.vm] = opts.vm;

  pipeline({
    funcs: [
      function allRules(_, cb) { loadAllRules(cb); },
      function vms(_, cb) { createVMlookup(opts.vms, cb); },
      function vmRules(state, cb) {
        filterRulesByVMs(state.vms, toFind, state.allRules, cb);
      }
    ]}, function (err, res) {
      if (err) {
        return callback(err);
      }

      var toReturn = res.state.vmRules.map(function (r) {
        return r.serialize();
      });

      LOG.debug(toReturn, 'getVMrules: return (vm=%s)', opts.vm);
      return callback(null, toReturn);
    });
}


/**
 * Validates an add / update payload
 *
 * @param opts {Object} : options:
 *   - localVMs {Array} : list of local VMs
 *   - remoteVMs {Array} : list of remote VMs
 *   - rules {Array} : list of rules
 *   - vms {Array} : array of VM objects (as per VM.js)
 * @param callback {Function} `function (err, rules)`
 * - Where rules is an array of rules that apply to the VM
 */
function validatePayload(opts, callback) {
  try {
    assert.object(opts, 'opts');
    assert.arrayOfObject(opts.vms, 'opts.vms');
    assert.optionalArrayOfObject(opts.rules, 'opts.rules');
    assert.optionalArrayOfObject(opts.localVMs, 'opts.localVMs');
    assert.optionalArrayOfObject(opts.remoteVMs, 'opts.remoteVMs');

    var optRules = opts.rules || [];
    var optLocalVMs = opts.localVMs || [];
    var optRemoteVMs = opts.remoteVMs || [];
    if (optRules.length === 0 && optLocalVMs.length === 0
      && optRemoteVMs.length === 0) {
      throw new Error(
        'Payload must contain one of: rules, localVMs, remoteVMs');
    }
  } catch (err) {
    return callback(err);
  }
  logEntry(opts, 'validatePayload');

  pipeline({
    funcs: [
      function rules(_, cb) {
        createRules(opts.rules, cb);
      },
      function vms(_, cb) { createVMlookup(opts.vms, cb); },
      function remoteVMs(_, cb) { loadAllRemoteVMs(cb); },
      function newRemoteVMs(state, cb) {
        createRemoteVMs(state.vms, opts.remoteVMs, cb);
      },
      // Create a combined remote VM lookup of remote VMs on disk plus
      // new remote VMs in the payload
      function allRemoteVMs(state, cb) {
        createRemoteVMlookup([state.remoteVMs, state.newRemoteVMs], cb);
      },

      function validate(state, cb) {
        validateRules(state.vms, state.allRemoteVMs, state.rules, cb);
      }
    ]}, function (err, res) {
      if (err) {
        LOG.error(err, 'validatePayload: return');
        return callback(err);
      }

      LOG.debug(opts.payload, 'validatePayload: return OK');
      return callback();
    });
}



module.exports = {
  add: add,
  del: del,
  disable: disableVM,
  enable: enableVM,
  get: getRule,
  list: listRules,
  rules: getVMrules,
  stats: vmStats,
  status: vmStatus,
  update: update,
  validatePayload: validatePayload
};
