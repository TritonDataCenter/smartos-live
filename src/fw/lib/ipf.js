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
 * fwadm: ipf control functions
 */

var assert = require('assert-plus');
var execFile = require('child_process').execFile;



// --- Globals



var IPF = '/usr/sbin/ipf';
var IPFSTAT = '/usr/sbin/ipfstat';
// Are we using an older version of ipf?
var OLD = false;



// --- Internal functions



/**
 * Trims spaces from both sides of a string
 */
function trim(str) {
    return str.replace(/^\s+/, '').replace(/\s+$/, '');
}


/**
 * Actually runs the ipfilter executable, logging as appropriate
 */
function ipf(args, log, callback) {
    return execFile(IPF, args, function (err, stdout, stderr) {
        var res = { stdout: stdout, stderr: stderr };
        if (log) {
            log.debug(res, 'ipf: "%s %s"', IPF, args.join(' '));
        }

        return callback(err, res);
    });
}


/**
 * Actually runs the ipfstat executable, logging as appropriate
 */
function ipfstat(args, log, callback) {
    return execFile(IPFSTAT, args, function (err, stdout, stderr) {
        var res = { stdout: stdout, stderr: stderr };
        if (log) {
            log.debug(res, 'ipfstat: "%s %s"', IPFSTAT, args.join(' '));
        }

        return callback(err, res);
    });
}



// --- Exported functions



/**
 * Indicates we're on a platform that doesn't support the '-G' flag
 */
function setOld() {
    OLD = true;
}


/**
 * Reloads the ipf rules for a zone
 *
 * @param uuid {String} : zone UUID
 * @param conf {String} : path of ipf conf file to load
 * @param log {Object} : bunyan logger
 * @param callback {Function} : `function (err, res)`
 */
function zoneReload(uuid, conf, log, callback) {
    assert.string(uuid, 'uuid');
    assert.string(conf, 'conf');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    // Flush (-F) all (-a) rules from the inactive list (-I) for the
    // GZ-controlled ipf stack (-G) for zone uuid
    var flushOpts = ['-GIFa', uuid];
    if (OLD) {
        flushOpts = ['-IFa', uuid];
    }
    return ipf(flushOpts, log, function (err, res) {
        if (err) {
            return callback(err, res);
        }

        // Load rules from conf (-f) into the inactive list (-I) for the
        // GZ-controlled (-G) ipf stack
        var loadOpts = ['-G', '-I', '-f', conf, uuid];
        if (OLD) {
            loadOpts = ['-I', '-f', conf, uuid];
        }
        return ipf(loadOpts, log, function (err2, res2) {
            if (err2) {
                return callback(err2, res2);
            }

            // Swap (-s) the active and inactive lists, and update the interface
            // list (-y) for the GZ-controlled ipf stack (-G)
            var swapOpts = ['-G', '-s', '-y', uuid];
            if (OLD) {
                swapOpts = ['-s', '-y', uuid];
            }

            return ipf(swapOpts, log, callback);
        });
    });
}


/**
 * Gets per-rule statistics for a zone
 *
 * @param uuid {String} : zone UUID
 * @param log {Object} : bunyan logger
 * @param callback {Function} : `function (err, res)`
 */
function zoneRuleStats(uuid, log, callback) {
    assert.string(uuid, 'uuid');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var statOpts = ['-hoi', '-G', uuid];
    if (OLD) {
        statOpts = ['-hoi', '-z', uuid];
    }
    return ipfstat(statOpts, log, function (err, res) {
        if (!res.stdout) {
            return callback(new Error('No output from ipfstat'), res);
        }

        var results = [];
        res.stdout.split('\n').forEach(function (line) {
            if (line === '') {
                return;
            }

            var idx = line.indexOf(' ');
            results.push({
                hits: line.substring(0, idx),
                rule: line.substring(idx + 1)
            });
        });

        return callback(null, results);
    });
}


/**
 * Gets the ipf status for a zone
 *
 * @param uuid {String} : zone UUID
 * @param log {Object} : bunyan logger
 * @param callback {Function} : `function (err, res)`
 */
function zoneStatus(uuid, log, callback) {
    assert.string(uuid, 'uuid');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var statusOpts = ['-GV', uuid];
    if (OLD) {
        statusOpts = ['-V', uuid];
    }
    return ipf(statusOpts, log, function (err, res) {
        if (err) {
            return callback(err, res);
        }

        if (!res.stdout) {
            return callback(new Error('No output from ipf'), res);
        }

        var i;
        var results = {};
        var lines = res.stdout.split('\n');
        for (i in lines) {
            var idx = lines[i].indexOf(':');
            var key = lines[i].substr(0, idx).toLowerCase();
            var val = trim(lines[i].substr(idx + 1));
            if (!key) {
                continue;
            }

            switch (key) {
            case 'ipf':
            case 'kernel':
                val = val.replace('IP Filter: ', '');
                break;
            case 'running':
                if (val == 'no') {
                    val = false;
                } else {
                    val = true;
                }
                break;
            case 'active list':
                val = Number(val);
                break;
            default:
                break;
            }

            results[key] = val;
        }

        return callback(null, results);
    });
}


/**
 * Enables ipf for a zone
 *
 * @param uuid {String} : zone UUID
 * @param log {Object} : bunyan logger
 * @param callback {Function} : `function (err, res)`
 */
function zoneStart(uuid, log, callback) {
    assert.string(uuid, 'uuid');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var startOpts = ['-GE', uuid];
    if (OLD) {
        startOpts = ['-E', uuid];
    }
    return ipf(startOpts, log, callback);
}


/**
 * Disables ipf for a zone
 *
 * @param uuid {String} : zone UUID
 * @param log {Object} : bunyan logger
 * @param callback {Function} : `function (err, res)`
 */
function zoneStop(uuid, log, callback) {
    assert.string(uuid, 'uuid');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var stopOpts = ['-GD', uuid];
    if (OLD) {
        stopOpts = ['-D', uuid];
    }

    return ipf(stopOpts, log, callback);
}



module.exports = {
    _setOld: setOld,
    ipf: ipf,
    ipfstat: ipfstat,
    reload: zoneReload,
    ruleStats: zoneRuleStats,
    status: zoneStatus,
    start: zoneStart,
    stop: zoneStop
};
