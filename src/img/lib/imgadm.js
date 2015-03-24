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
 * Copyright (c) 2015, Joyent, Inc. All rights reserved.
 *
 * * *
 * The main imgadm functionality. The CLI is a light wrapper around this tool.
 *
 *      var imgadm = require('./imgadm');
 *      var bunyan = require('bunyan');
 *      var log = bunyan.createLogger({name: 'foo'});
 *      imgadm.createTool({log: log}, function (err, tool) {
 *
 *          tool.listImages(function (err, images) { ... });
 *          // ...
 *
 *      });
 */

var p = console.warn;

var assert = require('assert-plus');
var async = require('async');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    execFile = child_process.execFile,
    exec = child_process.exec;
var crypto = require('crypto');
var dsapi = require('sdc-clients/lib/dsapi');
var EventEmitter = require('events').EventEmitter;
var findit = require('findit');
var fs = require('fs');
var genUuid = require('node-uuid');
var imgapi = require('sdc-clients/lib/imgapi');
var imgmanifest = require('imgmanifest');
var lock = require('/usr/img/node_modules/locker').lock;
var mkdirp = require('mkdirp');
var once = require('once');
var path = require('path');
var ProgressBar = require('progbar').ProgressBar;
var rimraf = require('rimraf');
var url = require('url');
var util = require('util'),
    format = util.format;
var vasync = require('vasync');
var zfs = require('/usr/node/node_modules/zfs.js').zfs;

var common = require('./common'),
    NAME = common.NAME,
    DB_DIR = common.DB_DIR,
    indent = common.indent,
    objCopy = common.objCopy,
    assertUuid = common.assertUuid,
    execFilePlus = common.execFilePlus,
    execPlus = common.execPlus;
var configuration = require('./configuration');
var Database = require('./database');
var errors = require('./errors');
var magic = require('./magic');
var mod_sources = require('./sources');
var upgrade = require('./upgrade');



// ---- globals

var CONFIG_PATH = DB_DIR + '/imgadm.conf';
var DEFAULT_CONFIG = {};

/* BEGIN JSSTYLED */
var VMADM_FS_NAME_RE = /^([a-zA-Z][a-zA-Z\._-]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-disk\d+)?$/;
var VMADM_IMG_NAME_RE = /^([a-zA-Z][a-zA-Z\._-]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/* END JSSTYLED */

var UA = 'imgadm/' + common.getVersion()
    + ' (' + 'node/' + process.versions.node + '; '
    + 'OpenSSL/' + process.versions.openssl + ')';



// ---- internal support stuff

function getSysinfo(callback) {
    assert.func(callback, 'callback');
    execFile('/usr/bin/sysinfo', function (err, stdout, stderr) {
        if (err) {
            callback(err);
        } else {
            // Explicitly want to abort/coredump on this not being parsable.
            var sysinfo = JSON.parse(stdout.trim());
            callback(null, sysinfo);
        }
    });
}


/**
 * Return an error if min_platform or max_platform isn't satisfied with the
 * current platform version.
 *
 * @param opts:
 *      - sysinfo {Object} sysinfo for this platform
 *      - manifest {Object} the manifest to check
 * @returns null or an error
 */
function checkMinMaxPlatformSync(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.manifest, 'opts.manifest');
    assert.object(opts.sysinfo, 'opts.sysinfo');

    var minPlatSpec = opts.manifest.requirements
        && opts.manifest.requirements.min_platform;
    var maxPlatSpec = opts.manifest.requirements
        && opts.manifest.requirements.max_platform;
    if (!minPlatSpec && !maxPlatSpec) {
        return null;
    }

    // SDC 6.5 sysinfo is missing 'SDC Version' key in sysinfo.
    var platVer = opts.sysinfo['SDC Version'] || '6.5';
    var platTimestamp = opts.sysinfo['Live Image'];

    if (minPlatSpec) {
        if (minPlatSpec[platVer]) {
            if (platTimestamp < minPlatSpec[platVer]) {
                return new errors.MinPlatformError(platVer,
                    platTimestamp, minPlatSpec);
            }
        } else {
            /*
             * From the IMGAPI docs:
             * 2. if SDC version is greater than the lowest key,
             *    e.g. if "7.0" for the example above, then this
             *    image may be used on this platform.
             */
            var lowestSpecVer = Object.keys(minPlatSpec).sort()[0];
            if (platVer < lowestSpecVer) {
                return new errors.MinPlatformError(platVer,
                    platTimestamp, minPlatSpec);
            }
        }
    }

    if (maxPlatSpec) {
        if (maxPlatSpec[platVer]) {
            if (platTimestamp > maxPlatSpec[platVer]) {
                return new errors.MaxPlatformError(platVer,
                    platTimestamp, maxPlatSpec);
            }
        } else {
            /*
             * From the IMGAPI docs:
             * 1. if SDC version is greater than the highest key,
             *    e.g. if "7.2" for the example above, then this
             *    image may not be used on this platform.
             */
            var highestSpecVer = Object.keys(maxPlatSpec)
                .sort().slice(-1)[0];
            if (platVer > highestSpecVer) {
                return new errors.MaxPlatformError(platVer,
                    platTimestamp, maxPlatSpec);
            }
        }
    }

    return null;
}


/**
 * Call `zfs destroy -r` on the given dataset name.
 *
 * TODO: use zfs.js (OS-1919).
 */
function zfsDestroy(dataset, log, callback) {
    assert.string(dataset, 'dataset');
    assert.object(log, 'log');
    assert.func(callback, 'callback');
    var cmd = format('/usr/sbin/zfs destroy -r %s', dataset);
    exec(cmd, function (err, stdout, stderr) {
        log.trace({cmd: cmd, err: err, stdout: stdout, stderr: stderr},
            'zfsDestroy');
        callback(err);
    });
}

/**
 * Call `zfs rename -r SNAPSHOT SNAPSHOT`.
 *
 * @param a {String} The current snapshot name.
 * @param b {String} The snapshot name to which to rename.
 * @param options {Object}
 *      - recursive {Boolean} Optional. Use '-r' arg to 'zfs rename'.
 *      - log {Bunyan Logger}
 * @param callback {Function} `function (err)`
 */
function zfsRenameSnapshot(a, b, options, callback) {
    assert.string(a, 'a');
    assert.string(b, 'b');
    assert.object(options, 'options');
    assert.optionalBool(options.recursive, 'options.recursive');
    assert.object(options.log, 'options.log');
    assert.func(callback);
    var optStr = '';
    if (options.recursive) {
        optStr += ' -r';
    }
    var cmd = format('/usr/sbin/zfs rename%s %s', optStr, a, b);
    options.log.trace({cmd: cmd}, 'start zfsRenameSnapshot');
    exec(cmd, function (err, stdout, stderr) {
        options.log.trace({cmd: cmd, err: err, stdout: stdout, stderr: stderr},
            'finish zfsRenameSnapshot');
        callback(err);
    });
}

/**
 * Get details on a ZFS dataset.
 *
 * @param name {String} The zfs dataset name, "$pool/$uuid".
 * @param properties {Array} Optional array of property names to get.
 *      "name" is always included. "children" is special: it does extra work
 *      to gather the list of child snapshots and dependent clones.
 * @param callback {Function} `function (err, dataset)`
 *      Returns `callback(null, null)` if the dataset name doesn't exist.
 *
 * TODO: use zfs.js (OS-1919).
 */
function getZfsDataset(name, properties, callback) {
    assert.string(name, 'name');
    if (callback === undefined) {
        callback = properties;
        properties = [];
    }
    assert.arrayOfString(properties, 'properties');

    if (properties.indexOf('name') === -1) {
        properties.push('name');
    }
    var cIdx = properties.indexOf('children');
    if (cIdx !== -1) {
        properties.splice(cIdx);
    }
    var dataset;

    function getDataset(next) {
        var cmd = format('/usr/sbin/zfs list -H -p -o %s %s',
            properties.join(','), name);
        exec(cmd, {maxBuffer: 10485760}, function (err, stdout, stderr) {
            if (err) {
                // `zfs list` *seems* to exit 2 for bogus properties and 1 for
                // non-existant dataset.
                if (err.code === 1) {
                    dataset = null;
                    next();
                    return;
                } else {
                    next(new errors.InternalError({
                        cause: err,
                        message: format('error running "%s": %s', cmd,
                            stderr.split('\n', 1)[0])
                    }));
                    return;
                }
            }
            var values = stdout.trim().split('\t');
            dataset = {};
            for (var i = 0; i < properties.length; i++) {
                dataset[properties[i]] = values[i] === '-' ? null : values[i];
            }
            next();
        });
    }

    function getChildSnapshots(next) {
        if (!dataset) {
            next();
            return;
        }
        dataset.children = {};
        var cmd = format('/usr/sbin/zfs list -t all -pHr -o name %s', name);
        exec(cmd, {maxBuffer: 10485760}, function (err, stdout, stderr) {
            if (err) {
                next(new errors.InternalError({
                    cause: err,
                    message: format('error running "%s": %s', cmd,
                        stderr.split('\n', 1)[0])
                }));
                return;
            }
            dataset.children.snapshots = stdout.trim().split(/\n/g).slice(1);
            next();
        });
    }

    /**
     * Dependent clones of a dataset are zfs filesystems or volumes
     * (-t filesystem,volume)
     * created by `zfs clone` of a snapshot of the dataset in question.
     * This snapshot is the `origin` property of that clone. A snapshot
     * is named <dataset>@<snapshot-name>. Hence we can get a list via:
     *
     *      zfs list -t filesystem,volume -o origin,name -pH | grep '^NAME@'
     *
     * where 'NAME' is the dataset name.
     */
    function getDependentClones(next) {
        if (!dataset) {
            next();
            return;
        }
        var cmd = '/usr/sbin/zfs list -t filesystem,volume -o origin,name -pH';
        exec(cmd, {maxBuffer: 10485760}, function (err, stdout, stderr) {
            if (err) {
                next(new errors.InternalError({
                    cause: err,
                    message: format('error running "%s": %s', cmd, stderr)
                }));
                return;
            }
            var clones = dataset.children.clones = [];
            var lines = stdout.trim().split(/\n/g);
            var marker = name + '@';
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.slice(0, marker.length) !== marker)
                    continue;
                clones.push(line.split(/\t/g)[1]);
            }
            next();
        });
    }

    var funcs = [getDataset];
    if (cIdx !== -1) {
        funcs.push(getChildSnapshots);
        funcs.push(getDependentClones);
    }
    async.waterfall(funcs, function (err) {
        callback(err, dataset);
    });
}


function checkFileChecksum(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.file, 'opts.file');
    assert.string(opts.checksum, 'opts.checksum'); // 'type:hexdigest'
    assert.func(cb, 'cb');

    var onceCb = once(cb);
    var bits = opts.checksum.split(':');
    var hash = crypto.createHash(bits[0]);

    var stream = fs.createReadStream(opts.file);
    stream.on('data', function (chunk) {
        hash.update(chunk);
    });
    stream.on('error', onceCb);
    stream.on('end', function () {
        var checksumActual = hash.digest('hex');
        if (checksumActual !== bits[1]) {
            onceCb(new errors.DownloadError(format('file checksum (%s) '
                + 'error: expected "%s", file "%s" checksum is "%s"',
                bits[0], bits[1], opts.file, checksumActual)));
        } else {
            onceCb();
        }
    });
}



// ---- IMGADM tool

function IMGADM(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');

    this.log = options.log;
    this._manifestFromUuid = null;
    this.sources = null;
    this._db = new Database(options);
}

IMGADM.prototype.init = function init(callback) {
    var self = this;

    function loadConfig(next) {
        configuration.loadConfig({log: self.log}, function (err, config) {
            self.config = config;
            next(err);
        });
    }

    function setUserAgent(next) {
        self.userAgent = UA;
        if (self.config && self.config.userAgentExtra) {
            if (typeof (self.config.userAgentExtra) !== 'string') {
                next(new errors.ConfigError(format(
                    '"userAgentExtra" in config file "%s" is not a string',
                    CONFIG_PATH)));
                return;
            }
            self.userAgent += ' ' + self.config.userAgentExtra;
        }
        next();
    }

    function upgradeDb(next) {
        upgrade.upgradeIfNecessary(self, next);
    }

    function addSources(next) {
        self.sources = [];
        var sourcesInfo = self.config.sources || [common.DEFAULT_SOURCE];
        self.log.trace({sourcesInfo: sourcesInfo}, 'init: add sources');
        async.forEachSeries(
            sourcesInfo,
            function oneSource(sourceInfo, nextSource) {
                self._addSource(sourceInfo, true, nextSource);
            },
            function doneSources(err) {
                if (err) {
                    next(err);
                    return;
                }
                next();
            }
        );
    }

    async.series([
        loadConfig,
        setUserAgent,
        upgradeDb,
        addSources
    ], callback);
};


IMGADM.prototype.saveConfig = function saveConfig(cb) {
    assert.func(cb, 'cb');
    var saveOpts = {log: this.log, config: this.config};
    configuration.saveConfig(saveOpts, cb);
};


/**
 * Add a source to the current IMGADM object, if it isn't already a source.
 * It normalizes and handles DNS lookup as required.
 *
 * Note that this does *not* update the IMGADM config file.
 *
 * @param source {Object} A source info object with these keys:
 *      - url {String}
 *      - type {String}
 *      - insecure {Boolean} Optional. Default false.
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source. This is done to verify that the given URL doesn't have
 *      typos. By default the ping check is done when adding a source
 *      (unless it is an existing source, i.e. if `source` is already a `Source`
 *      instance).
 * @param callback {Function} `function (err, changed, source)` where `changed`
 *      is a boolean indicating if the config changed as a result.
 */
IMGADM.prototype._addSource = function _addSource(
        sourceInfo, skipPingCheck, callback) {
    assert.object(sourceInfo, 'sourceInfo');
    assert.string(sourceInfo.url, 'sourceInfo.url');
    assert.string(sourceInfo.type, 'sourceInfo.type');
    assert.optionalBool(sourceInfo.insecure, 'sourceInfo.secure');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;

    // No-op if already have this URL/TYPE/INSECURE.
    var normUrl = common.normUrlFromUrl(sourceInfo.url);
    for (var i = 0; i < self.sources.length; i++) {
        if (self.sources[i].normUrl === normUrl
            && self.sources[i].type === sourceInfo.type
            && self.sources[i].insecure === sourceInfo.insecure)
        {
            return callback(null, false, self.sources[i]);
        }
    }

    // Else make a new Source instance.
    var source = self.sourceFromInfo(sourceInfo);

    if (skipPingCheck) {
        self.sources.push(source);
        callback(null, true, source);
    } else {
        source.ping(function (pingErr) {
            if (pingErr) {
                callback(pingErr);
                return;
            }
            self.sources.push(source);
            callback(null, true, source);
        });
    }
};

IMGADM.prototype.sourceFromInfo = function sourceFromInfo(sourceInfo) {
    assert.object(sourceInfo, 'sourceInfo');
    assert.string(sourceInfo.type, 'sourceInfo.type');

    return mod_sources.createSource(sourceInfo.type, {
        url: sourceInfo.url,
        insecure: sourceInfo.insecure,
        log: this.log,
        userAgent: this.userAgent,
        config: this.config
    });
};


/**
 * Remove a source from the current IMGADM object.
 *
 * Note that this does *not* update the IMGADM config file.
 *
 * @param sourceUrl {String}
 * @param callback {Function} `function (err, deleted)` where `deleted` is
 *      an array of `Source` instances deleted, if any.
 */
IMGADM.prototype._delSource = function _delSource(sourceUrl, callback) {
    assert.string(sourceUrl, 'sourceUrl');
    var normSourceUrl = common.normUrlFromUrl(sourceUrl);
    var deleted = [];
    this.sources = this.sources.filter(function (s) {
        if (s.normUrl !== normSourceUrl) {
            return true;
        } else {
            deleted.push(s);
            return false;
        }
    });
    callback(null, deleted.length ? deleted : null);
};


