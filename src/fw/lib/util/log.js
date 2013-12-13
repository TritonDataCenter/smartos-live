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

var assert = require('assert-plus');
var bunyan;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var vasync = require('vasync');



// --- Globals



var LOG_DIR = '/var/log/fw/logs';
var LOG_NAME = process.argv[1] ? path.basename(process.argv[1]) : 'fw';



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
 * Returns true if the bunyan stream is logging to LOG_DIR
 */
function isLoggingToFile(str) {
    if (str.type === 'file' && str.stream
        && startsWith(str.path, LOG_DIR)) {
        return true;
    }

    return false;
}


/**
 * Returns true if the bunyan stream is an OpenOnErrorFileStream
 */
function isOnErrorStream(str) {
    if (str.type === 'raw' && str.stream
        && str.stream instanceof OpenOnErrorFileStream) {
        return true;
    }

    return false;
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
 * Taken from jsprim
 */
function startsWith(str, prefix)
{
    return (str.substr(0, prefix.length) == prefix);
}


function newOnErrStream(filename) {

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



// --- OpenOnErrorFileStream (originally from VM.js)



// OpenOnErrorFileStream is a bunyan stream that only creates the file when
// there's an error or higher level message.  We use this for actions that
// shouldn't log in the normal case but where we do want logs when something
// breaks.  Thanks to Trent++ for most of this code.


function OpenOnErrorFileStream(opts) {
    this.path = opts.path;
    this.level = bunyan.resolveLevel(opts.level);
    this.write = this.constructor.prototype.write1;
    this.end = this.constructor.prototype.end1;
    this.on = this.constructor.prototype.on1;
    this.once = this.constructor.prototype.once1;

    // Add the ringbuffer which we'll dump if we switch from not writing to
    // writing, and so that they'll show up in dumps.
    this.ringbuffer = new bunyan.RingBuffer({ limit: 50 });
    this.log_to_file = false;
}


OpenOnErrorFileStream.prototype.startLoggingToFile = function () {
    this._startWriting(this.level);
};


OpenOnErrorFileStream.prototype._startWriting = function (level, rec) {
    var r;

    if (this.stream) {
        return;
    }

    this.stream = fs.createWriteStream(this.path,
        { flags: 'a', encoding: 'utf8' });
    this.emit = this.stream.emit;
    this.end = this.stream.end;
    this.on = this.stream.on;
    this.once = this.stream.once;
    this.write = this.constructor.prototype.write2;
    // dump out logs from ringbuffer too since there was an error so we can
    // figure out what's going on.
    for (r in this.ringbuffer.records) {
        r = this.ringbuffer.records[r];
        if (r.level >= level && (!rec || r != rec)) {
            this.write(r);
        }
    }
};


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
    if (rec.level >= bunyan.ERROR || this.log_to_file) {
        this._startWriting(bunyan.TRACE, rec);
        this.write(rec);
    } else {
        this.ringbuffer.write(rec);
    }
};


// used when writing to file
OpenOnErrorFileStream.prototype.write2 = function (rec) {
    var str = JSON.stringify(rec, bunyan.safeCycles()) + '\n';
    this.stream.write(str);
};



// --- Exports



/**
 * Create logger
 */
function createLogger(opts, readOnly) {
    readOnly = !!readOnly;  // make boolean
    if (!opts) {
        opts = {};
    }
    assert.string(opts.action, 'opts.action');

    if (!bunyan) {
        bunyan = require('bunyan');
    }

    var log;
    var logName = opts.logName || LOG_NAME;
    var logLevel = opts.logLevel || 'debug';
    var serializers = {
        err: bunyan.stdSerializers.err,
        fullRules: fullRuleSerializer,
        rules: ruleSerializer,
        vms: vmSerializer
    };
    var s;
    var str;
    var streams = [];

    // XXX: allow logging to stderr

    var filename = util.format('%s/%s-%s-%s.log',
        LOG_DIR, Date.now(0), sprintf('%06d', process.pid),
        opts.action.toLowerCase());

    function addOnErrStream() {
        streams.push({
            type: 'raw',
            stream: new OpenOnErrorFileStream({
                path: filename,
                level: logLevel
            }),
            level: 'trace'
        });
    }

    function addFileStream() {
        streams.push({ level: logLevel, path: filename });
    }

    mkdirp.sync(LOG_DIR);

    if (opts.log) {
        if (readOnly) {
            for (s in opts.log.streams) {
                str = opts.log.streams[s];

                if (isLoggingToFile(str) || isOnErrorStream(str)) {
                    return opts.log;
                }
            }

            addOnErrStream();

        } else {
            for (s in opts.log.streams) {
                str = opts.log.streams[s];

                if (isLoggingToFile(str)) {
                    return opts.log;
                }

                if (isOnErrorStream(str)) {
                    str.startLoggingToFile();
                    return opts.log;
                }
            }

            addFileStream();
        }

        log = opts.log.child({
            component: logName,
            serializers: serializers,
            streams: streams
        });
        return log;
    }

    if (readOnly) {
        addOnErrStream();
    } else {
        addFileStream();
    }

    log = bunyan.createLogger({
        name: logName,
        serializers: serializers,
        streams: streams
    });

    return log;
}


/**
 * Create the logger and log one of the API entry points. Strips down
 * properties in opts that we know to be too big to log (eg: VMs).
 */
function logEntry(opts, action, readOnly) {
    opts.action = action;

    var localVMs;
    var log = createLogger(opts, readOnly).child({ component: action });
    var oldLog;
    var rules;
    var vms;

    // Remove or truncate properties from opts to make the start logline
    // below a little cleaner

    if (opts.localVMs) {
        localVMs = opts.localVMs;
        opts.localVMs = opts.localVMs.map(function (vm) {
            return vm.uuid || '<unknown>'; });
    }

    if (opts.log) {
        oldLog = opts.log;
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

    log.debug(opts, '%s: start', action);

    // Now restore the removed / massaged properties

    if (localVMs) {
        opts.localVMs = localVMs;
    }
    if (oldLog) {
        opts.log = oldLog;
    }
    if (rules) {
        opts.rules = rules;
    }
    if (vms) {
        opts.vms = vms;
    }
    delete opts.inputRules;

    return log;
}


/**
 * Flush all open log streams
 */
function flushLogs(log, callback) {
    if (!log) {
        return callback();
    }

    vasync.forEachParallel({
        inputs: log.streams,
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


/**
 * Set the bunyan module
 */
function setBunyan(mod) {
    bunyan = mod;
}



module.exports = {
    create: createLogger,
    entry: logEntry,
    flush: flushLogs,
    setBunyan: setBunyan
};
