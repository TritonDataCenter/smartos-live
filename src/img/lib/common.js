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
 * * *
 * Dump for shared stuff for this package.
 */

var p = console.log;
var assert = require('assert-plus');
var async = require('async');
var child_process = require('child_process'),
    exec = child_process.exec,
    execFile = child_process.execFile,
    spawn = child_process.spawn;
var format = require('util').format;
var fs = require('fs');
var path = require('path');
var tty = require('tty');
var mod_url = require('url');

var errors = require('./errors'),
    InternalError = errors.InternalError;



// ---- globals

var NAME = 'imgadm';
var MANIFEST_V = 2;
var DEFAULT_ZPOOL = 'zones';
var DEFAULT_SOURCE = {type: 'imgapi', url: 'https://images.joyent.com'};

var DB_DIR = '/var/imgadm';

var VALID_COMPRESSIONS = ['none', 'bzip2', 'gzip', 'xz'];

var VALID_SOURCE_TYPES = ['imgapi', 'dsapi', 'docker'];


var _versionCache = null;
function getVersion() {
    if (_versionCache === null)
        _versionCache = require('../package.json').version;
    return _versionCache;
}


var DOWNLOAD_DIR = '/var/tmp/.imgadm-downloads';

function downloadFileFromUuid(uuid) {
    assert.string(uuid, 'uuid');
    return path.join(DOWNLOAD_DIR, uuid + '.file');
}


function indent(s, indentStr) {
    if (!indentStr) indentStr = '    ';
    var lines = s.split(/\r?\n/g);
    return indentStr + lines.join('\n' + indentStr);
}


function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}

/**
 * Merge the second object's keys into the first and return the first.
 *
 * Note: The first given object is modified in-place.
 */
function objMerge(a, b) {
    Object.keys(b).forEach(function (k) {
        a[k] = b[k];
    });
    return a;
}


var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function assertUuid(uuid) {
    if (!UUID_RE.test(uuid)) {
        throw new errors.InvalidUUIDError(uuid);
    }
}


/**
 * Convert a boolean or string representation into a boolean, or raise
 * TypeError trying.
 *
 * @param value {Boolean|String} The input value to convert.
 * @param default_ {Boolean} The default value is `value` is undefined.
 * @param errName {String} The name to include in the possibly
 *      raised TypeError.
 */
function boolFromString(value, default_, errName) {
    if (value === undefined) {
        return default_;
    } else if (value === 'false' || value === 'no') {
        return false;
    } else if (value === 'true' || value === 'yes') {
        return true;
    } else if (typeof (value) === 'boolean') {
        return value;
    } else {
        throw new TypeError(
            format('invalid value for %s: %j', errName, value));
    }
}

/**
 * Return a string suitable and convenient for a file name.
 */
var _pathSlugifyString = /[^\w\s\._-]/g;
var _pathSlugifyHyphenate = /[-\s]+/g;
function pathSlugify(s) {
    assert.string(s, 's');
    s = s.replace(_pathSlugifyString, '').trim().toLowerCase();
    s = s.replace(_pathSlugifyHyphenate, '-');
    return s;
}



/**
 * Return an array of manifest fields that differ between the two given
 * image manifests. The 'requirements' object is descended into to give
 * more specific diff info.
 */
function diffManifestFields(a, b) {
    var diffs = [];  // List of field names with diffs.
    Object.keys(b).forEach(function (field) {
        if (field === 'requirements') {
            if (a[field] === undefined) {
                diffs.push(field);
            }
            return;
        }
        if (JSON.stringify(b[field]) !==
            JSON.stringify(a[field])) {
            diffs.push(field);
        }
    });
    Object.keys(a).forEach(function (field) {
        if (b[field] === undefined) {
            diffs.push(field);
        }
    });
    if (b.requirements && a.requirements) {
        Object.keys(b.requirements).forEach(function (field) {
            if (JSON.stringify(b.requirements[field]) !==
                JSON.stringify(a.requirements[field])) {
                diffs.push('requirements.' + field);
            }
        });
        Object.keys(a.requirements).forEach(function (field) {
            if (b.requirements[field] === undefined) {
                diffs.push('requirements.' + field);
            }
        });
    }
    return diffs;
}


/**
 * Return an 80-column wrapped string.
 */
function textWrap(text) {
    var width = 80;
    var words = text.split(/\s+/g).reverse();
    var lines = [];
    var line = '';
    while (words.length) {
        var word = words.pop();
        if (line.length + 1 + word.length >= width) {
            lines.push(line);
            line = '';
        }
        if (line.length)
            line += ' ' + word;
        else
            line += word;
    }
    lines.push(line);
    return lines.join('\n');
}



