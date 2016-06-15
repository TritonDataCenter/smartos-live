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
 * Copyright 2016, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: functions for managing shared/exclusive locks
 */

var fs = require('fs');
var mod_lockfd = require('lockfd');

// --- Globals

var FW_LOCK_FILE = '/var/fw/.lockfile';


// --- Internal functions

function acquireLock(operation, callback) {
    fs.open(FW_LOCK_FILE, 'w+', function (err, fd) {
        if (err) {
            callback(err);
            return;
        }

        mod_lockfd.flock(fd, operation, function (err2) {
            if (err2) {
                releaseLock(fd);
                callback(err2);
                return;
            }

            callback(null, fd);
        });
    });
}


// --- Exported functions


function acquireSharedLock(callback) {
    acquireLock(mod_lockfd.LOCK_SH, callback);
}


function acquireExclusiveLock(callback) {
    acquireLock(mod_lockfd.LOCK_EX, callback);
}


function releaseLock(fd) {
    if (fd !== undefined) {
        mod_lockfd.flockSync(fd, mod_lockfd.LOCK_UN);
        fs.closeSync(fd);
    }
}


module.exports = {
    acquireExclusiveLock: acquireExclusiveLock,
    acquireSharedLock: acquireSharedLock,
    releaseLock: releaseLock
};
