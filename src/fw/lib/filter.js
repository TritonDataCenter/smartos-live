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
 *
 * fwadm: functions for filtering rules and remote VMs
 */

var mod_rvm = require('./rvm');
var objEmpty = require('./util/obj').objEmpty;



// --- Internal functions



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



// --- Exports



/**
 * Filter the list of rules, returning only the rules that contain VMs
 * in the given remote VM lookup table
 *
 * @param remoteVMs {Object}: remote VM lookup table, as returned by
 *     createRemoteVMlookup()
 * @param rules {Array}: array of rule objects
 * @param callback {Function} `function (err, matchingRules)`
 *
 */
function rulesByRVMs(remoteVMs, rules, log, callback) {
    log.trace('filter.rulesByRVMs: entry');

    if (!remoteVMs || objEmpty(remoteVMs)) {
        log.debug({ rules: [] }, 'filter.rulesByRVMs: return');
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

    log.debug({ rules: matchingRules }, 'filter.rulesByRVMs: return');
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
function rulesByUUIDs(rules, uuids, log, callback) {
    log.debug(uuids, 'filter.rulesByUUIDs: entry');

    var results = {
        matching: [],
        notMatching: []
    };

    if (!uuids || uuids.length === 0) {
        results.notMatching = rules;
        return callback(null, results);
    }

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
        log.warn(Object.keys(uuidHash), 'Trying to delete unknown rules');
    }

    log.debug({ rules: results.matching }, 'filter.rulesByUUIDs: return');
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
function rulesByVMs(allVMs, vms, rules, log, callback) {
    log.debug({ vms: vms }, 'filter.rulesByVMs: entry');
    var matchingRules = [];
    var matchingUUIDs = {};

    ruleTypeWalk(rules, function _filterByVM(rule, type, t, val) {
        if (val !== undefined) {
            type = 'tagValues';
        }

        log.trace('filter.rulesByVMs: type=%s, t=%s, rule=%s',
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
                log.trace('filter.rulesByVMs: VM %s owner_uuid=%s does not'
                    + ' match rule owner_uuid=%s: %s', vmList[uuid].owner_uuid,
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

    log.debug({ rules: matchingRules }, 'filter.rulesByVMs: return');
    return callback(null, matchingRules);
}



/**
 * Filters the remote VM lookup table into a lookup of RVMs that match the
 * UUIDs and one that doesn't.
 *
 * @param allRVMs {Object}: remote VM lookup table, as returned by
 *   createRemoteVMlookup()
 * @param uuids {Array}: array of remoteVM UUIDs
 * @param callback {Function} `function (err, matchingRVMs)`
 * - matchingRVMs {Object} : with matching and notMatching properties, both
 *   of which are remote VM lookups
 */
function rvmsByUUIDs(allRVMs, uuids, log, callback) {
    log.trace(uuids, 'filter.rvmsByUUIDs: entry');

    if (!uuids || uuids.length === 0) {
        return callback(null, {
            matching: mod_rvm.createLookup(null, log),
            notMatching: allRVMs
        });
    }

    var matching = {};
    var notMatching = {};

    // XXX: warn or error if we try to delete an RVM that doesn't exist?
    for (var uuid in allRVMs.vms) {
        if (uuids.indexOf(uuid) === -1) {
            // See the comment in createLookup() for the double UUID here:
            notMatching[uuid] = allRVMs.vms[uuid][uuid];
        } else {
            matching[uuid] = allRVMs.vms[uuid][uuid];
        }
    }

    return callback(null, {
        matching: mod_rvm.createLookup(matching, log),
        notMatching: mod_rvm.createLookup(notMatching, log)
    });
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
function vmsByRules(vms, rules, log, callback) {
    log.debug({ rules: rules }, 'filter.vmsByRules: entry');
    var matchingVMs = {};

    ruleTypeWalk(rules, function _matchingVMs(rule, type, t, val) {
        if (val !== undefined) {
            type = 'tagValues';
        }

        if (type === 'wildcards' && t === 'any') {
            return;
        }

        if (!vms[type].hasOwnProperty(t)) {
            log.trace(
                'filter.vmsByRules: type=%s, t=%s, rule=%s: not in VM hash',
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
                log.trace(
                    'filter.vmsByRules: type=%s, t=%s, VM=%s: rule owner uuid'
                    + ' (%s) did not match VM owner uuid (%s): %s',
                    type, t, uuid, owner_uuid, vm.owner_uuid, rule);
                return;
            }
            log.trace(
                'filter.vmsByRules: type=%s, t=%s, VM=%s: matched rule: %s',
                type, t, uuid, rule);
            matchingVMs[uuid] = vm;
        });
    });

    log.debug({ vms: matchingVMs }, 'filter.vmsByRules: return');
    return callback(null, matchingVMs);
}



module.exports = {
    rulesByRVMs: rulesByRVMs,
    rulesByUUIDs: rulesByUUIDs,
    rulesByVMs: rulesByVMs,
    rvmsByUUIDs: rvmsByUUIDs,
    vmsByRules: vmsByRules
};
