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
 *
 * Copyright 2019 Joyent, Inc.
 *
 *
 * fwadm: Main entry points
 */

var assert = require('assert-plus');
var clone = require('clone');
var filter = require('./filter');
var fs = require('fs');
var mkdirp = require('mkdirp');
var mod_addr = require('ip6addr');
var mod_ipf = require('./ipf');
var mod_lock = require('./locker');
var mod_obj = require('./util/obj');
var mod_rvm = require('./rvm');
var mod_rule = require('fwrule');
var pipeline = require('./pipeline').pipeline;
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var util_err = require('./util/errors');
var util_log = require('./util/log');
var util_vm = require('./util/vm');
var vasync = require('vasync');
var verror = require('verror');

var createSubObjects = mod_obj.createSubObjects;
var forEachKey = mod_obj.forEachKey;
var hasKey = mod_obj.hasKey;
var objEmpty = mod_obj.objEmpty;
var mergeObjects = mod_obj.mergeObjects;



// --- Globals



var DIRECTIONS = ['from', 'to'];
var RULE_PATH = '/var/fw/rules';
var IPF_CONF = '%s/config/ipf.conf';
var IPF_CONF_OLD = '%s/config/ipf.conf.old';
var IPF6_CONF = '%s/config/ipf6.conf';
var IPF6_CONF_OLD = '%s/config/ipf6.conf.old';
var KEEP_FRAGS = ' keep frags';
var KEEP_STATE = ' keep state';
var NOT_RUNNING_MSG = 'Could not find running zone';
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

var icmpr = /^icmp6?$/;

var fallbacks = [
    '',
    '# fwadm fallbacks',
    'block in all',
    'pass out quick proto tcp from any to any flags S/SA keep state',
    'pass out proto tcp from any to any',
    'pass out proto udp from any to any keep state'];

var v4fallbacks = fallbacks.concat([
    'pass out quick proto icmp from any to any keep state',
    'pass out proto icmp from any to any']);

var v6fallbacks = fallbacks.concat([
    'pass out quick proto ipv6-icmp from any to any keep state',
    'pass out proto ipv6-icmp from any to any']);

// Do not use directly - use haveIpfEventLogger() instead.
var haveDevIpfEv = undefined;
var DEV_IPFEV = '/dev/ipfev';

// --- Internal helper functions



/**
 * Assert that this is either a string or an object
 */
function assertStringOrObject(obj, name) {
    if (typeof (obj) !== 'string' && typeof (obj) !== 'object') {
        assert.ok(false, name + ' ([string] or [object]) required');
    }
}


/**
 * Determine if /dev/ipfev exists, caching the result for future calls in the
 * global variable haveDevIpfEv.
 */
function haveIpfEventLogger() {
    if (haveDevIpfEv === undefined) {
        haveDevIpfEv = fs.existsSync(DEV_IPFEV);
    }
    return haveDevIpfEv;
}

/**
 * For a rule and a direction, return whether or not we actually need to
 * write ipf rules. FROM+ALLOW and TO+BLOCK are essentially no-ops, as
 * they will be caught by the block / allow catch-all default rules.
 *
 * If the rule has a priority greater than 0, then we always need to write
 * out ipf rules.
 */
function noRulesNeeded(dir, rule) {
    if (rule.priority !== 0) {
        return false;
    }

    if ((dir === 'from' && rule.action === 'allow')
        || (dir === 'to' && rule.action === 'block')) {
        return true;
    }
    return false;
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
                if (hasKey(rule[dir], type)) {
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
        if (hasKey(r, 'uuid') && !hasKey(seenUUIDs, r.uuid)) {
            toReturn.push(r);
            seenUUIDs[r.uuid] = 1;
        }
    });

    return toReturn;
}


/**
 * Given a list of new rules and a map of existing rules, build a list
 * of the subset of new rules that are actually changing anything.
 */
function getChangingRules(rules, existingRules, cb) {
    var changing = rules.filter(function (rule) {
        if (!hasKey(existingRules, rule.uuid)) {
            return true;
        }
        return !mod_obj.shallowObjEqual(rule.serialize(),
            existingRules[rule.uuid].serialize());
    });

    cb(null, changing);
}


/**
 * This filter removes rules that aren't affected by adding a remote VM
 * or updating a local VM (for example, simple wildcard rules), and would
 * therefore require updating the rules of other VMs. This table shows which
 * rules we keep. Each row represents whether or not a new VM or remote VM
 * is a source or destination VM, plus whether or not the rule is a BLOCK
 * or ALLOW rule. Each column represents a collection of targets we might
 * have. Each cell says whether or not we need to update the VMs represented
 * by that column.
 *
 *              |  From   |   To    | From |  To  | From | To
 *              | All VMs | All VMs | Tags | Tags | VMs  | VMs
 * |------------|---------|---------|------|------|------|-----
 * | Dest. VM / |   No    |   No    |  No  |  No  |  No  | No
 * |   ALLOW    |         |         |      |      |      |
 * |------------|---------|---------|------|------|------|-----
 * |  Src VM /  |   No    |   Yes   |  No  |  Yes |  No  | Yes
 * |   ALLOW    |         |         |      |      |      |
 * |------------|---------|---------|------|------|------|-----
 * | Dest. VM / |   Yes   |   No    |  Yes |  No  |  Yes | No
 * |   BLOCK    |         |         |      |      |      |
 * |------------|---------|---------|------|------|------|-----
 * |  Src VM /  |   No    |   No    |  No  |  No  |  No  | No
 * |   BLOCK    |         |         |      |      |      |
 *
 */
function getAffectedRules(new_vms, log) {
    return function _isAffectedRule(rule) {
        if (rule.action === 'allow'
            && vmsOnSide(new_vms, rule, 'from', log).length > 0) {
            return rule.to.wildcards.indexOf('vmall') !== -1
                || rule.to.tags.length > 0
                || rule.to.vms.length > 0;
        } else if (rule.action === 'block'
            && vmsOnSide(new_vms, rule, 'to', log).length > 0) {
            return rule.from.wildcards.indexOf('vmall') !== -1
                || rule.from.tags.length > 0
                || rule.from.vms.length > 0;
        }
        return false;
    };
}


/**
 * Starts ipf and reloads the rules for a VM
 */
function reloadIPF(opts, log, callback) {
    var ipfConf = util.format(IPF_CONF, opts.zonepath);
    var ipf6Conf = util.format(IPF6_CONF, opts.zonepath);

    mod_ipf.reload(opts.vm, ipfConf, ipf6Conf, log, callback);
}



// --- Internal functions



/**
 * Validates the payload passed to the exported functions. Throws an error
 * if not in the right format
 */
function validateOpts(opts) {
    assert.object(opts, 'opts');
    assert.ok(Array.isArray(opts.vms),
        'opts.vms ([object]) required');
    // Allow opts.vms to be empty - it's possible, though unlikely, that
    // there are no VMs on this system
    if (opts.vms.length !== 0) {
        assert.arrayOfObject(opts.vms, 'opts.vms');
    }
}


/**
 * Create rule objects from the rules
 *
 * @param {Array} inRules : raw rule input objects to create
 * @param {Function} callback : `f(err, newRules)`
 * - newRules {Array} : array of rule objects
 */
function createRules(inRules, createdBy, callback) {
    var errors = [];
    var rules = [];
    var ver = mod_rule.generateVersion();

    if (!callback) {
        callback = createdBy;
        createdBy = null;
    }

    if (!inRules || inRules.length === 0) {
        return callback(null, []);
    }

    inRules.forEach(function (payloadRule) {
        var rule = clone(payloadRule);
        if (!hasKey(rule, 'version')) {
            rule.version = ver;
        }

        if (createdBy && !hasKey(rule, 'created_by')) {
            rule.created_by = createdBy;
        }

        try {
            var r = mod_rule.create(rule, { enforceGlobal: true });
            rules.push(r);
        } catch (err) {
            errors.push(err);
        }
    });

    if (errors.length !== 0) {
        return callback(util_err.createMultiError(errors));
    }

    return callback(null, rules);
}


/**
 * Merge updates from the rules in payload, and return the updated
 * rule objects
 */
