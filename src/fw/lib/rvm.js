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
 * fwadm: functions for manipulating remote VMs
 */

var fs = require('fs');
var mkdirp = require('mkdirp');
var mod_rule = require('fwrule');
var util = require('util');
var util_err = require('./util/errors');
var util_obj = require('./util/obj');
var util_vm = require('./util/vm');
var vasync = require('vasync');
var VError = require('verror').VError;


var createSubObjects = util_obj.createSubObjects;
var forEachKey = util_obj.forEachKey;



// --- Globals



var VM_PATH = '/var/fw/vms';



// --- Exports



/**
 * Create remote VM objects
 *
 * @param allVMs {Object}: VM lookup table, as returned by createVMlookup()
 * @param vms {Array}: array of VM objects to turn into remote VMs
 * @param callback {Function} `function (err, remoteVMs)`
 * - Where remoteVMs is an object of remote VMs, keyed by UUID
 */
function create(allVMs, vms, log, callback) {
    log.trace(vms, 'rvm.create: entry');
    if (!vms || vms.length === 0) {
        return callback();
    }

    var remoteVMs = {};
    var errs = [];

    vms.forEach(function (vm) {
        try {
            var rvm = util_vm.createRemoteVM(vm);
            if (allVMs.all.hasOwnProperty(rvm.uuid)) {
                var err = new VError(
                    'Remote VM "%s" must not have the same UUID as a local VM',
                    rvm.uuid);
                err.details = vm;
                throw err;
            }
            remoteVMs[rvm.uuid] = rvm;
        } catch (err2) {
            errs.push(err2);
        }
    });

    if (errs.length !== 0) {
        return callback(util_err.createMultiError(errs));
    }

    return callback(null, remoteVMs);
}


/**
 * Create a lookup table for remote VMs
 *
 * @param {Array of Objects} remoteVMs : this can either be an object mapping
 *   UUIDs to remote VM objects, or an array of these objects
 * @param {Object} log : bunyan logger
 */
function createLookup(remoteVMs, log) {
    log.trace(remoteVMs, 'rvm.createLookup: entry');

    var rvmLookup = {
        all: {},
        ips: {},
        subnets: {},
        tags: {},
        vms: {},
        wildcards: {}
    };

    if (!remoteVMs || util_obj.objEmpty(remoteVMs)) {
        return rvmLookup;
    }

    var rvmList = remoteVMs;
    if (!util_obj.isArray(rvmList)) {
        rvmList = [ remoteVMs ];
    }

    rvmList.forEach(function (rvmObj) {
        forEachKey(rvmObj, function (uuid, rvm) {
            // Make vms match the layout of tags, eg: tags[key][uuid] = { obj }
            rvmLookup.vms[uuid] = {};
            rvmLookup.vms[uuid][uuid] = rvm;

            if (rvm.hasOwnProperty('tags')) {
                forEachKey(rvm.tags, function (tag, val) {
                    createSubObjects(rvmLookup.tags, tag, uuid, rvm);
                    createSubObjects(rvmLookup, 'tagValues', tag, val,
                        uuid, rvm);
                });
            }

            rvm.ips.forEach(function (ip) {
                util_obj.addToObj3(rvmLookup, 'ips', ip, uuid, rvm);
            });

            rvmLookup.all[uuid] = rvm;
        });
    });

    rvmLookup.wildcards.vmall = rvmLookup.all;
    log.trace(rvmLookup, 'rvm.createLookup: return');
    return rvmLookup;
}


/*
 * Deletes remote VMs on disk
 *
 * @param {Array} rules : rule objects to delete
 * @param {Object} log : bunyan logger
 * @param {Function} callback : `f(err)`
 */
function del(rvmUUIDs, log, callback) {
    log.debug({ rvmUUIDs: rvmUUIDs }, 'rvm.del: entry');

    return vasync.forEachParallel({
        inputs: rvmUUIDs,
        func: function _del(uuid, cb) {
            var filename = util.format('%s/%s.json', VM_PATH, uuid);
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
 * Load a single remote VM from disk, returning the object
 *
 * @param {String} file : file to load the remote VM from
 * @param {Object} log : bunyan logger
 * @param {Function} callback : `f(err, vm)`
 * - vm {Object} : remote VM
 */
function load(uuid, log, callback) {
    var file = util.format('%s/%s.json', VM_PATH, uuid);
    log.trace('rvm.load: loading file "%s"', file);

    return fs.readFile(file, function (err, raw) {
        if (err) {
            if (err.code == 'ENOENT') {
                var uErr = new VError('Unknown remote VM "%s"', uuid);
                uErr.code = 'ENOENT';
                return callback(uErr);
            }

            return callback(err);
        }
        var parsed;

        try {
            parsed = JSON.parse(raw);
            log.trace(parsed, 'rvm.load: loaded rule file "%s"', file);
            // XXX: validate that the VM has a uuid
        } catch (err2) {
            log.error(err2, 'rvm.load: error parsing VM file "%s"', file);
            return callback(err2);
        }

        return callback(null, parsed);
    });
}


/**
 * Loads all remote VMs from disk
 *
 * @param {Object} log : bunyan logger
 * @param {Function} callback : `f(err, vms)`
 * - vms {Object} : remote VM objects, keyed by UUID
 */
function loadAll(log, callback) {
    log.trace('rvm.loadAll: entry');
    var vms = {};

    fs.readdir(VM_PATH, function (err, files) {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(null, {});
            }
            return callback(err);
        }

        return vasync.forEachParallel({
            inputs: files,
            func: function (file, cb) {
                if (file.indexOf('.json', file.length - 5) === -1) {
                    return cb(null);
                }
                var uuid = file.split('.')[0];

                return load(uuid, log, function (err2, rvm) {
                    if (rvm) {
                        vms[uuid] = rvm;
                    }
                    return cb(err2);
                });
            }
        }, function (err3, res) {
            return callback(err3, vms);
        });
    });
}


/*
 * Saves remote VMs to disk
 *
 * @param {Object} vms : remote VM objects to save, keyed by UUID
 * @param {Object} log : bunyan logger
 * @param {Function} callback : `f(err)`
 */
function save(vms, log, callback) {
    log.trace('rvm.save: entry');

    if (!vms || util_obj.objEmpty(vms)) {
        return callback();
    }

    var uuids = [];
    // XXX: allow overriding version in the payload
    var versions = {};
    var ver = mod_rule.generateVersion();

    return vasync.pipeline({
    funcs: [
        function _mkdir(_, cb) { mkdirp(VM_PATH, cb); },
        function _writeVMs(_, cb) {
            return vasync.forEachParallel({
                inputs: Object.keys(vms),
                func: function _writeVM(uuid, cb2) {
                    var vm = vms[uuid];
                    var filename = util.format('%s/%s.json.%s',
                        VM_PATH, uuid, ver);
                    log.trace(vm, 'writing "%s"', filename);

                    return fs.writeFile(filename, JSON.stringify(vm, null, 2),
                        function (err) {
                        if (err) {
                            return cb2(err);
                        }

                        uuids.push(uuid);
                        versions[uuid] = ver;

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
                    var before = util.format('%s/%s.json.%s', VM_PATH, uuid,
                        versions[uuid]);
                    var after = util.format('%s/%s.json', VM_PATH, uuid);
                    log.trace('renaming "%s" to "%s"', before, after);
                    fs.rename(before, after, cb2);
                }
            }, cb);
        }
    ]}, callback);
}



module.exports = {
    create: create,
    createLookup: createLookup,
    del: del,
    load: load,
    loadAll: loadAll,
    save: save
};
