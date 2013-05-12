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
 * Dump for shared stuff for this package.
 */

var format = require('util').format;
var errors = require('./errors');


var NAME = 'imgadm';
var DEFAULT_ZPOOL = 'zones';
var DEFAULT_SOURCE = {type: 'imgapi', url: 'https://images.joyent.com'};


var _versionCache = null;
function getVersion() {
    if (_versionCache === null)
        _versionCache = require('../package.json').version;
    return _versionCache;
}

function objCopy(obj) {
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return copy;
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function assertUuid(uuid) {
    if (!UUID_RE.test(uuid)) {
        throw new errors.InvalidUUIDError(uuid);
    }
}


/**
 * Convert a boolean or string representation into a boolean, or raise
 * TypeError trying.
 *
 * @param value {Boolean|String} The input value to convert.
 * @param default_ {Boolean} The default value is `value` is undefined.
 * @param errName {String} The name to include in the possibly
 *      raised TypeError.
 */
function boolFromString(value, default_, errName) {
    if (value === undefined) {
        return default_;
    } else if (value === 'false' || value === 'no') {
        return false;
    } else if (value === 'true' || value === 'yes') {
        return true;
    } else if (typeof (value) === 'boolean') {
        return value;
    } else {
        throw new TypeError(
            format('invalid value for %s: %j', errName, value));
    }
}



// ---- exports

module.exports = {
    NAME: NAME,
    DEFAULT_ZPOOL: DEFAULT_ZPOOL,
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    getVersion: getVersion,
    objCopy: objCopy,
    assertUuid: assertUuid,
    boolFromString: boolFromString
};
