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
 *
 * fwadm: shared object logic
 */



// --- Exports



/**
 * Adds to a 3-level deep object
 */
function addToObj3(hash, key1, key2, key3, obj) {
    if (!hash.hasOwnProperty(key1)) {
        hash[key1] = {};
    }
    if (!hash[key1].hasOwnProperty(key2)) {
        hash[key1][key2] = {};
    }
    if (!hash[key1][key2].hasOwnProperty(key3)) {
        hash[key1][key2][key3] = obj;
    }
}


/**
 * Creates a nested set of objects based on the argument names, like:
 *     args[0] = { args[1]: { args[2]: {} } }
 * If the last argument is an object, use that instead of an empty object
 * for the value of the most deeply nested object.
 */
function createSubObjects() {
    var h = arguments[0];
    var prev = {};
    for (var i = 1; i < arguments.length; i++) {
        if (typeof (arguments[i]) === 'object') {
            prev[arguments[i - 1]] = arguments[i];
            return;
        }

        if (!h.hasOwnProperty(arguments[i])) {
            h[arguments[i]] = {};
        }
        prev = h;
        h = h[arguments[i]];
    }
    return h;
}


/**
 * For object obj, calls callback(key, val)
 */
function forEachKey(obj, callback) {
    for (var key in obj) {
        callback(key, obj[key]);
    }
}


/**
 * Returns true if the object is an array
 */
function isArray(obj) {
    if (typeof (obj) == 'object' && obj.hasOwnProperty('length')) {
        return true;
    }

    return false;
}


/**
 * Merges two objects based on their keys and returns the result. In a key
 * conflict, obj1 wins.
 */
function mergeObjects(obj1, obj2) {
    var newObj = {};
    [obj2, obj1].forEach(function (h) {
        for (var k in h) {
            newObj[k] = h[k];
        }
    });
    return newObj;
}


/**
 * Returns true if the object has no keys
 */
function objEmpty(obj) {
    /* JSSTYLED */
    /*jsl:ignore*/
    for (var k in obj) {
        return false;
    }
    /* JSSTYLED */
    /*jsl:end*/

    return true;
}



module.exports = {
    addToObj3: addToObj3,
    createSubObjects: createSubObjects,
    forEachKey: forEachKey,
    isArray: isArray,
    mergeObjects: mergeObjects,
    objEmpty: objEmpty
};
