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
var child_process = require('child_process'),
    exec = child_process.exec,
    spawn = child_process.spawn;
var format = require('util').format;

var assert = require('assert-plus');
var async = require('async');

var errors = require('./errors'),
    InternalError = errors.InternalError;



var NAME = 'imgadm';
var MANIFEST_V = 2;
var DEFAULT_ZPOOL = 'zones';
var DEFAULT_SOURCE = {type: 'imgapi', url: 'https://images.joyent.com'};

var VALID_COMPRESSIONS = ['none', 'bzip2', 'gzip'];


var _versionCache = null;
function getVersion() {
    if (_versionCache === null)
        _versionCache = require('../package.json').version;
    return _versionCache;
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



// ---- exports

module.exports = {
    NAME: NAME,
    MANIFEST_V: MANIFEST_V,
    DEFAULT_ZPOOL: DEFAULT_ZPOOL,
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    VALID_COMPRESSIONS: VALID_COMPRESSIONS,
    getVersion: getVersion,
    objCopy: objCopy,
    objMerge: objMerge,
    assertUuid: assertUuid,
    boolFromString: boolFromString,
    pathSlugify: pathSlugify,
    diffManifestFields: diffManifestFields,
    vmStop: vmStop,
    vmStart: vmStart,
    vmGet: vmGet,
    vmUpdate: vmUpdate,
    vmWaitForState: vmWaitForState,
    vmHaltIfNotStopped: vmHaltIfNotStopped,
    vmWaitForCustomerMetadatum: vmWaitForCustomerMetadatum
};
