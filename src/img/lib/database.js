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

/*
 * The interface to the imgadm "database" under "/var/imgadm" (excepting
 * the "/var/imgadm/imgadm.conf" config file).
 */

var p = console.log;

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');

var common = require('./common');



// ---- internal support stuff

function Database(opts) {
    assert.optionalObject(opts, 'opts');
    if (!opts)
        opts = {};
    assert.optionalObject(opts.log, 'opts.log');

    this.log = opts.log;
}

Database.prototype._dbImagePath = function _dbImagePath(zpool, uuid) {
    return path.resolve(common.DB_DIR, 'images', zpool + '-' + uuid + '.json');
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
 * @param opts {Object}:
 *      - @param uuid {String}
 *      - @param zpool {String}
 * @param cb {Function} `function (err, imageInfo)`
 */
Database.prototype.loadImage = function loadImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.uuid, 'opts.uuid');
    assert.string(opts.zpool, 'opts.zpool');
    assert.func(cb, 'cb');

    var dbImagePath = self._dbImagePath(opts.zpool, opts.uuid);
    fs.readFile(dbImagePath, 'utf8', function (err, content) {
        var info = null;
        if (!err) {
            try {
                info = JSON.parse(content);
            } catch (synErr) {
                if (self.log) {
                    self.log.debug(synErr, 'corrupt "%s"', dbImagePath);
                }
            }
            assert.equal(info.manifest.uuid, opts.uuid, format(
                'UUID for image in "%s" is wrong', dbImagePath));
        }
        if (!info) {
            info = {manifest: {uuid: opts.uuid}, zpool: opts.zpool};
        }
        cb(null, info);
    });
};


/**
 * Delete image info for this image from the imgadm db.
 *
 * @param opts {Object}:
 *      - @param uuid {String}
 *      - @param zpool {String}
 * @param cb {Function} `function (err)`  It is *not* an error if the
 *      db image file does not exist (imgadm supports handling images that
 *      aren't in the imgadm db).
 */
Database.prototype.deleteImage = function deleteImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.uuid(opts.uuid, 'opts.uuid');
    assert.string(opts.zpool, 'opts.zpool');
    assert.func(cb, 'cb');

    var dbImagePath = self._dbImagePath(opts.zpool, opts.uuid);
    fs.exists(dbImagePath, function (exists) {
        if (!exists) {
            cb();
            return;
        } else {
            fs.unlink(dbImagePath, cb);
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
 * @param cb {Function} `function (err)`
 */
Database.prototype.addImage = function addImage(imageInfo, cb) {
    var self = this;
    assert.object(imageInfo, 'imageInfo');
    assert.object(imageInfo.manifest, 'imageInfo.manifest');
    assert.string(imageInfo.zpool, 'imageInfo.zpool');
    assert.optionalObject(imageInfo.source, 'imageInfo.source');

    var dbImagePath = self._dbImagePath(imageInfo.zpool,
                                        imageInfo.manifest.uuid);
    var dbImageDir = path.dirname(dbImagePath);
    mkdirp(dbImageDir, function (dirErr) {
        if (dirErr) {
            cb(dirErr);
            return;
        }
        var dbData = {
            manifest: imageInfo.manifest,
            zpool: imageInfo.zpool,
            source: (imageInfo.source ? imageInfo.source.url : undefined)
        };
        var content = JSON.stringify(dbData, null, 2) + '\n';
        fs.writeFile(dbImagePath, content, 'utf8', cb);
    });
};



// ---- exports

module.exports = Database;
