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
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 */

var p = console.log;

var assert = require('assert-plus');
var drc = require('docker-registry-client');
var imgmanifest = require('imgmanifest');
var url = require('url');
var util = require('util'),
    format = util.format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var Source = require('./source');



// ---- globals

var DOCKER_HUB_URL = 'https://docker.io';



// ---- docker source

function DockerSource(opts) {
    assert.object(opts.config, 'opts.config');
    assert.bool(opts.config.dockerImportSkipUuids,
        'opts.config.dockerImportSkipUuids');

    this.dockerImportSkipUuids = opts.config.dockerImportSkipUuids;

    Source.call(this, opts);

    this.index = drc.parseIndex(this.url);
}
util.inherits(DockerSource, Source);

DockerSource.prototype.type = 'docker';

DockerSource.prototype.ping = function ping(cb) {
    var self = this;

    drc.pingIndex({
        indexName: self.url,
        log: self.log,
        insecure: self.insecure
    }, function (err, body, res) {
        if (err) {
            cb(new errors.SourcePingError(err, self));
            return;
        }
        cb();
    });
};


DockerSource.prototype._clientFromRepo = function _clientFromRepo(repo) {
    assert.object(repo, 'repo');
    assert.equal(repo.index.name, this.index.name);

    var key = repo.canonicalName;

    if (this.__clientCache === undefined) {
        this.__clientCache = {};
    }

    if (!this.__clientCache[key]) {
        this.__clientCache[key] = drc.createClient({
            scheme: this.index.scheme,
            name: repo.canonicalName,
            agent: false,
            log: this.log,
            insecure: this.insecure
        });
    }
    return this.__clientCache[key];
};


/**
 * Attempt to find import info for the given docker pull arg, `REPO[:TAG]`
 * in this docker registry.
 *
 * If the given `arg` is not a valid identifier the response is `cb()`.
 * Likewise, if the arg is not found in this docker source: `cb()`. IOW, this
 * is how this image source says the `opts.arg` is not applicable.
 */
DockerSource.prototype.getImportInfo = function getImportInfo(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.arg, 'opts.arg');
    assert.func(cb, 'cb');

    if (self.dockerImportSkipUuids && common.UUID_RE.test(opts.arg)) {
        cb();
        return;
    }

    /*
     * Ignore: (a) a non-Docker IMGAPI/SDC image UUID, and (b) a Docker repo
     * which includes a index name (aka registry host) that doesn't match.
     */
    try {
        var rat = drc.parseRepoAndTag(opts.arg, self.index);
    } catch(e) {
        return cb();
    }
    if (rat.index.name !== self.index.name) {
        self.log.trace({arg: opts.arg, rat: rat, source: this},
            'import arg does not apply to this docker source');
        return cb();
    }

    var importInfo;
    var client = self._clientFromRepo(rat);
    client.listRepoTags(function (err, repoTags) {
        if (err) {
            if (err.statusCode === 404) {
                cb();
            } else {
                cb(err);
            }
            return;
        }
        if (!repoTags[rat.tag]) {
            cb();
            return;
        }
        var imgId = repoTags[rat.tag];
        importInfo = {
            repo: rat,
            tag: rat.tag,   // the requested tag
            tags: [],       // all the tags on that imgId
            imgId: imgId,
            uuid: imgmanifest.imgUuidFromDockerInfo({
                id: imgId,
                indexName: rat.index.name
            }),
        };
        Object.keys(repoTags).forEach(function (repoTag) {
            if (repoTags[repoTag] === imgId) {
                importInfo.tags.push(repoTag);
            }
        });
        cb(null, importInfo);
    });
}


DockerSource.prototype.titleFromImportInfo =
function titleFromImportInfo(importInfo) {
    return format('%s (%s:%s)', importInfo.uuid,
        importInfo.repo.canonicalName, importInfo.tag);
};


DockerSource.prototype.getImgAncestry = function getImgAncestry(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.repo, 'opts.repo');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    var client = this._clientFromRepo(opts.repo);
    client.getImgAncestry({imgId: opts.imgId}, function (err, dAncestry) {
        if (err) {
            cb(err);
            return;
        }
        var ancestry = dAncestry.map(function (imgId) {
            return {
                imgId: imgId,
                uuid: imgmanifest.imgUuidFromDockerInfo({
                    id: imgId,
                    indexName: opts.repo.index.name
                }),
                repo: opts.repo
            };
        });
        cb(null, ancestry);
    });
};


DockerSource.prototype.getImgMeta = function getImgMeta(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.repo, 'opts.repo');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.imgId, 'opts.imgId');
    // The docker tags on this imgId, if any. Typically set by `getImportInfo`.
    assert.optionalArrayOfString(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    var client = this._clientFromRepo(opts.repo);
    client.getImgJson({imgId: opts.imgId}, function (err, imgJson, res) {
        if (err) {
            cb(err);
            return;
        }
        var imgMeta = {
            manifest: imgmanifest.imgManifestFromDockerInfo({
                imgJson: imgJson,
                repo: opts.repo,
                uuid: opts.uuid,
                tags: opts.tags
            }),
            imgJson: imgJson
        };
        cb(null, imgMeta);
    });
};


/**
 * Get a (paused) readable stream for the given image file.
 *
 * @param opts {Object} Image info, as from `getImportInfo` or an element of
 *      the array returned from `getImgAncestry`.
 * @param cb {Function} `function (err, stream)`
 */
DockerSource.prototype.getImgFileStream = function getImgFileStream(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.repo, 'opts.repo');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    var client = this._clientFromRepo(opts.repo);
    client.getImgLayerStream({imgId: opts.imgId}, function (err, stream) {
        if (err) {
            cb(err);
            return;
        }
        cb(null, stream);
    });
};



// ---- exports

module.exports = DockerSource;

module.exports.DOCKER_HUB_URL = DOCKER_HUB_URL;

module.exports.isDockerPullArg = function isDockerPullArg(arg) {
    try {
        drc.parseRepoAndTag(arg);
        return true;
    } catch(e) {
        return false;
    }
};
