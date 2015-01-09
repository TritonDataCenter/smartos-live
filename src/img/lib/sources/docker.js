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
var util = require('util'),
    format = util.format;
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var Source = require('./source');



// ---- globals

var DOCKER_HUB_URL = 'https://index.docker.io'



// ---- docker source

function DockerSource(opts) {
    var self = this;
    assert.object(opts.config, 'opts.config');
    assert.bool(opts.config.dockerImportSkipUuids,
        'opts.config.dockerImportSkipUuids');

    self.dockerImportSkipUuids = opts.config.dockerImportSkipUuids;

    this.__defineGetter__('regClient', function () {
        if (this._regClient === undefined) {
            this._regClient = drc.createRegistryClient({
                url: self.url,
                log: self.log
            });
        }
        return this._regClient;
    });

    Source.call(this, opts);
}
util.inherits(DockerSource, Source);

DockerSource.prototype.type = 'docker';

DockerSource.prototype.ping = function ping(cb) {
    var self = this;
    /*
     * Note that DOCKER_HUB_URL actually works with this. IOW, while not
     * clearly documented, index.docker.io implements some of the *Registry
     * API* endpoints.
     */
    this.regClient.getStatus(function (err, body, res) {
        if (err) {
            cb(new errors.SourcePingError(err, self));
            return;
        }
        cb();
    });
};


/**
 * Get (and in-mem cache) a registry API session for the given repo.
 */
DockerSource.prototype.regSessFromRepo = function regSessFromRepo(repo, cb) {
    var self = this;
    if (self._regSessFromRepo === undefined) {
        self._regSessFromRepo = {};
    }
    if (self._regSessFromRepo[repo]) {
        // TODO: consider caching registry sessions to disk
        return cb(null, self._regSessFromRepo[repo]);
    }

    var sessOpts = {
        repo: repo,
        log: self.log
    }
    drc.createRegistrySession(sessOpts, function (err, sess) {
        if (err) {
            if (err.statusCode === 404) {
                cb(new errors.DockerRepoNotFoundError(err, repo));
            } else {
                cb(err);
            }
        } else {
            self._regSessFromRepo[repo] = sess;
            cb(null, sess);
        }
    });
};


/**
 * Attempt to find import info for the given docker pull arg, `REPO[:TAG]`
 * in this docker index/registry.
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

    // This can be called with non-docker import ids (e.g. an IMGAPI uuid).
    // Just return empty to indicate N/A.
    try {
        var rat = drc.parseRepoAndTag(opts.arg);
    } catch(e) {
        return cb();
    }
    self.log.debug({arg: opts.arg, rat: rat}, 'parsed docker import arg');

    var sess;
    var importInfo;

    vasync.pipeline({funcs: [
        function getSess(_, next) {
            self.regSessFromRepo(rat.repo, function (err, sess_) {
                sess = sess_;
                next(err);
            });
        },
        function getRepoTags(_, next) {
            assert.string(rat.tag, 'rat.tag');
            sess.listRepoTags(function (err, repoTags) {
                if (!repoTags[rat.tag]) {
                    next(new errors.ActiveImageNotFoundError(opts.arg));
                    return;
                }
                var imgId = repoTags[rat.tag];
                importInfo = {
                    repo: rat.repo,
                    tag: rat.tag,   // the requested tag
                    tags: [],       // all the tags on that imgId
                    imgId: imgId,
                    uuid: imgmanifest.imgUuidFromDockerId(imgId),
                };
                Object.keys(repoTags).forEach(function (repoTag) {
                    if (repoTags[repoTag] === imgId) {
                        importInfo.tags.push(repoTag);
                    }
                });
                next();
            });
        }
    ]}, function finish(err) {
        if (err && err.code === 'DockerRepoNotFound') {
            cb();
        } else {
            cb(err, importInfo);
        }
    });
};


DockerSource.prototype.titleFromImportInfo =
function titleFromImportInfo(importInfo) {
    return format('%s (%s:%s)', importInfo.uuid,
        importInfo.repo, importInfo.tag);
};


DockerSource.prototype.getImgAncestry = function getImgAncestry(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.repo, 'opts.repo');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    this.regSessFromRepo(opts.repo, function (sessErr, sess) {
        if (sessErr) {
            cb(sessErr);
            return;
        }
        sess.getImgAncestry({imgId: opts.imgId}, function (err, dAncestry) {
            if (err) {
                cb(err);
                return;
            }
            var ancestry = dAncestry.map(function (imgId) {
                return {
                    imgId: imgId,
                    uuid: imgmanifest.imgUuidFromDockerId(imgId),
                    repo: opts.repo
                };
            });
            cb(null, ancestry);
        });
    });
};


DockerSource.prototype.getImgMeta = function getImgMeta(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.repo, 'opts.repo');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.imgId, 'opts.imgId');
    // The docker tags on this imgId, if any. Typically set by `getImportInfo`.
    assert.optionalArrayOfString(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    this.regSessFromRepo(opts.repo, function (sessErr, sess) {
        if (sessErr) {
            cb(sessErr);
            return;
        }
        sess.getImgJson({imgId: opts.imgId}, function (err, imgJson, res) {
            if (err) {
                cb(err);
                return;
            }
            var size = Number(res.headers['x-docker-size']);
            assert.number(size, 'x-docker-size header');
            var imgMeta = {
                manifest: imgmanifest.imgManifestFromDockerJson({
                    imgJson: imgJson,
                    uuid: opts.uuid,
                    repo: opts.repo,
                    tags: opts.tags
                }),
                size: size,
                // Note: *Not* using 'X-Docker-Payload-Checksum' value. They
                // don't check out as I expect and `docker` CLI isn't using
                // that value.

                imgJson: imgJson
            };
            cb(null, imgMeta);
        });
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
    assert.string(opts.repo, 'opts.repo');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    this.regSessFromRepo(opts.repo, function (sessErr, sess) {
        if (sessErr) {
            cb(sessErr);
            return;
        }
        sess.getImgLayerStream({imgId: opts.imgId}, function (err, stream) {
            if (err) {
                cb(err);
                return;
            }
            cb(null, stream);
        });
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