/**
 * Add a source and update the on-disk config.
 *
 * @param sourceInfo {Object} Image source object with these keys:
 *      - url {String}
 *      - type {String}
 *      - insecure {Boolean} Optional. Default false.
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL. Default false.
 * @param callback {Function} `function (err, changed, source)`
 */
IMGADM.prototype.configAddSource = function configAddSource(
        sourceInfo, skipPingCheck, callback) {
    assert.object(sourceInfo, 'sourceInfo');
    assert.string(sourceInfo.url, 'sourceInfo.url');
    assert.string(sourceInfo.type, 'sourceInfo.type');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;

    self._addSource(sourceInfo, skipPingCheck, function (addErr, ch, source) {
        if (addErr) {
            callback(addErr);
        } else if (ch) {
            if (!self.config.sources) {
                // Was implicitly getting the default source. Let's keep it.
                self.config.sources = [common.DEFAULT_SOURCE];
            }
            self.config.sources.push(source.toJSON());
            self.saveConfig(function (saveErr) {
                if (saveErr) {
                    callback(saveErr);
                    return;
                }
                self.log.debug({source: source}, 'added source');
                callback(null, true, source);
            });
        } else {
            callback(null, false, source);
        }
    });
};


/**
 * Delete a source URL and update the on-disk config.
 *
 * @param sourceUrl {String}
 * @param callback {Function} `function (err, deleted)` where `deleted` is
 *      an array of `Source` instances deleted, if any.
 */
IMGADM.prototype.configDelSourceUrl = function configDelSourceUrl(
        sourceUrl, callback) {
    assert.string(sourceUrl, 'sourceUrl');
    var self = this;

    self._delSource(sourceUrl, function (delErr, deleted) {
        if (delErr) {
            callback(delErr);
        } else if (deleted) {
            self.config.sources = self.sources.map(function (s) {
                return s.toJSON();
            });
            self.saveConfig(function (saveErr) {
                if (saveErr) {
                    callback(saveErr);
                    return;
                }
                self.log.debug({sourceUrl: sourceUrl}, 'deleted source url');
                callback(null, deleted);
            });
        } else {
            callback(null, null);
        }
    });
};


/**
 * Update sources with the given URLs.
 *
 * Dev Notes: The histrionics below are to avoid re-running ping checks
 * on already existing source URLs.
 *
 * @param sourcesInfo {Array} Array of source info objects (with type and
 *      url keys, and optionally an 'insecure' key).
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL. Default false. However, a ping check is not done
 *      on already existing sources.
 * @param callback {Function} `function (err, changes)` where `changes` is
 *      a list of changes of the form `{type: <type>, url: <url>}` where
 *      `type` is one of 'reorder', 'add', 'del'.
 */
IMGADM.prototype.updateSources = function updateSources(
        sourcesInfo, skipPingCheck, callback) {
    assert.arrayOfObject(sourcesInfo, 'sourcesInfo');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;
    var i, j;

    // Validate types
    for (i = 0; i < sourcesInfo.length; i++) {
        var si = sourcesInfo[i];
        assert.string(si.url, format('sourcesInfo[%d].url', i));
        assert.string(si.type, format('sourcesInfo[%d].type', i));
        assert.optionalBool(si.insecure, format('sourcesInfo[%d].insecure', i));
        if (common.VALID_SOURCE_TYPES.indexOf(si.type) === -1) {
            callback(new errors.ConfigError(format(
                'type "%s" for source url "%s" is invalid: must be one of "%s"',
                si.type, si.url, common.VALID_SOURCE_TYPES.join('", "'))));
        }
    }

    var changes = [];
    var oldSources = self.sources.slice();
    var newSources = [];
    for (i = 0; i < sourcesInfo.length; i++) {
        var sourceInfo = sourcesInfo[i];
        var idx = -1;
        for (j = 0; j < oldSources.length; j++) {
            var old = oldSources[j];
            if (old && old.type === sourceInfo.type
                && old.url === sourceInfo.url
                && old.insecure === sourceInfo.insecure)
            {
                idx = j;
                break;
            }
        }
        if (idx === -1) {
            newSources.push(sourceInfo);
        } else {
            newSources.push(self.sources[idx]);
            oldSources[idx] = null;
        }
    }
    oldSources
        .filter(function (s) { return s !== null; })
        .forEach(function (s) { changes.push({type: 'del', source: s}); });
    if (changes.length === 0) {
        changes.push({type: 'reorder'});
    }

    self.sources = [];
    async.forEachSeries(
        newSources,
        function oneSource(s, next) {
            self._addSource(s, skipPingCheck, function (err, changed, source) {
                if (err) {
                    next(err);
                } else {
                    assert.ok(changed);
                    if (! mod_sources.isSource(s)) {
                        // Add to 'changes' with the actual `Source` instance.
                        changes.push({type: 'add', source: source});
                    }
                    next();
                }
            });
        },
        function doneSources(err) {
            if (err) {
                callback(err);
                return;
            }
            self.config.sources = self.sources.map(function (s) {
                return s.toJSON();
            });
            self.saveConfig(function (saveErr) {
                if (saveErr) {
                    callback(saveErr);
                    return;
                }
                callback(null, changes);
            });
        }
    );
};


IMGADM.prototype._errorFromClientError = function _errorFromClientError(
        clientUrl, err) {
    assert.string(clientUrl, 'clientUrl');
    assert.object(err, 'err');
    if (err.body && err.body.code) {
        return new errors.APIError(clientUrl, err);
    } else if (err.errno) {
        return new errors.ClientError(clientUrl, err);
    } else {
        return new errors.InternalError({message: err.message,
            clientUrl: clientUrl, cause: err});
    }
};



/**
 * Save image info to the db.
 *
 * @param imageInfo {Object} Holds image details, with keys:
 *      - manifest {Object}
 *      - zpool {String} The zpool on which the image is installed.
 *      - source {String} The source object.
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.dbAddImage = function dbAddImage(imageInfo, callback) {
    this._db.addImage(imageInfo, callback);
};


/**
 * Load images from the system and merge in manifest data from the imgadm
 * cache/database.
 *
 * @param callback {Function} `function (err, imagesInfo)`
 */
IMGADM.prototype._loadImages = function _loadImages(callback) {
    var self = this;
    var i;

    // Get a list of provisionable images. Here 'provisionable' means that
    // we are also constrained by 'vmadm create' rules. That means a
    // zfs "filesystem" (for zones) or "volume" (for KVM VMs) named
    // "$zpoolname/$uuid" whose mountpoint is not a zone root. Full images
    // won't have an origin, incremental images will.
    //
    // These conditions can conceivably include non-images: any clone not a
    // zone and named "ZPOOL/UUID". For this reason, any zfs dataset with
    // the property imgadm:ignore=true will be excluded, as an out.
    //
    // If necessary we could consider only include those with an origin
    // (i.e. incremental images) that also have a "@final" snapshot, as
    // recent imgadm guarantees on import.
    //
    // We also count the usages of these images: zfs filesystems with the
    // image as an origin.

    /* BEGIN JSSTYLED */
    // Example output:
    //      0:global:running:/::liveimg:shared:
    //      ...
    //      21:dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:running:/zones/dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:joyent-minimal:excl:21
    //      -:7970c690-1738-4e58-a04f-8ce4ea8ebfca:installed:/zones/7970c690-1738-4e58-a04f-8ce4ea8ebfca:7970c690-1738-4e58-a04f-8ce4ea8ebfca:kvm:excl:22
    /* END JSSTYLED */
    execPlus({
        command: '/usr/sbin/zoneadm list -pc',
        log: self.log,
        errMsg: 'could not list zones',
        execOpts: {
            maxBuffer: 10485760  /* >200k hit in prod, 10M should suffice */
        }
    }, function (zErr, zStdout, zStderr) {
        if (zErr) {
            callback(zErr);
            return;
        }
        var zLines = zStdout.trim().split('\n');
        var zoneRoots = {};
        zLines.forEach(function (zLine) {
            var zoneRoot = zLine.split(/:/g)[3];
            zoneRoots[zoneRoot] = true;
        });

        /*
         * PERF Note: Snapshots are gathered to do that (hopefully rare)
         * `hasFinalSnap` exclusions below. That can add 10%-20% (or
         * theoretically) more time to `imgadm list`. If that's a problem
         * we might want an option to exclude that processing if the caller
         * is fine with false positives.
         */
        execPlus({
            command: '/usr/sbin/zfs list -t filesystem,volume,snapshot -pH '
                + '-o name,origin,mountpoint,imgadm:ignore',
            log: self.log,
            errMsg: 'could not load images',
            execOpts: {
                maxBuffer: 10485760  /* >200k hit in prod, 10M should suffice */
            }
        }, function (zfsErr, stdout, stderr) {
            if (zfsErr) {
                callback(zfsErr);
                return;
            }
            var lines = stdout.trim().split('\n');
            var name;

            // First pass to gather which filesystems have '@final' snapshot.
            var hasFinalSnap = {};  /* 'zones/UUID' => true */
            for (i = 0; i < lines.length; i++) {
                name = lines[i].split('\t', 1)[0];
                if (name.slice(-6) === '@final') {
                    hasFinalSnap[name.slice(0, -6)] = true;
                }
            }

            var imageNames = [];
            var usageFromImageName = {};
            for (i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line.length === 0)
                    continue;
                var parts = line.split('\t');
                assert.equal(parts.length, 4);
                name = parts[0];
                var origin = parts[1];
                var mountpoint = parts[2];
                var ignore = parts[3];
                if (!VMADM_FS_NAME_RE.test(name))
                    continue;
                if (
                    /*
                     * If it has a mountpoint from `zoneadm list` it is
                     * a zone, not an image.
                     */
                    !zoneRoots[mountpoint]
                    /*
                     * If it doesn't match `VMADM_IMG_NAME_RE` it is a KVM
                     * disk volume, e.g. 'zones/UUID-disk0' or a snapshot,
                     * e.g. 'zones/UUID@SNAP'.
                     */
                    && VMADM_IMG_NAME_RE.test(name)
                    /*
                     * If it has a 'zones/UUID@final' origin (i.e. it was
                     * cloned from a modern-enough imgadm that enforced @final),
                     * but does *not* have a @final snapshot itself, then
                     * this isn't an image.
                     */
                    && !(origin.slice(-6) === '@final' && !hasFinalSnap[name])
                    )
                {
                    // Gracefully handle 'imgadm:ignore' boolean property.
                    if (ignore !== '-') {
                        try {
                            ignore = common.boolFromString(ignore, false,
                                '"imgadm:ignore" zfs property');
                        } catch (e) {
                            self.log.warn('dataset %s: %s', name, e);
                            ignore = false;
                        }
                    } else {
                        ignore = false;
                    }
                    if (!ignore) {
                        imageNames.push(name);
                    }
                }
                if (origin !== '-') {
                    // This *may* be a filesystem using an image. See
                    // joyent/smartos-live#180 for a counter-example.
                    var oname = origin.split('@')[0];
                    if (usageFromImageName[oname] === undefined) {
                        usageFromImageName[oname] = [name];
                    } else {
                        usageFromImageName[oname].push(name);
                    }
                }
            }

            var imagesInfo = [];
            async.forEachSeries(
                imageNames,
                function loadOne(imageName, next) {
                    var parsed = VMADM_FS_NAME_RE.exec(imageName);
                    var opts = {uuid: parsed[2], zpool: parsed[1]};
                    self._db.loadImage(opts, function (err, info) {
                        if (err) {
                            next(err);
                            return;
                        }
                        info.cloneNames = usageFromImageName[imageName] || [];
                        info.clones = info.cloneNames.length;
                        imagesInfo.push(info);
                        next();
                    });
                },
                function doneLoading(err) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, imagesInfo);
                    }
                }
            );
        });
    });
};


/**
 * Load info on the given locally installed image uuid.
 *
 * We don't just load "$uuid.json" from the imgadm db, because there might
 * be zombies (i.e. if the image was destroyed behind imgadm's back).
 *
 * @param options {Object} with:
 *      - @param uuid {String}
 *      - @param zpool {String}
 *      - @param children {Boolean} Optional. Set to true to also gather a
 *          list of child snapshots and dependent clones. Default is false.
 * @param callback {Function} `function (err, imageInfo)`
 *      If the image is not found it does `callback(null, null)`.
 */
IMGADM.prototype.getImage = function getImage(options, callback) {
    assert.object(options, 'options');
    assertUuid(options.uuid, 'options.uuid');
    assert.string(options.zpool, 'options.zpool');
    assert.optionalBool(options.children, 'options.children');
    assert.func(callback, 'callback');
    var self = this;

    var name = format('%s/%s', options.zpool, options.uuid);
    var properties = ['name'];
    if (options.children) {
        properties.push('children');
    }
    getZfsDataset(name, properties, function (zfsErr, dataset) {
        if (zfsErr) {
            callback(zfsErr);
            return;
        } else if (!dataset) {
            callback(null, null);
            return;
        }
        self._db.loadImage(options, function (loadErr, info) {
            if (loadErr) {
                callback(loadErr);
                return;
            }
            if (options.children) {
                info.children = dataset.children;
            }
            callback(null, info);
        });
    });
};



/**
 * Return available images from all sources.
 *
 * Limitations:
 * - This is not supported for Docker sources (they are skipped).
 *
 * @param cb {Function} `function (err, imagesInfo)`
 *      If there is an error then `err` will be set. Note that `imagesInfo`
 *      will still contain results. This is so that an error in one source
 *      does not break everything.
 */
IMGADM.prototype.sourcesList = function sourcesList(cb) {
    var self = this;

    if (self.sources.length === 0) {
        cb(new errors.NoSourcesError());
        return;
    }

    var imagesFromSourceUrl = {};
    var errs = [];
    vasync.forEachParallel({
        inputs: self.sources,
        func: function oneSource(source, next) {
            if (source.type === 'docker') {
                next();
                return;
            }
            source.listImages(function (err, images) {
                if (err) {
                    errs.push(err);
                } else if (images) {
                    imagesFromSourceUrl[source.url] = images;
                }
                next();
            });
        }
    }, function finishSourcesList(err) {
        if (!err && errs.length) {
            err = (errs.length === 1 ? errs[0] : new errors.MultiError(errs));
        }

        var imagesInfo = [];
        var imageFromUuid = {};
        self.log.trace({imagesFromSourceUrl: imagesFromSourceUrl},
            'images from each source');
        var sourceUrls = Object.keys(imagesFromSourceUrl);
        for (var i = 0; i < sourceUrls.length; i++) {
            var images = imagesFromSourceUrl[sourceUrls[i]];
            if (!images) {
                continue;
            }
            for (var j = 0; j < images.length; j++) {
                var image = images[j];
                var uuid = image.uuid;
                if (imageFromUuid[uuid] === undefined) {
                    imageFromUuid[uuid] = image;
                    imagesInfo.push({manifest: image, source: sourceUrls[i]});
                }
            }
        }
        cb(err, imagesInfo);
    });
};


/**
 * Get import info on the given image/repo from sources.
 *
 * @param opts {Object}
 *      - @param arg {String} Required. The import arg, e.g. a UUID for an
 *        IMGAPI source or a `docker pull ARG` for a Docker source.
 *      - @param sources {Array} Optional. An optional override to the set
 *        of sources to search. Defaults to `self.sources`.
 *      - @param ensureActive {Boolean} Optional. Default true. Set to false
 *        to have imgapi source searches exclude inactive images.
 * @param cb {Function} `function (err, importInfo)` where `importInfo`
 *      is `{uuid: <uuid>, source: <source>, ...opt source-specific fields...}`
 */
