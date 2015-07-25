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
 */

var assert = require('assert-plus');
var format = require('util').format;

var common = require('../common');
var errors = require('../errors');



// ---- Source interface

function Source(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.url, 'opts.url');
    assert.optionalBool(opts.insecure, 'opts.insecure');
    assert.object(opts.log, 'opts.log');
    assert.string(opts.userAgent, 'opts.userAgent');

    this.log = opts.log.child({
        component: 'source',
        source: {type: this.type, url: this.url, insecure: opts.insecure}
    }, true);
    this.url = opts.url;
    this.insecure = opts.insecure;
    this.normUrl = common.normUrlFromUrl(this.url);
    this.userAgent = opts.userAgent;
}

/**
 * Currently this is a convenience for *logging* a `Source` object, rather than
 * a roundtripping serialization.
 */
Source.prototype.toJSON = function toJSON() {
    return {type: this.type, url: this.url, insecure: this.insecure};
};

Source.prototype.toString = function toString() {
    var extra = (this.insecure ? ' (insecure)' : '');
    return format('"%s" image source "%s"%s',
        this.type, this.url, extra);
};


Source.prototype._errorFromClientError = function _errorFromClientError(err) {
    assert.object(err, 'err');
    if (err.body && err.body.code) {
        return new errors.APIError(this.url, err);
    } else if (err.errno) {
        return new errors.ClientError(this.url, err);
    } else {
        return new errors.InternalError({message: err.message,
            clientUrl: this.url, cause: err});
    }
};


/**
 * Ping the source service. Return an error if the service isn't functional.
 *
 * @param cb {Function} `function (err)`
 */
Source.prototype.ping = function ping(cb) {
    throw new Error('not implemented');
};


/**
 * List all images in this repo.
 * Note: DockerSource doesn't implement this.
 *
 * @param cb {Function} `function (err, images)`
 */
Source.prototype.listImages = function listImages(cb) {
    throw new Error('not implemented');
};


/**
 * Get the info necessary to import the image identified by `arg`, if present
 * in this source.
 *
 * @param opts {Object}
 *      - arg {String} The source-specific allowed import argument string.
 * @param cb {Function} `function (err, importInfo)`. If a matching image is
 *      not found in this source, then null values for both are returned.
 *      For an `arg` that is inapplicable for the given source (e.g. an IMGAPI
 *      UUID for a "docker" source), which will return `null` to indicate N/A.
 *
 *  importInfo = {
 *      // Required
 *      "uuid": "<uuid>",
 *
 *      // Sources-specific fields, as required by `getImgAncestry`,
 *      // `getImgMeta`.
 *      "manifest": {...},    // included by 'imgapi', 'dsapi'
 *      ...
 *  }
 */
Source.prototype.getImportInfo = function getImportInfo(opts, cb) {
    throw new Error('not implemented');
};


/**
 * Return a short title string for the given image. Synchronous.
 */
Source.prototype.titleFromImportInfo =
function titleFromImportInfo(importInfo) {
    throw new Error('not implemented');
};


/**
 * Gather the ancestry of this image, i.e. the ordered array of image ids
 * from top (this image) to bottom (the base non-incremental image).
 *
 * @param opts {Object} Source-specific details on the image to import. This
 *      is meant to work if passed the `importInfo` result of `getImportInfo`.
 * @param cb {Function} `function (err, ancestry)`
 *      where `ancestry` is an array of objects where each object has:
 *      - a image `uuid` field
 *      - whatever fields are required by `getImgMeta`
 *
 *  ancestry = [
 *      {
 *          "uuid": "<uuid>",
 *          // other Source-specific fields required by `getImgMeta`
 *          ...
 *      },
 *      ...
 *  ]
 */
Source.prototype.getImgAncestry = function getImgAncestry(opts, cb) {
    throw new Error('not implemented');
};


/**
 * Get metadata (including the manifest, and any other useful information
 * for download and install) for the given image.
 *
 * @param opts {Object} Source-specific details on the image to import. This
 *      is meant to work if passed either:
 *      - the `importInfo` result of `getImportInfo`, or
 *      - an element of the ancestry array returned by `getImgAncestry`.
 * @param cb {Function} `function (err, imgMeta)` where `imgMeta` includes the
 *      following fields, plus any optional source-specific fields:
 *
 *  imgMeta = {
 *      // Required:
 *      "manifest": {...},
 *
 *      // Optional:
 *      "size": <size-of-the-file-in-bytes>,
 *      "checksum": "<file checksum in the format TYPE:HEXDIGEST,
 *          e.g. 'sha256:23498af90e8g9...'>",
 *
 *      // Optional extra source-specific fields:
 *      ...
 *  }
 */
Source.prototype.getImgMeta = function getImgMeta(opts, cb) {
    throw new Error('not implemented');
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
Source.prototype.getImgFileStream = function getImgFileStream(opts, cb) {
    throw new Error('not implemented');
};


module.exports = Source;