function createUpdatedRules(opts, log, callback) {
    log.trace('createUpdatedRules: entry');
    var originals = opts.originalRules;
    var updatedRules = opts.updatedRules;

    if (!updatedRules || updatedRules.length === 0) {
        return callback(null, []);
    }

    var mergedRule;
    var origRule;
    var updated = [];
    var ver = mod_rule.generateVersion();

    updatedRules.forEach(function (rule) {
        // Assume that we're allowed to do adds - findRules() would have errored
        // out if allowAdds was unset and an add was attempted
        if (!hasKey(rule, 'version')) {
            rule.version = ver;
        }

        if (opts.createdBy && !hasKey(rule, 'created_by')) {
            rule.created_by = opts.createdBy;
        }

        if (hasKey(originals, rule.uuid)) {
            origRule = originals[rule.uuid].serialize();
            mergedRule = mergeObjects(rule, origRule);

            if (!(hasKey(rule, 'owner_uuid')
                && hasKey(rule, 'global'))) {
                // If both owner_uuid and global are set - let
                // this bubble up the appropriate error in createRules()

                if (hasKey(rule, 'owner_uuid')
                    && hasKey(origRule, 'global')) {
                    // Updating from global -> owner_uuid rule
                    delete mergedRule.global;
                }

                if (hasKey(rule, 'global')
                    && hasKey(origRule, 'owner_uuid')) {
                    // Updating from owner_uuid -> global rule
                    delete mergedRule.owner_uuid;
                }
            }

            if (mod_obj.shallowObjEqual(origRule, mergedRule)) {
                // The rule hasn't changed - do nothing
                delete originals[rule.uuid];
            } else {
                updated.push(mergedRule);
            }
        } else {
            updated.push(rule);
        }
    });

    log.debug(updated, 'createUpdatedRules: rules merged');
    return createRules(updated, callback);
}


function mergeIntoLookup(vmStore, vm) {
    vmStore.all[vm.uuid] = vm;
    mod_obj.addToObj3(vmStore, 'vms', vm.uuid, vm.uuid, vm);

    forEachKey(vm.tags, function (tag, val) {
        createSubObjects(vmStore, 'tags', tag, vm.uuid, vm);
        createSubObjects(vmStore, 'tagValues', tag, val, vm.uuid, vm);
    });

    vm.ips.forEach(function (ip) {
        mod_obj.addToObj3(vmStore, 'ips', ip, vm.uuid, vm);
    });

    // XXX: subnet
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
function createVMlookup(vms, log, callback) {
    log.trace('createVMlookup: entry');

    var errs = [];
    var vmStore = {
        all: {},
        ips: {},
        subnets: {},
        tags: {},
        tagValues: {},
        vms: {},
        wildcards: {}
    };

    vmStore.wildcards.vmall = vmStore.all;

    vms.forEach(function (fullVM) {
        var missing = [];
        VM_FIELDS_REQUIRED.forEach(function (field) {
            if (!hasKey(fullVM, field)) {
                missing.push(field);
            }
        });

        if (missing.length !== 0) {
            log.error({ vm: fullVM, missing: missing }, 'missing VM fields');
            errs.push(new verror.VError(
                'VM %s: missing field%s required for firewall: %s',
                fullVM.uuid,
                missing.length === 0 ? '' : 's',
                missing.join(', ')));
            return;
        }

        var vm = {
            enabled: fullVM.firewall_enabled || false,
            ips: util_vm.ipsFromNICs(fullVM.nics).sort(mod_addr.compare),
            owner_uuid: fullVM.owner_uuid,
            state: fullVM.state,
            tags: fullVM.tags,
            uuid: fullVM.uuid,
            zonepath: fullVM.zonepath
        };
        log.trace(vm, 'Adding VM "%s" to lookup', vm.uuid);

        mergeIntoLookup(vmStore, vm);
    });

    if (errs.length !== 0) {
        return callback(util_err.createMultiError(errs));
    }

    if (log.debug()) {
        var truncated = { };
        ['vms', 'tags', 'ips'].forEach(function (type) {
            truncated[type] = {};
            if (!hasKey(vmStore, type)) {
                return;
            }

            Object.keys(vmStore[type]).forEach(function (t) {
                truncated[type][t] = Object.keys(vmStore[type][t]);
            });
        });

        log.debug(truncated, 'vmStore');
    }

    return callback(null, vmStore);
}


/**
 * Create a lookup table for remote VMs
 */
function createRemoteVMlookup(remoteVMs, log, callback) {
    return callback(null, mod_rvm.createLookup(remoteVMs, log));
}


/**
 * Load a single rule from disk, returning a rule object
 *
 * @param {String} uuid : UUID of the rule to load
 * @param {Function} callback : `f(err, rule)`
 * - vm {Object} : rule object (as per mod_rule)
 */
function loadRule(uuid, log, callback) {
    var file = util.format('%s/%s.json', RULE_PATH, uuid);
    log.debug('loadRule: loading rule file "%s"', file);

    return fs.readFile(file, function (err, raw) {
        if (err) {
            if (err.code == 'ENOENT') {
                var uErr = new verror.VError('Unknown rule "%s"', uuid);
                uErr.code = 'ENOENT';
                return callback(uErr);
            }

            return callback(err);
        }

        var rule;

        try {
            var parsed = JSON.parse(raw);
            log.trace(parsed, 'loadRule: loaded rule file "%s"', file);
            // XXX: validate that the rule has a uuid
            rule = mod_rule.create(parsed);
        } catch (err2) {
            log.error(err2, 'loadRule: error creating rule');
            return callback(err2);
        }

        if (log.trace()) {
            log.trace(rule.toString(), 'loadRule: created rule');
        }

        return callback(null, rule);
    });
}


/**
 * Loads all rules from disk
 */
function loadAllRules(log, callback) {
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

                return loadRule(file.substring(0, file.length - 5),
                    log, function (err2, rule) {
                    if (rule) {
                        rules.push(rule);
                    }
                    return cb(err2);
                });
            }
        }, function (err3, res) {
            if (err3) {
                log.error(err3, 'loadAllRules: return');
                return callback(err3);
            }

            log.debug({ fullRules: rules }, 'loadAllRules: return');
            return callback(null, rules);
        });
    });
}


/*
 * Saves rules to disk
 *
 * @param {Array} rules : rule objects to save
 * @param {Function} callback : `f(err)`
 */