IMGADM.prototype.sourcesGetImportInfo =
        function sourcesGetImportInfo(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.arg, 'opts.arg');
    assert.optionalArrayOfObject(opts.sources, 'opts.sources');
    assert.optionalBool(opts.ensureActive, 'opts.ensureActive');
    var ensureActive = (opts.ensureActive === undefined
            ? true : opts.ensureActive);
    assert.func(cb, 'cb');

    var sources = opts.sources || self.sources;
    if (sources.length === 0) {
        cb(new errors.NoSourcesError());
        return;
    }

    var importInfo = null;
    var errs = [];
    vasync.forEachPipeline({
        inputs: sources,
        func: function oneSource(source, next) {
            if (importInfo) {
                next();
                return;
            }
            var getOpts = {
                arg: opts.arg,
                ensureActive: ensureActive
            };
            source.getImportInfo(getOpts, function (err, info) {
                if (err) {
                    errs.push(err);
                } else if (info) {
                    importInfo = info;
                    importInfo.source = source;
                }
                next();
            });
        }
    }, function finish(err) {
        if (!err && errs.length) {
            err = (errs.length === 1 ? errs[0] : new errors.MultiError(errs));
        }
        cb(err, importInfo);
    });
};


/**
 * List locally install images.
 *
 * Here `imagesInfo` is an array of objects like this:
 *      {
 *          manifest: {
 *              uuid: UUID,
 *              ...     // may only be uuid if don't have IMGAPI manifest info
 *              ...
 *          },
 *          source: SOURCE-URL,
 *          clones: N   // number of zfs clones from this image
 *          cloneNames: ['zones/UUID1', ...]    // if `opts.cloneNames`
 *      }
 *
 * @param callback {Function} `function (err, imagesInfo)`
 */
IMGADM.prototype.listImages = function listImages(callback) {
    this._loadImages(function (err, imagesInfo) {
        if (err) {
            callback(err);
        } else {
            callback(null, imagesInfo);
        }
    });
};


/**
 * Delete the given image.
 *
 * Dev notes:
 * - Bail if have child clones (We don't support a '-R' recursive delete
 *   option like `zfs destroy -R`. Too dangerous.)
 * - `zfs destroy ZPOOL/UUID` before updating imgadm db, in case we fail
 *   on a race (e.g., someone just cloned it).
 * - Remove imgadm db info.
 *
 * @param options {Object}:
 *      - @param uuid {String}
 *      - @param zpool {String}
 *      - @param skipChecks {Boolean} Optional. Default false. If true, will
 *        skip the (slightly costly) check for whether the image exists
 *        and has dependent clones.
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.deleteImage = function deleteImage(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assertUuid(options.uuid, 'options.uuid');
    assert.string(options.zpool, 'options.zpool');
    assert.optionalBool(options.skipChecks, 'options.skipChecks');
    assert.func(callback, 'callback');
    var uuid = options.uuid;
    var zpool = options.zpool;

    vasync.pipeline({funcs: [
        function checks(_, next) {
            if (options.skipChecks) {
                next();
                return;
            }

            var getOpts = {uuid: uuid, zpool: zpool, children: true};
            self.getImage(getOpts, function (err, imageInfo) {
                if (err) {
                    next(err);
                } else if (!imageInfo) {
                    next(new errors.ImageNotInstalledError(zpool, uuid));
                } else if (imageInfo.children.clones.length > 0) {
                    next(new errors.ImageHasDependentClonesError(imageInfo));
                } else {
                    next();
                }
            });
        },

        function del(_, next) {
            execPlus({
                command: format('/usr/sbin/zfs destroy -r %s/%s', zpool, uuid),
                log: self.log,
                errMsg: format('error deleting image "%s"', uuid)
            }, function (err, stdout, stderr) {
                if (err) {
                    next(err);
                    return;
                }
                self._db.deleteImage(options, next);
            });
        }
    ]}, callback);
};


/**
 * Import (find, download and install) the given image and, if necessary, its
 * ancestry.
 *
 * @param opts {Object}
 *      - @param importInfo {Object} Source-specific import info (from
 *        `source.getImportInfo()`.
 *      - @param zpool {String} The zpool to which to import.
 *      - @param zstream {Boolean} Optional. Default false. If true, indicates
 *        the GetImageFile will be a raw ZFS dataset stream.
 *      - @param quiet {Boolean} Optional. Default false. Set to true
 *        to not have a progress bar for the install.
 *      - @param logCb {Function} Optional. A function that is called
 *        with progress messages. It should support printf-like syntax,
 *        e.g. passing console.log is legal.
 * @param cb {Function} `function (err)`
 */
IMGADM.prototype.importImage = function importImage(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.importInfo, 'opts.importInfo');
    assert.object(opts.importInfo.source, 'opts.importInfo.source');
    assert.string(opts.zpool, 'opts.zpool');
    assert.optionalBool(opts.zstream, 'opts.zstream');
    assert.optionalBool(opts.quiet, 'opts.quiet');
    assert.optionalFunc(opts.logCb, 'opts.logCb');

    var manifest = opts.importInfo.manifest;
    if (manifest) {
        // Ensure this image is active.
        if (manifest.state !== 'active') {
            cb(new errors.ImageNotActiveError(manifest.uuid));
            return;
        }
    }

    this._importImage(opts, cb);
};


/**
 * Download one image file to a local temp directory.
 *
 * @param opts {Object}
 *      - source
 *      - bar
 *      - logCb
 *      - importInfo
 *      - imgMeta
 *      - @param zstream {Boolean} Optional. Default false. If true, indicates
 *        the GetImageFile will be a raw ZFS dataset stream.
 * @param cb {Function} `function (err, downloadInfo)` where `downloadInfo` is
 *      {
 *          "path": "/var/tmp/.imgadm-downloads/$uuid.file",
 *          "size": <content-length>
 *      }
 */
IMGADM.prototype._downloadImageFile = function _downloadImageFile(opts, cb) {
    var self = this;
    assert.func(cb, 'cb');
    assert.object(opts, 'opts');
    assert.object(opts.source, 'opts.source');
    assert.optionalObject(opts.bar, 'opts.bar');
    assert.optionalBool(opts.zstream, 'opts.zstream');
    assert.func(opts.logCb, 'opts.logCb');
    // As from `source.getImportInfo`.
    assert.object(opts.importInfo, 'opts.importInfo');
    // As from `source.getImgMeta`.
    assert.object(opts.imgMeta, 'opts.imgMeta');
    assert.optionalNumber(opts.imgMeta.size, 'opts.imgMeta.size');
    assert.optionalString(opts.imgMeta.checksum, 'opts.imgMeta.checksum');

    var log = self.log;
    var uuid = opts.importInfo.uuid;
    var zstream = Boolean(opts.zstream);
    var downFile = common.downloadFileFromUuid(uuid);
    var context = {};
    var cosmicRay = common.testForCosmicRay('download');

    /**
     * Return an event emitter on which we announce the 'content-length' when
     * we have it.
     */
    var ee = new EventEmitter();

    vasync.pipeline({arg: context, funcs: [
        function skipIfPreDownloaded(ctx, next) {
            if (! fs.existsSync(downFile)) {
                next();
                return;
            }

            // If have an expected size, ensure any pre-downloaded file
            // matches that.
            if (opts.imgMeta.size) {
                ctx.downFileStats = fs.statSync(downFile);
                if (ctx.downFileStats.size !== opts.imgMeta.size) {
                    log.info({uuid: uuid, downFile: downFile,
                        actualSize: ctx.downFileStats.size,
                        expectedSize: opts.imgMeta.size},
                        'unexpected size for pre-downloaded image %s file, '
                        + 'deleting and re-downloading', uuid);
                    rimraf.sync(downFile);
                    next();
                    return;
                }
            }

            // If have an expected checksum, ensure any pre-downloaded file
            // matches that. On a match we skip out and use pre-downloaded file.
            if (opts.imgMeta.checksum) {
                var checkOpts = {
                    file: downFile,
                    checksum: opts.imgMeta.checksum
                };
                checkFileChecksum(checkOpts, function (err) {
                    if (err) {
                        log.info({err: err, uuid: uuid, downFile: downFile,
                            expectedChecksum: opts.imgMeta.checksum},
                            'unexpected checksum for pre-downloaded '
                            + 'image %s file, re-downloading', uuid);
                        rimraf.sync(downFile);
                        next();
                    } else {
                        log.info({uuid: uuid, downFile: downFile},
                            'using pre-downloaded image file (checksum match)');
                        next(true); // early abort
                    }
                });
            } else {
                next();
            }
        },

        function mkdirpDownDir(ctx, next) {
            mkdirp(common.DOWNLOAD_DIR, next);
        },

        function getStream(ctx, next) {
            ctx.stream = opts.source.getImgFileStream(opts.importInfo,
                function (err, stream) {
                    ctx.stream = stream;
                    next(err);
                }
            );
        },

        function checkContentLength(ctx, next) {
            if (zstream) {
                next();
                return;
            }

            ctx.cLen = Number(ctx.stream.headers['content-length']);
            if (isNaN(ctx.cLen)) {
                next(new errors.DownloadError('unexpected '
                    + 'missing or invalid Content-Length header: '
                    + ctx.stream.headers['content-length']));
                return;
            } else if (opts.imgMeta.size) {
                // Sanity check: content-length === imgMeta.size
                if (opts.imgMeta.size !== ctx.cLen) {
                    next(new errors.DownloadError(format('unexpected '
                        + 'mismatch between expected size, %d, and '
                        + 'Content-Length header, %d',
                        opts.imgMeta.size, ctx.cLen)));
                    return;
                }
            } else {
                // If have a pre-downloaded file of the right size, then use it.
                if (ctx.downFileStats && ctx.downFileStats.size === ctx.cLen)
                {
                    log.info({uuid: uuid, downFile: downFile},
                        'using pre-downloaded image file '
                        + '(Content-Length match)');
                    next(true); // early abort
                    return;
                }
            }

            ee.emit('content-length', ctx.cLen);

            next();
        },

        function downloadIt(ctx, next_) {
            var next = once(next_);

            var cosmicRayFunc;
            if (cosmicRay) {
                cosmicRayFunc = once(function () {
                    next(new errors.DownloadError(format(
                        'image %s cosmic ray error', uuid)));
                    ctx.stream.unpipe(ctx.fout);
                });
            }

            // Track size and checksum for checking.
            ctx.bytesDownloaded = 0;
            if (!zstream && opts.imgMeta.checksum) {
                ctx.checksum = opts.imgMeta.checksum.split(':');
                ctx.checksumHash = crypto.createHash(ctx.checksum[0]);
            }
            if (ctx.stream.headers['content-md5']) {
                ctx.contentMd5 = ctx.stream.headers['content-md5'];
                ctx.md5sumHash = crypto.createHash('md5');
            }
            ctx.stream.on('data', function (chunk) {
                if (opts.bar)
                    opts.bar.advance(chunk.length);
                ctx.bytesDownloaded += chunk.length;
                if (cosmicRay) {
                    cosmicRayFunc();
                }
                if (ctx.checksumHash) {
                    ctx.checksumHash.update(chunk);
                }
                if (ctx.md5sumHash) {
                    ctx.md5sumHash.update(chunk);
                }
            });

            ctx.downFilePartial = downFile + '.partial';
            ctx.fout = fs.createWriteStream(ctx.downFilePartial);
            ctx.stream.on('error', next);
            ctx.fout.on('error', next);
            ctx.fout.on('finish', next);
            ctx.stream.pipe(ctx.fout);
            ctx.stream.resume();
        },

        /**
         * Ensure the streamed image data matches expected checksum and size.
         */
        function checksum(ctx, next) {
            var errs = [];

            if (ctx.cLen !== undefined && ctx.bytesDownloaded !== ctx.cLen) {
                errs.push(new errors.DownloadError(format('image %s file size '
                    + 'error: expected %d bytes, downloaded %d bytes',
                    uuid, ctx.cLen, ctx.bytesDownloaded)));
            }

            if (ctx.checksumHash) {
                var checksumActual = ctx.checksumHash.digest('hex');
                if (checksumActual !== ctx.checksum[1]) {
                    errs.push(new errors.DownloadError(format('image %s file '
                        + 'checksum (%s) error: expected "%s", downloaded '
                        + 'checksum was "%s"', uuid, ctx.checksum[0],
                        ctx.checksum[1], checksumActual)));
                }
            }

            if (ctx.md5sumHash) {
                var md5sumActual = ctx.md5sumHash.digest('base64');
                if (md5sumActual !== ctx.contentMd5) {
                    errs.push(new errors.DownloadError(format('image %s file '
                        + 'Content-MD5 error: expected "%s", downloaded '
                        + 'checksum was "%s"', uuid,
                        ctx.contentMd5, md5sumActual)));
                }
            }

            if (errs.length === 1) {
                next(errs[0]);
            } else if (errs.length > 1) {
                next(new errors.MultiError(errs));
            } else {
                log.info({uuid: opts.importInfo.uuid},
                    'download passed size and checksum checks');
                next();
            }
        },

        function mvToFinalName(ctx, next) {
            fs.rename(ctx.downFilePartial, downFile, function (err) {
                delete ctx.downFilePartial;
                next(err);
            });
        }

    ]}, function (err) {
        if (err === true) { // Signal for early abort.
            err = null;
        }

        if (err) {
            if (context.downFilePartial) {
                rimraf(context.downFilePartial, function (rmErr) {
                    if (rmErr) {
                        log.warn({err: rmErr, uuid: uuid,
                            path: context.downFilePartial},
                            'could not remove partial download file');
                    }
                    cb(err);
                });
            } else {
                cb(err);
            }
        } else {
            var downloadInfo = {
                path: downFile,
                size: context.bytesDownloaded || opts.imgMeta.size
            };
            cb(null, downloadInfo);
        }
    });

    return ee;
};



/**
 * Do the work for `importImage`.
 *
 * tl;dr on import process:
 *  - Gather `installedImageFromName` and `irecs` (Import RECords, one for each
 *    image to download).
 *  - `getMetaQ` to get meta info (i.e. the manifest et al) from source
 *  - `downloadQ` to download all the image files to /var/tmp
 *  - `installQ` to install each image in order to the zpool
 */
