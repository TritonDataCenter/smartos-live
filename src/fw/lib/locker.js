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

var FW_DIR_PATH = '/var/fw';
var FW_LOCK_FILE = FW_DIR_PATH + '/.lockfile';
var FW_DIR_MODE = parseInt('0755', 8);
var FW_FILE_MODE = parseInt('0644', 8);


// --- Internal functions


/*
 * Opening the lock file should normally be fine, but in the odd event that we
 * are trying for the first time on a system initially set up with a pre-June
 * 2013 platform, when the /var/fw directory started shipping with the platform,
 * and there've never been any rules on this system, then we need to take care
 * of creating the directory.
 */
function tryOpen(callback) {
    fs.open(FW_LOCK_FILE, 'w+', FW_FILE_MODE, function (err, fd) {
        if (!err || err.code !== 'ENOENT') {
            callback(err, fd);
            return;
        }

        try {
            fs.mkdirSync(FW_DIR_PATH, FW_DIR_MODE);
            fd = fs.openSync(FW_LOCK_FILE, 'w+', FW_FILE_MODE);
        } catch (_) {
            callback(err);
            return;
        }

        callback(null, fd);
    });
}


function acquireLock(operation, callback) {
    tryOpen(function (err, fd) {
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
