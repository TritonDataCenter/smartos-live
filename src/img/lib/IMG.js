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
 * The no-binary deps node.js interface to `imgadm`.
 *
 * Generally it is preferred that `imgadm` (the CLI) is the promised interface
 * to imgadm. That saves us from node binary module dependencies, which is
 * difficult to manage for compatibility. However, sometimes perf concerns
 * dominate. This IMG.js interface was added for `vmadm` and `vminfod` to
 * use when perf is a concern. The API here is intentionally small and
 * limited.
 */

var p = console.log;
var assert = require('assert-plus');

var Database = require('./database');
var errors = require('./errors');


// ---- the node.js API (intentionally limited and small)

var IMG = {};

/**
 * Quickly (but with limitations and potential false positives) get details
 * (mostly the manifest) on an installed image.
 *
 * This is *similar* to `IMGAPI.prototype.getImage` with these diffs:
 * - It doesn't do `zfs list` which makes it faster.
 * - It doesn't do `zfs list`, which means there can be false positives. The
 *   imgadm database of metadata can be out of sync with zfs datasets.
 *   ZFS is the authority.
 * - It doesn't support the "children" option that `getImage` does.
 */
IMG.quickGetImage = function quickGetImage(opts, cb) {
    assert.object(opts, 'opts');
    assert.uuid(opts.uuid, 'opts.uuid');
    assert.string(opts.zpool, 'opts.zpool');
    assert.optionalObject(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var db = new Database({log: opts.log});
    db.loadImage({zpool: opts.zpool, uuid: opts.uuid}, function (err, img) {
        if (err) {
            cb(err);
        } else if (Object.keys(img.manifest).length === 1) {
            cb(new errors.ImageNotInstalledError(opts.zpool, opts.uuid));
        } else {
            cb(null, img);
        }
    });
};


// ---- exports

module.exports = IMG;