IMGADM.prototype._importImage = function _importImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.object(opts.importInfo, 'opts.importInfo');
    assert.uuid(opts.importInfo.uuid, 'opts.importInfo.uuid');
    assert.object(opts.importInfo.source, 'opts.importInfo.source');
    assert.string(opts.zpool, 'opts.zpool');
    assert.optionalBool(opts.zstream, 'opts.zstream');
    assert.optionalBool(opts.quiet, 'opts.quiet');
    assert.optionalFunc(opts.logCb, 'opts.logCb');

    // Print timing info.
    // var _TIMES = {};
    // function TIME(name) {
    //     if (_TIMES[name]) {
    //         logCb('TIME(%s): %ss', name, (Date.now() - _TIMES[name]) / 1000);
    //     }
    //     _TIMES[name] = Date.now();
    // }
    function TIME() { }  // uncomment to disable timings

    var log = self.log;
    var logCb = opts.logCb || function () {};
    var zpool = opts.zpool;
    var importInfo = opts.importInfo;
    var source = importInfo.source;
    // If this will be a raw zstream, then we ignore
    // 'manifest.files[0].{sha1|size}'.
    var zstream = Boolean(opts.zstream);

    // TODO: refactor: move these to `ctx`.
    var canCloseInstallQ = false;
    var onDeck = {};  // <uuid> -> <irec>; `irec` stands for `import record`
    var bar;  // progress bar
    var unlockInfos;
    var irecs;

    // `bar.log` conflicts with `logCb`. It would require
    // something more capable than `logCb` to do right.
    var barLogCb = function (msg) {
        if (bar) {
            bar.log(msg);
        } else {
            logCb(msg);
        }
    };

    logCb('Importing %s from "%s"',
        source.titleFromImportInfo(opts.importInfo), source.url);

    var context = {};
    vasync.pipeline({arg: context, funcs: [
        function gatherSysinfo(ctx, next) {
            getSysinfo(function (err, sysinfo) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.sysinfo = sysinfo;
                next();
            });
        },

        /**
         * "irec" == import record, one for each image/layer we need to
         * download and install.
         */
        function createIrecs(ctx, next) {
            vasync.parallel({funcs: [
                function loadInstalledImages(nextGather) {
                    TIME('loadImages');
                    self._loadImages(function (err, imagesInfo) {
                        TIME('loadImages');
                        ctx.installedImageFromName = {};
                        for (var i = 0; i < imagesInfo.length; i++) {
                            var info = imagesInfo[i];
                            var name = info.zpool + '/' + info.manifest.uuid;
                            ctx.installedImageFromName[name] = info;
                        }
                        nextGather(err);
                    });
                },

                function getTargetImgAncestry(nextGather) {
                    logCb('Gather image %s ancestry', importInfo.uuid);
                    TIME('ancestry');
                    source.getImgAncestry(importInfo, function (err, ancestry) {
                        TIME('ancestry');
                        ctx.ancestry = ancestry;
                        log.debug({err: err, ancestry: ancestry},
                            'img ancestry');
                        if (err) {
                            nextGather(err);
                            return;
                        }
                        irecs = ancestry.map(function (a) {
                            return {
                                uuid: a.uuid,
                                // Prefer the top `importInfo` for the top-level
                                // image as it may have more fields.
                                importInfo: (a.uuid === importInfo.uuid
                                    ? importInfo
                                    : a)
                            };
                        });
                        nextGather();
                    });
                }
            ]}, next);
        },

        function filterOutAlreadyInstalled(ctx, next) {
            ctx.isInstalledFromUuid = {};
            var filteredIrecs = [];
            for (var i = 0; i < irecs.length; i++) {
                var irec = irecs[i];
                var info = ctx.installedImageFromName[zpool + '/' + irec.uuid];
                if (info) {
                    ctx.isInstalledFromUuid[irec.uuid] = true;
                    logCb('Image %s already installed', irec.uuid);
                } else {
                    filteredIrecs.push(irec);
                }
            }
            irecs = filteredIrecs;
            next();
        },

        function acquireLocks(ctx, next) {
            var lockOpts = {
                uuids: irecs.map(function (irec) { return irec.uuid; }),
                logCb: logCb
            };
            self._lockAcquire(lockOpts, function (err, unlockInfos_) {
                unlockInfos = unlockInfos_;
                next(err);
            });
        },

        // TODO: This should be done for *all* the irecs instead of just
        //       the top level. Release the lock for each already installed.
        //       If irecs.length goes to zero, then done.
        function checkIfImportedAfterLock(ctx, next) {
            var getOpts = {
                uuid: opts.importInfo.uuid,
                zpool: opts.zpool
            };
            self.getImage(getOpts, function (getErr, ii) {
                if (getErr) {
                    next(getErr);
                } else if (ii) {
                    logCb('Image %s (%s@%s) was imported while '
                        + 'waiting on lock', ii.manifest.uuid,
                        ii.manifest.name, ii.manifest.version);
                    next(true);  // early abort
                } else {
                    next();
                }
            });
        },

        /**
         * Get imgMeta for all import records.
         *
         * We *could* break this out to separate Q so could get downloads
         * started before having all meta.
         */
        function getMeta(ctx, next) {
            var onceNext = once(next);
            var cosmicRay = common.testForCosmicRay('get_meta');

            var getMetaQ = vasync.queuev({
                concurrency: 5,
                worker: function getManifestIfNotInstalled(irec, nextManifest) {
                    if (cosmicRay) {
                        nextManifest(new errors.InternalError({
                            message: 'getMeta cosmic ray'
                        }));
                        return;
                    }

                    source.getImgMeta(irec.importInfo, function (err, imgMeta) {
                        if (err) {
                            nextManifest(err);
                            return;
                        }
                        // Note: the image *manifest* is `imgMeta.manifest`.
                        irec.imgMeta = imgMeta;
                        log.info({irec: irec}, 'got irec.imgMeta');

                        nextManifest(checkMinMaxPlatformSync({
                            sysinfo: ctx.sysinfo,
                            manifest: imgMeta.manifest
                        }));
                    });
                }
            });

            getMetaQ.on('end', function doneManifests() {
                TIME('manifests');
                onceNext();
            });

            function onTaskEnd(taskErr) {
                if (taskErr && !getMetaQ.killed) {
                    log.info({err: taskErr}, 'abort getMeta');
                    logCb('Aborting (%s)', taskErr.message);
                    getMetaQ.kill();
                    onceNext(taskErr);
                }
            }

            TIME('manifests');
            getMetaQ.push(irecs, onTaskEnd);
            getMetaQ.close();
        },

        /**
         * Here we run downloads (`downloadQ`, concurrency=5) and installs
         * into the zpool (`installQ`) in parallel. Most of the code is
         * bookkeeping for:
         * (a) error handling: abort cleanly on any error
         * (b) installing in correct order: from base image up
         * (c) cleaning up temp files
         */
        function downloadAndInstall(ctx, next) {
            var onceNext = once(next);

            var downloadQ = vasync.queuev({
                concurrency: 5,
                worker: function fetchImg(irec, nextDownload) {
                    self.log.info({uuid: irec.uuid}, 'download image');
                    var dlOpts = {
                        source: source,
                        importInfo: irec.importInfo,
                        imgMeta: irec.imgMeta,
                        zstream: zstream,
                        bar: bar,
                        logCb: logCb
                    };
                    var dlEvents = self._downloadImageFile(dlOpts,
                            function (err, dlInfo) {
                        if (err) {
                            nextDownload(err);
                            return;
                        }

                        self.log.info({uuid: irec.uuid, downloadInfo: dlInfo},
                            'downloaded image');
                        barLogCb(format('Downloaded image %s (%s)',
                            irec.uuid, common.humanSizeFromBytes(dlInfo.size)));
                        irec.downloadPath = dlInfo.path;

                        var origin = irec.imgMeta.manifest.origin;
                        if (!origin || ctx.isInstalledFromUuid[origin]) {
                            if (!installQ.closed) {
                                installQ.push(irec, onTaskEnd);
                            }
                        } else {
                            onDeck[irec.uuid] = irec;
                        }
                        if (canCloseInstallQ
                            && Object.keys(onDeck).length === 0)
                        {
                            installQ.close();
                        }
                        nextDownload();
                    });

                    dlEvents.once('content-length', function (cLen) {
                        if (bar && !irec.imgMeta.size) {
                            bar.resize(bar.pb_size + cLen);
                        }
                    });
                }
            });

            downloadQ.on('end', function doneDownloads() {
                TIME('downloads');
                if (bar) {
                    bar.end();
                }
                canCloseInstallQ = true;
                log.debug('done downloads');
            });

            var installQ = vasync.queuev({
                concurrency: 1,
                worker: function installImg(irec, nextInstall) {
                    TIME('install-'+irec.uuid);

                    var installOpts = {
                        source: source,
                        zpool: zpool,
                        imgMeta: irec.imgMeta,
                        dsName: format('%s/%s', zpool, irec.uuid),
                        filePath: irec.downloadPath,
                        zstream: zstream,
                        quiet: opts.quiet,
                        logCb: barLogCb
                    };
                    self._installSingleImage(installOpts, function (err) {
                        if (err) {
                            nextInstall(err);
                            return;
                        }

                        barLogCb(format('Imported image %s (%s@%s)',
                            irec.uuid,
                            irec.imgMeta.manifest.name,
                            irec.imgMeta.manifest.version));

                        rimraf(irec.downloadPath, function (rmErr) {
                            if (rmErr) {
                                nextInstall(rmErr);
                                return;
                            }

                            ctx.isInstalledFromUuid[irec.uuid] = true;
                            // We can now install any downloaded (i.e. on deck)
                            // images whose origin was the image that we just
                            // installed.
                            // TODO: avoid iteration: there is just one child
                            Object.keys(onDeck).forEach(function (uuid) {
                                var onDeckIrec = onDeck[uuid];
                                var origin = onDeckIrec.imgMeta.manifest.origin;
                                if (origin === irec.uuid) {
                                    log.debug({uuid: irec.uuid},
                                        'putting img on installQ');
                                    delete onDeck[uuid];
                                    if (!installQ.closed) {
                                        installQ.push(onDeckIrec, onTaskEnd);
                                    }
                                }
                            });
                            if (canCloseInstallQ
                                && Object.keys(onDeck).length === 0)
                            {
                                installQ.close();
                            }
                            TIME('install-'+irec.uuid);
                            nextInstall();
                        });
                    });
                }
            });

            installQ.on('end', function doneInstalls() {
                log.debug('done installs');
                onceNext();
            });


            /**
             * If there is a download or install error, abort. Vasync's
             * `queue.kill()` does not stop running tasks (only prevents
             * queued ones from being started), therefore we need
             * `_downloadImageFile` and `_installSingleImage` to support
             * being aborted.
             */
            var abortDAI = once(function _abortDownloadAndInstall(taskErr) {
                if (bar) {
                    bar.end({nocomplete: true});
                }
                log.info({err: taskErr}, 'abort download and install');
                logCb('Aborting (%s)', taskErr.message);

                downloadQ.kill();
                installQ.kill();

                // TODO: Abort any ongoing downloads and install.
                // Object.keys(downloadQ.pending).forEach(function (id) {
                //     var task = downloadQ.pending[id].task;
                //     try {
                //         task.abort();
                //     } catch (e) {
                //         log.warn({err: e, task: task},
                //             'error aborting ongoing image download');
                //     }
                // });

                onceNext(taskErr);
            });

            function onTaskEnd(taskErr) {
                if (taskErr) {
                    abortDAI(taskErr);
                }
            }

            // The progress bar is complicated in that with Docker (v1)
            // downloads we don't have image file size info yet.
            var haveSizes = (!zstream
                && irecs.filter(function (irec) { return irec.imgMeta.size; })
                    .length === irecs.length);
            var barOpts = {
                filename: (irecs.length === 1 ? 'Download 1 image'
                    : format('Download %d images', irecs.length))
            };
            if (haveSizes) {
                var totalBytes = irecs
                    .map(function (irec) { return irec.imgMeta.size; })
                    .reduce(function (a, b) { return a + b; });
                barOpts.size = totalBytes;
                logCb('Must download and install %d image%s (%s)',
                    irecs.length, (irecs.length === 1 ? '' : 's'),
                    common.humanSizeFromBytes(totalBytes));
            } else {
                // We'll be resizing as we read Content-Length headers. We
                // add a hack extra byte here to ensure we don't "complete"
                // before all Content-Length headers have been included.
                if (zstream) {
                    barOpts.nosize = true;
                } else {
                    barOpts.size = 1;
                }

                logCb('Must download and install %d image%s',
                    irecs.length, (irecs.length === 1 ? '' : 's'));
            }
            if (!opts.quiet && process.stderr.isTTY) {
                bar = new ProgressBar(barOpts);
            }

            // Start it up.
            irecs.reverse();
            log.info({irecs: irecs, numInAncestry: ctx.ancestry.length,
                numToInstall: irecs.length}, 'irecs to download and install');
            TIME('downloads');
            downloadQ.push(irecs, onTaskEnd);
            downloadQ.close();
        }

    ]}, function finishUp(err) {
        if (err === true) { // Signal for early abort.
            err = null;
        }

        if (!unlockInfos) {
            cb(err);
            return;
        }

        var unlockOpts = {
            unlockInfos: unlockInfos,
            logCb: logCb
        };
        self._lockRelease(unlockOpts, function (unlockErr) {
            var e = (err && unlockErr
                ? new errors.MultiError([err, unlockErr])
                : err || unlockErr);
            cb(e);
        });
    });
};



/**
 * Lock imports for the given `uuids`.
 *
 * When locking multiple UUIDs (typical for an image import with ancestry),
 * it is expected that `opts.uuids` is in order from top image, its parent,
 * etc. down to the base. Lock files are per-uuid and will be acquired in order.
 * This should avoid deadlock if used consistently.
 *
 * @param opts {Object}
 * @param cb {Function} `function (err, unlockInfos)`
 */
IMGADM.prototype._lockAcquire = function _lockAcquire(opts, cb) {
    assert.object(opts, 'opts');
    assert.arrayOfString(opts.uuids, 'opts.uuids');
    assert.func(opts.logCb, 'opts.logCb');
    assert.func(cb, 'cb');

    var self = this;
    var log = self.log;
    var unlockInfos = [];

    vasync.forEachPipeline({
        inputs: opts.uuids,
        func: function lockOneUuid(uuid, next) {
            var acquireLogTimeout = setTimeout(function () {
                opts.logCb(format('Waiting for image %s import lock', uuid));
            }, 1000);

            var lockPath = self._lockPathFromUuid(uuid);
            log.debug({uuid: uuid, lockPath: lockPath}, 'acquiring lock');

            lock(lockPath, function (lockErr, unlockFn) {
                if (acquireLogTimeout) {
                    clearTimeout(acquireLogTimeout);
                }
                if (lockErr) {
                    next(new errors.InternalError({
                        message: 'error acquiring lock',
                        uuid: uuid,
                        lockPath: lockPath,
                        cause: lockErr
                    }));
                    return;
                }
                log.debug({lockPath: lockPath, uuid: uuid}, 'acquired lock');
                unlockInfos.push({
                    uuid: uuid,
                    lockPath: lockPath,
                    unlockFn: unlockFn
                });
                next();
            });
        }
    }, function finishLockAcquires(err) {
        if (err) {
            var unlockOpts = {
                unlockInfos: unlockInfos,
                logCb: opts.logCb
            };
            self._lockRelease(unlockOpts, function (unlockErr) {
                if (unlockErr) {
                    log.warn({unlockInfos: unlockInfos, err: unlockErr},
                        'could not release all locks in _lockAcquire cleanup');
                }
                cb(err);
            });
        } else {
            cb(null, unlockInfos);
        }
    });
};


IMGADM.prototype._lockRelease = function _lockRelease(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.arrayOfObject(opts.unlockInfos, 'opts.unlockInfos');
    assert.func(opts.logCb, 'opts.logCb');
    assert.func(cb, 'cb');

    vasync.forEachPipeline({
        inputs: opts.unlockInfos,
        func: function unlockOne(unlockInfo, next) {
            self.log.debug({unlockInfo: unlockInfo}, 'releasing lock');
            unlockInfo.unlockFn(function (unlockErr) {
                if (unlockErr) {
                    next(new errors.InternalError({
                        message: 'error releasing lock',
                        lockPath: unlockInfo.lockPath,
                        cause: unlockErr
                    }));
                    return;
                }
                self.log.debug({unlockInfo: unlockInfo}, 'released lock');
                next();
            });
        }
    }, cb);
};


/**
 * Install the given image from the given `manifest` and image file path,
 * `file`.
 *
 * It is up to the caller to ensure this UUID is not already installed.
 *
 * @param opts {Object}
 *      - @param manifest {Object} The manifest to import.
 *      - @param zpool {String} The zpool to which to import.
 *      - @param file {String} Path to the image file.
 *      - @param zstream {Boolean} Optional. Default false. If true, indicates
 *        the GetImageFile will be a raw ZFS dataset stream.
 *      - @param quiet {Boolean} Optional. Default false. Set to true
 *        to not have a progress bar for the install.
 *      - @param logCb {Function} A function that is called
 *        with progress messages. Called as `logCb(<string>)`. E.g. passing
 *        console.log is legal.
 * @param cb {Function} `function (err)`
 */
