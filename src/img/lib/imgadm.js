/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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
 *
 */

var warn = console.warn;
var path = require('path');
var fs = require('fs');
var format = require('util').format;
var assert = require('assert-plus');
var crypto = require('crypto');
var async = require('async');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var url = require('url');
var mkdirp = require('mkdirp');
var ProgressBar = require('progress');
var imgapi = require('sdc-clients/lib/imgapi');
var dsapi = require('sdc-clients/lib/dsapi');

var imgmanifest = require('imgmanifest');
var common = require('./common'),
    NAME = common.NAME,
    objCopy = common.objCopy,
    assertUuid = common.assertUuid;
var errors = require('./errors');
var upgrade = require('./upgrade');



// ---- globals

var DB_DIR = '/var/imgadm';
var CONFIG_PATH = DB_DIR + '/imgadm.conf';
var DEFAULT_CONFIG = {};

/* BEGIN JSSTYLED */
var VMADM_FS_NAME_RE = /^([a-zA-Z][a-zA-Z\._-]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-disk\d+)?$/;
var VMADM_IMG_NAME_RE = /^([a-zA-Z][a-zA-Z\._-]*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/* END JSSTYLED */



// ---- internal support stuff

function ipFromHost(host, callback) {
    if (IP_RE.test(host)) {
        callback(null, host);
        return;
    }
    // No DNS in SmartOS GZ by default, so handle DNS ourself.
    var cmd = format('/usr/sbin/dig %s +short', host);
    exec(cmd, function (error, stdout, stderr) {
        if (error) {
            callback(new errors.InternalError(
                {message: format('error DNS resolving %s: %s', host, error)}));
            return;
        }
        callback(null, stdout.trim());
    });
}


/**
 * Call `zfs destroy -r` on the given dataset name.
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
 * Get details on a ZFS dataset.
 *
 * @param name {String} The zfs dataset name, "$pool/$uuid".
 * @param properties {Array} Optional array of property names to get.
 *      "name" is always included. "children" is special: it does extra work
 *      to gather the list of child snapshots and dependent clones.
 * @param callback {Function} `function (err, dataset)`
 *      Returns `callback(null, null)` if the dataset name doesn't exist.
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
        exec(cmd, function (err, stdout, stderr) {
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
        exec(cmd, function (err, stdout, stderr) {
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
        exec(cmd, function (err, stdout, stderr) {
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


// ---- IMGADM tool

function IMGADM(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');

    this.log = options.log;
    this._manifestFromUuid = null;
    this.sources = null;
}

IMGADM.prototype.init = function init(callback) {
    var self = this;

    function loadConfig(next) {
        self.config = objCopy(DEFAULT_CONFIG);
        fs.exists(CONFIG_PATH, function (exists) {
            if (!exists) {
                next();
                return;
            }
            self.log.debug({path: CONFIG_PATH}, 'read config file');
            fs.readFile(CONFIG_PATH, 'utf8', function (err, content) {
                try {
                    var config = JSON.parse(content);
                } catch (e) {
                    next(new errors.ConfigError(e, format(
                        'config file "%s" is not valid JSON', CONFIG_PATH)));
                    return;
                }
                Object.keys(config).forEach(function (k) {
                    self.config[k] = config[k];
                });
                next();
            });
        });
    }

    function upgradeDb(next) {
        upgrade.upgradeIfNecessary(self, next);
    }

    function addSources(next) {
        self.sources = [];
        var sources = self.config.sources || common.DEFAULT_SOURCE;
        async.forEachSeries(
            sources,
            function oneSource(source, nextSource) {
                self._addSource(source, true, nextSource);
            },
            function doneSources(err) {
                if (err) {
                    next(err);
                    return;
                }
                if (self.sources.length === 0) {
                    next(new errors.NoSourcesError());
                    return;
                }
                next();
            }
        );
    }

    async.series([loadConfig, upgradeDb, addSources], callback);
};


/**
 * Add a source URL to the current IMGADM object. It normalizes and handles
 * DNS lookup as required.
 *
 * Note that this does *not* update the IMGADM config file.
 *
 * @param source {Object} Image source object with these keys:
 *      - url {String}
 *      - type {String} Optional. One of 'dsapi' or 'imgapi'. If not given
 *        it is (imperfectly) inferred from the URL.
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL.
 * @param callback {Function} `function (err, changed)` where `changed` is
 *      a boolean indicating if the config changed as a result.
 */
IMGADM.prototype._addSource = function _addSource(
        source, skipPingCheck, callback) {
    assert.object(source, 'source');
    assert.optionalString(source.type, 'source.type');
    assert.string(source.url, 'source.url');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;

    // Ping-test against the new URL
    function sourcePingCheck(s, next) {
        if (skipPingCheck) {
            next();
            return;
        }
        var client = self.clientFromSource(s);
        client.ping(function (err, pong, res) {
            if (err
                || res.statusCode !== 200
                || (s.type === 'imgapi' && !pong.imgapi))
            {
                next(new errors.SourcePingError(err, s));
                return;
            }
            next();
        });
    }


    // No-op if already have this URL.
    for (var i = 0; i < self.sources.length; i++) {
        if (self.sources[i].url === source.url)
            return callback(null, false);
    }

    // Figure out `type` if necessary.
    if (!source.type) {
        // Per the old imgadm (v1) the old source URL includes the
        // "datasets/" subpath. That's not a completely reliable marker, but
        // we'll use that.
        var isDsapiUrl = /datasets\/?$/;
        if (isDsapiUrl.test(source.url)) {
            source.type = 'dsapi';
        } else {
            source.type = 'imgapi';
        }
    }

    var parsed = url.parse(source.url);
    if (parsed.pathname === '/') {
        parsed.pathname = ''; // Don't want trailing '/'.
    }
    ipFromHost(parsed.host, function (err, ip) {
        if (err) {
            callback(err);
            return;
        }
        parsed.host = ip;
        source.normUrl = url.format(parsed);
        sourcePingCheck(source, function (pingErr) {
            if (pingErr) {
                callback(pingErr);
                return;
            }
            self.sources.push(source);
            callback(null, true);
        });
    });
};


/**
 * Remove a source from the current IMGADM object.
 *
 * Note that this does *not* update the IMGADM config file.
 *
 * @param sourceUrl {String}
 * @param callback {Function} `function (err, changed)` where `changed` is
 *      a boolean indicating if the config changed as a result.
 */
IMGADM.prototype._delSource = function _delSource(sourceUrl, callback) {
    assert.string(sourceUrl, 'sourceUrl');
    var lenBefore = this.sources.length;
    this.sources = this.sources.filter(function (s) {
        return s.url !== sourceUrl;
    });
    var changed = (lenBefore !== this.sources.length);
    callback(null, changed);
};


/**
 * Add a source and update the on-disk config.
 *
 * @param source {Object} Image source object with these keys:
 *      - url {String}
 *      - type {String} Optional. One of 'dsapi' or 'imgapi'. If not given
 *        it is (imperfectly) inferred from the URL.
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL.
 * @param callback {Function} `function (err, changed)`
 */
IMGADM.prototype.configAddSource = function configAddSource(
        source, skipPingCheck, callback) {
    assert.object(source, 'source');
    assert.string(source.url, 'source.url');
    assert.optionalString(source.type, 'source.type');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;

    self._addSource(source, skipPingCheck, function (addErr, changed) {
        if (addErr) {
            callback(addErr);
        } else if (changed) {
            if (!self.config.sources) {
                self.config.sources = [];
            }
            self.config.sources.push({url: source.url, type: source.type});
            self.saveConfig(function (saveErr) {
                if (saveErr) {
                    callback(saveErr);
                    return;
                }
                self.log.debug({source: source}, 'added source url');
                callback(null, true);
            });
        } else {
            callback(null, false);
        }
    });
};


/**
 * Delete a source URL and update the on-disk config.
 *
 * @param sourceUrl {String}
 * @param callback {Function} `function (err, changed)`
 */
IMGADM.prototype.configDelSourceUrl = function configDelSourceUrl(
        sourceUrl, callback) {
    assert.string(sourceUrl, 'sourceUrl');
    var self = this;

    self._delSource(sourceUrl, function (delErr, changed) {
        if (delErr) {
            callback(delErr);
        } else if (changed) {
            self.config.sources = self.sources.map(function (s) {
                return {url: s.url, type: s.type};
            });
            self.saveConfig(function (saveErr) {
                if (saveErr) {
                    callback(saveErr);
                    return;
                }
                self.log.debug({sourceUrl: sourceUrl}, 'deleted source url');
                callback(null, true);
            });
        } else {
            callback(null, false);
        }
    });
};


/**
 * Update sources with the given URLs.
 *
 * Dev Notes: The histrionics below are to avoid re-running ping checks
 * on already existing source URLs.
 *
 * @param sourceUrls {Array}
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL.
 * @param callback {Function} `function (err, changes)` where `changes` is
 *      a list of changes of the form `{type: <type>, url: <url>}` where
 *      `type` is one of 'reorder', 'add', 'del'.
 */
IMGADM.prototype.updateSourceUrls = function updateSourceUrls(
        sourceUrls, skipPingCheck, callback) {
    assert.arrayOfString(sourceUrls, 'sourceUrls');
    assert.bool(skipPingCheck, 'skipPingCheck');
    assert.func(callback, 'callback');
    var self = this;

    var changes = [];
    var oldSourceUrls = self.sources.map(function (s) { return s.url; });
    var newSources = [];
    for (var i = 0; i < sourceUrls.length; i++) {
        var sourceUrl = sourceUrls[i];
        var idx = oldSourceUrls.indexOf(sourceUrl);
        if (idx === -1) {
            newSources.push({url: sourceUrl});
            changes.push({type: 'add', url: sourceUrl});
        } else {
            newSources.push(self.sources[idx]);
            oldSourceUrls[idx] = null;
        }
    }
    oldSourceUrls
        .filter(function (u) { return u !== null; })
        .forEach(function (u) { changes.push({type: 'del', url: u}); });
    if (changes.length === 0) {
        changes.push({type: 'reorder'});
    }

    // `_addSource` has the logic to fill out the source object.
    self.sources = [];
    async.forEachSeries(
        newSources,
        function oneSource(s, next) {
            if (!s.normUrl) {
                self._addSource(s, skipPingCheck, next);
            } else {
                self.sources.push(s);
                next();
            }
        },
        function doneSources(err) {
            if (err) {
                callback(err);
                return;
            }
            self.config.sources = self.sources.map(
                function (s) { return {url: s.url, type: s.type}; });
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


/**
 * Save out the current config.
 *
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.saveConfig = function saveConfig(callback) {
    var self = this;
    self.log.debug({config: self.config}, 'save config to %s', CONFIG_PATH);
    var configDir = path.dirname(CONFIG_PATH);
    mkdirp(configDir, function (dirErr) {
        if (dirErr) {
            callback(dirErr);
            return;
        }
        var str = JSON.stringify(self.config, null, 2);
        fs.writeFile(CONFIG_PATH, str, 'utf8', callback);
    });
};


IMGADM.prototype.sourceFromUrl = function sourceFromUrl(sourceUrl) {
    return this.sources.filter(
        function (s) { return s.url === sourceUrl; })[0];
};


IMGADM.prototype.clientFromSource = function clientFromSource(source) {
    if (this._clientCache === undefined) {
        this._clientCache = {};
    }
    if (this._clientCache[source.url] === undefined) {
        if (source.type === 'dsapi') {
            var baseUrl = path.dirname(source.url); // drop 'datasets/' tail
            var baseNormUrl = path.dirname(source.normUrl);
            this._clientCache[source.url] = dsapi.createClient({
                url: baseNormUrl,
                log: this.log.child({component: 'api', source: baseUrl}, true)
            });
        } else {
            this._clientCache[source.url] = imgapi.createClient({
                url: source.normUrl,
                log: this.log.child(
                    {component: 'api', source: source.url}, true)
            });
        }
    }
    return this._clientCache[source.url];
};


IMGADM.prototype._errorFromClientError = function _errorFromClientError(
        source, err) {
    assert.string(source.url, 'source');
    assert.object(err, 'err');
    if (err.body && err.body.code) {
        return new errors.APIError(source.url, err);
    } else if (err.errno) {
        return new errors.ClientError(source.url, err);
    } else {
        return new errors.InternalError({message: err.message,
            source: source.url, cause: err});
    }
};



IMGADM.prototype._dbImagePath = function _dbImagePath(zpool, uuid) {
    return path.resolve(DB_DIR, 'images', zpool + '-' + uuid + '.json');
};


/**
 * Load the image info for this image from the imgadm db.
 *
 * This never callsback with an error. Basically we treat the imgadm db
 * of image info as a cache: if we don't have the manifest info, then we
 * keep going. A debug message is logged if there is a corrupt db file that
 * is ignored.
 *
 * If no image info is found in the db, then this returns the minimal
 * `imageInfo`:  `{manifest: {uuid: UUID}, zpool: ZPOOL}`
 *
 * @param options {Object}:
 *      - @param uuid {String}
 *      - @param zpool {String}
 * @param callback {Function} `function (err, imageInfo)`
 */
IMGADM.prototype._dbLoadImage = function _dbLoadImage(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assertUuid(options.uuid, 'options.uuid');
    assert.string(options.zpool, 'options.zpool');
    assert.func(callback, 'callback');

    var dbImagePath = this._dbImagePath(options.zpool, options.uuid);
    fs.readFile(dbImagePath, 'utf8', function (err, content) {
        var info = null;
        if (!err) {
            try {
                info = JSON.parse(content);
            } catch (synErr) {
                self.log.debug(synErr, 'corrupt "%s"', dbImagePath);
            }
            assert.equal(info.manifest.uuid, options.uuid, format(
                'UUID for image in "%s" is wrong', dbImagePath));
        }
        if (!info) {
            info = {manifest: {uuid: options.uuid}, zpool: options.zpool};
        }
        callback(null, info);
    });
};


/**
 * Delete image info for this image from the imgadm db.
 *
 * @param options {Object}:
 *      - @param uuid {String}
 *      - @param zpool {String}
 * @param callback {Function} `function (err)`  It is *not* an error if the
 *      db image file does not exist (imgadm supports handling images that
 *      aren't in the imgadm db).
 */
IMGADM.prototype._dbDeleteImage = function _dbDeleteImage(options, callback) {
    assert.object(options, 'options');
    assertUuid(options.uuid, 'options.uuid');
    assert.string(options.zpool, 'options.zpool');
    assert.func(callback, 'callback');

    var dbImagePath = this._dbImagePath(options.zpool, options.uuid);
    fs.exists(dbImagePath, function (exists) {
        if (!exists) {
            callback();
            return;
        } else {
            fs.unlink(dbImagePath, callback);
        }
    });
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
    assert.object(imageInfo, 'imageInfo');
    assert.object(imageInfo.manifest, 'imageInfo.manifest');
    assert.string(imageInfo.zpool, 'imageInfo.zpool');
    assert.optionalObject(imageInfo.source, 'imageInfo.source');

    var dbImagePath = this._dbImagePath(imageInfo.zpool,
                                        imageInfo.manifest.uuid);
    var dbImageDir = path.dirname(dbImagePath);
    mkdirp(dbImageDir, function (dirErr) {
        if (dirErr) {
            callback(dirErr);
            return;
        }
        var dbData = {
            manifest: imageInfo.manifest,
            zpool: imageInfo.zpool,
            sources: (imageInfo.source ? imageInfo.source.url : undefined)
        };
        var content = JSON.stringify(dbData, null, 2) + '\n';
        fs.writeFile(dbImagePath, content, 'utf8', callback);
    });
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
    // zfs "filesystem" (for zones) or "volume" (for VMs) named
    // "$zpoolname/$uuid" with no origin. Also need to exclude filesystems
    // with a zone root -- which is how kvm VMs are handled.
    //
    // We also count the usages of these images: zfs filesystems with the
    // image as an origin.

    var zCmd = '/usr/sbin/zoneadm list -pc';
    /* BEGIN JSSTYLED */
    // Example output:
    //      0:global:running:/::liveimg:shared:
    //      ...
    //      21:dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:running:/zones/dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:dc5cbce7-798a-4bc8-bdc5-61b4be00a22e:joyent-minimal:excl:21
    //      -:7970c690-1738-4e58-a04f-8ce4ea8ebfca:installed:/zones/7970c690-1738-4e58-a04f-8ce4ea8ebfca:7970c690-1738-4e58-a04f-8ce4ea8ebfca:kvm:excl:22
    /* END JSSTYLED */
    exec(zCmd, function (zError, zStdout, zStderr) {
        if (zError) {
            callback(new errors.InternalError(
                {message: format('could not list zones: %s', zError)}));
            return;
        }
        var zLines = zStdout.trim().split('\n');
        var zoneRoots = {};
        zLines.forEach(function (zLine) {
            var zoneRoot = zLine.split(/:/g)[3];
            zoneRoots[zoneRoot] = true;
        });

        var cmd = '/usr/sbin/zfs list -t filesystem,volume -pH '
            + '-o name,origin,mountpoint';
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                callback(new errors.InternalError(
                    {message: format('could not load images: %s', error)}));
                return;
            }
            var lines = stdout.trim().split('\n');
            var imageNames = [];
            var usageFromImageName = {};
            for (i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line.length === 0)
                    continue;
                var parts = line.split('\t');
                assert.equal(parts.length, 3);
                var name = parts[0];
                var origin = parts[1];
                var mountpoint = parts[2];
                if (!VMADM_FS_NAME_RE.test(name))
                    continue;
                if (origin === '-') {
                    if (// If it has a mountpoint from `zoneadm list` it is
                        // a zone, not an image.
                        !zoneRoots[mountpoint]
                        // If it doesn't match `VMADM_IMG_NAME_RE` it is
                        // a KVM disk volume, e.g.
                        // "zones/7970c690-1738-4e58-a04f-8ce4ea8ebfca-disk0".
                        && VMADM_IMG_NAME_RE.test(name))
                    {
                        imageNames.push(name);
                    }
                } else {
                    // This is a filesystem using an image.
                    name = origin.split('@')[0];
                    if (usageFromImageName[name] === undefined) {
                        usageFromImageName[name] = 1;
                    } else {
                        usageFromImageName[name]++;
                    }
                }
            }

            // Sanity check that for every image name for which there is usage
            // there is an image filesystem.
            Object.keys(usageFromImageName).forEach(function (imageName) {
                assert.ok(imageNames.indexOf(imageName) !== -1,
                    format('"%s" image name is an origin for a zfs fs, but '
                        + 'that image fs is not found', imageName));
            });

            var imagesInfo = [];
            async.forEachSeries(
                imageNames,
                function loadOne(imageName, next) {
                    var parsed = VMADM_FS_NAME_RE.exec(imageName);
                    var opts = {uuid: parsed[2], zpool: parsed[1]};
                    self._dbLoadImage(opts, function (err, info) {
                        if (err) {
                            next(err);
                            return;
                        }
                        info.clones = usageFromImageName[imageName] || 0;
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
 * be zombies (i.e. if the image was destroy behind imgadm's back).
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
        self._dbLoadImage(options, function (loadErr, info) {
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
 * @param callback {Function} `function (err, imagesInfo)`
 *      If there is an error then `err` will be set. Note that `imagesInfo`
 *      will still contain results. This is so that an error in one source
 *      does not break everything.
 */
IMGADM.prototype.sourcesList = function sourcesList(callback) {
    var self = this;
    var errs = [];
    var imageSetFromSourceUrl = {};

    async.forEach(
        self.sources,
        function oneSource(source, next) {
            var client = self.clientFromSource(source);
            client.listImages(function (cErr, images) {
                if (cErr) {
                    errs.push(self._errorFromClientError(source, cErr));
                }
                imageSetFromSourceUrl[source.url] = images || [];
                next();
            });
        },
        function done(err) {
            if (!err && errs.length) {
                err = (errs.length === 1 ? errs[0]
                    : new errors.MultiError(errs));
            }
            var imagesInfo = [];
            var imageFromUuid = {};
            for (var i = 0; i < self.sources.length; i++) {
                var sourceUrl = self.sources[i].url;
                var imageSet = imageSetFromSourceUrl[sourceUrl];
                for (var j = 0; j < imageSet.length; j++) {
                    var image = imageSet[j];
                    var uuid = image.uuid;
                    if (imageFromUuid[uuid] === undefined) {
                        imageFromUuid[uuid] = image;
                        imagesInfo.push({manifest: image, source: sourceUrl});
                    }
                }
            }
            callback(err, imagesInfo);
        }
    );
};


/**
 * Get info (mainly manifest data) on the given image UUID from sources.
 *
 * @param uuid {String}
 * @param callback {Function} `function (err, imageInfo)` where `imageInfo`
 *      is `{manifest: <manifest>, source: <source>}`
 */
IMGADM.prototype.sourcesGet = function sourcesGet(uuid, callback) {
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');
    var self = this;
    var errs = [];

    var imageInfo = null;
    async.forEachSeries(
        self.sources,
        function oneSource(source, next) {
            if (imageInfo) {
                next();
                return;
            }
            var client = self.clientFromSource(source);
            client.getImage(uuid, function (cErr, manifest) {
                if (cErr && cErr.statusCode !== 404) {
                    errs.push(self._errorFromClientError(source, cErr));
                }
                if (manifest) {
                    imageInfo = {manifest: manifest, source: source};
                }
                next();
            });
        },
        function done(err) {
            if (!err && errs.length) {
                err = (errs.length === 1 ? errs[0]
                    : new errors.MultiError(errs));
            }
            callback(err, imageInfo);
        }
    );
};


/**
 * Get info (mainly manifest data) on the given image UUID from sources.
 *
 * @param imageInfo {Object} as from `IMGADM.sourcesGet`:
 *      - @param manifest {Object} The image manifest
 *      - @param source {Object} The source object
 * @param callback {Function} `function (err, stream)`
 */
IMGADM.prototype.sourceGetFileStream = function sourceGetFileStream(
        imageInfo, callback) {
    assert.object(imageInfo, 'imageInfo');
    assert.object(imageInfo.manifest, 'imageInfo.manifest');
    assert.object(imageInfo.source, 'imageInfo.source');
    assert.func(callback, 'callback');

    var client = this.clientFromSource(imageInfo.source);
    client.getImageFileStream(imageInfo.manifest.uuid, callback);
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
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.deleteImage = function deleteImage(options, callback) {
    assert.object(options, 'options');
    assertUuid(options.uuid, 'options.uuid');
    assert.string(options.zpool, 'options.zpool');
    assert.func(callback, 'callback');
    var self = this;
    var uuid = options.uuid;
    var zpool = options.zpool;

    var getOpts = {uuid: uuid, zpool: zpool, children: true};
    this.getImage(getOpts, function (err, imageInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (!imageInfo) {
            callback(new errors.ImageNotInstalledError(zpool, uuid));
            return;
        }
        if (imageInfo.children.clones.length > 0) {
            callback(new errors.ImageHasDependentClonesError(imageInfo));
            return;
        }

        var cmd = format('/usr/sbin/zfs destroy -r %s/%s', zpool, uuid);
        exec(cmd, function (dErr, stdout, stderr) {
            if (dErr) {
                callback(new errors.InternalError({
                    cause: dErr,
                    message: format('error deleting image "%s": %s',
                                    uuid, dErr)
                }));
                return;
            }
            self._dbDeleteImage(options, callback);
        });
    });
};


/**
 * Import the given image from the given `source`
 *
 * It is up to the caller to ensure this UUID is not already installed.
 *
 * @param options {Object}
 *      - @param manifest {Object} The manifest to import.
 *      - @param zpool {String} The zpool to which to import.
 *      - @param source {Object} The source object from which to import.
 *      - @param quiet {Boolean} Optional. Default false. Set to true
 *        to not have a progress bar for the install.
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.importImage = function importImage(options, callback) {
    assert.object(options, 'options');
    assert.object(options.manifest, 'options.manifest');
    assert.string(options.zpool, 'options.zpool');
    assert.object(options.source, 'options.source');
    assert.optionalBool(options.quiet, 'options.quiet');

    this._installImage(options, callback);
};


/**
 * Install the given image from the given `manifest` and image file path,
 * `file`.
 *
 * It is up to the caller to ensure this UUID is not already installed.
 *
 * @param options {Object}
 *      - @param manifest {Object} The manifest to import.
 *      - @param zpool {String} The zpool to which to import.
 *      - @param file {String} Path to the image file.
 *      - @param quiet {Boolean} Optional. Default false. Set to true
 *        to not have a progress bar for the install.
 * @param callback {Function} `function (err)`
 */
IMGADM.prototype.installImage = function installImage(options, callback) {
    assert.object(options, 'options');
    assert.object(options.manifest, 'options.manifest');
    assert.string(options.zpool, 'options.zpool');
    assert.string(options.file, 'options.file');
    assert.optionalBool(options.quiet, 'options.quiet');

    this._installImage(options, callback);
};


/**
 * Install an image from the given manifest and either a local `file` or
 * downloading from a given image `source`.
 */
IMGADM.prototype._installImage = function _installImage(options, callback) {
    var self = this;
    assert.object(options, 'options');
    assert.object(options.manifest, 'options.manifest');
    assert.string(options.zpool, 'options.zpool');
    assert.optionalString(options.file, 'options.file');
    assert.optionalObject(options.source, 'options.source');
    assert.ok((options.file || options.source)
        && !(options.file && options.source),
        'must specify exactly *one* of options.file or options.source');
    assert.optionalBool(options.quiet, 'options.quiet');
    assert.func(callback, 'callback');
    var uuid = options.manifest.uuid;
    assertUuid(uuid, 'options.manifest.uuid');
    var log = self.log;
    log.debug(options, 'importImage');

    // Upgrade manifest if required.
    try {
        var manifest = imgmanifest.upgradeManifest(options.manifest);
    } catch (err) {
        callback(new errors.InvalidManifestError(err));
        return;
    }

    var imageInfo = {
        manifest: manifest,
        zpool: options.zpool,
        source: options.source
    };
    var dsName = format('%s/%s', options.zpool, uuid);
    var tmpDsName = dsName + '-partial';
    var bar = null;  // progress-bar object
    var md5Hash = null;
    var sha1Hash = null;
    var md5Expected = null;
    var finished = false;

    function cleanupAndExit(cleanDsName, err) {
        var cmd = format('/usr/sbin/zfs destroy -r %s', cleanDsName);
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                log.error({cmd: cmd, error: error, stdout: stdout,
                    stderr: stderr, cleanDsName: cleanDsName},
                    'error destroying tmp dataset while cleaning up');
            }
            callback(err);
        });
    }

    function destroyChildSnapshots(parentDsName, next) {
        getZfsDataset(parentDsName, ['name', 'children'], function (zErr, ds) {
            if (zErr) {
                next(zErr);
                return;
            }
            var snapshots = ds.children.snapshots;
            if (snapshots.length === 0) {
                next();
                return;
            }
            async.forEachSeries(
                snapshots,
                function oneSnapshot(snapshot, nextSnapshot) {
                    zfsDestroy(snapshot, log, nextSnapshot);
                },
                function doneSnapshots(snapErr) {
                    next(snapErr);
                }
            );
        });
    }

    function finish(err) {
        if (finished) {
            return;
        }
        finished = true;
        if (bar) {
            process.stderr.write('\n');
        }
        if (!err && md5Expected) {
            var md5Actual = md5Hash.digest('base64');
            if (md5Actual !== md5Expected) {
                err = new errors.DownloadError(format(
                    'Content-MD5 expected to be %s, but was %s',
                    md5Expected, md5Actual));
            }
        }
        if (!err) {
            var sha1Expected = manifest.files[0].sha1;
            var sha1Actual = sha1Hash.digest('hex');
            if (sha1Actual !== sha1Expected) {
                err = new errors.DownloadError(format(
                    'image file sha1 expected to be %s, but was %s',
                    sha1Expected, sha1Actual));
            }
        }
        if (err) {
            cleanupAndExit(tmpDsName, err);
            return;
        }

        // Remove any child snapshots. (Per DATASET-666) There will always
        // be the one snapshot sent with 'zfs send' and might be more if
        // 'zfs send -r|-R' was used. This is just to be clean... because
        // 'imgadm delete' is *still* going to use "zfs destroy -r" to get
        // dependent snapshots of the image.
        destroyChildSnapshots(tmpDsName, function (snapErr) {
            if (snapErr) {
                cleanupAndExit(tmpDsName, snapErr);
                return;
            }

            // Rename.
            var cmd = format('/usr/sbin/zfs rename %s %s',
                tmpDsName, dsName);
            exec(cmd, function (error, stdout, stderr) {
                if (error) {
                    log.error({cmd: cmd, error: error, stdout: stdout,
                        stderr: stderr, dsName: dsName},
                        'error renaming imported image');
                    cleanupAndExit(tmpDsName,
                        new errors.InternalError(
                            {message: 'error importing'}));
                    return;
                }

                // Save manifest to db.
                self.dbAddImage(imageInfo, function (addErr) {
                    if (addErr) {
                        log.error({err: addErr, imageInfo: imageInfo},
                            'error saving image to the database');
                        cleanupAndExit(dsName,
                            new errors.InternalError(
                                {message: 'error saving image manifest'}));
                    } else {
                        callback();
                    }
                });
            });
        });
    }

    function getImageFileInfo(next) {
        if (options.file) {
            fs.stat(options.file, function (statErr, stats) {
                if (statErr) {
                    next(statErr);
                    return;
                }
                var stream = fs.createReadStream(options.file);
                next(null, {
                    stream: stream,
                    size: stats.size
                });
            });
        } else {
            assert.ok(options.source);
            self.sourceGetFileStream(imageInfo, function (err, stream) {
                if (err) {
                    next(err);
                    return;
                }
                if (imageInfo.source.type !== 'dsapi'
                    && !stream.headers['content-md5'])
                {
                    next(new errors.DownloadError(
                        'image file headers did not include a "Content-MD5"'));
                    return;
                }
                next(null, {
                    stream: stream,
                    size: Number(stream.headers['content-length']),
                    contentMd5: stream.headers['content-md5']
                });
            });
        }
    }

    getImageFileInfo(function (err, info) {
        // image file stream                [A]
        //      | inflator (if necessary)   [B]
        //      | zfs recv                  [C]

        // [A]
        if (!options.quiet && process.stderr.isTTY) {
            bar = new ProgressBar(
                ':percent [:bar]  time :elapseds  eta :etas',
                {
                    complete: '=',
                    incomplete: ' ',
                    width: 30,
                    total: info.size,
                    stream: process.stderr
                });
        }
        md5Expected = info.contentMd5;
        md5Hash = crypto.createHash('md5');
        sha1Hash = crypto.createHash('sha1');
        info.stream.on('data', function (chunk) {
            if (bar)
                bar.tick(chunk.length);
            md5Hash.update(chunk);
            sha1Hash.update(chunk);
        });
        info.stream.on('error', finish);

        // [B]
        var compression = manifest.files[0].compression;
        var uncompressor;
        if (compression === 'bzip2') {
            uncompressor = spawn('/usr/bin/bzip2', ['-cdfq']);
        } else if (compression === 'gzip') {
            uncompressor = spawn('/usr/bin/gzip', ['-cdfq']);
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
                    finish(new errors.InternalError({message: format(
                        'uncompression error while importing: '
                        + 'exit code %s', code)}));
                }
            });
        }

        // [C]
        var zfsRecv = spawn('/usr/sbin/zfs', ['receive', tmpDsName]);
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

        if (uncompressor) {
            uncompressor.stdout.pipe(zfsRecv.stdin);
            info.stream.pipe(uncompressor.stdin);
        } else {
            info.stream.pipe(zfsRecv.stdin);
        }
    });
};


/**
 * Update image database. I.e., attempt to gather info on installed images
 * with no cached manifest info, from current image sources.
 *
 * Dev Note: Currently this just writes progress (updated images) with
 * `console.log`, which isn't very "library-like".
 */
IMGADM.prototype.updateImages = function updateImages(callback) {
    assert.func(callback, 'callback');
    var self = this;

    function updateImage(ii, next) {
        assert.object(ii.manifest, 'ii.manifest');
        assert.string(ii.zpool, 'ii.zpool');
        if (ii.manifest.name) {
            next();
            return;
        }
        var uuid = ii.manifest.uuid;
        self.sourcesGet(uuid, function (sGetErr, imageInfo) {
            if (sGetErr) {
                next(sGetErr);
                return;
            }
            if (!imageInfo) {
                console.log('Could not find image %s in image sources', uuid);
                next();
                return;
            }
            imageInfo.zpool = ii.zpool;
            self.dbAddImage(imageInfo, function (dbAddErr) {
                if (dbAddErr) {
                    next(dbAddErr);
                    return;
                }
                console.log('Updated image %s from "%s"', uuid,
                    imageInfo.source.url);
                next();
            });
        });
    }

    self.listImages(function (err, imagesInfo) {
        if (err) {
            callback(err);
            return;
        }
        async.forEachSeries(imagesInfo, updateImage, callback);
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
        tool.log.debug({config: tool.config}, 'tool initialized');
        callback(null, tool);
    });
}

module.exports = {
    createTool: createTool
};
