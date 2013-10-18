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
var assert = require('assert-plus');
var errors = require('./errors');

var NAME = 'imgadm';
var MANIFEST_V = 2;
var DEFAULT_ZPOOL = 'zones';
var DEFAULT_SOURCE = {type: 'imgapi', url: 'https://images.joyent.com'};

var VALID_COMPRESSIONS = ['none', 'bzip2', 'gzip'];


var _versionCache = null;
function getVersion() {
    if (_versionCache === null)
        _versionCache = require('../package.json').version;
    return _versionCache;
}

function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}

/**
 * Merge the second object's keys into the first and return the first.
 *
 * Note: The first given object is modified in-place.
 */
function objMerge(a, b) {
    Object.keys(b).forEach(function (k) {
        a[k] = b[k];
    });
    return a;
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

/**
 * Return a string suitable and convenient for a file name.
 */
var _pathSlugifyString = /[^\w\s\._-]/g;
var _pathSlugifyHyphenate = /[-\s]+/g;
function pathSlugify(s) {
    assert.string(s, 's');
    s = s.replace(_pathSlugifyString, '').trim().toLowerCase();
    s = s.replace(_pathSlugifyHyphenate, '-');
    return s;
}



/**
 * Return an array of manifest fields that differ between the two given
 * image manifests. The 'requirements' object is descended into to give
 * more specific diff info.
 */
function diffManifestFields(a, b) {
    var diffs = [];  // List of field names with diffs.
    Object.keys(b).forEach(function (field) {
        if (field === 'requirements') {
            if (a[field] === undefined) {
                diffs.push(field);
            }
            return;
        }
        if (JSON.stringify(b[field]) !==
            JSON.stringify(a[field])) {
            diffs.push(field);
        }
    });
    Object.keys(a).forEach(function (field) {
        if (b[field] === undefined) {
            diffs.push(field);
        }
    });
    if (b.requirements && a.requirements) {
        Object.keys(b.requirements).forEach(function (field) {
            if (JSON.stringify(b.requirements[field]) !==
                JSON.stringify(a.requirements[field])) {
                diffs.push('requirements.' + field);
            }
        });
        Object.keys(a.requirements).forEach(function (field) {
            if (b.requirements[field] === undefined) {
                diffs.push('requirements.' + field);
            }
        });
    }
    return diffs;
}



// ---- exports

module.exports = {
    NAME: NAME,
    MANIFEST_V: MANIFEST_V,
    DEFAULT_ZPOOL: DEFAULT_ZPOOL,
    DEFAULT_SOURCE: DEFAULT_SOURCE,
    VALID_COMPRESSIONS: VALID_COMPRESSIONS,
    getVersion: getVersion,
    objCopy: objCopy,
    objMerge: objMerge,
    assertUuid: assertUuid,
    boolFromString: boolFromString,
    pathSlugify: pathSlugify,
    diffManifestFields: diffManifestFields
};
