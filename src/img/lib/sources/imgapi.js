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
 */

var p = console.log;

var assert = require('assert-plus');
var imgapi = require('sdc-clients/lib/imgapi');
var imgmanifest = require('imgmanifest');
var util = require('util');
var vasync = require('vasync');

var common = require('../common');
var errors = require('../errors');
var Source = require('./source');


// ---- imgapi source

function ImgapiSource(opts) {
    var self = this;

    this.__defineGetter__('client', function () {
        if (this._client === undefined) {
            this._client = imgapi.createClient({
                url: self.normUrl,
                version: '~2',
                log: self.log,
                rejectUnauthorized: (process.env.IMGADM_INSECURE !== '1'),
                userAgent: self.userAgent
            });
        }
        return this._client;
    });

    Source.call(this, opts);
}
util.inherits(ImgapiSource, Source);

ImgapiSource.prototype.type = 'imgapi';

ImgapiSource.prototype.ping = function ping(cb) {
    var self = this;
    this.client.ping(function (err, pong, res) {
        if (err || res.statusCode !== 200 || !pong.imgapi) {
            if (res && res.headers['content-type'] !== 'application/json') {
                var body = res.body;
                if (body && body.length > 1024) {
                    body = body.slice(0, 1024) + '...';
                }
                err = new Error(format(
                    'statusCode %s, response not JSON:\n%s',
                    res.statusCode, common.indent(body)));
            }
            cb(new errors.SourcePingError(err, self));
            return;
        }
        cb();
    });
};


ImgapiSource.prototype.listImages = function listImages(cb) {
    var self = this;
    assert.func(cb, 'cb');

    self.client.listImages({}, function (err, images) {
        if (err) {
            cb(self._errorFromClientError(err));
            return;
        }
        cb(null, images);
    });
};


/**
 * This source includes the `manifest` on the returned `importInfo` because
 * the manifest is returned with the endpoint used to find the image.
 */
ImgapiSource.prototype.getImportInfo = function getImportInfo(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.arg, 'opts.arg');
    assert.bool(opts.ensureActive, 'opts.ensureActive');
    assert.optionalBool(opts.errOn404, 'opts.errOn404');
    assert.func(cb, 'cb');

    // By default we do *not* error on a 404 from the server.
    var errOn404 = (opts.errOn404 !== undefined ? opts.errOn404 : false);

    // This can be called with non-docker import ids (e.g. a Docker repo:tag).
    // Just return empty to indicate N/A.
    if (! common.UUID_RE.test(opts.arg)) {
        return cb();
    }

    var importInfo = null;
    self.client.getImage(opts.arg, function (err, manifest) {
        if (err) {
            if (err.statusCode !== 404 || errOn404) {
                cb(err);
                return;
            }
        }
        if (manifest) {
            if (opts.ensureActive) {
                try {
                    manifest = imgmanifest.upgradeManifest(manifest);
                } catch (err) {
                    cb(new errors.InvalidManifestError(err));
                    return;
                }
            }
            if (!opts.ensureActive || manifest.state === 'active') {
                importInfo = {
                    uuid: manifest.uuid,
                    manifest: manifest
                };
            }
        }
        cb(null, importInfo);
    });
};

ImgapiSource.prototype.titleFromImportInfo =
function titleFromImportInfo(importInfo) {
    return util.format('%s (%s@%s)', importInfo.manifest.uuid,
        importInfo.manifest.name, importInfo.manifest.version);
};

ImgapiSource.prototype.getImgMeta = function getImgMeta(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.manifest, 'opts.manifest');
    assert.func(cb, 'cb');

    var imgMeta;

    if (opts.manifest) {
        imgMeta = {
            manifest: opts.manifest
        };
        if (opts.manifest.files && opts.manifest.files[0]) {
            imgMeta.size = opts.manifest.files[0].size;
            if (opts.manifest.files[0].sha1) {
                imgMeta.checksum = 'sha1:' + opts.manifest.files[0].sha1;
            }
        }
        cb(null, imgMeta);
        return;
    }

    self.client.getImage(opts.uuid, function (err, manifest) {
        if (err) {
            cb(err);
            return;
        }
        imgMeta = {
            manifest: opts.manifest
        };
        if (opts.manifest.files && opts.manifest.files[0]) {
            imgMeta.size = opts.manifest.files[0].size;
            if (opts.manifest.files[0].sha1) {
                imgMeta.checksum = 'sha1:' + opts.manifest.files[0].sha1;
            }
        }
        cb(null, imgMeta);
    });
};


ImgapiSource.prototype.getImgAncestry = function getImgAncestry(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.object(opts.manifest, 'opts.manifest');
    assert.func(cb, 'cb');

    var ancestry = [
        {
            uuid: opts.uuid,
            manifest: opts.manifest
        }
    ];

    // Early out.
    if (!opts.manifest.origin) {
        cb(null, ancestry);
        return;
    }

    // Keep getting origin until we hit the base (manifest with no origin).
    getNextOrigin(opts.manifest.origin);

    function getNextOrigin(uuid) {
        var iOpts = {
            arg: uuid,
            ensureActive: true,
            errOn404: true
        };
        self.getImportInfo(iOpts, function (err, importInfo) {
            if (err) {
                cb(err);
            } else {
                ancestry.push(importInfo);
                if (importInfo.manifest.origin) {
                    getNextOrigin(importInfo.manifest.origin);
                } else {
                    cb(null, ancestry);
                }
            }
        });
    }
};



/**
 * Get a ReadableStream for the given image file.
 *
 * @param opts {Object} Source-specific details on the image. This
 *      is meant to work if passed either:
 *      - the `importInfo` result of `getImportInfo`, or
 *      - an element of the ancestry array returned by `getImgAncestry`.
 * @param cb {Function} `function (err, stream)`
 */
ImgapiSource.prototype.getImgFileStream = function getImgFileStream(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.func(cb, 'cb');

    this.client.getImageFileStream(opts.uuid, cb);
};


module.exports = ImgapiSource;