/**
 * Adapted from <http://stackoverflow.com/a/18650828>
 */
function humanSizeFromBytes(bytes) {
    assert.number(bytes, 'bytes');
    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    if (bytes === 0) {
        return '0 B';
    }
    var i = Number(Math.floor(Math.log(bytes) / Math.log(1024)));
    var s = String(bytes / Math.pow(1024, i));
    var precision1 = (s.indexOf('.') === -1
        ? s + '.0' : s.slice(0, s.indexOf('.') + 2));
    return format('%s %s', precision1, sizes[i]);
}


/**
 * Prompt a user for a y/n answer.
 *
 *      cb('y')        user entered in the affirmative
 *      cb('n')        user entered in the negative
 *      cb(false)      user ^C'd
 */
function promptYesNo(opts_, cb) {
    assert.object(opts_, 'opts');
    assert.string(opts_.msg, 'opts.msg');
    assert.optionalString(opts_.default, 'opts.default');
    var opts = objCopy(opts_);

    // Setup stdout and stdin to talk to the controlling terminal if
    // process.stdout or process.stdin is not a TTY.
    var stdout;
    if (opts.stdout) {
        stdout = opts.stdout;
    } else if (process.stdout.isTTY) {
        stdout = process.stdout;
    } else {
        opts.stdout_fd = fs.openSync('/dev/tty', 'r+');
        stdout = opts.stdout = new tty.WriteStream(opts.stdout_fd);
    }
    var stdin;
    if (opts.stdin) {
        stdin = opts.stdin;
    } else if (process.stdin.isTTY) {
        stdin = process.stdin;
    } else {
        opts.stdin_fd = fs.openSync('/dev/tty', 'r+');
        stdin = opts.stdin = new tty.ReadStream(opts.stdin_fd);
    }

    stdout.write(opts.msg);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    var input = '';
    stdin.on('data', onData);

    function postInput() {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.write('\n');
        stdin.removeListener('data', onData);
    }

    function finish(rv) {
        if (opts.stdout_fd !== undefined) {
            stdout.end();
            delete opts.stdout_fd;
        }
        if (opts.stdin_fd !== undefined) {
            stdin.end();
            delete opts.stdin_fd;
        }
        cb(rv);
    }

    function onData(ch) {
        ch = ch + '';

        switch (ch) {
        case '\n':
        case '\r':
        case '\u0004':
            // They've finished typing their answer
            postInput();
            var answer = input.toLowerCase();
            if (answer === '' && opts.default) {
                finish(opts.default);
            } else if (answer === 'yes' || answer === 'y') {
                finish('y');
            } else if (answer === 'no' || answer === 'n') {
                finish('n');
            } else {
                stdout.write('Please enter "y", "yes", "n" or "no".\n');
                promptYesNo(opts, cb);
                return;
            }
            break;
        case '\u0003':
            // Ctrl C
            postInput();
            finish(false);
            break;
        default:
            // More plaintext characters
            stdout.write(ch);
            input += ch;
            break;
        }
    }
}