IMGADM.prototype.installImage = function installImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.object(opts.manifest, 'opts.manifest');
    assert.string(opts.zpool, 'opts.zpool');
    assert.string(opts.file, 'opts.file');
    assert.optionalBool(opts.zstream, 'opts.zstream');
    assert.optionalBool(opts.quiet, 'opts.quiet');
    assert.func(opts.logCb, 'opts.logCb');

    // Upgrade manifest if required.
    try {
        var manifest = imgmanifest.upgradeManifest(opts.manifest);
    } catch (err) {
        cb(new errors.InvalidManifestError(err));
        return;
    }

    var zstream = Boolean(opts.zstream);
    var logCb = opts.logCb;
    var imgMeta = {
        manifest: manifest
    };
    var unlockInfos;

    vasync.pipeline({funcs: [
        function validateManifest(_, next) {
            var errs = imgmanifest.validateMinimalManifest(manifest);
            if (errs) {
                next(new errors.ManifestValidationError(errs));
            } else {
                next();
            }
        },

        function checkMinMaxPlatform(_, next) {
            getSysinfo(function (err, sysinfo) {
                if (err) {
                    next(err);
                    return;
                }
                next(checkMinMaxPlatformSync({
                    sysinfo: sysinfo,
                    manifest: manifest
                }));
            });
        },

        function acquireLock(_, next) {
            var lockOpts = {
                uuids: [manifest.uuid],
                logCb: logCb
            };
            self._lockAcquire(lockOpts, function (err, unlockInfos_) {
                unlockInfos = unlockInfos_;
                next(err);
            });
        },

        function checkIfImportedAfterLock(_, next) {
            var getOpts = {
                uuid: manifest.uuid,
                zpool: opts.zpool
            };
            self.getImage(getOpts, function (getErr, ii) {
                if (getErr) {
                    next(getErr);
                } else if (ii) {
                    logCb('Image %s (%s@%s) was installed while '
                        + 'waiting on lock', manifest.uuid, ii.manifest.name,
                        ii.manifest.version);
                    next(true);  // early abort
                } else {
                    next();
                }
            });
        },

        function getAndCheckSize(_, next) {
            if (zstream) {
                next();
                return;
            }

            fs.stat(opts.file, function (statErr, stats) {
                if (statErr) {
                    next(statErr);
                    return;
                }
                var manSize = (manifest.files && manifest.files[0]
                    && manifest.files[0].size);
                if (manSize !== undefined && manSize != stats.size) {
                    next(new errors.DownloadError(format('image file size '
                        + 'error: manifest says %d bytes, %s is %d bytes',
                        manSize, opts.file, stats.size)));
                    return;
                }
                imgMeta.size = stats.size;
                next();
            });
        },

        function checkHash(_, next_) {
            var next = once(next_);

            if (zstream) {
                next();
                return;
            }


            var manSha1 = (manifest.files && manifest.files[0]
                && manifest.files[0].sha1);
            if (!manSha1) {
                next();
                return;
            }

            var hash = crypto.createHash('sha1');
            var s = fs.createReadStream(opts.file);
            s.on('data', function (chunk) {
                hash.update(chunk);
            });
            s.on('error', function (err) {
                next(err);
            });
            s.on('end', function () {
                var actualSha1 = hash.digest('hex');
                if (manSha1 != actualSha1) {
                    next(new errors.DownloadError(format('image file '
                        + 'checksum (sha1) error: manifest says "%s", '
                        + '%s is "%s"', manSha1, opts.file, actualSha1)));
                } else {
                    next();
                }
            });
        },

        function installIt(_, next) {
            var installOpts = {
                imgMeta: imgMeta,
                filePath: opts.file,
                dsName: format('%s/%s', opts.zpool, manifest.uuid),
                zpool: opts.zpool,
                zstream: opts.zstream,
                quiet: opts.quiet,
                logCb: logCb
            };
            self._installSingleImage(installOpts, function (err) {
                if (err) {
                    next(err);
                    return;
                }

                logCb('Installed image %s (%s@%s)',
                    manifest.uuid, manifest.name, manifest.version);
                next();
            });
        }

    ]}, function finishInstallImage(err) {
        if (err === true) { // Signal for early abort.
            err = null;
        }

        if (!unlockInfos) {
            cb(err);
            return;
        }

        var unlockOpts = {
            unlockInfos: unlockInfos,
            logCb: logCb
        };
        self._lockRelease(unlockOpts, function (unlockErr) {
            var e = (err && unlockErr
                ? new errors.MultiError([err, unlockErr])
                : err || unlockErr);
            cb(e);
        });
    });
};


IMGADM.prototype._lockPathFromUuid = function _lockPathFromUuid(uuid) {
    assertUuid(uuid, 'uuid');
    return '/var/run/img.' + uuid + '.import.lock';
};


/**
 * This handles creating an image in the zpool from a *single* docker
 * layer.
 *
 * - if have origin:
 *      zfs clone zones/$origin@final zones/$uuid
 *   else:
 *      zfs create zones/$uuid
 *      mkdir zones/$uuid/root
 *      crle ...
 * - cd /zones/$uuid/root && tar xf $layerFile
 * - handle .wh.* files
 * - zfs snapshot zones/$uuid@final
 *
 * Dev Note: This presumes an imgadm lock is held for this image.
 *
 * Testing notes:
 * - 'imgadm import tutum/influxdb' has a cbde4a8607af layer that is an
 *   empty gzip. That breaks `zcat FILE | gtar xz -f` that was used in earlier
 *   imgadm versions.
 * - 'imgadm import learn/tutorial' (layer 8dbd9e392a96) uses xz compression.
 * - 'imgadm import busybox' has layers with no compression.
 * - TODO: what's a docker image using bzip2 compression?
 */
IMGADM.prototype._installDockerImage = function _installDockerImage(ctx, cb) {
    var self = this;
    assert.object(ctx, 'ctx');
    assert.object(ctx.source, 'ctx.source');
    assert.string(ctx.filePath, 'ctx.filePath');
    assert.string(ctx.dsName, 'ctx.dsName');
    assert.string(ctx.zpool, 'ctx.zpool');
    assert.object(ctx.imgMeta.manifest, 'ctx.imgMeta.manifest');
    assert.func(ctx.logCb, 'ctx.logCb');
    assert.func(cb, 'cb');

    var zpool = ctx.zpool;
    var manifest = ctx.imgMeta.manifest;
    var log = self.log;

    var partialDsName = ctx.dsName + '-partial';
    var zoneroot = format('/%s/root', partialDsName);

    vasync.pipeline({funcs: [
        /**
         * A crashed earlier import of this image could have left a partial
         * dataset around. Turf it (we hold the lock).
         */
        function deleteExistingPartial(_, next) {
            getZfsDataset(partialDsName, ['name'], function (getErr, ds) {
                if (getErr) {
                    next(getErr);
                } else if (!ds) {
                    next();
                } else {
                    ctx.logCb('Warning: deleting partial dataset left over '
                        + 'from earlier import attempt: ' + partialDsName);
                    zfsDestroy(partialDsName, log, next);
                }
            });
        },

        function cloneOrigin(_, next) {
            if (!manifest.origin) {
                next();
                return;
            }
            var argv = ['/usr/sbin/zfs', 'clone',
                format('%s/%s@final', zpool, manifest.origin), partialDsName];
            execFilePlus({argv: argv, log: log}, next);
        },

        function createNewZoneroot(_, next) {
            if (manifest.origin) {
                next();
                return;
            }
            vasync.pipeline({funcs: [
                function zfsCreate(_2, next2) {
                    var argv = ['/usr/sbin/zfs', 'create', partialDsName];
                    execFilePlus({argv: argv, log: log}, next2);
                },
                function mkZoneroot(_2, next2) {
                    var argv = ['/usr/bin/mkdir', '-p', zoneroot];
                    execFilePlus({argv: argv, log: log}, next2);
                }
            ]}, next);
        },

        function sniffCompression(_, next) {
            assert.string(ctx.filePath, 'ctx.filePath');
            magic.compressionTypeFromPath(ctx.filePath, function (err, cType) {
                if (err) {
                    next(err);
                    return;
                }
                ctx.cType = cType; // one of: null, bzip2, gzip, xz
                next();
            });
        },

        /*
         * '/usr/bin/tar' supports sniffing 'xz', but balks on some Mac tar
         * goop (as in the learn/tutorial image). '/usr/bin/gtar' currently
         * doesn't sniff 'xz' compression.
         */
        function extract(_, next) {
            assert.string(ctx.filePath, 'ctx.filePath');

            var command;
            switch (ctx.cType) {
            case null:
                command = format(
                    '/usr/img/sbin/chroot-gtar %s %s %s none',
                    path.dirname(zoneroot),
                    path.basename(zoneroot),
                    ctx.filePath);
                break;
            case 'gzip':
                command = format(
                    '/usr/img/sbin/chroot-gtar %s %s %s gzip',
                    path.dirname(zoneroot),
                    path.basename(zoneroot),
                    ctx.filePath);
                break;
            case 'bzip2':
                command = format(
                    '/usr/img/sbin/chroot-gtar %s %s %s bzip2',
                    path.dirname(zoneroot),
                    path.basename(zoneroot),
                    ctx.filePath);
                break;
            case 'xz':
                command = format(
                    '/usr/img/sbin/chroot-gtar %s %s %s xz',
                    path.dirname(zoneroot),
                    path.basename(zoneroot),
                    ctx.filePath);
                break;
            default:
                throw new Error('unexpected compression type: ' + ctx.cType);
            }

            execPlus({
                command: command,
                log: log,
                execOpts: {
                    maxBuffer: 2 * 1024 * 1024
                }
            }, next);
        },

        function whiteout(_, next) {
            var find = findit(zoneroot);
            var onceNext = once(next);
            var toRemove = [];
            find.on('file', function (file, stat) {
                var base = path.basename(file);
                if (base.slice(0, 4) === '.wh.') {
                    toRemove.push(path.join(path.dirname(file), base.slice(4)));
                    toRemove.push(file);
                }
            });
            find.on('end', function () {
                log.info({toRemove: toRemove}, 'whiteout files');
                vasync.forEachPipeline({
                    inputs: toRemove,
                    func: rimraf
                }, onceNext);
            });
            find.on('error', onceNext);
        },

        /**
         * As a rule, we want all installed images on SmartOS to have their
         * single base snapshot (from which VMs are cloned) called "@final".
         * `vmadm` presumes this (tho allows for it not to be there for
         * bwcompat). This "@final" snapshot is also necessary for
         * `imgadm create -i` (i.e. incremental images).
         */
        function zfsSnapshot(_, next) {
            var argv = ['/usr/sbin/zfs', 'snapshot', partialDsName + '@final'];
            execFilePlus({argv: argv, log: log}, next);
        },

        /**
         * We created the dataset to a "...-partial" temporary name.
         * Rename it to the final name.
         */
        function renameToFinalDsName(_, next) {
            var argv = ['/usr/sbin/zfs', 'rename', partialDsName, ctx.dsName];
            execFilePlus({argv: argv, log: log}, next);
        }

    ]}, function finishUp(err) {
        if (err) {
            // Rollback the currently installed dataset, if necessary.
            // Silently fail here (i.e. only log at debug level) because
            // it is possible we errored out before the -partial dataset
            // was created.
            var argv = ['/usr/sbin/zfs', 'destroy', '-r',
                partialDsName];
            execFilePlus({argv: argv, log: log},
                    function (rollbackErr, stdout, stderr) {
                if (rollbackErr) {
                    log.debug({argv: argv, err: rollbackErr,
                        rollbackDsName: partialDsName},
                        'error destroying partial dataset while rolling back');
                }
                cb(err);
            });
        } else {
            cb(err);
        }
    });
};


IMGADM.prototype._installZfsImage = function _installZfsImage(ctx, cb) {
    var self = this;
    assert.object(ctx, 'ctx');
    assert.string(ctx.filePath, 'ctx.filePath');
    assert.string(ctx.dsName, 'ctx.dsName');
    assert.string(ctx.zpool, 'ctx.zpool');
    assert.object(ctx.imgMeta.manifest, 'ctx.imgMeta.manifest');
    assert.number(ctx.imgMeta.size, 'ctx.imgMeta.size');
    assert.optionalBool(ctx.zstream, 'ctx.zstream');
    assert.optionalBool(ctx.quiet, 'ctx.quiet');

    var zstream = Boolean(ctx.zstream);
    var manifest = ctx.imgMeta.manifest;
    var uuid = manifest.uuid;
    var log = self.log;

    vasync.pipeline({funcs: [
        /**
         * image file stream \                  [A]
         *      | inflator (if necessary) \     [B]
         *      | zfs recv                      [C]
         */
        function recvTheDataset(_, next) {
            // To complete this stage we want to wait for all of:
            // 1. the 'zfs receive' process to 'exit'.
            // 2. the compressor process to 'exit' (if we are compressing)
            // 3. the pipeline's std handles to 'close'
            //
            // If we get an error we "finish" right away. This `finish` stuff
            // coordinates that.
            var numToFinish = 2;  // 1 is added below if compressing.
            var numFinishes = 0;
            var finished = false;
            function finish(err) {
                numFinishes++;
                if (finished) {
                    /* jsl:pass */
                } else if (err) {
                    finished = true;
                    self.log.trace({err: err}, 'recvTheDataset err');
                    next(err);
                } else if (numFinishes >= numToFinish) {
                    finished = true;
                    next();
                }
            }

            if (!ctx.quiet && process.stderr.isTTY) {
                ctx.bar = new ProgressBar({
                    size: ctx.imgMeta.size,
                    filename: ctx.dsName
                });
            }

            // [A]
            var stream = fs.createReadStream(ctx.filePath);
            if (ctx.bar) {
                stream.on('data', function (chunk) {
                    ctx.bar.advance(chunk.length);
                });
            }
            stream.on('error', finish);

            // [B]
            // If we are getting a raw ZFS stream, then ignore the
            // manifest.files compression.
            var compression = (zstream
                ? 'none' : manifest.files[0].compression);
            var uncompressor;
            if (compression === 'bzip2') {
                uncompressor = spawn('/usr/bin/bzip2', ['-cdfq']);
                numToFinish++;
            } else if (compression === 'gzip') {
                uncompressor = spawn('/usr/bin/gzip', ['-cdfq']);
                numToFinish++;
            } else if (compression === 'xz') {
                uncompressor = spawn('/usr/bin/xz', ['-cdfq']);
                numToFinish++;
            } else {
                assert.equal(compression, 'none',
                    format('image %s file compression: %s', uuid, compression));
                uncompressor = null;
            }
            if (uncompressor) {
                uncompressor.stderr.on('data', function (chunk) {
                    console.error('Stderr from uncompression: %s',
                        chunk.toString());
                });
                uncompressor.on('exit', function (code) {
                    if (code !== 0) {
                        var msg;
                        if (compression === 'bzip2' && code === 2) {
                            msg = format('%s uncompression error while '
                                + 'importing: exit code %s (corrupt compressed '
                                + 'file): usually indicates a network error '
                                + 'while downloading, try again',
                                compression, code);
                        } else {
                            msg = format('%s uncompression error while '
                                + 'importing: exit code %s', compression, code);
                        }
                        finish(new errors.UncompressionError(msg));
                    } else {
                        finish();
                    }
                });
            }

            // [C]
            ctx.partialDsName = ctx.dsName + '-partial';
            var zfsRecv = spawn('/usr/sbin/zfs',
                ['receive', ctx.partialDsName]);
            zfsRecv.stderr.on('data', function (chunk) {
                console.error('Stderr from zfs receive: %s',
                    chunk.toString());
            });
            zfsRecv.stdout.on('data', function (chunk) {
                console.error('Stdout from zfs receive: %s',
                    chunk.toString());
            });
            zfsRecv.on('exit', function (code) {
                if (code !== 0) {
                    finish(new errors.InternalError({message: format(
                        'zfs receive error while importing: '
                        + 'exit code %s', code)}));
                } else {
                    finish();
                }
            });

            (uncompressor || zfsRecv).on('close', function () {
                self.log.trace('image file receive pipeline closed');
                finish();
            });

            if (uncompressor) {
                uncompressor.stdout.pipe(zfsRecv.stdin);
                stream.pipe(uncompressor.stdin);
            } else {
                stream.pipe(zfsRecv.stdin);
            }
        },

        /**
         * As a rule, we want all installed images on SmartOS to have their
         * single base snapshot (from which VMs are cloned) called "@final".
         * `vmadm` presumes this (tho allows for it not to be there for
         * bwcompat). This "@final" snapshot is also necessary for
         * `imgadm create -i` (i.e. incremental images).
         *
         * Here we ensure that the snapshot for this image is called "@final",
         * renaming it if necessary.
         */
        function ensureFinalSnapshot(_, next) {
            var properties = ['name', 'children'];
            getZfsDataset(ctx.partialDsName, properties, function (zErr, ds) {
                if (zErr) {
                    next(zErr);
                    return;
                }
                var snapshots = ds.children.snapshots;
                var snapnames = snapshots.map(
                    function (n) { return '@' + n.split(/@/g).slice(-1)[0]; });
                if (snapshots.length !== 1) {
                    next(new errors.UnexpectedNumberOfSnapshotsError(
                        uuid, snapnames));
                } else if (snapnames[0] !== '@final') {
                    var curr = snapshots[0];
                    var finalSnap = curr.split(/@/)[0] + '@final';
                    zfsRenameSnapshot(curr, finalSnap,
                        {recursive: true, log: log}, next);
                } else {
                    next();
                }
            });
        },

        /**
         * We recv'd the dataset to a "...-partial" temporary name.
         * Rename it to the final name.
         */
        function renameToFinalDsName(_, next) {
            var cmd = format('/usr/sbin/zfs rename %s %s',
                ctx.partialDsName, ctx.dsName);
            log.trace({cmd: cmd}, 'rename tmp image');
            exec(cmd, function (err, stdout, stderr) {
                if (err) {
                    log.error({cmd: cmd, err: err, stdout: stdout,
                        stderr: stderr, partialDsName: ctx.partialDsName,
                        dsName: ctx.dsName}, 'error renaming imported image');
                    next(new errors.InternalError(
                        {message: 'error importing'}));
                } else {
                    next();
                }
            });
        }

    ]}, function finishUp(err) {
        vasync.pipeline({funcs: [
            function stopProgressBar(_, next) {
                if (ctx.bar) {
                    ctx.bar.end();
                }
                next();
            },
            function rollbackPartialDsIfNecessary(_, next) {
                if (err && ctx.partialDsName) {
                    // Rollback the currently installed dataset, if necessary.
                    // Silently fail here (i.e. only log at trace level) because
                    // it is possible we errored out before the -partial
                    // dataset was created.
                    var cmd = format('/usr/sbin/zfs destroy -r %s',
                        ctx.partialDsName);
                    exec(cmd, function (rollbackErr, stdout, stderr) {
                        if (rollbackErr) {
                            log.trace({cmd: cmd, err: rollbackErr,
                                stdout: stdout,
                                stderr: stderr,
                                rollbackDsName: ctx.partialDsName},
                                'error destroying dataset while rolling back');
                        }
                        next();
                    });
                } else {
                    next();
                }
            }
        ]}, function done(finishUpErr) {
            // We shouldn't ever get a `finishUpErr`. Let's be loud if we do.
            if (finishUpErr) {
                log.fatal({err: finishUpErr},
                    'unexpected error finishing up image import');
            }
            cb(err || finishUpErr);
        });
    });
};