function saveRules(rules, log, callback) {
    var uuids = [];
    var versions = {};
    log.debug({ rules: rules }, 'saveRules: entry');

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
                    log.trace(ser, 'writing "%s"', filename);

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
                    log.trace('renaming "%s" to "%s"', before, after);
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
 * @param {Function} callback : `f(err)`
 */
function deleteRules(rules, log, callback) {
    log.debug({ rules: rules }, 'deleteRules: entry');

    return vasync.forEachParallel({
        inputs: rules.map(function (r) { return r.uuid; }),
        func: function _delRule(uuid, cb) {
            var filename = util.format('%s/%s.json', RULE_PATH, uuid);
            log.trace('deleting "%s"', filename);

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
 * Loads rules and remote VMs from disk
 */
function loadDataFromDisk(log, callback) {
    var onDisk = {};

    vasync.parallel({
        funcs: [
            function _diskRules(cb) {
                loadAllRules(log, function (err, res) {
                    if (res) {
                        onDisk.rules = res;
                        onDisk.rulesByUUID = {};
                        onDisk.rules.forEach(function (rule) {
                            onDisk.rulesByUUID[rule.uuid] = rule;
                        });
                    }

                    return cb(err);
                });
            },

            function _diskRemoteVMs(cb) {
                mod_rvm.loadAll(log, function (err, res) {
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
function findRules(opts, log, callback) {
    log.trace('findRules: entry');
    var allowAdds = opts.allowAdds || false;
    var allRules = opts.allRules;
    var rules = opts.rules;

    if (!rules || rules.length === 0) {
        return callback(null, []);
    }

    var errs = [];
    var found = {};
    var missing = {};

    rules.forEach(function (r) {
        if (!hasKey(r, 'uuid')) {
            errs.push(new verror.VError('Missing UUID of rule: %j', r));
            return;
        }

        if (hasKey(allRules, r.uuid)) {
            found[r.uuid] = allRules[r.uuid];
        } else {
            missing[r.uuid] = 1;
        }
    });

    // If we're allowing adds, missing rules aren't an error
    if (!allowAdds && !objEmpty(missing)) {
        Object.keys(missing).forEach(function (uuid) {
            errs.push(new verror.VError('Unknown rule: %s', uuid));
        });
    }

    if (log.debug()) {
        var ret = { rules: found };
        if (allowAdds) {
            ret.adds = Object.keys(missing);
        } else {
            ret.missing = Object.keys(missing);
        }
        log.debug(ret, 'findRules: return');
    }

    if (errs.length !== 0) {
        callback(util_err.createMultiError(errs));
        return;
    }

    callback(null, found);
}


/**
 * Looks up the given VMs in the VM lookup object, and returns an
 * object mapping UUIDs to VM lookup objects
 */
function lookupVMs(allVMs, vms, log, callback) {
    log.debug({ vms: vms }, 'lookupVMs: entry');

    if (!vms || vms.length === 0) {
        log.debug('lookupVMs: no VMs to lookup: returning');
        return callback(null, {});
    }

    var toReturn = {};
    var errs = [];
    vms.forEach(function (vm) {
        if (!hasKey(vm, 'uuid')) {
            errs.push(new verror.VError('VM missing uuid property: %j', vm));
            return;
        }
        if (!hasKey(allVMs.all, vm.uuid)) {
            errs.push(new verror.VError('Could not find VM "%s" in VM list',
                vm.uuid));
            return;
        }
        toReturn[vm.uuid] = allVMs.all[vm.uuid];
    });

    if (errs.length !== 0) {
        return callback(util_err.createMultiError(errs));
    }

    log.debug({ vms: toReturn }, 'lookupVMs: return');
    return callback(null, toReturn);
}


/**
 * Validates the list of rules, ensuring that there's enough information
 * to write each rule to disk
 *
 * @param vms {Object}: VM lookup table, as returned by createVMlookup()
 * @param rvms {Object}: remote VM lookup table, as returned by
 *     createRemoteVMlookup()
 * @param rules {Array}: array of rule objects
 * @param callback {Function} `function (err)`
 */
function validateRules(vms, rvms, rules, log, callback) {
    log.trace(rules, 'validateRules: entry');
    var sideData = {};
    var errs = [];
    var rulesLeft = rules.reduce(function (h, r) {
        h[r.uuid] = r;
        return h;
    }, {});

    // XXX: make owner uuid aware

    // First go through the rules finding all the VMs we need rules for,
    // and mark any missing types
    ruleTypeDirWalk(rules, function _getRuleData(rule, dir, type, t) {
        // Don't bother checking IPs, since we don't need any additional
        // data in order to create an ipf rule
        if (type == 'ips') {
            return;
        }

        // Allow creating rules that target tags, but not any specific VMs
        if (type == 'tags') {
            delete rulesLeft[rule.uuid];
            return;
        }

        createSubObjects(sideData, rule.uuid, dir, 'missing', type);
        createSubObjects(sideData, rule.uuid, dir, 'vms');

        if (hasKey(vms[type], t)) {
            for (var vm in vms[type][t]) {
                sideData[rule.uuid][dir].vms[vm] = 1;
            }
            delete rulesLeft[rule.uuid];
        } else if (hasKey(rvms[type], t)) {
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

        if (!missing) {
            return;
        }

        DIRECTIONS.forEach(function (dir) {
            var otherSide = (dir == 'to' ? 'from' : 'to');

            if (!hasKey(missing, dir) || objEmpty(missing[dir].vms)
                || !hasKey(missing, otherSide)) {
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
        return callback(util_err.createMultiError(errs));
    }

    return callback();
}


/**
 * Returns the appropriate target string based on the rule's protocol
 * (eg: code for ICMP, port for TCP / UDP)
 */
function protoTarget(rule, target) {
    if (target === 'all') {
        return '';
    } else if (icmpr.test(rule.protocol)) {
        var typeArr = target.split(':');
        return 'icmp-type ' + typeArr[0]
            + (typeArr.length === 1 ? '' : ' code ' + typeArr[1]);
    } else {
        if (hasKey(target, 'start')
            && hasKey(target, 'end')) {
            return 'port ' + target.start + ' : ' + target.end;
        } else {
            return 'port = ' + target;
        }
    }
}


/**
 * Compare two port targets. Valid values are "all", numbers, or an object
 * representing a port range containing "start" and "end" fields.
 */
function comparePorts(p1, p2) {
    // "all" comes before any port numbers
    if (p1 === 'all') {
        if (p2 === 'all') {
            return 0;
        } else {
            return -1;
        }
    } else if (p2 === 'all') {
        return 1;
    }

    var n1 = p1.hasOwnProperty('start') ? p1.start : p1;
    var n2 = p2.hasOwnProperty('start') ? p2.start : p2;

    return Number(n1) - Number(n2);
}


/**
 * Compare two ICMP type targets. Valid values are "all" or strings like "5" or
 * "5:3", representing the ICMP type number and code.
 */
function compareTypes(t1, t2) {
    // "all" comes before any types
    if (t1 === 'all') {
        if (t2 === 'all') {
            return 0;
        } else {
            return -1;
        }
    } else if (t2 === 'all') {
        return 1;
    }

    var p1 = t1.split(':');
    var p2 = t2.split(':');
    var c = Number(p1[0]) - Number(p2[0]);
    if (c !== 0) {
        return c;
    }

    if (p1.length === 1) {
        if (p2.length === 1) {
            return 0;
        } else {
            return -1;
        }
    } else if (p2.length === 1) {
        return 1;
    } else {
        return Number(p1[1]) - Number(p2[1]);
    }
}


/**
 * Compare IP and subnet targets from an ipf rule object.
 */
function compareAddrs(a1, a2) {
    var s1 = a1.split('/');
    var s2 = a2.split('/');

    return mod_addr.compare(s1[0], s2[0]);
}


/**
 * This comparison function is used to sort the output ipf rule objects
 * in the following order:
 *
 * 1. First by protocol: icmp, icmp6, tcp, udp.
 * 2. Then by direction: outbound rules, then inbound.
 * 3. By priority level (higher priorities come first).
 * 4. By action:
 *   a) For outbound traffic, block comes before allow.
 *   b) For inbound traffic, allow comes before block.
 * 5. By the first port or type listed.
 * 6. By the first targeted IP.
 *
 * 1 and 2 help apply some organization to the output file.
 * 5 and 6 help make testing easier by putting things in a predictable order.
 *
 * 3 and 4 are the actual, important metric to sort on: priority and action
 * are important for ensuring that the actions taken by ipfilter are applied in
 * the order that fwadm(1M) describes.
 */
function compareRules(r1, r2) {
    var res;

    // Protocol:
    if (r1.protocol < r2.protocol) {
        return -1;
    }

    if (r1.protocol > r2.protocol) {
        return 1;
    }

    // Direction:
    if (r1.direction < r2.direction) {
        return -1;
    }

    if (r1.direction > r2.direction) {
        return 1;
    }

    // Priority levels:
    if (r1.priority < r2.priority) {
        return 1;
    }

    if (r1.priority > r2.priority) {
        return -1;
    }

    // Action:
    if (r1.direction === 'from') {
        if (r1.action === 'allow') {
            if (r2.action === 'block') {
                return 1;
            }
        } else if (r2.action === 'allow') {
            if (r1.action === 'block') {
                return -1;
            }
        }
    } else {
        if (r1.action === 'allow') {
            if (r2.action === 'block') {
                return -1;
            }
        } else if (r2.action === 'allow') {
            if (r1.action === 'block') {
                return 1;
            }
        }
    }

    // Ports and types:
    if (icmpr.test(r1.protocol)) {
        res = compareTypes(r1.protoTargets[0], r2.protoTargets[0]);
    } else {
        res = comparePorts(r1.protoTargets[0], r2.protoTargets[0]);
    }

    if (res !== 0) {
        return res;
    }

    // Target IPs and subnets:
    return compareAddrs(r1.targets[0], r2.targets[0]);
}


/**
 * Returns an object containing ipf rule text and enough data to sort on
 */
function ipfRuleObj(opts) {
    var dir = opts.direction;
    var rule = opts.rule;

    var targets = Array.isArray(opts.targets) ?
        opts.targets : [ opts.targets ];

    // ipfilter uses /etc/protocols which calls ICMPv6 'ipv6-icmp'
    var ipfProto = (rule.protocol === 'icmp6') ? 'ipv6-icmp' : rule.protocol;

    var readtags = [];
    if (haveIpfEventLogger()) {
        if (rule.uuid) {
            readtags.push(util.format('uuid=%s', rule.uuid));
        }
        if (rule.log) {
            readtags.push('cfwlog');
        }
    }

    var sortObj = {
        action: rule.action,
        direction: dir,
        priority: rule.priority,
        protocol: rule.protocol,
        header: util.format('\n# rule=%s, version=%s, %s=%s',
            rule.uuid, rule.version, opts.type, opts.value),
        v4text: [],
        v6text: [],
        targets: targets,
        protoTargets: rule.protoTargets,
        type: opts.type,
        uuid: rule.uuid,
        value: opts.value,
        version: rule.version,
        allTags: readtags.length !== 0 ?
            util.format(' set-tag(%s)', readtags.join(', ')) : ''
    };

    if (opts.type === 'wildcard' && opts.value === 'any') {
        rule.protoTargets.forEach(function (t) {
            var wild = util.format('%s %s quick proto %s from any to any %s',
                rule.action === 'allow' ? 'pass' : 'block',
                dir === 'from' ? 'out' : 'in',
                ipfProto,
                protoTarget(rule, t));
            if (rule.protocol !== 'icmp6') { sortObj.v4text.push(wild); }
            if (rule.protocol !== 'icmp') { sortObj.v6text.push(wild); }
        });

        return sortObj;
    }

    targets.forEach(function (target) {
        var isv6 = target.indexOf(':') !== -1;

        // Don't generate rules for ICMPv4/IPv6 or ICMPv6/IPv4
        if ((isv6 && rule.protocol === 'icmp')
            || (!isv6 && rule.protocol === 'icmp6')) {
            return;
        }

        var text = isv6 ? sortObj.v6text : sortObj.v4text;

        rule.protoTargets.forEach(function (t) {
            text.push(
                util.format('%s %s quick proto %s from %s to %s %s',
                    rule.action === 'allow' ? 'pass' : 'block',
                    dir === 'from' ? 'out' : 'in',
                    ipfProto,
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
function prepareIPFdata(opts, log, callback) {
    var allVMs = opts.allVMs;
    var date = new Date();
    var rules = opts.rules;
    var vms = opts.vms;
    var remoteVMs = opts.remoteVMs || { ips: {}, vms: {}, tags: {} };

    log.debug({ vms: vms, rules: rules }, 'prepareIPFdata: entry');

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

    /* Gather the VMs targeted on each side of every enabled rule. */
    var targetVMs = rules.map(function (rule) {
        if (!rule.enabled) {
            return null;
        }

        return {
            from: vmsOnSide(allVMs, rule, 'from', log),
            to: vmsOnSide(allVMs, rule, 'to', log)
        };
    });

    /*
     * If we block outbound traffic for a protocol, make sure to also track
     * inbound state for anything allowed, so that we'll allow response
     * packets.
     *
     * We could just always enable state tracking for all of our inbound
     * allow rules, but state tracking can get pretty expensive. There's no
     * need to penalize all firewall users.
     */
    var keepInboundState = { };
    rules.forEach(function (rule, i) {
        if (!rule.enabled || rule.action === 'allow') {
            return;
        }

        targetVMs[i].from.forEach(function (uuid) {
            if (!hasKey(keepInboundState, uuid)) {
                keepInboundState[uuid] = {};
            }
            keepInboundState[uuid][rule.protocol] = true;
        });
    });

    rules.forEach(function (rule, i) {
        if (!rule.enabled) {
            return;
        }

        DIRECTIONS.forEach(function (dir) {
            // XXX: add to errors here if missing

            // Default outgoing policy is 'allow' and default incoming policy
            // is 'block', so these are effectively no-ops:
            if (noRulesNeeded(dir, rule)) {
                return;
            }

            var otherSideRules =
                rulesFromOtherSide(rule, dir, allVMs, remoteVMs);

            targetVMs[i][dir].forEach(function (uuid) {
                /*
                 * If the VM's firewall is disabled, we don't need to write out
                 * rules for it.
                 */
                if (!allVMs.all[uuid].enabled || !hasKey(conf, uuid)) {
                    return;
                }

                conf[uuid] = conf[uuid].concat(otherSideRules);
            });
        });
    });

    var toReturn = [];
    for (var vm in conf) {
        var rulesIncluded = {};
        var ipf4Conf = [
            '# DO NOT EDIT THIS FILE. THIS FILE IS AUTO-GENERATED BY fwadm(1M)',
            '# AND MAY BE OVERWRITTEN AT ANY TIME.',
            '#',
            '# File generated at ' + date.toString(),
            '#'
        ];
        if (haveIpfEventLogger()) {
            ipf4Conf.push('# smartos_ipf_version 2');
        }
        ipf4Conf.push('#', '');
        var ipf6Conf = ipf4Conf.slice();
        var iks = hasKey(keepInboundState, vm) ? keepInboundState[vm] : {};

        conf[vm].sort(compareRules).forEach(function (sortObj) {
            var ktxt = KEEP_FRAGS;
            if (sortObj.allTags !== ''
                || (sortObj.direction === 'from' && sortObj.action === 'allow')
                || (sortObj.direction === 'to' && iks[sortObj.protocol])) {
                ktxt += KEEP_STATE + sortObj.allTags;
            }

            if (!hasKey(rulesIncluded, sortObj.uuid)) {
                rulesIncluded[sortObj.uuid] = [];
            }
            rulesIncluded[sortObj.uuid].push(sortObj.direction);

            ipf4Conf.push(sortObj.header);
            ipf6Conf.push(sortObj.header);

            sortObj.v4text.forEach(function (line) {
                ipf4Conf.push(line + ktxt);
            });
            sortObj.v6text.forEach(function (line) {
                ipf6Conf.push(line + ktxt);
            });
        });

        log.debug(rulesIncluded, 'VM %s: generated ipf(6).conf', vm);

        var v4rules = ipf4Conf.concat(v4fallbacks);
        var v6rules = ipf6Conf.concat(v6fallbacks);

        toReturn.push({
            uuid: vm,
            zonepath: allVMs.all[vm].zonepath,
            v4text: v4rules.join('\n') + '\n',
            v6text: v6rules.join('\n') + '\n'
        });
    }

    return callback(null, toReturn);
}


/**
 * Returns an array of the UUIDs of VMs on the given side of a rule
 */
function vmsOnSide(allVMs, rule, dir, log) {
    var matching = [];

    ['vms', 'tags', 'wildcards'].forEach(function (walkType) {
        rule[dir][walkType].forEach(function (t) {
            var type = walkType;
            var value;
            if (typeof (t) !== 'string') {
                value = t[1];
                t = t[0];
                type = 'tagValues';
            }

            if (type === 'wildcards' && t === 'any') {
                return;
            }

            if (!allVMs[type] || !hasKey(allVMs[type], t)) {
                log.debug('No matching VMs found in lookup for %s=%s', type, t);
                return;
            }

            var vmList = allVMs[type][t];
            if (value !== undefined) {
                if (!hasKey(vmList, value)) {
                    return;
                }
                vmList = vmList[value];
            }

            Object.keys(vmList).forEach(function (uuid) {
                if (hasKey(rule, 'owner_uuid')
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
            targets: [ '0.0.0.0' ],
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
            var lookupType = type;
            var lookupTypePlural = typePlural;
            var t;

            if (typeof (value) !== 'string') {
                t = value[1];
                value = value[0];
                lookupType = 'tagValue';
                lookupTypePlural = 'tagValues';
            }

            if (lookupTypePlural === 'wildcards' && value === 'any') {
                return;
            }

            [localVMs, remoteVMs].forEach(function (lookup) {
                if (!hasKey(lookup, lookupTypePlural)
                    || !hasKey(lookup[lookupTypePlural], value)) {
                    return;
                }

                var vmList = lookup[lookupTypePlural][value];
                if (t !== undefined) {
                    if (!hasKey(vmList, t)) {
                        return;
                    }
                    vmList = vmList[t];
                }

                forEachKey(vmList, function (uuid, vm) {
                    if (rule.owner_uuid && vm.owner_uuid
                        && vm.owner_uuid != rule.owner_uuid) {
                        return;
                    }

                    if (vm.ips.length === 0) {
                        return;
                    }

                    ipfRules.push(ipfRuleObj({
                        rule: rule,
                        direction: dir,
                        targets: vm.ips,
                        type: lookupType,
                        value: value
                    }));
                });
            });
        });
    });

    return ipfRules;
}


/**
 * Gets remote targets from the other side of the rule and adds them to
 * the targets object
 */
function addOtherSideRemoteTargets(vms, rule, targets, dir, log) {
    var matching = vmsOnSide(vms, rule, dir, log);
    if (matching.length === 0) {
        return;
    }

    var otherSide = dir === 'from' ? 'to' : 'from';
    if (rule[otherSide].tags.length !== 0) {
        if (!hasKey(targets, 'tags')) {
            targets.tags = {};
        }

        // All tags (no value) wins out over tags with
        // a value. If multiple values for the same tag
        // are present, return them as an array
        rule[otherSide].tags.forEach(function (tag) {
            var key = tag;
            var val = true;
            if (typeof (tag) !== 'string') {
                key = tag[0];
                val = tag[1];
            }

            if (!hasKey(targets.tags, key)) {
                targets.tags[key] = val;
            } else {
                if (targets.tags[key] !== true) {
                    if (val === true) {
                        targets.tags[key] = val;
                    } else {
                        if (!Array.isArray(targets.tags[key])) {
                            targets.tags[key] = [ targets.tags[key] ];
                        }

                        if (targets.tags[key].indexOf(val) === -1) {
                            targets.tags[key].push(val);
                        }
                    }
                }
            }
        });
    }

    if (rule[otherSide].vms.length !== 0) {
        if (!hasKey(targets, 'vms')) {
            targets.vms = {};
        }

        rule[otherSide].vms.forEach(function (vm) {
            // Don't add if it's a local VM
            if (!hasKey(vms.all, vm)) {
                targets.vms[vm] = true;
            }
        });
    }

    if (rule[otherSide].wildcards.indexOf('vmall') !== -1) {
        targets.allVMs = true;
    }
}


/**
 * Carefully move the new ipfilter configuration file into place. It's
 * important to make sure that if we fail or crash at any point that we
 * leave a file in place, since its presence is what determines whether
 * to enable the firewall at zone boot.
 */
function replaceIPFconf(file, data, ver, callback) {
    var tempFile = util.format('%s.%s', file, ver);
    var oldFile = util.format('%s.old', file);

    vasync.pipeline({
    funcs: [
        function _write(_, cb) {
            fs.writeFile(tempFile, data, cb);
        },
        function _unlinkOld(_, cb) {
            fs.unlink(oldFile, function (err) {
                if (err && err.code === 'ENOENT') {
                    cb(null);
                    return;
                }

                cb(err);
            });
        },
        function _linkOld(_, cb) {
            fs.link(file, oldFile, function (err) {
                if (err && err.code === 'ENOENT') {
                    cb(null);
                    return;
                }

                cb(err);
            });
        },
        function _renameTemp(_, cb) {
            fs.rename(tempFile, file, cb);
        }
    ]}, callback);
}


/**
 * Saves all of the generated ipfilter rules in ipfData to disk. We handle
 * each VM separately in parallel, so that failures for one don't impact
 * reloading others. For example, a VM may have filled up its disk, and we
 * now can't write out its configuration, or a VM may have stopped on us
 * before we had a chance to run ipf(1M) on it.
 */
function saveConfsAndReload(opts, ipfData, log, callback) {
    var ver = Date.now(0) + '.' + sprintf('%06d', process.pid);
    var files = {};
    var uuids = [];

    vasync.forEachParallel({
        inputs: ipfData,
        func: function (vm, cb) {
            uuids.push(vm.uuid);

            vasync.pipeline({
            funcs: [
                // Write the new ipf.conf for IPv4 rules:
                function writeV4(_, cb2) {
                    var filename = util.format(IPF_CONF, vm.zonepath);
                    files[filename] = vm.v4text;

                    if (opts.dryrun) {
                        cb2(null);
                        return;
                    }

                    replaceIPFconf(filename, vm.v4text, ver, cb2);
                },

                // Write the new ipf6.conf for IPv6 rules:
                function writeV6(_, cb2) {
                    var filename = util.format(IPF6_CONF, vm.zonepath);
                    files[filename] = vm.v6text;

                    if (opts.dryrun) {
                        cb2(null);
                        return;
                    }

                    replaceIPFconf(filename, vm.v6text, ver, cb2);
                },

                // Restart the VM's firewall:
                function reload(_, cb2) {
                    if (opts.dryrun) {
                        cb2(null);
                        return;
                    }

                    restartFirewall(opts.allVMs, vm.uuid, log, cb2);
                }
            ]}, cb);
        }
    }, function (err) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, {
            files: files,
            vms: uuids
        });
    });
}


/**
 * Restart the given VMs firewall.
 *
 * @param vms {Object}: VM lookup table, as returned by createVMlookup()
 * @param uuid {UUID}: The UUID of the target VM
 * @param callback {Function} `function (err)`
 */
function restartFirewall(vms, uuid, log, cb) {
    if (!vms.all[uuid].enabled || vms.all[uuid].state !== 'running') {
        log.debug('restartFirewalls: VM "%s": not restarting '
            + '(enabled=%s, state=%s)', uuid, vms.all[uuid].enabled,
            vms.all[uuid].state);
        cb(null);
        return;
    }

    log.debug('restartFirewalls: reloading firewall for VM "%s" '
        + '(enabled=%s, state=%s)', uuid, vms.all[uuid].enabled,
        vms.all[uuid].state);

    // Reload the firewall, and start it if necessary.
    reloadIPF({ vm: uuid, zonepath: vms.all[uuid].zonepath }, log,
        function (err, res) {
        if (err && zoneNotRunning(res)) {
            /*
             * An error starting the firewall due to the zone not
             * running isn't really an error.
             */
            cb();
            return;
        }

        cb(err);
    });
}


/**
 * Applies firewall changes:
 * - saves / deletes rule files as needed
 * - writes out ipf conf files
 * - starts or restarts ipf in VMs
 *
 * @param {Object} opts :
 *   - allRemoteVMs {Object} : VM lookup object of all remote VMs
 *   - allVMs {Object} : VM lookup object of all local VMs
 *   - del {Object} : Objects to delete from disk:
 *     - rules {Array of Objects} : rules objects to delete
 *     - rvms {Array of Objects} : remote VM UUIDs to delete
 *   - dryRun {Bool} : if true, no files will be written or firewalls reloaded
 *   - rules {Array of Objects} : rules to write out
 *   - save {Object} : Objects to save to disk:
 *     - rules {Array of Objects} : rule objects to save
 *     - remoteVMs {Array of Objects} : remote VM objects to save
 *   - vms {Object} : Mapping of UUID to VM object - VMs to write out
 *     firewalls for, regardless of whether or not rules affect them
 *     (necessary for catching the case where a VM used to have rules that
 *     applied to it but no longer does)
 */
function applyChanges(opts, log, callback) {
    log.trace(opts, 'applyChanges: entry');

    assert.object(opts, 'opts');
    assert.optionalObject(opts.allRemoteVMs, 'opts.allRemoteVMs');
    assert.optionalObject(opts.allVMs, 'opts.allVMs');
    assert.optionalObject(opts.del, 'opts.del');
    assert.optionalArrayOfObject(opts.rules, 'opts.rules');
    assert.optionalObject(opts.vms, 'opts.vms');
    assert.optionalObject(opts.save, 'opts.save');

    pipeline({
    funcs: [
        // Generate the ipf files for each VM
        function reloadPlan(res, cb) {
            prepareIPFdata({
                allVMs: opts.allVMs,
                remoteVMs: opts.allRemoteVMs,
                rules: opts.rules,
                vms: opts.vms
            }, log, cb);
        },

        // Save the remote VMs
        function saveVMs(res, cb) {
            if (opts.dryrun || !opts.save || !opts.save.remoteVMs
                || objEmpty(opts.save.remoteVMs)) {
                return cb(null);
            }
            mod_rvm.save(opts.save.remoteVMs, log, cb);
        },

        // Save rule files (if specified)
        function save(res, cb) {
            if (opts.dryrun || !opts.save || !opts.save.rules
                || opts.save.rules.length === 0) {
                return cb(null);
            }
            saveRules(opts.save.rules, log, cb);
        },

        // Delete rule files (if specified)
        function delRules(res, cb) {
            if (opts.dryrun || !opts.del || !opts.del.rules
                || opts.del.rules.length === 0) {
                return cb(null);
            }
            deleteRules(opts.del.rules, log, cb);
        },

        // Delete remote VMs (if specified)
        function delRVMs(res, cb) {
            if (opts.dryrun || !opts.del || !opts.del.rvms
                || opts.del.rvms.length === 0) {
                return cb(null);
            }
            mod_rvm.del(opts.del.rvms, log, cb);
        },

        // Write the new ipf files to disk and restart affected VMs
        function ipfData(res, cb) {
            saveConfsAndReload(opts, res.reloadPlan, log, cb);
        }
    ] }, function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        var toReturn = {
            vms: res.state.ipfData.vms
        };

        if (opts.save) {
            if (opts.save.rules) {
                toReturn.rules = opts.save.rules.map(function (r) {
                    return r.serialize();
                });
            }

            if (opts.save.remoteVMs) {
                toReturn.remoteVMs = Object.keys(opts.save.remoteVMs).sort();
            }
        }

        if (opts.del) {
            if (opts.del.rules) {
                toReturn.rules = opts.del.rules.map(function (r) {
                    return r.serialize();
                });
            }

            if (opts.del.rvms && opts.del.rvms.length !== 0) {
                toReturn.remoteVMs = opts.del.rvms.sort();
            }
        }

        if (opts.filecontents) {
            toReturn.files = res.state.ipfData.files;
        }

        callback(null, toReturn);
    });
}


/**
 * Examine the stderr from an ipf command and return true if the zone
 * wasn't running at the time
 */
function zoneNotRunning(res) {
    return res && res.stderr && res.stderr.indexOf(NOT_RUNNING_MSG) !== -1;
}



// --- Exported functions


/**
 * Functions that touch anything in the following directories:
 *
 *   - /var/fw (such as /var/fw/rules and /var/fw/vms)
 *   - /zones/<uuid>/config (e.g. ipf.conf and ipf6.conf)
 *
 * Should acquire the appropriate type of lock so that they read and write
 * a consistent view of the local firewall rules, and so that parallel
 * executions don't run into each other while operating. (See FWAPI-240.)
 */


/**
 * Add rules, local VMs or remote VMs
 *
 * @param {Object} opts : options
 *   - localVMs {Array} : list of local VMs to update
 *   - remoteVMs {Array} : list of remote VMs to add
 *   - rules {Array} : list of rules
 *   - vms {Array} : list of VMs from vmadm
 * @param {Function} callback : `f(err, res)`
 */
function add(opts, callback) {
    try {
        validateOpts(opts);
        assert.optionalArrayOfObject(opts.rules, 'opts.rules');
        assert.optionalArrayOfObject(opts.localVMs, 'opts.localVMs');
        assert.optionalArrayOfObject(opts.remoteVMs, 'opts.remoteVMs');
        assert.optionalString(opts.createdBy, 'opts.createdBy');

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
    var log = util_log.entry(opts, 'add');

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireExclusiveLock(cb);
        },

        function originalRules(_, cb) {
            createRules(opts.rules, opts.createdBy, cb);
        },

        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },

        function disk(_, cb) { loadDataFromDisk(log, cb); },

        // If we're trying to add a rule that already exists and looks
        // the same, drop it.
        function rules(res, cb) {
            getChangingRules(res.originalRules, res.disk.rulesByUUID, cb);
        },

        function newRemoteVMs(res, cb) {
            mod_rvm.create({ allVMs: res.vms, requireIPs: true, log: log },
                opts.remoteVMs, cb);
        },

        // Create remote VMs (if any) from payload
        function remoteVMs(res, cb) {
            createRemoteVMlookup(res.newRemoteVMs, log, cb);
        },

        // Create a combined remote VM lookup of remote VMs on disk plus
        // new remote VMs in the payload
        function allRemoteVMs(res, cb) {
            createRemoteVMlookup([res.disk.remoteVMs, res.newRemoteVMs],
                log, cb);
        },

        function localVMs(res, cb) {
            lookupVMs(res.vms, opts.localVMs, log, cb);
        },

        // Build a table for information about newly added local/remote VMs
        function newVMs(res, cb) {
            var nvms = clone(res.remoteVMs);
            mod_obj.values(res.localVMs).map(mergeIntoLookup.bind(null, nvms));
            cb(null, nvms);
        },

        function allRules(res, cb) {
            return cb(null, dedupRules(res.rules, res.disk.rules));
        },

        // Get VMs the added rules affect
        function matchingVMs(res, cb) {
            filter.vmsByRules({
                log: log,
                rules: res.rules,
                vms: res.vms
            }, cb);
        },

        // Get rules the added remote VMs affect
        function remoteVMrules(res, cb) {
            filter.rulesByRVMs(res.remoteVMs, res.allRules, log, cb);
        },

        // Get any rules that the added local VMs target
        function localVMrules(res, cb) {
            filter.rulesByVMs(res.vms, res.localVMs, res.allRules, log, cb);
        },

        // Merge the local and remote VM rules, and use that list to find
        // the VMs affected.
        function localAndRemoteVMsAffected(res, cb) {
            var affectedRules = dedupRules(res.localVMrules, res.remoteVMrules)
                .filter(getAffectedRules(res.newVMs, log));
            filter.vmsByRules({
                log: log,
                rules: affectedRules,
                vms: res.vms
            }, cb);
        },

        function mergedVMs(res, cb) {
            var ruleVMs = mergeObjects(res.localVMs, res.matchingVMs);
            return cb(null, mergeObjects(ruleVMs,
                res.localAndRemoteVMsAffected));
        },

        // Get the rules that need to be written out for all VMs, before and
        // after the update
        function vmRules(res, cb) {
            filter.rulesByVMs(res.vms, res.mergedVMs, res.allRules, log, cb);
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
            }, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'add: finish');
            return callback(err);
        }

        log.debug(res.state.apply, 'add: finish');
        return callback(err, res.state.apply);
    });
}


/**
 * Delete rules
 *
 * @param {Object} opts : options
 *   - uuids {Array} : list of rules
 *   - vms {Array} : list of VMs from vmadm
 * @param {Function} callback : `f(err, res)`
 */
function del(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assert.optionalArrayOfString(opts.rvmUUIDs, 'opts.rvmUUIDs');
        assert.optionalArrayOfString(opts.uuids, 'opts.uuids');
        assert.arrayOfObject(opts.vms, 'vms');

        var rvmUUIDs = opts.rvmUUIDs || [];
        var uuids = opts.uuids || [];
        if (rvmUUIDs.length === 0 && uuids.length === 0) {
            throw new Error(
                'Payload must contain one of: rvmUUIDs, uuids');
        }
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'del');

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireExclusiveLock(cb);
        },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },

        function disk(_, cb) { loadDataFromDisk(log, cb); },

        function allRemoteVMs(state, cb) {
            createRemoteVMlookup(state.disk.remoteVMs, log, cb);
        },

        // Get matching remote VMs
        function remoteVMs(state, cb) {
            filter.rvmsByUUIDs(state.allRemoteVMs, opts.rvmUUIDs, log, cb);
        },

        // Get rules the delted remote VMs affect
        function remoteVMrules(res, cb) {
            filter.rulesByRVMs(res.remoteVMs.matching, res.disk.rules,
                log, cb);
        },

        // Get VMs that are affected by the remote VM rules
        function rvmVMs(res, cb) {
            filter.vmsByRules({
                log: log,
                rules: res.remoteVMrules,
                vms: res.vms
            }, cb);
        },

        // Get the deleted rules
        function rules(res, cb) {
            filter.rulesByUUIDs(res.disk.rules, opts.uuids, log, cb);
        },

        // Get VMs the deleted rules affect
        function ruleVMs(res, cb) {
            filter.vmsByRules({
                log: log,
                rules: res.rules.matching,
                vms: res.vms
            }, cb);
        },

        // Now find all rules that apply to those VMs, omitting the
        // rules that are deleted
        function vmRules(res, cb) {
            filter.rulesByVMs(res.vms,
                mergeObjects(res.ruleVMs, res.rvmVMs),
                res.rules.notMatching, log, cb);
        },

        function apply(res, cb) {
            applyChanges({
                allVMs: res.vms,
                dryrun: opts.dryrun,
                filecontents: opts.filecontents,
                allRemoteVMs: res.remoteVMs.notMatching,
                rules: res.vmRules,
                del: {
                    rules: res.rules.matching,
                    rvms: objEmpty(res.remoteVMs.matching.all) ?
                        null : Object.keys(res.remoteVMs.matching.all)
                },
                vms: mergeObjects(res.ruleVMs, res.rvmVMs)
            }, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'del: finish');
            return callback(err);
        }

        log.debug(res.state.apply, 'del: finish');
        return callback(err, res.state.apply);
    });
}


/**
 * Returns a remote VM
 *
 * @param opts {Object} : options:
 * - remoteVM {String} : UUID of remote VM to get
 * @param callback {Function} : `function (err, rvm)`
 */
function getRemoteVM(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assert.string(opts.remoteVM, 'opts.remoteVM');
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'getRemoteVM', true);

    mod_lock.acquireSharedLock(function (lErr, fd) {
        if (lErr) {
            callback(lErr);
            return;
        }

        mod_rvm.load(opts.remoteVM, log, function (err, rvm) {
            mod_lock.releaseLock(fd);

            if (err) {
                if (err.code == 'ENOENT') {
                    // Don't write a log file for "not found"
                    log.info(err, 'getRemoteVM: finish');
                } else {
                    util_log.finishErr(log, err, 'getRemoteVM: finish');
                }
                return callback(err);
            }

            log.debug(rvm, 'getRemoteVM: finish');
            return callback(null, rvm);
        });
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
    var log = util_log.entry(opts, 'get', true);

    mod_lock.acquireSharedLock(function (lErr, fd) {
        if (lErr) {
            callback(lErr);
            return;
        }

        loadRule(opts.uuid, log, function (err, rule) {
            mod_lock.releaseLock(fd);

            if (err) {
                if (err.code == 'ENOENT') {
                    // Don't write a log file for "not found"
                    log.info(err, 'get: finish');
                } else {
                    util_log.finishErr(log, err, 'get: finish');
                }
                return callback(err);
            }

            var ser = rule.serialize();
            log.debug(ser, 'get: finish');
            return callback(null, ser);
        });
    });
}


/**
 * List remote VMs
 */
function listRemoteVMs(opts, callback) {
    try {
        assert.object(opts, 'opts');
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'listRemoteVMs', true);

    mod_lock.acquireSharedLock(function (lErr, fd) {
        if (lErr) {
            callback(lErr);
            return;
        }

        mod_rvm.loadAll(log, function (err, res) {
            mod_lock.releaseLock(fd);

            if (err) {
                util_log.finishErr(log, err, 'listRemoteVMs: finish');
                return callback(err);
            }

            // XXX: support sorting by other fields, filtering
            var sortFn = function _sort(a, b) {
                return (a.uuid > b.uuid) ? 1 : -1;
            };

            log.debug('listRemoteVMs: finish');
            return callback(null, Object.keys(res).map(function (r) {
                return res[r];
            }).sort(sortFn));
        });
    });
}


/**
 * List rules
 */
function listRules(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assert.optionalArrayOfString(opts.fields, 'opts.fields');
        if (opts.fields) {
            var invalid = [];
            opts.fields.forEach(function (f) {
                if (mod_rule.FIELDS.indexOf(f) === -1) {
                    invalid.push(f);
                }
            });

            if (invalid.length > 0) {
                throw new verror.VError('Invalid display field%s: %s',
                    invalid.length == 1 ? '' : 's',
                    invalid.sort().join(', '));
            }
        }
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'list', true);

    mod_lock.acquireSharedLock(function (lErr, fd) {
        if (lErr) {
            callback(lErr);
            return;
        }

        loadAllRules(log, function (err, res) {
            mod_lock.releaseLock(fd);

            if (err) {
                util_log.finishErr(log, err, 'list: finish');
                return callback(err);
            }

            // XXX: support sorting by other fields, filtering
            // (eg: enabled=true vm=<uuid>)
            var sortFn = function _defaultSort(a, b) {
                return (a.uuid > b.uuid) ? 1 : -1;
            };
            var mapFn = function _defaultMap(r) {
                return r.serialize();
            };

            if (opts.fields) {
                var filterFields = opts.fields;
                // If we didn't include uuid in the fields to list, include
                // it here so that we can sort by it - we'll remove it after
                if (opts.fields.indexOf('uuid') === -1) {
                    filterFields = opts.fields.concat(['uuid']);
                }

                mapFn = function _fieldMap(r) {
                    return r.serialize(filterFields);
                };
            }

            var rules = res.map(mapFn).sort(sortFn);
            if (opts.fields && opts.fields.indexOf('uuid') === -1) {
                rules = rules.map(function (r) {
                    delete r.uuid;
                    return r;
                });
            }

            log.debug('list: finish');
            return callback(null, rules);
        });
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
    var log = util_log.entry(opts, 'enable');

    var vmFilter = {};

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireExclusiveLock(cb);
        },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },

        function disk(_, cb) { loadDataFromDisk(log, cb); },

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
            filter.rulesByVMs(res.vms, vmFilter, res.disk.rules, log, cb);
        },

        function allRemoteVMs(res, cb) {
            createRemoteVMlookup(res.disk.remoteVMs, log, cb);
        },

        function apply(res, cb) {
            applyChanges({
                allVMs: res.vms,
                dryrun: opts.dryrun,
                filecontents: opts.filecontents,
                allRemoteVMs: res.allRemoteVMs,
                rules: res.vmRules,
                vms: vmFilter
            }, log, cb);
        }
    ]}, function _afterEnable(err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'enable: finish');
            return callback(err);
        }

        var toReturn = res.state.apply;
        log.debug(toReturn, 'enable: finish');
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
    var log = util_log.entry(opts, 'disable');

    function moveConf(new_fmt, old_fmt, _, cb) {
        // Move config out of the way - on zone boot, the firewall
        // will start again if it's present
        var new_cfg = util.format(new_fmt, opts.vm.zonepath);
        var old_cfg = util.format(old_fmt, opts.vm.zonepath);
        return fs.rename(new_cfg, old_cfg, function (err) {
            // If the file's already gone, that's OK
            if (err && err.code !== 'ENOENT') {
                return cb(err);
            }

            return cb(null);
        });
    }

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireExclusiveLock(cb);
        },
        moveConf.bind(null, IPF_CONF, IPF_CONF_OLD),
        moveConf.bind(null, IPF6_CONF, IPF6_CONF_OLD),
        function stop(_, cb) {
            if (opts.vm.state !== 'running') {
                log.debug('disableVM: VM "%s": not stopping ipf (state=%s)',
                    opts.vm.uuid, opts.vm.state);
                return cb(null);
            }

            log.debug('disableVM: stopping ipf for VM "%s"', opts.vm.uuid);
            return mod_ipf.stop(opts.vm.uuid, log, cb);
        }
    ]}, function _afterDisable(err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'disable: finish');
            return callback(err);
        }

        log.debug('disable: finish');
        return callback();
    });
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
    var log = util_log.entry(opts, 'status', true);

    return mod_ipf.status(opts.uuid, log, function (err, res) {
        if (err) {
            // 'No such device' is returned when the zone is down
            if (zoneNotRunning(res)) {
                log.debug({ running: false }, 'status: finish');
                return callback(null, { running: false });
            }

            util_log.finishErr(log, err, 'status: finish');
            return callback(err);
        }

        log.debug(res, 'status: finish');
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
    var log = util_log.entry(opts, 'stats', true);

    return mod_ipf.ruleStats(opts.uuid, log, function (err, res) {
        if (err) {
            if (res && res.stderr) {
                // Zone is down
                if (zoneNotRunning(res)) {
                    log.debug('stats: finish: zone not running');
                    return callback(new verror.VError(
                        'Firewall is not running for VM "%s"', opts.uuid));
                }

                // No rules loaded: return an error if the firewall
                // isn't running
                if (res.stderr.indexOf('empty list') !== -1) {
                    return vmStatus(opts, function (err2, res2) {
                        if (err2) {
                            util_log.finishErr(log, err2, 'stats: finish');
                            return callback(err2);
                        }

                        if (res2.running) {
                            log.debug({ rules: [] }, 'stats: finish');
                            return callback(null, { rules: [] });
                        } else {
                            log.debug('stats: finish: firewall not running');
                            return callback(new verror.VError(
                                'Firewall is not running for VM "%s"',
                                opts.uuid));
                        }
                    });
                }
            }

            return callback(err);
        }

        log.debug({ rules: res }, 'stats: finish');
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
 * @param {Function} callback : `f(err, res)`
 */
function update(opts, callback) {
    try {
        validateOpts(opts);
        assert.optionalArrayOfObject(opts.rules, 'opts.rules');
        assert.optionalArrayOfObject(opts.localVMs, 'opts.localVMs');
        assert.optionalArrayOfObject(opts.remoteVMs, 'opts.remoteVMs');
        assert.optionalString(opts.createdBy, 'opts.createdBy');

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
    var log = util_log.entry(opts, 'update');

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireExclusiveLock(cb);
        },
        function disk(_, cb) { loadDataFromDisk(log, cb); },

        // Make sure the rules exist
        function originalRules(res, cb) {
            findRules({
                allRules: res.disk.rulesByUUID,
                allowAdds: opts.allowAdds,
                rules: opts.rules
            }, log, cb);
        },

        // Apply updates to the found rules
        function rules(res, cb) {
            createUpdatedRules({
                createdBy: opts.createdBy,
                originalRules: res.originalRules,
                updatedRules: opts.rules
            }, log, cb);
        },

        // Create list of rules that are being replaced
        function replacedRules(res, cb) {
            cb(null, mod_obj.values(res.originalRules));
        },

        // Create the VM lookup
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },

        // Create remote VMs (if any) from payload
        function newRemoteVMs(res, cb) {
            mod_rvm.create({ allVMs: res.vms, requireIPs: true, log: log },
                opts.remoteVMs, cb);
        },

        // Create a lookup for the new remote VMs
        function newRemoteVMsLookup(res, cb) {
            createRemoteVMlookup(res.newRemoteVMs, log, cb);
        },

        function allRemoteVMs(res, cb) {
            createRemoteVMlookup([res.disk.remoteVMs, res.newRemoteVMs],
                log, cb);
        },

        // Lookup any local VMs in the payload
        function localVMs(res, cb) {
            lookupVMs(res.vms, opts.localVMs, log, cb);
        },

        // Build a table for information about updated local/remote VMs
        function newVMs(res, cb) {
            var nvms = clone(res.newRemoteVMsLookup);
            mod_obj.values(res.localVMs).map(mergeIntoLookup.bind(null, nvms));
            cb(null, nvms);
        },

        // Get the VMs the rules applied to before the update
        function originalVMs(res, cb) {
            filter.vmsByRules({
                log: log,
                rules: res.replacedRules,
                vms: res.vms
            }, cb);
        },

        // Now get the VMs the updated rules apply to
        function matchingVMs(res, cb) {
            filter.vmsByRules({
                log: log,
                rules: res.rules,
                vms: res.vms
            }, cb);
        },

        // Replace the rules with their updated versions
        function updatedRules(res, cb) {
            return cb(null, dedupRules(res.rules, res.disk.rules));
        },

        // Get any rules that the added remote VMs target
        function remoteVMrules(res, cb) {
            filter.rulesByRVMs(res.newRemoteVMsLookup,
                res.updatedRules, log, cb);
        },

        // Get any rules that the added local VMs target
        function localVMrules(res, cb) {
            filter.rulesByVMs(res.vms, res.localVMs, res.updatedRules, log, cb);
        },

        // Merge the local and remote VM rules, and use that list to find
        // the VMs affected.
        function localAndRemoteVMsAffected(res, cb) {
            var affectedRules = dedupRules(res.localVMrules, res.remoteVMrules)
                .filter(getAffectedRules(res.newVMs, log));
            filter.vmsByRules({
                log: log,
                rules: affectedRules,
                vms: res.vms
            }, cb);
        },

        function mergedVMs(res, cb) {
            // These are VMs affected by changing rules:
            var ruleVMs = mergeObjects(res.originalVMs, res.matchingVMs);
            // These are VMs affected by changing VM information:
            var updatedVMs = mergeObjects(res.localVMs,
                res.localAndRemoteVMsAffected);
            return cb(null, mergeObjects(ruleVMs, updatedVMs));
        },

        // Get the rules that need to be written out for all VMs, before and
        // after the update
        function vmRules(res, cb) {
            filter.rulesByVMs(res.vms, res.mergedVMs, res.updatedRules, log,
                cb);
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
            }, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'update: finish');
            return callback(err);
        }

        log.debug(res.state.apply, 'update: finish');
        return callback(err, res.state.apply);
    });
}


/**
 * Given the list of local VMs and a list of rules, return an object with
 * the non-local targets on the other side of the rules.
 *
 * @param opts {Object} : options:
 * - vms {Array} : array of VM objects (as per VM.js)
 * - rules {Array of Objects} : firewall rules
 * @param callback {Function} `function (err, targets)`
 * - Where targets is an object like:
 *   {
 *     tags: { some: ['one', 'two'], other: true },
 *     vms: [ '<UUID>' ],
 *     allVMs: true
 *   }
 */
function getRemoteTargets(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assert.arrayOfObject(opts.vms, 'opts.vms');
        assert.arrayOfObject(opts.rules, 'opts.rules');

        if (opts.rules.length === 0) {
            throw new Error('Must specify rules');
        }
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'remoteTargets', true);

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireSharedLock(cb);
        },
        function rules(_, cb) {
            createRules(opts.rules, cb);
        },
        function vms(_, cb) {
            createVMlookup(opts.vms, log, cb);
        }
    ] }, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'remoteTargets: createRules: finish');
            return callback(err);
        }

        var targets = {};

        for (var r in res.state.rules) {
            var rule = res.state.rules[r];

            for (var d in DIRECTIONS) {
                var dir = DIRECTIONS[d];
                addOtherSideRemoteTargets(
                    res.state.vms, rule, targets, dir, log);
            }
        }

        if (hasKey(targets, 'vms')) {
            targets.vms = Object.keys(targets.vms);
            if (targets.vms.length === 0) {
                delete targets.vms;
            }
        }

        log.debug(targets, 'remoteTargets: finish');
        return callback(null, targets);
    });
}