// TODO: persist "?channel=<channel>"
function normUrlFromUrl(u) {
    // `url.parse('example.com:9999')` is not what you expect. Make sure we
    // have a protocol.
    if (! /^\w+:\/\// .test(u)) {
        u = 'http://' + u;
    }

    var parsed = mod_url.parse(u);

    // Don't want trailing '/'.
    if (parsed.pathname.slice(-1) === '/') {
        parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Drop redundant ports.
    if (parsed.port
        && ((parsed.protocol === 'https:' && parsed.port === '443')
        || (parsed.protocol === 'http:' && parsed.port === '80'))) {
        parsed.port = '';
        parsed.host = parsed.hostname;
    }

    return mod_url.format(parsed);
}


/**
 * A convenience wrapper around `child_process.execFile` to take away some
 * logging and error handling boilerplate.
 *
 * @param args {Object}
 *      - argv {Array} Required.
 *      - execOpts {Array} Exec options.
 *      - log {Bunyan Logger} Required. Use to log details at trace level.
 * @param cb {Function} `function (err, stdout, stderr)` where `err` here is
 *      an `errors.InternalError` wrapper around the child_process error.
 */
function execFilePlus(args, cb) {
    assert.object(args, 'args');
    assert.arrayOfString(args.argv, 'args.argv');
    assert.optionalObject(args.execOpts, 'args.execOpts');
    assert.object(args.log, 'args.log');
    assert.func(cb);
    var argv = args.argv;
    var execOpts = args.execOpts;

    // args.log.trace({exec: true, argv: argv, execOpts: execOpts},
    //      'exec start');
    execFile(argv[0], argv.slice(1), execOpts, function (err, stdout, stderr) {
        args.log.trace({exec: true, argv: argv, execOpts: execOpts, err: err,
            stdout: stdout, stderr: stderr}, 'exec done');
        if (err) {
            var msg = format(
                'exec error:\n'
                + '\targv: %j\n'
                + '\texit status: %s\n'
                + '\tstdout:\n%s\n'
                + '\tstderr:\n%s',
                argv, err.code, stdout.trim(), stderr.trim());
            cb(new InternalError({cause: err, message: msg}), stdout, stderr);
        } else {
            cb(null, stdout, stderr);
        }
    });
}


/**
 * A convenience wrapper around `child_process.exec` to take away some
 * logging and error handling boilerplate.
 *
 * @param args {Object}
 *      - command {String} Required.
 *      - log {Bunyan Logger} Required. Use to log details at trace level.
 *      - execOpts {Array} Optional. child_process.exec options.
 *      - errMsg {String} Optional. Error string to use in error message on
 *        failure.
 * @param cb {Function} `function (err, stdout, stderr)` where `err` here is
 *      an `errors.InternalError` wrapper around the child_process error.
 */
function execPlus(args, cb) {
    assert.object(args, 'args');
    assert.string(args.command, 'args.command');
    assert.optionalString(args.errMsg, 'args.errMsg');
    assert.optionalObject(args.execOpts, 'args.execOpts');
    assert.object(args.log, 'args.log');
    assert.func(cb);
    var command = args.command;
    var execOpts = args.execOpts;

    // args.log.trace({exec: true, command: command, execOpts: execOpts},
    //      'exec start');
    exec(command, execOpts, function (err, stdout, stderr) {
        args.log.trace({exec: true, command: command, execOpts: execOpts,
            err: err, stdout: stdout, stderr: stderr}, 'exec done');
        if (err) {
            var msg = format(
                '%s:\n'
                + '\tcommand: %s\n'
                + '\texit status: %s\n'
                + '\tstdout:\n%s\n'
                + '\tstderr:\n%s',
                args.errMsg || 'exec error', command, err.code,
                stdout.trim(), stderr.trim());
            cb(new InternalError({cause: err, message: msg}), stdout, stderr);
        } else {
            cb(null, stdout, stderr);
        }
    });
}


/**
 * Call `vmadm stop UUID`.
 *
 * @param uuid {String} The current snapshot name.
 * @param options {Object}
 *      - force {Boolean} Optional. Use '-F' option to 'vmadm stop'.
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err)`
 */
function vmStop(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.optionalBool(options.force, 'options.force');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var optStr = '';
    if (options.force) {
        optStr += ' -F';
    }
    var cmd = format('/usr/sbin/vmadm stop%s %s', optStr, uuid);
    options.log.trace({cmd: cmd}, 'start vmStop');
    exec(cmd, function (err, stdout, stderr) {
        options.log.trace({cmd: cmd, err: err, stdout: stdout, stderr: stderr},
            'finish vmStop');
        callback(err);
    });
}


/**
 * Call `vmadm start UUID`.
 *
 * @param uuid {String} The current snapshot name.
 * @param options {Object}
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err)`
 */
function vmStart(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.optionalBool(options.force, 'options.force');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var optStr = '';
    if (options.force) {
        optStr += ' -F';
    }
    var cmd = format('/usr/sbin/vmadm start%s %s', optStr, uuid);
    options.log.trace({cmd: cmd}, 'start vmStart');
    exec(cmd, function (err, stdout, stderr) {
        options.log.trace({cmd: cmd, err: err, stdout: stdout, stderr: stderr},
            'finish vmStart');
        callback(err);
    });
}

/**
 * Call `vmadm get UUID`.
 *
 * @param uuid {String} The current snapshot name.
 * @param options {Object}
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err, vm)`
 */
function vmGet(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var cmd = format('/usr/sbin/vmadm get %s', uuid);
    // options.log.trace({cmd: cmd}, 'start vmGet');
    exec(cmd, function (err, stdout, stderr) {
        // options.log.trace(
        //    {cmd: cmd, err: err, stdout: stdout, stderr: stderr},
        //    'finish vmGet');
        if (err) {
            callback(new InternalError({
                cause: err,
                message: format('error getting VM %s info', uuid)
            }));
            return;
        }
        try {
            var vm = JSON.parse(stdout);
            callback(null, vm);
        } catch (e) {
            callback(e);
        }
    });
}

/**
 * Wait for a particular key (and optionally, value) in a VM's
 * customer_metadata to show up.
 *
 * @param uuid {String} The VM uuid.
 * @param options {Object}
 *      - key {String} The customer_metadata key to wait for.
 *      - value {String} Optional. If given, a key *value* to wait for. If not
 *        given, then this just waits for the presence of `key`.
 *      - values {Array of String} Optional. An *array*
 *        of values can be given, in which case it will return if the value
 *        matches any of those.
 *      - timeout {Number} The number of ms (approximately) after which
 *        to timeout with an error. If not given, then never times out.
 *      - interval {Number} The number of ms between polls. Default is 1000ms.
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err, vm)`
 */
function vmWaitForCustomerMetadatum(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.string(options.key, 'options.key');
    assert.optionalString(options.value, 'options.value');
    assert.optionalArrayOfString(options.values, 'options.values');
    assert.optionalNumber(options.timeout, 'options.timeout');
    assert.optionalNumber(options.interval, 'options.interval');
    assert.func(callback);
    var interval = options.interval || 1000;
    var key = options.key;

    function match(val) {
        if (options.value !== undefined) {
            return val === options.value;
        } else if (options.values !== undefined) {
            return options.values.indexOf(val) !== -1;
        } else {
            return val !== undefined;
        }
    }

    var start = Date.now();
    var vm;
    async.doUntil(
        function getIt(next) {
            setTimeout(function () {
                vmGet(uuid, options, function (err, vm_) {
                    vm = vm_;
                    next(err);
                });
            }, interval);
        },
        function testIt() {
            options.log.trace({vm: uuid},
                'test for customer_metadata "%s" key match', options.key);
            return (match(vm.customer_metadata[key])
                || (options.timeout && Date.now() - start >= options.timeout));
        },
        function done(err) {
            if (err) {
                callback(err);
            } else if (match(vm.customer_metadata[key])) {
                callback(null, vm);
            } else {
                var extra = '';
                if (options.value) {
                    extra = format(' to bet set to "%s"', options.value);
                } else if (options.values) {
                    extra = format(' to bet set to one of "%s"',
                        options.values.join('", "'));
                }
                callback(new errors.TimeoutError(format('timeout (%dms) '
                    + 'waiting for VM %s customer_metadata "%s" key%s',
                    options.timeout, uuid, key, extra)));
            }
        }
    );
}


/**
 * Wait for the given VM to enter the given state.
 *
 * @param uuid {String} The VM uuid.
 * @param options {Object}
 *      - state {String} The state to wait for.
 *      - timeout {Number} The number of ms (approximately) after which
 *        to timeout with an error. If not given, then never times out.
 *      - interval {Number} The number of ms between polls. Default is 1000ms.
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err, vm)`
 */
function vmWaitForState(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.string(options.state, 'options.state');
    assert.optionalNumber(options.timeout, 'options.timeout');
    assert.optionalNumber(options.interval, 'options.interval');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var interval = options.interval || 1000;

    var start = Date.now();
    var vm;
    async.doUntil(
        function getIt(next) {
            setTimeout(function () {
                vmGet(uuid, options, function (err, vm_) {
                    vm = vm_;
                    next(err);
                });
            }, interval);
        },
        function testIt() {
            options.log.trace({vm: uuid, state: vm.state},
                'test for state "%s"', options.state);
            return vm.state === options.state
                || (options.timeout
                    && Date.now() - start >= options.timeout);
        },
        function done(err) {
            if (err) {
                callback(err);
            } else if (vm.state === options.state) {
                callback(null, vm);
            } else {
                callback(new errors.TimeoutError(format('timeout (%dms) '
                    + 'waiting for VM %s to enter "%s" state: current '
                    + 'state is "%s"', options.timeout, uuid, options.state,
                    vm.state)));
            }

        }
    );
}


/**
 * Halt (aka `vmadm stop -F UUID`) this VM if it is not stopped.
 *
 * @param uuid {String} The current snapshot name.
 * @param options {Object}
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err)`
 */
function vmHaltIfNotStopped(uuid, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(callback);

    vmGet(uuid, options, function (err, vm) {
        if (err) {
            callback(err);
        } else if (vm.state === 'stopped') {
            callback();
        } else {
            vmStop(uuid, {force: true, log: options.log}, callback);
        }
    });
}


/**
 * Call `vmadm update UUID <<UPDATE`.
 *
 * @param uuid {String} The current snapshot name.
 * @param update {String} The current snapshot name.
 * @param options {Object}
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err)`
 */
function vmUpdate(uuid, update, options, callback) {
    assert.string(uuid, 'uuid');
    assert.object(update, 'update');
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var argv = ['/usr/sbin/vmadm', 'update', uuid];
    options.log.trace({argv: argv, update: update}, 'start vmUpdate');

    var vmadm = spawn(argv[0], argv.slice(1));
    var stdout = [];
    var stderr = [];
    vmadm.stdout.setEncoding('utf8');
    vmadm.stderr.setEncoding('utf8');
    vmadm.stdout.on('data', function (s) { stdout.push(s); });
    vmadm.stderr.on('data', function (s) { stderr.push(s); });
    vmadm.on('close', function () {
        done();
    });
    var exitStatus;
    vmadm.on('exit', function (code) {
        exitStatus = code;
        done();
    });
    vmadm.stdin.write(JSON.stringify(update));
    vmadm.stdin.end();

    var nDoneCalls = 0;
    function done() {
        nDoneCalls++;
        if (nDoneCalls !== 2) {
            return;
        }
        options.log.trace({argv: argv, exitStatus: exitStatus,
            stdout: stdout, stderr: stderr}, 'finish vmUpdate');
        // 'exit' and 'close' called.
        if (exitStatus !== 0) {
            callback(new InternalError({
                message: format('vmadm update failed (%s): %s',
                                exitStatus, stderr.join(''))
            }));
        } else {
            callback();
        }
    }
}


/**
 * "cosmic ray" stuff for testing error code paths
 *
 * To support testing some error code paths we support inducing some errors
 * via "IMGADM_TEST_*_COSMIC_RAY" environment variables, where "*" is an
 * action like "DOWNLOAD".
 *
 * If defined it must be a comma-separated list of numbers (from zero to one).
 * Each number is a *probability* of failure (i.e. of having a cosmic ray)
 * for the Nth action (e.g. for the 0th, 1st, ... download). The "N" here is
 * a global count from `imgadm` invocation.
 *
 * E.g.: The following will result in the 3rd attempted
 * download failing:
 *      IMGADM_TEST_DOWNLOAD_COSMIC_RAY=0,0,1 imgadm import busybox:latest
 *
 * Usage in code:
 *      var cosmicRay = common.testForCosmicRay('download');
 *      ...
 *      if (cosmicRay) {
 *          return cb(new Error('download cosmic ray'));
 *      }
 */
var cosmicRayCountFromName = {};

function testForCosmicRay(name) {
    assert.string(name, 'name');

    if (cosmicRayCountFromName[name] === undefined) {
        cosmicRayCountFromName[name] = 0;
    }
    var index = cosmicRayCountFromName[name]++;
    var prob = 0;
    var envvar = 'IMGADM_TEST_' + name.toUpperCase() + '_COSMIC_RAY';

    if (process.env[envvar]) {
        // JSSTYLED
        var probs = process.env[envvar].split(/,/g);
        if (index < probs.length) {
            prob = Number(probs[index]);
            assert.number(prob, envvar + '[' + index + ']');
        }
    }
    var cosmicRay = prob > 0 && Math.random() <= prob;

    return cosmicRay;
}





// ---- exports

module.exports = {
    NAME: NAME,
    MANIFEST_V: MANIFEST_V,
    DEFAULT_ZPOOL: DEFAULT_ZPOOL,
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    DB_DIR: DB_DIR,
    VALID_COMPRESSIONS: VALID_COMPRESSIONS,
    VALID_SOURCE_TYPES: VALID_SOURCE_TYPES,
    getVersion: getVersion,
    DOWNLOAD_DIR: DOWNLOAD_DIR,
    downloadFileFromUuid: downloadFileFromUuid,
    indent: indent,
    objCopy: objCopy,
    objMerge: objMerge,
    UUID_RE: UUID_RE,
    assertUuid: assertUuid,
    boolFromString: boolFromString,
    pathSlugify: pathSlugify,
    diffManifestFields: diffManifestFields,
    textWrap: textWrap,
    humanSizeFromBytes: humanSizeFromBytes,
    promptYesNo: promptYesNo,
    normUrlFromUrl: normUrlFromUrl,
    execFilePlus: execFilePlus,
    execPlus: execPlus,

    vmStop: vmStop,
    vmStart: vmStart,
    vmGet: vmGet,
    vmUpdate: vmUpdate,
    vmWaitForState: vmWaitForState,
    vmHaltIfNotStopped: vmHaltIfNotStopped,
    vmWaitForCustomerMetadatum: vmWaitForCustomerMetadatum,

    testForCosmicRay: testForCosmicRay
};
