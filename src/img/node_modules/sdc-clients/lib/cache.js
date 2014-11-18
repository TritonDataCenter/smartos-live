/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert');

var LRU = require('lru-cache');



// --- API

function Cache(options) {
    if (typeof (options) !== 'object')
        throw new TypeError('options (object) required');

    this._cache = LRU(options.size || 1000);
    this._age = (options.age || 60) * 1000;

    var self = this;
    this.__defineGetter__('age', function () { return self._age / 1000; });
    this.__defineSetter__('age', function (a) {
        self._age = a * 1000;
    });
}


Cache.prototype.get = function (key) {
    assert.ok(key);

    var entry = this._cache.get(key);
    if (!entry)
        return null;

    var now = new Date();
    if ((now.getTime() - entry.ctime) > this._age)
        return null;

    return entry.value;
};


Cache.prototype.put = function (key, value) {
    assert.ok(key);

    var entry = {
        ctime: new Date().getTime(),
        value: value
    };

    this._cache.set(key, entry);
    return value;
};



// --- Exports

module.exports = {

    createCache: function (options) {
        return new Cache(options || {});
    },

    Cache: Cache

};