/**
 * Gets VMs that are affected by a rule
 *
 * @param opts {Object} : options:
 * - vms {Array} : array of VM objects (as per VM.js)
 * - rule {UUID or Object} : UUID of pre-existing rule, or a rule object
 * - includeDisabled {Boolean, optional} : if set, include VMs that have
 *   their firewalls disabled in the search
 * @param callback {Function} `function (err, vms)`
 * - Where vms is an array of VMs that are affected by that rule
 */
function getRuleVMs(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assert.arrayOfObject(opts.vms, 'opts.vms');
        assertStringOrObject(opts.rule, 'opts.rule');
        assert.optionalBool(opts.includeDisabled, 'opts.includeDisabled');
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'vms', true);

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireSharedLock(cb);
        },
        function rules(_, cb) {
            if (typeof (opts.rule) === 'string') {
                return loadRule(opts.rule, log, cb);
            }

            createRules([ opts.rule ], cb);
        },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },
        function ruleVMs(state, cb) {
            if (!Array.isArray(state.rules)) {
                state.rules = [ state.rules ];
            }

            filter.vmsByRules({
                includeDisabled: opts.includeDisabled,
                log: log,
                rules: state.rules,
                vms: state.vms
            }, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'vms: finish');
            return callback(err);
        }

        var matched = Object.keys(res.state.ruleVMs);
        log.debug(matched, 'vms: finish');
        return callback(null, matched);
    });
}


