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
// VM fields that affect filtering
var VM_FIELDS = [
  'firewall_enabled',
  'nics',
  'owner_uuid',
  'state',
  'tags',
  'uuid',
  'zonepath'
];
// VM fields required for filtering
var VM_FIELDS_REQUIRED = [
  'nics',
  'state',
  'tags',
  'uuid',
  'zonepath'
];



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
    types = ['ips', 'tags', 'vms', 'wildcards'];
  }

  rules.forEach(function (rule) {
    types.forEach(function (type) {
      rule[type].forEach(function (t) {
        if (typeof (t) === 'string') {
          cb(rule, type, t);
        } else {
          cb(rule, type, t[0], t[1]);
        }
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
function createUpdatedRules(opts, callback) {
  LOG.trace('createUpdatedRules: entry');
  var originalRules = opts.originalRules;
  var updatedRules = opts.updatedRules;

  if (!updatedRules || updatedRules.length === 0) {
    return callback(null, []);
  }

  var originals = {};
  var updated = [];

  originalRules.forEach(function (r) {
    originals[r.uuid] = r;
  });

  updatedRules.forEach(function (rule) {
    // Assume that we're allowed to do adds - findRules() would have errored
    // out if allowAdds was unset and an add was attempted
    if (originals.hasOwnProperty(rule.uuid)) {
      updated.push(mergeObjects(rule, originals[rule.uuid].serialize()));
    } else {
      updated.push(rule);
    }
  });

  LOG.debug(updated, 'createUpdatedRules: rules merged');
  return createRules(updated, callback);
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

  var errs = [];
  var vmStore = {
    all: {},
    ips: {},
    subnets: {},
    tags: {},
    vms: {},
    wildcards: {}
  };

  vmStore.wildcards.vmall = vmStore.all;

  vms.forEach(function (fullVM) {
    var missing = [];
    VM_FIELDS_REQUIRED.forEach(function (field) {
      if (!fullVM.hasOwnProperty(field)) {
        missing.push(field);
      }
    });

    if (missing.length !== 0) {
      LOG.error({ vm: fullVM, missing: missing }, 'missing VM fields');
      errs.push(new verror.VError(
        'VM %s: missing field%s required for firewall: %s',
        fullVM.uuid,
        missing.length === 0 ? '' : 's',
        missing.join(', ')));
      return;
    }

    var vm = {
      enabled: fullVM.firewall_enabled || false,
      ips: fullVM.nics.map(function (n) { return (n.ip); }).filter(
        function (i) { return (i !== 'dhcp'); }),
      owner_uuid: fullVM.owner_uuid,
      state: fullVM.state,
      tags: fullVM.tags,
      uuid: fullVM.uuid,
      zonepath: fullVM.zonepath
    };
    LOG.trace(vm, 'Adding VM "%s" to lookup', vm.uuid);

    vmStore.all[vm.uuid] = vm;
    addToHash3(vmStore, 'vms', vm.uuid, vm.uuid, vm);

    forEachKey(vm.tags, function (tag, val) {
      createSubObjects(vmStore, 'tags', tag, vm.uuid, vm);
      createSubObjects(vmStore, 'tagValues', tag, val, vm.uuid, vm);
    });

    vm.ips.forEach(function (ip) {
      addToHash3(vmStore, 'ips', ip, vm.uuid, vm);
    });

    // XXX: subnet
  });

  if (errs.length !== 0) {
    return callback(createMultiError(errs));
  }

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

  var rvmLookup = {
    all: {},
    ips: {},
    subnets: {},
    tags: {},
    vms: {},
    wildcards: {}
  };

  if (!remoteVMs || objEmpty(remoteVMs)) {
    return callback(null, rvmLookup);
  }

  var rvmList = remoteVMs;
  if (!mod_obj.isArray(rvmList)) {
    rvmList = [ remoteVMs ];
  }

  rvmList.forEach(function (rvmObj) {
    forEachKey(rvmObj, function (uuid, rvm) {
      // Make vms match the layout of tags, eg: tags[key][uuid] = { obj }
      rvmLookup.vms[uuid] = {};
      rvmLookup.vms[uuid][uuid] = rvm;

      if (rvm.hasOwnProperty('tags')) {
        forEachKey(rvm.tags, function (tag, val) {
          createSubObjects(rvmLookup.tags, tag, uuid, rvm);
          createSubObjects(rvmLookup, 'tagValues', tag, val, uuid, rvm);
        });
      }

      rvm.ips.forEach(function (ip) {
        addToHash3(rvmLookup, 'ips', ip, uuid, rvm);
      });

      rvmLookup.all[uuid] = rvm;
    });
  });

  rvmLookup.wildcards.vmall = rvmLookup.all;
  return callback(null, rvmLookup);
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
function findRules(opts, callback) {
  LOG.trace('findRules: entry');
  var allowAdds = opts.allowAdds || false;
  var allRules = opts.allRules;
  var rules = opts.rules;

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

  // If we're allowing adds, missing rules aren't an error
  if (!allowAdds && !objEmpty(uuids)) {
    Object.keys(uuids).forEach(function (uuid) {
      errs.push(new verror.VError('Unknown rule: %s', uuid));
    });
  }

  if (LOG.debug()) {
    var ret = { rules: found };
    if (allowAdds) {
      ret.adds = Object.keys(uuids);
    } else {
      ret.missing = Object.keys(uuids);
    }
    LOG.debug(ret, 'findRules: return');
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

  ruleTypeWalk(rules, function _matchingVMs(rule, type, t, val) {
    if (val !== undefined) {
      type = 'tagValues';
    }

    if (type === 'wildcards' && t === 'any') {
      return;
    }

    if (!vms[type].hasOwnProperty(t)) {
      LOG.debug('filterVMsByRules: type=%s, t=%s, rule=%s: not in VM hash',
        type, t, rule);
      return;
    }

    var vmList = vms[type][t];
    if (val) {
      if (!vms[type][t].hasOwnProperty(val)) {
        return;
      }
      vmList = vms[type][t][val];
    }

    var owner_uuid = rule.owner_uuid;

    Object.keys(vmList).forEach(function (uuid) {
      var vm = vmList[uuid];
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

  ruleTypeWalk(rules, ['tags', 'vms', 'wildcards'], function (rule, type, t) {
    if (type === 'wildcards' && t === 'any') {
      return;
    }

    if (remoteVMs[type].hasOwnProperty(t)) {
      if (!rule.hasOwnProperty('owner_uuid')) {
        matchingRules.push(rule);
        return;
      }

      for (var uuid in remoteVMs[type][t]) {
        if (remoteVMs[type][t][uuid].owner_uuid == rule.owner_uuid) {
          matchingRules.push(rule);
          return;
        }
      }
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

  ruleTypeWalk(rules, function _filterByVM(rule, type, t, val) {
    if (val !== undefined) {
      type = 'tagValues';
    }

    LOG.trace('filterRulesByVMs: type=%s, t=%s, rule=%s',
      type, t, rule);

    if (!allVMs[type].hasOwnProperty(t)) {
      return;
    }

    var vmList = allVMs[type][t];

    if (val) {
      if (!allVMs[type][t].hasOwnProperty(val)) {
        return;
      }
      vmList = allVMs[type][t][val];
    }

    var owner_uuid = rule.owner_uuid;

    for (var uuid in vmList) {
      if (!vms.hasOwnProperty(uuid)) {
        continue;
      }

      if (owner_uuid && vmList[uuid].owner_uuid != owner_uuid) {
        LOG.trace('filterRulesByVMs: VM %s owner_uuid=%s does not match '
          + 'rule owner_uuid=%s: %s', vmList[uuid].owner_uuid,
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
 * Returns the appropriate target string based on the rule's protocol
 * (eg: code for ICMP, port for TCP / UDP)
 */
function protoTarget(rule, target) {
  if (rule.protocol === 'icmp') {
    var typeArr = target.split(':');
    return 'icmp-type ' + typeArr[0]
      + (typeArr.length === 1 ? '' : ' code ' + typeArr[1]);
  } else {
    if (target === 'all') {
      return '';
    }

    return 'port = ' + target;
  }
}


/**
 * Returns an object containing ipf rule text and enough data to sort on
 */
function ipfRuleObj(opts) {
  var dir = opts.direction;
  var rule = opts.rule;

  var sortObj = {
    action: rule.action,
    direction: dir,
    protocol: rule.protocol,
    text: [ '', util.format('# rule=%s, version=%s, %s=%s',
      rule.uuid, rule.version, opts.type, opts.value)
    ],
    type: opts.type,
    uuid: rule.uuid,
    value: opts.value,
    version: rule.version
  };

  if (opts.type === 'wildcard' && opts.value === 'any') {
    rule.protoTargets.sort().forEach(function (t) {
      sortObj.text.push(
        util.format('%s %s quick proto %s from any to any %s',
          rule.action === 'allow' ? 'pass' : 'block',
          dir === 'from' ? 'out' : 'in',
          rule.protocol,
          protoTarget(rule, t)));
    });

    return sortObj;
  }

  var targets = mod_obj.isArray(opts.targets) ? opts.targets : [ opts.targets ];

  targets.forEach(function (target) {
    // XXX: need to do Number() on these before sorting?
    rule.protoTargets.sort().forEach(function (t) {
      sortObj.text.push(
        util.format('%s %s quick proto %s from %s to %s %s',
          rule.action === 'allow' ? 'pass' : 'block',
          dir === 'from' ? 'out' : 'in',
          rule.protocol,
          dir === 'to' ? target : 'any',
          dir === 'to' ? 'any' : target,
          protoTarget(rule, t)));
    });
  });

  return sortObj;
}


/**
 * Returns an object containing all ipf files to be written to disk, based
 * on the given rules
 *
 * @param opts {Object} :
 * - @param allVMs {Object} : VM lookup table, as returned by createVMlookup()
 * - @param remoteVMs {Array} : array of remote VM objects (optional)
 * - @param rules {Array} : array of rule objects
 * - @param vms {Array} : object mapping VM UUIDs to VM objects. All VMs in
 *   this object will have conf files written. This covers the case where
 *   a rule used to target a VM, but no longer does, so we want to write the
 *   config minus the rule that no longer applies.
 * @param callback {Function} `function (err)`
 */
function prepareIPFdata(opts, callback) {
  var allVMs = opts.allVMs;
  var date = new Date();
  var rules = opts.rules;
  var vms = opts.vms;
  var remoteVMs = opts.remoteVMs || { ips: {}, vms: {}, tags: {} };

  LOG.debug({ vms: vms, rules: rules }, 'prepareIPFdata: entry');

  var conf = {};
  if (vms) {
    conf = Object.keys(vms).reduce(function (acc, v) {
      // If the VM's firewall is disabled, we don't need to write out
      // rules for it
      if (allVMs.all[v].enabled) {
        acc[v] = [];
      }
      return acc;
    }, {});
  }

  rules.forEach(function (rule) {
    if (!rule.enabled) {
      return;
    }

    var ruleVMs = {
      from: vmsOnSide(allVMs, rule, 'from'),
      to: vmsOnSide(allVMs, rule, 'to')
    };

    DIRECTIONS.forEach(function (dir) {
      // XXX: add to errors here if missing

      // Default outgoing policy is 'allow' and default incoming policy
      // is 'block', so these are effectively no-ops:
      if (noRulesNeeded(dir, rule)) {
        return;
      }

      var otherSideRules = rulesFromOtherSide(rule, dir, allVMs, remoteVMs);

      ruleVMs[dir].forEach(function (uuid) {
        // If the VM's firewall is disabled, we don't need to write out
        // rules for it
        if (!allVMs.all[uuid].enabled) {
          return;
        }

        otherSideRules.forEach(function (oRule) {
          if (!conf.hasOwnProperty(uuid)) {
            return;
          }

          conf[uuid].push(oRule);
        });
      });
    });
  });

  var toReturn = { files: {}, vms: [] };
  for (var vm in conf) {
    var rulesIncluded = {};
    var filename = util.format('%s/config/ipf.conf', allVMs.all[vm].zonepath);
    var ipfConf = [
      '# DO NOT EDIT THIS FILE. THIS FILE IS AUTO-GENERATED BY fwadm(1M)',
      '# AND MAY BE OVERWRITTEN AT ANY TIME.',
      '#',
      '# File generated at ' + date.toString(),
      '#',
      ''];

    toReturn.vms.push(vm);

    // XXX: sort here
    conf[vm].forEach(function (sortObj) {
      if (!rulesIncluded.hasOwnProperty(sortObj.uuid)) {
        rulesIncluded[sortObj.uuid] = [];
      }
      rulesIncluded[sortObj.uuid].push(sortObj.direction);

      sortObj.text.forEach(function (line) {
        ipfConf.push(line);
      });
    });

    LOG.debug(rulesIncluded, 'VM %s: generated ipf.conf', vm);

    toReturn.files[filename] = ipfConf.concat([
      '',
      '# fwadm fallbacks',
      'block in all',
      'pass out quick proto tcp from any to any flags S/SA keep state',
      'pass out proto tcp from any to any',
      'pass out proto udp from any to any keep state',
      'pass out quick proto icmp from any to any keep state',
      'pass out proto icmp from any to any']).join('\n')
      + '\n';
  }

  return callback(null, toReturn);
}


/**
 * Returns an array of the UUIDs of VMs on the given side of a rule
 */
function vmsOnSide(allVMs, rule, dir) {
  var matching = [];

  ['vms', 'tags', 'wildcards'].forEach(function (type) {
    rule[dir][type].forEach(function (t) {
      var value;
      if (typeof (t) !== 'string') {
        value = t[1];
        t = t[0];
        type = 'tagValues';
      }

      if (type === 'wildcards' && t === 'any') {
        return;
      }

      if (!allVMs[type] || !allVMs[type].hasOwnProperty(t)) {
        LOG.debug('No matching VMs found in lookup for %s=%s', type, t);
        return;
      }

      var vmList = allVMs[type][t];
      if (value !== undefined) {
        if (!vmList.hasOwnProperty(value)) {
          return;
        }
        vmList = vmList[value];
      }

      Object.keys(vmList).forEach(function (uuid) {
        if (rule.hasOwnProperty('owner_uuid')
          && (rule.owner_uuid != vmList[uuid].owner_uuid)) {
          return;
        }

        matching.push(uuid);
      });
    });
  });

  return matching;
}


/**
 * Returns the ipf rules for the opposite side of a rule
 */
function rulesFromOtherSide(rule, dir, localVMs, remoteVMs) {
  var otherSide = dir === 'from' ? 'to' : 'from';
  var ipfRules = [];

  if (rule[otherSide].wildcards.indexOf('any') !== -1) {
      ipfRules.push(ipfRuleObj({
        rule: rule,
        direction: dir,
        type: 'wildcard',
        value: 'any'
      }));

    return ipfRules;
  }

  // IPs and subnets don't need looking up in the local or remote VM
  // lookup objects, so just them as-is
  ['ip', 'subnet'].forEach(function (type) {
    rule[otherSide][type + 's'].forEach(function (value) {
      ipfRules.push(ipfRuleObj({
        rule: rule,
        direction: dir,
        targets: value,
        type: type,
        value: value
      }));
    });
  });

  // Lookup the VMs in the local and remove VM lookups, and add their IPs
  // accordingly
  ['tag', 'vm', 'wildcard'].forEach(function (type) {
    var typePlural = type + 's';
    rule[otherSide][typePlural].forEach(function (value) {
      var t;
      if (typeof (value) !== 'string') {
        t = value[1];
        value = value[0];
        type = 'tagValue';
        typePlural = 'tagValues';
      }

      if (type === 'wildcards' && value === 'any') {
        return;
      }

      [localVMs, remoteVMs].forEach(function (lookup) {
        if (!lookup.hasOwnProperty(typePlural)
          || !lookup[typePlural].hasOwnProperty(value)) {
          return;
        }

        var vmList = lookup[typePlural][value];
        if (t !== undefined) {
          if (!vmList.hasOwnProperty(t)) {
            return;
          }
          vmList = vmList[t];
        }

        forEachKey(vmList, function (uuid, vm) {
          if (rule.owner_uuid && vm.owner_uuid
            && vm.owner_uuid != rule.owner_uuid) {
            return;
          }

          ipfRules.push(ipfRuleObj({
            rule: rule,
            direction: dir,
            targets: vm.ips,
            type: type,
            value: value
          }));
        });
      });

    });
  });

  return ipfRules;
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
          'Remote VM "%s" must not have the same UUID as a local VM',
          rvm.uuid);
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
      function rules(_, cb) { createRules(opts.rules, cb); },

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

      function localVMs(res, cb) {
        lookupVMs(res.vms, opts.localVMs, cb);
      },

      function allRules(res, cb) {
        return cb(null, dedupRules(res.rules, res.disk.rules));
      },

      // Get VMs the added rules affect
      function matchingVMs(res, cb) {
        filterVMsByRules(res.vms, res.rules, cb);
      },

      // Get rules the added remote VMs affect
      function remoteVMrules(res, cb) {
        filterRulesByRemoteVMs(res.remoteVMs, res.allRules, cb);
      },

      // Get any rules that the added local VMs target
      function localVMrules(res, cb) {
        filterRulesByVMs(res.vms, res.localVMs, res.allRules, cb);
      },

      // Merge the local and remote VM rules, and use that list to find
      // the VMs affected
      function localAndRemoteVMsAffected(res, cb) {
        filterVMsByRules(res.vms,
          dedupRules(res.localVMrules, res.remoteVMrules), cb);
      },

      function mergedVMs(res, cb) {
        var ruleVMs = mergeObjects(res.localVMs, res.matchingVMs);
        return cb(null, mergeObjects(ruleVMs, res.localAndRemoteVMsAffected));
      },

      // Get the rules that need to be written out for all VMs, before and
      // after the update
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, res.mergedVMs, res.allRules, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.vmRules,
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

  pipeline({
    funcs: [
      function vms(_, cb) { createVMlookup(opts.vms, cb); },

      function disk(_, cb) { loadDataFromDisk(cb); },

      function getVM(res, cb) {
        var vm = res.vms.all[opts.vm.uuid];
        if (!vm) {
          return cb(new verror.VError('VM "%s" not found', opts.vm.uuid));
        }

        vmFilter[opts.vm.uuid] = vm;
        return cb();
      },

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
          rules: res.vmRules,
          vms: vmFilter
        }, cb);
      }
    ]}, function _afterEnable(err, res) {
      if (err) {
        LOG.error(err, 'enableVM: return');
        return callback(err);
      }

      var toReturn = res.state.apply;
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

      // Make sure the rules exist
      function originalRules(res, cb) {
        findRules({
          allRules: res.disk.rules,
          allowAdds: opts.allowAdds,
          rules: opts.rules
        }, cb);
      },

      // Apply updates to the found rules
      function rules(res, cb) {
        createUpdatedRules({
          originalRules: res.originalRules,
          updatedRules: opts.rules
        }, cb);
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

      // Replace the rules with their updated versions
      function updatedRules(res, cb) {
        return cb(null, dedupRules(res.rules, res.disk.rules));
      },

      // Get any rules that the added remote VMs target
      function remoteVMrules(res, cb) {
        filterRulesByRemoteVMs(res.newRemoteVMsLookup, res.updatedRules, cb);
      },

      // Get any rules that the added local VMs target
      function localVMrules(res, cb) {
        filterRulesByVMs(res.vms, res.localVMs, res.updatedRules, cb);
      },

      // Merge the local and remote VM rules, and use that list to find
      // the VMs affected
      function localAndRemoteVMsAffected(res, cb) {
        filterVMsByRules(res.vms,
          dedupRules(res.localVMrules, res.remoteVMrules), cb);
      },

      function mergedVMs(res, cb) {
        var ruleVMs = mergeObjects(res.originalVMs, res.matchingVMs);
        return cb(null, mergeObjects(ruleVMs, res.localAndRemoteVMsAffected));
      },

      // Get the rules that need to be written out for all VMs, before and
      // after the update
      function vmRules(res, cb) {
        filterRulesByVMs(res.vms, res.mergedVMs, res.updatedRules, cb);
      },

      function apply(res, cb) {
        applyChanges({
          allVMs: res.vms,
          dryrun: opts.dryrun,
          filecontents: opts.filecontents,
          allRemoteVMs: res.allRemoteVMs,
          rules: res.vmRules,
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
  validatePayload: validatePayload,
  VM_FIELDS: VM_FIELDS
};
