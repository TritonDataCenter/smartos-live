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
 * Copyright (c) 2018, Joyent, Inc. All rights reserved.
 */

var p = console.log;

var assert = require('assert-plus');
var concat = require('concat-stream');
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

    drc.pingV2({
        indexName: self.url,
        log: self.log,
        insecure: self.insecure
    }, function (err) {
        // Allow a 401 "Authentication is required" error.
        if (err && err.statusCode !== 401) {
            cb(new errors.SourcePingError(err, self));
            return;
        }
        cb();
    });
};


DockerSource.prototype._clientFromRepo = function _clientFromRepo(repo) {
    assert.object(repo, 'repo');
    // assert.equal(repo.index.name, this.index.name);

    var key = repo.canonicalName;

    if (this.__clientCache === undefined) {
        this.__clientCache = {};
    }

    if (!this.__clientCache[key]) {
        this.__clientCache[key] = drc.createClientV2({
            maxSchemaVersion: 2,
            repo: repo,
            scheme: this.index.scheme,
            log: this.log,
            insecure: this.insecure
        });
    }
    return this.__clientCache[key];
};


function _importInfoFromV21Manifest(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.dockerManifest, 'opts.dockerManifest');
    assert.object(opts.rat, 'opts.rat');
    assert.func(cb, 'cb');

    var dockerManifest = opts.dockerManifest;
    var imgJson;

    // These digests are backwards (newest to oldest layer), so we reverse
    // them to get the base layer first.
    var layers = dockerManifest.fsLayers.slice();
    layers = layers.reverse();

    var lastDigest;
    var layerDigests = layers.filter(
        // Filter out duplicated layers here - i.e. those layers which are
        // exactly the same as the previous layer, as there is no need to
        // download and install the same layer over and over again. We hit
        // this because v2.1 manifests use an empty bits layer for docker
        // build commands that don't change the image, i.e. for metadata
        // commands like ENV and ENTRYPOINT.
        function _filterLayerDigest(l) {
            if (l.blobSum === lastDigest) {
                return false;
            }
            lastDigest = l.blobSum;
            return true;
        }
    ).map(
        function _mapLayerDigest(l) {
            return l.blobSum;
        }
    );

    try {
        imgJson = JSON.parse(dockerManifest.history[0].v1Compatibility);
    } catch (manifestErr) {
        cb(new errors.ValidationFailedError(manifestErr, format(
            'invalid "v1Compatibility" JSON in docker manifest: %s (%s)',
            manifestErr, dockerManifest.history[0].v1Compatibility)));
        return;
    }

    var rat = opts.rat;
    var importInfo = {
        repo: rat,
        tag: rat.tag,    // the requested tag
        tags: [rat.tag], // all the tags on that imgId
        imgId: layerDigests[layerDigests.length - 1], // newest layer
        imgJson: imgJson,
        dockerManifest: dockerManifest,
        layerDigests: layerDigests,
        uuid: imgmanifest.imgUuidFromDockerDigests(layerDigests)
    };
    cb(null, importInfo);
}


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
        var rat = drc.parseRepoAndTag(opts.arg);
    } catch(e) {
        return cb();
    }
    
    var importInfo;

    var client = self._clientFromRepo(rat);
    client.getManifest({ref: rat.tag}, function (err, dockerManifest, res) {
        if (err) {
            if (err.statusCode === 404) {
                cb();
            } else {
                cb(err);
            }
            return;
        }

        assert.object(dockerManifest, 'manifest');
        if (!dockerManifest.hasOwnProperty('schemaVersion')) {
            cb(new errors.InvalidDockerInfoError(
                'No docker manifest schemaVersion defined'));
            return;
        }

        if (dockerManifest.schemaVersion !== 1
                && dockerManifest.schemaVersion !== 2) {
            cb(new errors.InvalidDockerInfoError(
                'Unsupported docker manifest version: '
                 + dockerManifest.schemaVersion));
            return;
        }

        if (dockerManifest.schemaVersion === 1) {
            _importInfoFromV21Manifest({
                dockerManifest: dockerManifest,
                rat: rat
            }, cb);
            return;
        }

        // For schemaVersion 2 manifests - must fetch the imgJson separately.
        assert.equal(dockerManifest.schemaVersion, 2,
            'dockerManifest.schemaVersion === 2');

        var layerDigests = dockerManifest.layers.map(
            function (l) {
                return l.digest;
            }
        );

        var configDigest = dockerManifest.config.digest;
        client.createBlobReadStream({digest: configDigest},
            function (err, stream, ress) {
                if (err) {
                    cb(err);
                    return;
                }
                stream.pipe(concat(function (buf) {
                    var imgJson;
                    try {
                        imgJson = JSON.parse(buf.toString());
                    } catch (ex) {
                        cb(ex);
                        return;
                    }
    
                    importInfo = {
                        repo: rat,
                        tag: rat.tag,   // the requested tag
                        tags: [rat.tag], // all the tags on that imgId
                        imgId: dockerManifest.layers[dockerManifest.layers.length-1].digest,
                        imgJson: imgJson,
                        dockerManifest: dockerManifest,
                        layerDigests: layerDigests,
                        uuid: imgmanifest.imgUuidFromDockerDigests(layerDigests)
                    };
                    cb(null, importInfo);
                }));
    
                // stream error handling
                stream.on('error', function (err) {
                   console.error('read stream error:', err);
                   cb(err);
                });
    
                stream.resume();
            }
        );
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
    assert.object(opts.dockerManifest, 'opts.dockerManifest');
    assert.object(opts.imgJson, 'opts.imgJson');
    assert.arrayOfString(opts.layerDigests, 'opts.layerDigests');
    assert.func(cb, 'cb');

    var ancestry;
    var digests = opts.layerDigests;
    var imgJson = common.objCopy(opts.imgJson);
    var parentDigest = null;

    ancestry = digests.map(function (digest, idx) {
        imgJson = common.objCopy(imgJson);
        imgJson.parent = parentDigest;
        imgJson.config = common.objCopy(imgJson.config);
        imgJson.config.parent = parentDigest;
        parentDigest = digest;
        var layerDigests = digests.slice(0, idx+1);
        var size = 0;
        if (opts.dockerManifest.schemaVersion === 2) {
            size = opts.dockerManifest.layers[idx].size;
        }
        return {
            imgId: digest,
            imgJson: imgJson,
            layerDigests: layerDigests,
            uuid: imgmanifest.imgUuidFromDockerDigests(layerDigests),
            size: size,
            repo: opts.repo
        };
    });
    cb(null, ancestry);
};


DockerSource.prototype.getImgMeta = function getImgMeta(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.repo, 'opts.repo');
    assert.string(opts.imgId, 'opts.imgId');
    assert.arrayOfString(opts.layerDigests, 'opts.layerDigests');
    assert.optionalArrayOfString(opts.tags, 'opts.tags');
    assert.func(cb, 'cb');

    var imgMeta = {
        manifest: imgmanifest.imgManifestFromDockerInfo({
            layerDigests: opts.layerDigests,
            imgJson: opts.imgJson,
            repo: opts.repo,
            tags: opts.tags,
            uuid: opts.uuid
        })
    };
    cb(null, imgMeta);
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
    client.createBlobReadStream({digest: opts.imgId}, function (err, stream) {
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