/**
 * Gets rules that apply to a Remote VM
 *
 * @param opts {Object} : options:
 * - vms {Array} : array of VM objects (as per VM.js)
 * - vm {UUID} : UUID of VM to get the rules for
 * @param callback {Function} `function (err, rules)`
 * - Where rules is an array of rules that apply to the VM
 */
function getRemoteVMrules(opts, callback) {
    try {
        assert.object(opts, 'opts');
        assertStringOrObject(opts.remoteVM, 'opts.remoteVM');
        assert.arrayOfObject(opts.vms, 'opts.vms');
    } catch (err) {
        return callback(err);
    }
    var log = util_log.entry(opts, 'rvmRules', true);

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireSharedLock(cb);
        },
        function allRules(_, cb) { loadAllRules(log, cb); },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },
        function rvm(_, cb) {
            if (typeof (opts.remoteVM) === 'object') {
                return cb(null, opts.remoteVM);
            }

            return mod_rvm.load(opts.remoteVM, log, cb);
        },
        function rvms(state, cb) {
            mod_rvm.create({ allVMs: state.vms, requireIPs: false, log: log },
                [ state.rvm ], function (e, rvmList) {
                if (e) {
                    return cb(e);
                }

                createRemoteVMlookup(rvmList, log, cb);
            });
        },
        function rvmRules(state, cb) {
            filter.rulesByRVMs(state.rvms, state.allRules, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'rvmRules: finish (vm=%s)',
                opts.remoteVM);
            return callback(err);
        }

        var toReturn = res.state.rvmRules.map(function (r) {
            return r.serialize();
        });

        log.debug(toReturn, 'rvmRules: finish (vm=%s)', opts.remoteVM);
        return callback(null, toReturn);
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
    var log = util_log.entry(opts, 'vmRules', true);

    var toFind = {};
    toFind[opts.vm] = opts.vm;

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireSharedLock(cb);
        },
        function allRules(_, cb) { loadAllRules(log, cb); },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },
        function vmRules(state, cb) {
            filter.rulesByVMs(state.vms, toFind, state.allRules, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'vmRules: finish (vm=%s)', opts.vm);
            return callback(err);
        }

        var toReturn = res.state.vmRules.map(function (r) {
            return r.serialize();
        });

        log.debug(toReturn, 'vmRules: finish (vm=%s)', opts.vm);
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
    var log = util_log.entry(opts, 'validatePayload');

    pipeline({
    funcs: [
        function lock(_, cb) {
            mod_lock.acquireSharedLock(cb);
        },
        function rules(_, cb) {
            createRules(opts.rules, cb);
        },
        function vms(_, cb) { createVMlookup(opts.vms, log, cb); },
        function remoteVMs(_, cb) { mod_rvm.loadAll(log, cb); },
        function newRemoteVMs(state, cb) {
            mod_rvm.create({ allVMs: state.vms, requireIPs: true, log: log },
                opts.remoteVMs, cb);
        },
        // Create a combined remote VM lookup of remote VMs on disk plus
        // new remote VMs in the payload
        function allRemoteVMs(state, cb) {
            createRemoteVMlookup([state.remoteVMs, state.newRemoteVMs],
                log, cb);
        },

        function validate(state, cb) {
            validateRules(state.vms, state.allRemoteVMs, state.rules, log, cb);
        }
    ]}, function (err, res) {
        mod_lock.releaseLock(res.state.lock);

        if (err) {
            util_log.finishErr(log, err, 'validatePayload: finish');
            return callback(err);
        }

        log.debug(opts.payload, 'validatePayload: finish');
        return callback();
    });
}



module.exports = {
    _setOldIPF: mod_ipf._setOld,
    add: add,
    del: del,
    disable: disableVM,
    enable: enableVM,
    get: getRule,
    getRVM: getRemoteVM,
    list: listRules,
    listRVMs: listRemoteVMs,
    remoteTargets: getRemoteTargets,
    rvmRules: getRemoteVMrules,
    setBunyan: util_log.setBunyan,
    stats: vmStats,
    status: vmStatus,
    update: update,
    validatePayload: validatePayload,
    VM_FIELDS: VM_FIELDS,
    vmRules: getVMrules,
    vms: getRuleVMs
};
