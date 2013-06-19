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
var path = require('path');
var fs = require('fs');
var format = require('util').format;
var assert = require('assert-plus');
var dns = require('dns');
var crypto = require('crypto');
var async = require('async');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var url = require('url');
var mkdirp = require('mkdirp');
var ProgressBar = require('progbar').ProgressBar;
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

function _indent(s, indent) {
    if (!indent) indent = '    ';
    var lines = s.split(/\r?\n/g);
    return indent + lines.join('\n' + indent);
}

function ipFromHost(host, log, callback) {
    if (IP_RE.test(host)) {
        callback(null, host);
        return;
    }
    // No DNS in SmartOS GZ by default, so handle DNS ourself.
    log.trace({host: host}, 'dns lookup');
    dns.lookup(host, function (err, ip) {
        if (err) {
            callback(new errors.InternalError(
                {message: format('error DNS resolving %s: %s', host, err)}));
            return;
        }
        callback(null, ip);
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


function normUrlFromUrl(u) {
    // `url.parse('example.com:9999')` is not what you expect. Make sure we
    // have a protocol.
    if (! /^\w+:\/\// .test(u)) {
        u = 'http://' + u;
    }

    var parsed = url.parse(u);

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

    return url.format(parsed);
}



// ---- Source class

/**
 * A light wrapper around an image source repository. A source has a
 * `url` and a `type` ("dsapi" or "imgapi"). `getResolvedUrl()` handles (lazy)
 * DNS resolution.
 *
 * @param options {Object} with these keys
 *      - url {String}
 *      - type {String} Optional. One of 'dsapi' or 'imgapi'. If not given
 *        it is (imperfectly) inferred from the URL.
 *      - log {Bunyan Logger}
 */
function Source(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.optionalString(options.type, 'options.type');
    assert.object(options.log, 'options.log');
    this.url = options.url;
    this.normUrl = normUrlFromUrl(this.url);
    this.log = options.log;

    // Figure out `type` if necessary.
    this.type = options.type;
    if (!this.type) {
        // Per the old imgadm (v1) the old source URL includes the
        // "datasets/" subpath. That's not a completely reliable marker, but
        // we'll use that.
        var isDsapiUrl = /datasets$/;
        if (isDsapiUrl.test(this.normUrl)) {
            this.type = 'dsapi';
        } else {
            this.type = 'imgapi';
        }
    }
}


/**
 * Return a URL with DNS-resolved host
 *
 * @params callback {Function} `function (err, normUrl)`
 */
Source.prototype.getResolvedUrl = function getResolvedUrl(callback) {
    assert.func(callback, 'callback');

    var self = this;
    if (this._resolvedUrl) {
        callback(null, this._resolvedUrl);
        return;
    }

    var parsed = url.parse(this.normUrl);
    self.log.trace({resolve: parsed.hostname}, 'DNS resolve source host');
    ipFromHost(parsed.hostname, self.log, function (dnsErr, ip) {
        if (dnsErr) {
            callback(dnsErr);
            return;
        }
        parsed.hostname = ip;
        parsed.host = ip + (parsed.port ? ':' + parsed.port : '');
        self._resolvedUrl = url.format(parsed);
        callback(null, self._resolvedUrl);
        return;
    });
};



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
        var sources = self.config.sources || [common.DEFAULT_SOURCE];
        self.log.trace({sources: sources}, 'init: add sources');
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
 * @param source {Source|Object} A `Source` instance or an object describing
 *      the image source with these keys:
 *      - url {String}
 *      - type {String} Optional. One of 'dsapi' or 'imgapi'. If not given
 *        it is (imperfectly) inferred from the URL.
 * @param skipPingCheck {Boolean} Whether to do a ping check on the new
 *      source URL. Default false. However, a ping check is not done for
 *      an existing source (i.e. if `source` is already a Source instance).
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
    function sourcePingCheck(sourceToPing, next) {
        if (skipPingCheck) {
            next();
            return;
        }

        self.log.trace({source: sourceToPing.url}, 'sourcePingCheck');
        self.clientFromSource(sourceToPing, function (cErr, client) {
            if (cErr) {
                next(cErr);
                return;
            }
            client.ping(function (err, pong, res) {
                if (err
                    || res.statusCode !== 200
                    || (sourceToPing.type === 'imgapi' && !pong.imgapi))
                {
                    if (res
                        && res.headers['content-type'] !== 'application/json')
                    {
                        var body = res.body;
                        if (body && body.length > 1024) {
                            body = body.slice(0, 1024) + '...';
                        }
                        err = new Error(format(
                            'statusCode %s, response not JSON:\n%s',
                            res.statusCode, _indent(body)));
                    }
                    next(new errors.SourcePingError(err, sourceToPing));
                    return;
                }
                next();
            });
        });
    }

    // No-op if already have this URL.
    var normUrl = normUrlFromUrl(source.url);
    for (var i = 0; i < self.sources.length; i++) {
        if (self.sources[i].normUrl === normUrl)
            return callback(null, false);
    }

    // If already a source, then just add it.
    if (source.constructor.name === 'Source') {
        self.sources.push(source);
        callback(null, true);
        return;
    }

    // Else make a new Source instance.
    var s = new Source({url: source.url, type: source.type, log: self.log});
    if (skipPingCheck) {
        self.sources.push(s);
        callback(null, true);
    } else {
        sourcePingCheck(s, function (pingErr) {
            if (pingErr) {
                callback(pingErr);
                return;
            }
            self.sources.push(s);
            callback(null, true);
        });
    }
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
    var normSourceUrl = normUrlFromUrl(sourceUrl);
    this.sources = this.sources.filter(function (s) {
        return s.normUrl !== normSourceUrl;
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
 *      source URL. Default false.
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
                // Was implicitly getting the default source. Let's keep it.
                self.config.sources = [common.DEFAULT_SOURCE];
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
 *      source URL. Default false. However, a ping check is not done
 *      on already existing sources.
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
            self._addSource(s, skipPingCheck, next);
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



/**
 * Return an API client for the given source.
 *
 * @param source {Source}
 * @param callback {Function} `function (err, client)`
 */
IMGADM.prototype.clientFromSource = function clientFromSource(
        source, callback) {
    var self = this;
    assert.object(source, 'source');
    assert.func(callback, 'callback');

    if (self._clientCache === undefined) {
        self._clientCache = {};
    }
    var client = self._clientCache[source.normUrl];
    if (client) {
        callback(null, client);
        return;
    }

    source.getResolvedUrl(function (normErr, normUrl) {
        if (normErr) {
            callback(normErr);
            return;
        }
        if (source.type === 'dsapi') {
            var baseNormUrl = path.dirname(normUrl); // drop 'datasets/' tail
            self._clientCache[source.normUrl] = dsapi.createClient({
                agent: false,
                url: baseNormUrl,
                log: self.log.child(
                    {component: 'api', source: source.url}, true)
            });
        } else {
            self._clientCache[source.normUrl] = imgapi.createClient({
                agent: false,
                url: normUrl,
                log: self.log.child(
                    {component: 'api', source: source.url}, true)
            });
        }
        callback(null, self._clientCache[source.normUrl]);
    });
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
            source: (imageInfo.source ? imageInfo.source.url : undefined)
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
            + '-o name,origin,mountpoint,imgadm:ignore';
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
                assert.equal(parts.length, 4);
                var name = parts[0];
                var origin = parts[1];
                var mountpoint = parts[2];
                var ignore = parts[3];
                if (!VMADM_FS_NAME_RE.test(name))
                    continue;
                if (// If it has a mountpoint from `zoneadm list` it is
                    // a zone, not an image.
                    !zoneRoots[mountpoint]
                    // If it doesn't match `VMADM_IMG_NAME_RE` it is
                    // a KVM disk volume, e.g.
                    // "zones/7970c690-1738-4e58-a04f-8ce4ea8ebfca-disk0".
                    && VMADM_IMG_NAME_RE.test(name))
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
                    name = origin.split('@')[0];
                    if (usageFromImageName[name] === undefined) {
                        usageFromImageName[name] = 1;
                    } else {
                        usageFromImageName[name]++;
                    }
                }
            }

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

    if (self.sources.length === 0) {
        callback(new errors.NoSourcesError());
        return;
    }
    async.forEach(
        self.sources,
        function oneSource(source, next) {
            self.clientFromSource(source, function (cErr, client) {
                if (cErr) {
                    errs.push(cErr);
                    next();
                    return;
                }
                client.listImages(function (listErr, images) {
                    if (listErr) {
                        errs.push(self._errorFromClientError(source, listErr));
                    }
                    imageSetFromSourceUrl[source.url] = images || [];
                    next();
                });
            });
        },
        function done(err) {
            if (!err && errs.length) {
                err = (errs.length === 1 ? errs[0]
                    : new errors.MultiError(errs));
            }
            var imagesInfo = [];
            var imageFromUuid = {};
            self.log.trace({imageSetFromSourceUrl: imageSetFromSourceUrl},
                'image sets from each source');
            for (var i = 0; i < self.sources.length; i++) {
                var sourceUrl = self.sources[i].url;
                var imageSet = imageSetFromSourceUrl[sourceUrl];
                if (!imageSet) {
                    continue;
                }
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
 * @param ensureActive {Boolean} Set to true to skip inactive images.
 * @param callback {Function} `function (err, imageInfo)` where `imageInfo`
 *      is `{manifest: <manifest>, source: <source>}`
 */
IMGADM.prototype.sourcesGet
        = function sourcesGet(uuid, ensureActive, callback) {
    assert.string(uuid, 'uuid');
    assert.bool(ensureActive, 'ensureActive');
    assert.func(callback, 'callback');
    var self = this;
    var errs = [];

    if (self.sources.length === 0) {
        callback(new errors.NoSourcesError());
        return;
    }

    var imageInfo = null;
    async.forEachSeries(
        self.sources,
        function oneSource(source, next) {
            if (imageInfo) {
                next();
                return;
            }
            self.clientFromSource(source, function (cErr, client) {
                if (cErr) {
                    next(cErr);
                    return;
                }
                client.getImage(uuid, function (getErr, manifest) {
                    if (getErr && getErr.statusCode !== 404) {
                        errs.push(self._errorFromClientError(source, getErr));
                        next();
                        return;
                    }
                    if (manifest) {
                        if (ensureActive) {
                            try {
                                manifest
                                    = imgmanifest.upgradeManifest(manifest);
                            } catch (err) {
                                errs.push(new errors.InvalidManifestError(err));
                                next();
                                return;
                            }
                        }
                        if (!ensureActive || manifest.state === 'active') {
                            imageInfo = {manifest: manifest, source: source};
                        }
                    }
                    next();
                });
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
    var self = this;
    assert.object(imageInfo, 'imageInfo');
    assert.object(imageInfo.manifest, 'imageInfo.manifest');
    assert.object(imageInfo.source, 'imageInfo.source');
    assert.func(callback, 'callback');

    self.clientFromSource(imageInfo.source, function (cErr, client) {
        if (cErr) {
            callback(cErr);
            return;
        }
        client.getImageFileStream(imageInfo.manifest.uuid, callback);
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

    // Ensure this image is active (upgrading manifest if required).
    try {
        options.manifest = imgmanifest.upgradeManifest(options.manifest);
    } catch (err) {
        callback(new errors.InvalidManifestError(err));
        return;
    }
    if (options.manifest.state !== 'active') {
        callback(new errors.ImageNotActiveError(options.manifest.uuid));
        return;
    }

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
    log.debug(options, '_installImage');

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
    var tmpDsName;  // set when the 'zfs receive' begins
    var bar = null;  // progress-bar object
    var md5Hash = null;
    var sha1Hash = null;
    var md5Expected = null;
    var finished = false;

    function cleanupAndExit(cleanDsName, err) {
        if (cleanDsName) {
            var cmd = format('/usr/sbin/zfs destroy -r %s', cleanDsName);
            exec(cmd, function (error, stdout, stderr) {
                if (error) {
                    log.error({cmd: cmd, error: error, stdout: stdout,
                        stderr: stderr, cleanDsName: cleanDsName},
                        'error destroying tmp dataset while cleaning up');
                }
                callback(err);
            });
        } else {
            callback(err);
        }
    }

    function ensureFinalSnapshot(parentDsName, next) {
        getZfsDataset(parentDsName, ['name', 'children'], function (zErr, ds) {
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
    }

    function finish(err) {
        if (finished) {
            return;
        }
        finished = true;
        if (bar) {
            bar.end();
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

        // Ensure that we have a snapshot named "@final" for use by
        // `vmadm create`. See IMGAPI-152, smartos-live#204.
        ensureFinalSnapshot(tmpDsName, function (snapErr) {
            if (snapErr) {
                cleanupAndExit(tmpDsName, snapErr);
                return;
            }

            // Rename.
            var cmd = format('/usr/sbin/zfs rename %s %s',
                tmpDsName, dsName);
            log.trace({cmd: cmd}, 'rename tmp image');
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
        if (err) {
            finish(err);
            return;
        }

        // image file stream                [A]
        //      | inflator (if necessary)   [B]
        //      | zfs recv                  [C]
        // [A]
        if (!options.quiet && process.stderr.isTTY) {
            bar = new ProgressBar({
                size: info.size,
                filename: uuid
            });
        }
        md5Expected = info.contentMd5;
        md5Hash = crypto.createHash('md5');
        sha1Hash = crypto.createHash('sha1');
        info.stream.on('data', function (chunk) {
            if (bar)
                bar.advance(chunk.length);
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
                }
            });
        }

        // [C]
        tmpDsName = dsName + '-partial';
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
        self.sourcesGet(uuid, true, function (sGetErr, imageInfo) {
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