/**
 * Install a given image file and manifest to the zpool and imgadm db.
 *
 * It is the responsibility of the caller to have the import lock.
 */
IMGADM.prototype._installSingleImage = function _installSingleImage(ctx, cb) {
    var self = this;
    assert.object(ctx, 'ctx');
    assert.optionalObject(ctx.source, 'ctx.source');
    assert.string(ctx.filePath, 'ctx.filePath');
    assert.string(ctx.dsName, 'ctx.dsName');
    assert.string(ctx.zpool, 'ctx.zpool');
    assert.object(ctx.imgMeta.manifest, 'ctx.imgMeta.manifest');
    assert.optionalBool(ctx.zstream, 'ctx.zstream');
    assert.optionalBool(ctx.quiet, 'ctx.quiet');
    assert.func(ctx.logCb, 'ctx.logCb');
    assert.func(cb, 'cb');

    var manifest = ctx.imgMeta.manifest;
    var zstream = Boolean(ctx.zstream);

    vasync.pipeline({funcs: [

        /**
         * Install the manifest *before the file*, because it is the presense
         * of the file in the zpool that decides if there is actually an
         * image. Therefore if we, for whatever reason, install the file in
         * the zpool but do *not install the manifest in imgadm's db*, then
         * we get a broken image. Further, for an image from a *docker* source
         * we cannot `imgadm update` it to recover.
         */
        function saveManifestToDb(_, next) {
            // Note that we have a DS to remove if the rest of the import fails.
            ctx.installedDs = true;

            var dbImageInfo = {
                zpool: ctx.zpool,
                manifest: manifest,
                source: ctx.source
            };
            self.dbAddImage(dbImageInfo, function (addErr) {
                if (addErr) {
                    self.log.error({err: addErr, zpool: ctx.zpool,
                        manifest: manifest},
                        'error saving image to the database');
                    next(new errors.InternalError(
                        {message: 'error saving image manifest'}));
                } else {
                    next();
                }
            });
        },

        function _installTheFile(_, next) {
            if (!zstream && manifest.type === 'docker') {
                self._installDockerImage(ctx, next);
            } else {
                self._installZfsImage(ctx, next);
            }
        }

    ]}, function finishUp(err) {
        if (err && ctx.installedDs) {
            var cmd = format('/usr/sbin/zfs destroy -r %s', ctx.dsName);
            exec(cmd, function (rollbackErr, stdout, stderr) {
                if (rollbackErr) {
                    self.log.trace({cmd: cmd, err: rollbackErr,
                        stdout: stdout, stderr: stderr,
                        rollbackDsName: ctx.dsName},
                        'error destroying dataset while rolling back');
                }
                cb(err);
            });
        } else {
            cb(err);
        }
    });
};

/**
 * Update image database. I.e., attempt to gather info on installed images
 * with no cached manifest info, from current image sources.
 *
 * Limitation: Doesn't support updating from docker sources.
 *
 * Dev Note: Currently this just writes progress (updated images) with
 * `console.log`, which isn't very "library-like".
 *
 * @param opts {Object}
 *      - uuids {Array} Optional array of uuids to which to limit processing.
 *      - dryRun {Boolean} Default false. Just print changes that would be made
 *        without making them.
 * @param cb {Function} `function (err)`
 */
IMGADM.prototype.updateImages = function updateImages(opts, cb) {
    assert.object(opts, 'opts');
    assert.optionalArrayOfString(opts.uuids, 'opts.uuids');
    assert.optionalBool(opts.dryRun, 'opts.dryRun');
    assert.func(cb, 'cb');
    var self = this;
    var updateErrs = [];

    self.listImages(function (listErr, ii) {
        if (listErr) {
            cb(listErr);
            return;
        }

        var imagesInfo;
        if (opts.uuids) {
            var iiFromUuid = {};
            ii.forEach(function (i) { iiFromUuid[i.manifest.uuid] = i; });

            imagesInfo = [];
            var missing = [];
            opts.uuids.forEach(function (u) {
                if (!iiFromUuid[u]) {
                    missing.push(u);
                } else {
                    imagesInfo.push(iiFromUuid[u]);
                }
            });
            if (missing.length) {
                cb(new errors.UsageError(
                    'no installed image with the given UUID(s): '
                    + missing.join(', ')));
                return;
            }
        } else {
            imagesInfo = ii;
        }

        vasync.forEachPipeline({
            inputs: imagesInfo,
            func: updateImage
        }, function finishUpdateImages(err) {
            if (err) {
                cb(err);
            } else if (updateErrs.length === 1) {
                cb(updateErrs[0]);
            } else if (updateErrs.length > 1) {
                cb(new errors.MultiError(updateErrs));
            } else {
                cb();
            }
        });
    });

    function updateImage(ii, cb2) {
        assert.object(ii.manifest, 'ii.manifest');
        assert.string(ii.zpool, 'ii.zpool');

        var uuid = ii.manifest.uuid;
        var sii; // source importInfo
        var snapshots;
        vasync.pipeline({funcs: [
            function getSource(_, next) {
                var getOpts = {
                    arg: uuid,
                    ensureActive: false
                };
                self.sourcesGetImportInfo(getOpts, function (err, importInfo) {
                    if (err) {
                        next(err);
                        return;
                    }
                    sii = importInfo;
                    // Limitation: don't support docker sources, skip warnings
                    // on them.
                    if (!sii && ii.manifest.type !== 'docker') {
                        console.log('warning: Could not find image %s in '
                            + 'image sources (skipping)', uuid);
                    }
                    next();
                });
            },
            function getSnapshots(_, next) {
                if (!sii) {
                    next();
                    return;
                }
                var properties = ['name', 'children'];
                var fsName = format('%s/%s', ii.zpool, uuid);
                getZfsDataset(fsName, properties, function (zErr, ds) {
                    if (zErr) {
                        next(zErr);
                        return;
                    }
                    snapshots = ds.children.snapshots;
                    next();
                });
            },
            function updateManifest(_, next) {
                if (!sii) {
                    next();
                    return;
                }
                sii.zpool = ii.zpool;
                var msg;
                if (!ii.manifest.name) {
                    // Didn't have any manifest details.
                    msg = format('Added manifest info for image %s from "%s"',
                        uuid, sii.source.url);
                } else {
                    var sm = sii.manifest;
                    var m = ii.manifest;
                    if (JSON.stringify(sm) === JSON.stringify(m)) {
                        // No manifest changes.
                        next();
                        return;
                    }
                    var diffs = common.diffManifestFields(m, sm);
                    // If 'diffs' is empty here, then the early out above just
                    // had order differences.
                    if (diffs.length === 0) {
                        next();
                        return;
                    }
                    msg = format('Updated %d manifest field%s for image '
                        + '%s from "%s": %s', diffs.length,
                        (diffs.length === 1 ? '' : 's'), uuid, sii.source.url,
                        diffs.join(', '));
                }
                if (opts.dryRun) {
                    console.log(msg);
                    next();
                    return;
                }
                self.dbAddImage(sii, function (dbAddErr) {
                    if (dbAddErr) {
                        next(dbAddErr);
                        return;
                    }
                    console.log(msg);
                    next();
                });
            },
            function ensureFinalSnapshot(_, next) {
                if (!sii) {
                    next();
                    return;
                }
                var finalSnapshot = format('%s/%s@final', ii.zpool, uuid);
                if (snapshots.indexOf(finalSnapshot) !== -1) {
                    next();
                    return;
                }

                /**
                 * We don't have a '@final' snapshot for this image.
                 * - If there aren't *any* snapshots, then fail because the
                 *   original has been deleted. For 'vmadm send/receive' to
                 *   ever work the base snapshot for VMs must be the same
                 *   original.
                 * - If the source manifest info doesn't have a
                 *   "files.0.dataset_guid" then skip (we can't check).
                 * - If there are any, find the one that is the original
                 *   (by machine dataset_guid to the zfs 'guid' property).
                 */
                if (snapshots.length === 0) {
                    next(new errors.ImageMissingOriginalSnapshotError(uuid));
                    return;
                }

                var expectedGuid = sii.manifest.files[0].dataset_guid;
                if (!expectedGuid) {
                    console.warn('imgadm: warn: cannot determine original '
                        + 'snapshot for image "%s" (source info has no '
                        + '"dataset_guid")', uuid);
                    next();
                    return;
                }

                var found = null;
                var i = 0;
                async.until(
                    function testDone() {
                        return found || i >= snapshots.length;
                    },
                    function checkOneSnapshot(nextSnapshot) {
                        var snapshot = snapshots[i];
                        i++;
                        var props = ['name', 'guid'];
                        getZfsDataset(snapshot, props, function (zErr, ds) {
                            if (zErr) {
                                nextSnapshot(zErr);
                                return;
                            }
                            if (ds.guid === expectedGuid) {
                                found = snapshot;
                            }
                            nextSnapshot();
                        });
                    },
                    function doneSnapshots(sErr) {
                        if (sErr) {
                            next(sErr);
                        } else if (!found) {
                            next(new errors.ImageMissingOriginalSnapshotError(
                                uuid, expectedGuid));
                        } else {
                            // Rename this snapshot to '@final'.
                            zfsRenameSnapshot(
                                found,
                                finalSnapshot,
                                {recursive: true, log: self.log},
                                function (rErr) {
                                    if (rErr) {
                                        next(rErr);
                                        return;
                                    }
                                    console.log('Renamed image %s original '
                                        + 'snapshot from %s to %s', uuid,
                                        found, finalSnapshot);
                                    next();
                                }
                            );
                        }
                    }
                );
            }
        ]}, cb2);
    }
};


/**
 * Remove unused images.
 *
 * @param opts {Object}
 *      - dryRun {Boolean} Default false. Just print changes that would be made
 *        without making them.
 *      - @param logCb {Function} A function that is called
 *        with progress messages. Should have the same signature as
 *        `console.log`.
 *      - @param force {Boolean} Optional. Default false. If true, skips
 *        confirmation.
 * @param cb {Function} `function (err, vacuumedImages)`
 */
IMGADM.prototype.vacuumImages = function vacuumImages(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.optionalBool(opts.dryRun, 'opts.dryRun');
    assert.optionalBool(opts.force, 'opts.force');
    assert.func(opts.logCb, 'opts.logCb');
    assert.func(cb, 'cb');

    var context = {
        vacuumImages: []
    };
    vasync.pipeline({arg: context, funcs: [
        function listAllImages(ctx, next) {
            self.listImages(function (err, imagesInfo) {
                ctx.imagesInfo = imagesInfo;
                next(err);
            });
        },

        function findThem(ctx, next) {
            // First pass, setup structures.
            var i, j, ds;
            var clonesFromDs = {};  // dataset -> clone -> true
            for (i = 0; i < ctx.imagesInfo.length; i++) {
                var ii = ctx.imagesInfo[i];
                ds = ii.zpool + '/' + ii.manifest.uuid;
                clonesFromDs[ds] = {};
                for (j = 0; j < ii.cloneNames.length; j++) {
                    clonesFromDs[ds][ii.cloneNames[j]] = true;
                }
            }

            // Figure out which we can delete.
            var allToDel = [];
            while (true) {
                var toDel = [];
                var remainingDatasets = Object.keys(clonesFromDs);
                for (i = 0; i < remainingDatasets.length; i++) {
                    ds = remainingDatasets[i];
                    var clones = clonesFromDs[ds];
                    if (Object.keys(clones).length === 0) {
                        toDel.push(ds);
                    }
                }
                if (toDel.length === 0) {
                    break;
                }
                for (i = 0; i < toDel.length; i++) {
                    var clone = toDel[i];
                    for (j = 0; j < remainingDatasets.length; j++) {
                        delete clonesFromDs[remainingDatasets[j]][clone];
                    }
                }
                for (i = 0; i < toDel.length; i++) {
                    delete clonesFromDs[toDel[i]];
                }
                allToDel = allToDel.concat(toDel);
            }
            self.log.trace({allToDel: allToDel}, 'vacuumImages.findThem');

            var iiFromDs = {};
            ctx.imagesInfo.forEach(function (ii_) {
                iiFromDs[ii_.zpool + '/' + ii_.manifest.uuid] = ii_;
            });
            ctx.iiToDel = allToDel.map(
                function (ds_) { return iiFromDs[ds_]; });

            next();
        },

        function confirm(ctx, next) {
            if (opts.force || ctx.iiToDel.length === 0) {
                next();
                return;
            }

            var summaries = ctx.iiToDel.map(function (ii) {
                return format('%s (%s@%s)', ii.manifest.uuid, ii.manifest.name,
                    ii.manifest.version);
            });
            opts.logCb('This will delete the following images:\n    '
                + summaries.join('\n    '));

            var msg;
            if (ctx.iiToDel.length === 1) {
                msg = 'Delete this image? [y/N] ';
            } else {
                msg = format('Delete these %d images? [y/N] ',
                    ctx.iiToDel.length);
            }
            common.promptYesNo({msg: msg, default: 'n'}, function (answer) {
                if (answer !== 'y') {
                    opts.logCb('Aborting');
                    next(true);
                    return;
                }
                opts.logCb('');
                next();
            });
        },

        function deleteThem(ctx, next) {
            vasync.forEachPipeline({
                inputs: ctx.iiToDel,
                func: function delImage(ii, nextIi) {
                    var uuid = ii.manifest.uuid;
                    if (opts.dryRun) {
                        opts.logCb('[dry-run] Deleted image %s (%s@%s)',
                            uuid, ii.manifest.name, ii.manifest.version);
                        nextIi();
                        return;
                    }

                    self.deleteImage({
                        zpool: ii.zpool,
                        uuid: uuid,
                        skipChecks: true
                    }, function (err) {
                        if (err) {
                            opts.logCb('Error deleting image %s (%s@%s): %s',
                                uuid, ii.manifest.name, ii.manifest.version,
                                err);
                            nextIi(err);
                        } else {
                            opts.logCb('Deleted image %s (%s@%s)',
                                uuid, ii.manifest.name, ii.manifest.version);
                            nextIi();
                        }
                    });
                }
            }, next);
        }
    ]}, cb);
};


