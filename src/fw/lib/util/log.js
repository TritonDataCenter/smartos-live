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
 * fwadm: logging and associated utils
 */

var bunyan = require('bunyan');
var fs = require('fs');
var mkdirp = require('mkdirp');
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var vasync = require('vasync');



// --- Globals



var LOG;
var LOG_TO_FILE = false;
var LOG_DIR = '/var/log/fw/logs';
// keep the last 50 messages just in case we end up wanting them.
var RINGBUFFER = new bunyan.RingBuffer({ limit: 50 });



// --- Internal helper functions



/**
 * Bunyan serializer for a firewall rule
 */
function fullRuleSerializer(rules) {
    var res = {};
    for (var r in rules) {
        res[rules[r].uuid] = rules[r].toString();
    }

    return Object.keys(res).map(function (u) {
        return res[u];
    });
}


/**
 * Bunyan serializer for just the rule UUID
 */
function ruleSerializer(rules) {
    var res = {};
    for (var r in rules) {
        res[rules[r].uuid] = rules[r].toString();
    }

    return Object.keys(res);
}


/**
 * Bunyan serializer for just the VM UUID
 */
function vmSerializer(vms) {
    // Returning from add, update, etc, vms is a list of VM UUIDs
    if (util.isArray(vms)) {
        if (typeof (vms[0]) === 'string') {
            return vms;
        }

        return vms.map(function (v) {
            return v.hasOwnProperty('uuid') ? v.uuid : v;
        });
    }

    return Object.keys(vms);
}


/**
 * Create logger
 */
function createLogger(opts) {
    if (!opts) {
        opts = {};
    }

    // XXX: allow upgrading from readOnly to writing

    if (LOG) {
        return LOG;
    }

    var logName = 'fwadm';
    var logLevel = 'debug';
    var streams = [];

    // XXX: allow logging to stderr
    if (opts.action) {
        logName = opts.action;
    }

    if (opts.logName) {
        logName = opts.logName;
    }

    if (opts.logLevel) {
        logLevel = opts.logLevel;
    }

    var filename = util.format('%s/%s-%s-%s.log',
            LOG_DIR, Date.now(0), sprintf('%06d', process.pid), logName);

    if (opts.readOnly) {
        streams.push({
            type: 'raw',
            stream: new OpenOnErrorFileStream(filename),
            level: logLevel
        });
    } else {
        streams.push({ level: logLevel, path: filename });
    }

    // Add the ringbuffer which we'll dump if we switch from not writing to
    // writing, and so that they'll show up in dumps.
    streams.push({
            level: 'trace',
            type: 'raw',
            stream: RINGBUFFER
    });

    mkdirp.sync(LOG_DIR);

    if (opts.log) {
        LOG = opts.log.child({ component: 'fw', streams: streams });
        return;
    }

    LOG = bunyan.createLogger({
        name: 'fw',
        serializers: {
            err: bunyan.stdSerializers.err,
            fullRules: fullRuleSerializer,
            rules: ruleSerializer,
            vms: vmSerializer
        },
        streams: streams
    });

    return LOG;
}



// --- OpenOnErrorFileStream (originally from VM.js)



// OpenOnErrorFileStream is a bunyan stream that only creates the file when
// there's an error or higher level message.  We use this for actions that
// shouldn't log in the normal case but where we do want logs when something
// breaks.  Thanks to Trent++ for most of this code.


function OpenOnErrorFileStream(filename) {
    this.path = filename;
    this.write = this.constructor.prototype.write1;
    this.end = this.constructor.prototype.end1;
    this.on = this.constructor.prototype.on1;
    this.once = this.constructor.prototype.once1;
}


OpenOnErrorFileStream.prototype.end1 = function () {
    // in initial mode we're not writing anything, so nothing to flush
    return;
};


OpenOnErrorFileStream.prototype.on1 = function (name, cb) {
    return;
};


OpenOnErrorFileStream.prototype.once1 = function (name, cb) {
    return;
};


// used until first ERROR or higher, then opens file and ensures future writes
// go to .write2()
OpenOnErrorFileStream.prototype.write1 = function (rec) {
    var r;

    if (rec.level >= bunyan.ERROR || LOG_TO_FILE) {
        this.stream = fs.createWriteStream(this.path,
                {flags: 'a', encoding: 'utf8'});
        this.end = this.stream.end;
        this.on = this.stream.on;
        this.once = this.stream.once;
        this.write = this.constructor.prototype.write2;
        // dump out logs from ringbuffer too since there was an error so we can
        // figure out what's going on.
        for (r in RINGBUFFER.records) {
                r = RINGBUFFER.records[r];
                if (r != rec) {
                        this.write(r);
                }
        }

        this.write(rec);
    }
};


// used when writing to file
OpenOnErrorFileStream.prototype.write2 = function (rec) {
    var str = JSON.stringify(rec, bunyan.safeCycles()) + '\n';
    this.stream.write(str);
};



// --- Exports



/**
 * Create the logger and log one of the API entry points. Strips down
 * properties in opts that we know to be too big to log (eg: VMs).
 */
function logEntry(opts, action) {
    opts.action = action;

    var localVMs;
    var log;
    var rules;
    var vms;

    if (opts.localVMs) {
        localVMs = opts.localVMs;
        opts.localVMs = opts.localVMs.map(function (vm) {
            return vm.uuid || '<unknown>'; });
    }

    if (opts.log) {
        log = opts.log;
        delete opts.log;
    }

    if (opts.rules) {
        rules = opts.rules;
        opts.inputRules = opts.rules;
        delete opts.rules;
    }

    if (opts.vms) {
        vms = opts.vms;
        opts.vms = opts.vms.map(function (vm) {
            return vm.uuid || '<unknown>';
        });
    }

    createLogger(opts);
    LOG.debug(opts, '%s: entry', action);

    if (localVMs) {
        opts.localVMs = localVMs;
    }
    if (log) {
        opts.log = log;
    }
    if (rules) {
        opts.rules = rules;
    }
    if (vms) {
        opts.vms = vms;
    }

    return LOG;
}


/**
 * Flush all open log streams
 */
function flushLogs(callback) {
    if (!LOG) {
        return callback();
    }

    vasync.forEachParallel({
        inputs: LOG.streams,
        func: function _closeStream(str, cb) {
            if (!str || !str.stream) {
                return cb();
            }

            var returned = false;
            str.stream.once('drain', function () {
                if (!returned) {
                    return cb();
                }
            });

            if (str.stream.write('')) {
                returned = true;
                return cb();
            }
        }
    }, function _doneClose(err) {
        return callback(err);
    });
}



module.exports = {
    entry: logEntry,
    flush: flushLogs
};
