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



// --- Exports



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



module.exports = {
    rvmsByUUIDs: rvmsByUUIDs
};