/**
 * Create an image from the given VM and manifest data. There are two basic
 * calling modes here:
 * 1. A `options.prepareScript` is provided to be used to prepare the VM
 *    before image creation. The running of the prepare script is gated by
 *    a snapshot and rollback so that the end result is a VM that is unchanged.
 *    This is desireable because (a) it is easier (fewer steps to follow
 *    for imaging) and (b) the typical preparation script is destructive, so
 *    gating with snapshotting makes the original VM re-usable. Note that
 *    the snapshotting and preparation involve reboots of the VM (typically
 *    two reboots).
 *    Dev Note: This mode with prepareScript is called "autoprep" in vars
 *    below.
 * 2. The VM is already prepared (via the typical prepare-image scripts,
 *    see <https://download.joyent.com/pub/prepare-image/>) and shutdown.
 *    For this "mode" do NOT pass in `options.prepareScript`.
 *
 * @param options {Object}
 *      - @param vmUuid {String} UUID of the VM from which to create the image.
 *      - @param manifest {Object} Data to include in the created manifest.
 *      - @param logCb {Function} Optional. A function that is called
 *        with progress messages. Called as `logCb(<string>)`. E.g. passing
 *        console.log is legal.
 *      - @param compression {String} Optional compression type for the image
 *        file. Default is 'none'.
 *      - @param savePrefix {String} Optional. The file path prefix to which
 *        to save the manifest and image files.
 *      - @param incremental {Boolean} Optional. Default false. Create an
 *        incremental image.
 *      - @param prepareScript {String} Optional. A script to run to prepare
 *        the VM for image. See note above.
 *      - @param prepareTimeout {Number} Optional. Default is 300 (5 minutes).
 *        The number of seconds before timing out any prepare *stage*. The
 *        preparation stages are (starting from the VM being shutdown):
 *        prepare-image running, prepare-image complete, VM stopped.
 * @param callback {Function} `function (err, imageInfo)` where imageInfo
 *      has `manifest` (the manifest object), `manifestPath` (the saved
 *      manifest path) and `filePath` (the saved image file path) keys.
 */
IMGADM.prototype.createImage = function createImage(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.vmUuid, 'options.vmUuid');
    assert.object(options.manifest, 'options.manifest');
    assert.optionalFunc(options.logCb, 'options.logCb');
    assert.optionalString(options.compression, 'options.compression');
    assert.optionalBool(options.incremental, 'options.incremental');
    assert.optionalString(options.prepareScript, 'options.prepareScript');
    assert.optionalNumber(options.prepareTimeout, 'options.prepareTimeout');
    assert.optionalNumber(options.maxOriginDepth, 'options.maxOriginDepth');
    var log = self.log;
    var vmUuid = options.vmUuid;
    var incremental = options.incremental || false;
    var logCb = options.logCb || function () {};
    var prepareScript = options.prepareScript;
    var prepareTimeout = options.prepareTimeout || 300;  // in seconds
    var maxOriginDepth = options.maxOriginDepth;

    var vmInfo;
    var sysinfo;
    var vmZfsFilesystemName;
    var vmZfsSnapnames;
    var originInfo;
    var originFinalSnap;
    var imageInfo = {};
    var finalSnapshot;
    var toCleanup = {};
    async.waterfall([
        function validateVm(next) {
            common.vmGet(vmUuid, {log: log}, function (err, vm) {
                // Currently `vmGet` doesn't distinguish bwtn some unexpected
                // error and no such VM.
                if (err) {
                    next(new errors.VmNotFoundError(vmUuid));
                    return;
                }
                if (!prepareScript && vm.state !== 'stopped') {
                    next(new errors.VmNotStoppedError(vmUuid));
                    return;
                }
                vmInfo = vm;
                next();
            });
        },
        function getVmInfo(next) {
            var opts;
            if (vmInfo.brand === 'kvm') {
                if (vmInfo.disks && vmInfo.disks[0]) {
                    var disk = vmInfo.disks[0];
                    vmZfsFilesystemName = disk.zfs_filesystem;

                    if (disk.image_uuid) {
                        opts = {uuid: disk.image_uuid, zpool: disk.zpool};
                    }
                }
            } else {
                opts = {uuid: vmInfo.image_uuid, zpool: vmInfo.zpool};
                vmZfsFilesystemName = vmInfo.zfs_filesystem;
            }
            if (!opts) {
                // Couldn't find an origin image.
                log.debug('no origin image found');
                next();
                return;
            }
            self.getImage(opts, function (getErr, ii) {
                if (getErr) {
                    next(getErr);
                    return;
                }
                log.debug({imageInfo: ii}, 'origin image');
                originInfo = ii;
                next();
            });
        },
        function validateMaxOriginDepth(next) {
            // If there is no origin, no depth was passed or origin doesn't
            // have an origin itself
            if (!originInfo || !maxOriginDepth || !originInfo.manifest.origin) {
                next();
                return;
            }
            var currentDepth = 1;
            // One origin is already one level deep
            var currentOrigin = originInfo;
            var foundFirstOrigin = false;

            // Recursively call getImage until we find the source origin
            async.whilst(
                function () {
                    return currentDepth <= maxOriginDepth && !foundFirstOrigin;
                },
                function (cb) {
                    if (!currentOrigin.manifest.origin) {
                        foundFirstOrigin = true;
                        cb();
                        return;
                    }
                    var getOpts = {
                        uuid: currentOrigin.manifest.origin,
                        zpool: currentOrigin.zpool
                    };
                    self.getImage(getOpts, function (getErr, origImg) {
                        if (getErr) {
                            cb(getErr);
                            return;
                        }
                        currentDepth++;
                        currentOrigin = origImg;
                        cb();
                    });
                },
                function (err) {
                    if (err) {
                        next(err);
                        return;
                    }
                    // If we exited the loop because we hit maxOriginDepth
                    if (currentDepth > maxOriginDepth) {
                        next(new errors.MaxOriginDepthError(maxOriginDepth));
                        return;
                    } else {
                        next();
                        return;
                    }
                }
            );
        },
        function getSystemInfo(next) {
            if (vmInfo.brand === 'kvm') {
                next();
                return;
            }
            // We need `sysinfo` for smartos images. See below.
            getSysinfo(function (err, sysinfo_) {
                sysinfo = sysinfo_;
                next(err);
            });
        },
        function gatherManifest(next) {
            var m = {
                v: common.MANIFEST_V,
                uuid: genUuid()
            };
            m = imageInfo.manifest = objCopy(options.manifest, m);
            if (originInfo) {
                var originManifest = originInfo.manifest;
                logCb(format('Inheriting from origin image %s (%s %s)',
                    originManifest.uuid, originManifest.name,
                    originManifest.version));
                // IMGAPI-227 TODO: document these and note them in the
                // imgapi docs. These should come from imgmanifest constant.
                var INHERITED_FIELDS = ['type', 'os', 'requirements',
                    'users', 'billing_tags', 'traits', 'generate_passwords',
                    'inherited_directories', 'nic_driver', 'disk_driver',
                    'cpu_type', 'image_size'];
                // TODO Should this *merge* requirements?
                INHERITED_FIELDS.forEach(function (field) {
                    if (!m.hasOwnProperty(field)
                        && originManifest.hasOwnProperty(field))
                    {
                        var val = originManifest[field];
                        // Drop empty arrays, e.g. `billing_tags`, just to
                        // be leaner/cleaner.
                        if (!Array.isArray(val) || val.length > 0) {
                            m[field] = val;
                        }
                    }
                });
            }
            if (vmInfo.brand !== 'kvm' /* i.e. this is a smartos image */
                && !(options.manifest.requirements
                    && options.manifest.requirements.min_platform))
            {
                // Unless an explicit min_platform is provided (possibly empty)
                // the min_platform for a SmartOS image must be the current
                // platform, b/c that's the SmartOS binary compat story.
                if (!m.requirements)
                    m.requirements = {};
                m.requirements.min_platform = {};
                m.requirements.min_platform[sysinfo['SDC Version']]
                    = sysinfo['Live Image'];
                log.debug({min_platform: m.requirements.min_platform},
                    'set smartos image min_platform to current');
            }
            if (incremental) {
                if (!originInfo) {
                    next(new errors.VmHasNoOriginError(vmUuid));
                    return;
                } else {
                    m.origin = originInfo.manifest.uuid;
                }
            }
            logCb(format('Manifest:\n%s',
                indent(JSON.stringify(m, null, 2))));
            next();
        },
        function validateManifest(next) {
            var errs = imgmanifest.validateMinimalManifest(imageInfo.manifest);
            if (errs) {
                next(new errors.ManifestValidationError(errs));
            } else {
                next();
            }
        },
        function ensureOriginFinalSnapshot(next) {
            if (!incremental) {
                next();
                return;
            }
            originFinalSnap = format('%s/%s@final', originInfo.zpool,
                imageInfo.manifest.origin);
            getZfsDataset(originFinalSnap, function (err, ds) {
                if (err) {
                    next(err);
                } else if (!ds) {
                    next(new errors.OriginHasNoFinalSnapshotError(
                        imageInfo.manifest.origin));
                } else {
                    next();
                }
            });
        },

        function getVmZfsDataset(next) {
            // Get snapshot/children dataset details on the ZFS filesystem with
            // which we are going to be mucking.
            var properties = ['name', 'children'];
            getZfsDataset(vmZfsFilesystemName, properties, function (zErr, ds) {
                if (zErr) {
                    next(zErr);
                    return;
                }
                var snapshots = ds.children.snapshots;
                vmZfsSnapnames = snapshots.map(
                    function (n) { return '@' + n.split(/@/g).slice(-1)[0]; });
                next();
            });
        },

        // If `prepareScript` was given, here is where we need to:
        // - snapshot the VM
        // - prepare the VM
        function autoprepStopVmIfNecessary(next) {
            if (!prepareScript) {
                next();
            } else if (vmInfo.state !== 'stopped') {
                logCb(format('Stopping VM %s to snapshot it', vmUuid));
                toCleanup.autoprepStartVm = vmUuid; // Re-start it when done.
                common.vmStop(vmUuid, {log: log}, next);
            } else {
                next();
            }
        },
        function autoprepSnapshotDatasets(next) {
            if (!prepareScript) {
                next();
                return;
            }

            var toSnapshot = [vmInfo.zfs_filesystem];
            if (vmInfo.brand === 'kvm' && vmInfo.disks) {
                for (var i = 0; i < vmInfo.disks.length; i++) {
                    toSnapshot.push(vmInfo.disks[i].zfs_filesystem);
                }
            }

            var snapname = '@imgadm-create-pre-prepare';
            logCb(format('Snapshotting VM "%s" to %s', vmUuid, snapname));
            toCleanup.autoprepSnapshots = [];
            async.eachSeries(
                toSnapshot,
                function snapshotOne(ds, nextSnapshot) {
                    var snap = ds + snapname;
                    zfs.snapshot(snap, function (zfsErr) {
                        if (zfsErr) {
                            nextSnapshot(new errors.InternalError({
                                message: 'error creating snapshot',
                                snap: snap,
                                cause: zfsErr
                            }));
                            return;
                        }
                        toCleanup.autoprepSnapshots.push(snap);
                        nextSnapshot();
                    });
                },
                next);
        },
        function autoprepSetOperatorScript(next) {
            if (!prepareScript) {
                next();
                return;
            }
            var update = {
                set_internal_metadata: {
                    'operator-script': prepareScript
                }
            };
            log.debug('set operator-script');
            common.vmUpdate(vmUuid, update, {log: log}, next);
        },
        /**
         * "Prepare" the VM by booting it, which should run the
         * operator-script to prepare and shutdown. We track progress via
         * the 'prepare-image:state' and 'prepare-image:error' keys on
         * customer_metadata. See the "PREPARE IMAGE SCRIPT" section in the
         * man page for the contract.
         */
        function autoprepClearMdata(next) {
            if (!prepareScript) {
                next();
                return;
            }
            var update = {
                remove_customer_metadata: [
                    'prepare-image:state',
                    'prepare-image:error'
                ]
            };
            log.debug('create prepare-image:* customer_metadata');
            common.vmUpdate(vmUuid, update, {log: log}, next);
        },
        function autoprepBoot(next) {
            if (!prepareScript) {
                next();
                return;
            }
            logCb(format('Preparing VM %s (starting it)', vmUuid));
            common.vmStart(vmUuid, {log: log}, next);
        },
        function autoprepWaitForRunning(next) {
            if (!prepareScript) {
                next();
                return;
            }
            var opts = {
                log: log,
                key: 'prepare-image:state',
                // Don't explicitly check for value=running here because it is
                // fine if it blows by to 'success' between our polling.
                timeout: prepareTimeout * 1000,
                interval: 2000
            };
            log.debug('wait for up to %ds for prepare-image:state signal '
                + 'from operator-script', prepareTimeout);
            common.vmWaitForCustomerMetadatum(vmUuid, opts, function (err, vm) {
                if (err) {
                    if (err.code === 'Timeout') {
                        /**
                         * This could mean any of:
                         * - the VM has old guest tools that either don't run
                         *   an 'sdc:operator-script' or don't have a working
                         *   'mdata-put'
                         * - the VM boot + time to get to prepare-image script
                         *   setting 'prepare-image:state' mdata takes >5
                         *   minutes
                         * - the prepare-image script has a bug in that it does
                         *   not set the 'prepare-image:state' mdata key to
                         *   'running'
                         * - the prepare-image script crashed early
                         */
                        logCb('Timeout waiting for prepare-image script to '
                            + 'signal it started');
                        log.debug('timeout waiting for operator-script to '
                            + 'set prepare-image:state');
                        next(new errors.PrepareImageDidNotRunError(vmUuid));
                    } else {
                        log.debug(err, 'unexpected error waiting for '
                            + 'operator-script to set prepare-image:state');
                        next(err);
                    }
                    return;
                }
                logCb('Prepare script is running');
                vmInfo = vm;
                next();
            });
        },
        function autoprepWaitForComplete(next) {
            if (!prepareScript) {
                next();
                return;
            }
            var opts = {
                log: log,
                key: 'prepare-image:state',
                values: ['success', 'error'],
                timeout: prepareTimeout * 1000
            };
            log.debug('wait for up to %ds for prepare-image:state of "error" '
                + 'or "success"', prepareTimeout);
            common.vmWaitForCustomerMetadatum(vmUuid, opts, function (err, vm) {
                if (err) {
                    next(new errors.PrepareImageError(err, vmUuid,
                        'prepare-image script did not complete'));
                    return;
                }
                vmInfo = vm;
                var cm = vm.customer_metadata;
                log.debug({
                    'prepare-image:state': cm['prepare-image:state'],
                    'prepare-image:error': cm['prepare-image:error'],
                    'prepare-image:progress': cm['prepare-image:progress']
                }, 'prepare-image:state is set');
                if (cm['prepare-image:state'] === 'error') {
                    next(new errors.PrepareImageError(vmUuid,
                        cm['prepare-image:error'] || ''));
                } else {
                    logCb('Prepare script succeeded');
                    next();
                }
            });
        },
        function autoprepWaitForVmStopped(next) {
            if (!prepareScript) {
                next();
                return;
            }
            var opts = {
                state: 'stopped',
                timeout: prepareTimeout * 1000,
                log: log
            };
            log.debug('wait for up to %ds for VM to stop', prepareTimeout);
            common.vmWaitForState(vmUuid, opts, function (err, vm) {
                if (err) {
                    next(new errors.PrepareImageError(err, vmUuid,
                        'VM did not shutdown'));
                    return;
                }
                var cm = vm.customer_metadata;
                log.debug({
                    'prepare-image:state': cm['prepare-image:state'],
                    'prepare-image:error': cm['prepare-image:error'],
                    'prepare-image:progress': cm['prepare-image:progress']
                }, 'prepare-image stopped VM');
                logCb('Prepare script stopped VM ' + vmUuid);
                next();
            });
        },

        function renameFinalSnapshotOutOfTheWay(next) {
            // We use a snapshot named '@final'. If there is an existing one,
            // rename it to '@final-$timestamp'.
            if (vmZfsSnapnames.indexOf('@final') == -1) {
                next();
                return;
            }
            var curr = vmZfsFilesystemName + '@final';
            var outofway = curr + '-' + Date.now();
            logCb(format('Moving existing @final snapshot out of the '
                + 'way to "%s"', outofway));
            zfsRenameSnapshot(curr, outofway,
                {recursive: true, log: log}, next);
        },
        function snapshotVm(next) {
            // We want '@final' to be the snapshot in the created image -- see
            // the notes in _installImage.
            finalSnapshot = format('%s@final', vmZfsFilesystemName);
            logCb(format('Snapshotting to "%s"', finalSnapshot));
            zfs.snapshot(finalSnapshot, function (zfsErr) {
                if (zfsErr) {
                    next(new errors.InternalError({
                        message: 'error creating final snapshot',
                        finalSnapshot: finalSnapshot,
                        cause: zfsErr
                    }));
                    return;
                }
                toCleanup.finalSnapshot = finalSnapshot;
                next();
            });
        },
        function sendImageFile(next) {
            // 'zfs send' the image snapshot to a local file. We *could*
            // stream directly to an optional IMGAPI target, but that makes
            // it more difficult to do (a) sha1 pre-caculation for upload
            // checking and (b) eventual re-upload support.

            // To complete this stage we want to wait for all of:
            // 1. the 'zfs send' process to 'exit'.
            // 2. the compressor process to 'exit' (if we are compressing)
            // 3. the pipeline's std handles to 'close'
            //
            // If we get an error we "finish" right away. This `finish` stuff
            // coordinates that.
            var numToFinish = 2;  // 1 is added below if compressing.
            var numFinishes = 0;
            var finished = false;
            function finish(err) {
                numFinishes++;
                if (finished) {
                    /* jsl:pass */
                } else if (err) {
                    finished = true;
                    log.trace({err: err}, 'sendImageFile err');
                    next(err);
                } else if (numFinishes >= numToFinish) {
                    finished = true;
                    next();
                }
            }

            imageInfo.filePath = options.savePrefix;
            if (imageInfo.manifest.type === 'zvol') {
                imageInfo.filePath += '.zvol';
            } else {
                imageInfo.filePath += '.zfs';
            }
            logCb(format('Sending image file to "%s"', imageInfo.filePath));

            // Compression
            var compression = options.compression || 'none';
            var compressor;
            if (compression === 'none') {
                /* pass through */
                compressor = null;
            } else if (compression === 'bzip2') {
                compressor = spawn('/usr/bin/bzip2', ['-cfq']);
                imageInfo.filePath += '.bz2';
                numToFinish++;
            } else if (compression === 'gzip') {
                compressor = spawn('/usr/bin/gzip', ['-cfq']);
                imageInfo.filePath += '.gz';
                numToFinish++;
            } else if (compression === 'xz') {
                compressor = spawn('/usr/bin/xz', ['-cfq']);
                imageInfo.filePath += '.xz';
                numToFinish++;
            } else {
                finish(new errors.UsageError(format(
                    'unknown compression "%s"', compression)));
                return;
            }
            if (compressor) {
                toCleanup.compressor = compressor;
                var compStderrChunks = [];
                compressor.stderr.on('data', function (chunk) {
                    compStderrChunks.push(chunk);
                });
                compressor.on('exit', function (code) {
                    delete toCleanup.compressor;
                    if (code !== 0) {
                        toCleanup.filePath = imageInfo.filePath;
                        var msg = format(
                            'error compressing zfs stream: exit code %s\n'
                            + '    compression: %s\n'
                            + '    stderr:\n%s', code, compression,
                            indent(compStderrChunks.join(''), '        '));
                        log.debug(msg);
                        finish(new errors.InternalError({message: msg}));
                    } else {
                        log.trace({compression: compression},
                            'compressor exited successfully');
                        finish();
                    }
                });
            }

            // Don't want '-p' or '-r' options to 'zfs send'.
            var zfsArgs = ['send'];
            if (incremental) {
                zfsArgs.push('-i');
                zfsArgs.push(originFinalSnap);
            }
            zfsArgs.push(finalSnapshot);
            self.log.debug({cmd: ['/usr/sbin/zfs'].concat(zfsArgs)},
                'spawn zfs send');
            var zfsSend = spawn('/usr/sbin/zfs', zfsArgs);
            var zfsStderrChunks = [];
            zfsSend.stderr.on('data', function (chunk) {
                zfsStderrChunks.push(chunk);
            });
            toCleanup.zfsSend = zfsSend;
            zfsSend.on('exit', function (code) {
                delete toCleanup.zfsSend;
                if (code !== 0) {
                    toCleanup.filePath = imageInfo.filePath;
                    var msg = format('zfs send error: exit code %s\n'
                        + '    cmd: /usr/sbin/zfs %s\n'
                        + '    stderr:\n%s', code,
                        zfsArgs.join(' '),
                        indent(zfsStderrChunks.join(''), '        '));
                    self.log.debug(msg);
                    finish(new errors.InternalError({message: msg}));
                } else {
                    self.log.trace({zfsArgs: zfsArgs},
                        'zfs send exited successfully');
                    finish();
                }
            });

            var size = 0;
            var sha1Hash = crypto.createHash('sha1');
            (compressor || zfsSend).stdout.on('data', function (chunk) {
                size += chunk.length;
                try {
                    sha1Hash.update(chunk);
                } catch (e) {
                    self.log.debug({err: e}, 'hash update error');
                    finish(new errors.InternalError({
                        cause: e,
                        message: format(
                            'hash error calculating image file sha1: %s', e)
                    }));
                }
            });
            (compressor || zfsSend).on('close', function () {
                imageInfo.manifest.files = [ {
                    size: size,
                    compression: compression,
                    sha1: sha1Hash.digest('hex')
                } ];

                // This is our successful exit point from this step.
                self.log.trace('image file send pipeline closed successfully');
                finish();
            });

            var out = fs.createWriteStream(imageInfo.filePath);
            if (compressor) {
                // zfs send -> bzip2/gzip -> filePath
                zfsSend.stdout.pipe(compressor.stdin);
                compressor.stdout.pipe(out);
            } else {
                // zfs send -> filePath
                zfsSend.stdout.pipe(out);
            }
        },
        function saveManifest(next) {
            var manifestPath = imageInfo.manifestPath
                = options.savePrefix + '.imgmanifest';
            logCb(format('Saving manifest to "%s"', manifestPath));
            var manifestStr = JSON.stringify(imageInfo.manifest, null, 2);
            fs.writeFile(manifestPath, manifestStr, 'utf8', function (wErr) {
                if (wErr) {
                    next(new errors.FileSystemError(wErr, format(
                        'error saving manifest to "%s": %s', manifestPath,
                        wErr)));
                    return;
                }
                next();
            });
        }
    ], function (err) {
        async.series([
            function cleanupZfsSend(next) {
                if (!toCleanup.zfsSend) {
                    next();
                    return;
                }
                self.log.debug('killing zfsSend process');
                toCleanup.zfsSend.on('exit', function () {
                    self.log.debug('zfsSend process exited');
                    next();
                });
                toCleanup.zfsSend.kill('SIGKILL');
            },
            function cleanupCompressor(next) {
                if (!toCleanup.compressor) {
                    next();
                    return;
                }
                self.log.debug('killing compressor process');
                toCleanup.compressor.on('exit', function () {
                    self.log.debug('compressor process exited');
                    next();
                });
                toCleanup.compressor.kill('SIGKILL');
            },
            function cleanupImageFile(next) {
                if (!toCleanup.filePath) {
                    next();
                    return;
                }
                self.log.debug('remove incomplete image file "%s"',
                    toCleanup.filePath);
                rimraf(toCleanup.filePath, next);
            },
            function cleanupFinalSnapshot(next) {
                if (!toCleanup.finalSnapshot) {
                    next();
                    return;
                }
                zfsDestroy(toCleanup.finalSnapshot, self.log, next);
            },
            /**
             * Restoring the VM dataset(s) to their previous state in 3 parts:
             * 1. ensure the VM is stopped (it is surprising if it isn't)
             * 2. rollback all the zfs filesystems
             * 3. destroy the snaps
             */
            function cleanupAutoprepSnapshots1(next) {
                if (!toCleanup.autoprepSnapshots) {
                    next();
                    return;
                }
                logCb(format('Rollback VM %s to pre-prepare snapshot (cleanup)',
                    vmUuid));
                var opts = {log: self.log};
                common.vmHaltIfNotStopped(vmUuid, opts, next);
            },
            function cleanupAutoprepSnapshots2(next) {
                if (!toCleanup.autoprepSnapshots) {
                    next();
                    return;
                }
                async.eachSeries(
                    toCleanup.autoprepSnapshots,
                    function rollbackOne(snap, nextSnapshot) {
                        self.log.debug('zfs rollback', snap);
                        zfs.rollback(snap, nextSnapshot);
                    },
                    next);
            },
            function cleanupAutoprepSnapshots3(next) {
                if (!toCleanup.autoprepSnapshots) {
                    next();
                    return;
                }
                async.eachSeries(
                    toCleanup.autoprepSnapshots,
                    function destroyOne(snap, nextSnapshot) {
                        zfsDestroy(snap, self.log, nextSnapshot);
                    },
                    next);
            },
            function cleanupAutoprepStartVm(next) {
                if (!toCleanup.autoprepStartVm) {
                    next();
                    return;
                }
                logCb(format('Restarting VM %s (cleanup)',
                    toCleanup.autoprepStartVm));
                common.vmStart(toCleanup.autoprepStartVm,
                    {log: self.log}, next);
            }
        ], function (cleanErr) {
            var e = err || cleanErr;
            if (err && cleanErr) {
                e = new errors.MultiError([err, cleanErr]);
            }
            callback(e, imageInfo);
        });
    });
};


/**
 * Publish the given image to the given IMGAPI.
 *
 * @param options {Object}
 *      - @param manifest {Object} The manifest to import.
 *      - @param file {String} The image file path to import.
 *      - @param url {String} The IMGAPI URL to which to publish.
 *      - @param quiet {Boolean} Optional. Default false. Set to true
 *        to not have a progress bar for the file upload.
 * @param callback {Function} `function (err, image)`
 */
IMGADM.prototype.publishImage = function publishImage(opts, callback) {
    assert.object(opts, 'options');
    assert.object(opts.manifest, 'options.manifest');
    var manifest = opts.manifest;
    assert.string(opts.file, 'options.file');
    assert.string(opts.url, 'options.url');
    assert.optionalBool(opts.quiet, 'options.quiet');
    // At least currently we require the manifest to have the file info
    // (as it does if created by 'imgadm create').
    assert.arrayOfObject(manifest.files, 'options.manifest.files');
    var manifestFile = manifest.files[0];
    assert.object(manifestFile, 'options.manifest.files[0]');
    assert.string(manifestFile.compression,
        'options.manifestFile.files[0].compression');
    var self = this;

    var client = imgapi.createClient({
        agent: false,
        url: opts.url,
        log: self.log.child({component: 'api', url: opts.url}, true),
        rejectUnauthorized: (process.env.IMGADM_INSECURE !== '1'),
        userAgent: self.userAgent
    });
    var uuid = manifest.uuid;
    var rollbackImage;
    var activatedImage;

    async.series([
        function importIt(next) {
            client.adminImportImage(manifest, {}, function (err, image, res) {
                self.log.trace({err: err, image: image, res: res},
                    'AdminImportImage');
                if (err) {
                    next(self._errorFromClientError(opts.url, err));
                    return;
                }
                console.log('Imported image %s (%s, %s, state=%s)',
                    image.uuid, image.name, image.version, image.state);
                rollbackImage = image;
                next();
            });
        },
        function addFile(next) {
            var stream = fs.createReadStream(opts.file);
            imgapi.pauseStream(stream);

            var bar;
            if (!opts.quiet && process.stderr.isTTY) {
                bar = new ProgressBar({
                    size: manifestFile.size,
                    filename: uuid
                });
            }
            stream.on('data', function (chunk) {
                if (bar)
                    bar.advance(chunk.length);
            });
            stream.on('end', function () {
                if (bar)
                    bar.end();
            });

            var fopts = {
                uuid: uuid,
                file: stream,
                size: manifestFile.size,
                compression: manifestFile.compression,
                sha1: manifestFile.sha1
            };
            client.addImageFile(fopts, function (err, image, res) {
                self.log.trace({err: err, image: image, res: res},
                    'AddImageFile');
                if (err) {
                    if (bar)
                        bar.end();
                    next(self._errorFromClientError(opts.url, err));
                    return;
                }

                console.log('Added file "%s" (compression "%s") to image %s',
                    opts.file, manifestFile.compression, uuid);

                // Verify uploaded size and sha1.
                var expectedSha1 = manifestFile.sha1;
                if (expectedSha1 !== image.files[0].sha1) {
                    next(new errors.UploadError(format(
                        'sha1 expected to be %s, but was %s',
                        expectedSha1, image.files[0].sha1)));
                    return;
                }
                var expectedSize = manifestFile.size;
                if (expectedSize !== image.files[0].size) {
                    next(new errors.UploadError(format(
                        'size expected to be %s, but was %s',
                        expectedSize, image.files[0].size)));
                    return;
                }

                next();
            });
        },
        function activateIt(next) {
            client.activateImage(uuid, function (err, image, res) {
                self.log.trace({err: err, image: image, res: res},
                    'ActivateImage');
                if (err) {
                    next(self._errorFromClientError(opts.url, err));
                    return;
                }
                activatedImage = image;
                console.log('Activated image %s', uuid);
                next();
            });
        }
    ], function (err) {
        if (err) {
            if (rollbackImage) {
                self.log.debug({err: err, rollbackImage: rollbackImage},
                    'rollback partially imported image');
                var delUuid = rollbackImage.uuid;
                client.deleteImage(uuid, function (delErr, res) {
                    self.log.trace({err: delErr, res: res}, 'DeleteImage');
                    if (delErr) {
                        self.log.debug({err: delErr}, 'error rolling back');
                        console.log('Warning: Could not delete partially '
                            + 'published image %s: %s', delUuid, delErr);
                    }
                    callback(err);
                });
            } else {
                callback(err);
            }
        } else {
            callback(null, activatedImage);
        }
    });
};


// ---- exports

/**
 * Create an IMGADM tool.
 *
 * @params options {Object}
 *      - log {Bunyan Logger} Required.
 * @params callback {Function} `function (err)`
 */
function createTool(options, callback) {
    var tool = new IMGADM(options);
    tool.init(function (err) {
        if (err) {
            callback(err);
            return;
        }
        tool.log.trace({config: tool.config}, 'tool initialized');
        callback(null, tool);
    });
}

module.exports = {
    createTool: createTool
};
