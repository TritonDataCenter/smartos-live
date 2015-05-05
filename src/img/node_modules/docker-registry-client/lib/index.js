/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

var assert = require('assert-plus');
var fmt = require('util').format;
var restify = require('restify');

var common = require('./common');
var reg1 = require('./registry-client-v1');



/**
 * Ping a given Docker *index* URL (as opposed to a registry that requires
 * a repo name).
 */
function pingIndex(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.indexName, 'opts.indexName');
    assert.optionalBool(opts.insecure, 'opts.insecure');
    assert.optionalObject(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var index = common.parseIndex(opts.indexName);
    var client = restify.createJsonClient({
        url: common.urlFromIndex(index),
        log: opts.log,
        agent: false,
        rejectUnauthorized: !opts.insecure
    });

    client.get({
        path: '/v1/_ping'
    }, function _afterPing(err, req, res, obj) {
        if (err) {
            return cb(err);
        }
        return cb(null, obj, res);
    });
}


// --- exports

module.exports = {
    pingIndex: pingIndex,
    createClient: reg1.createClient,

    DEFAULT_INDEX_NAME: common.DEFAULT_INDEX_NAME,
    DEFAULT_TAG: common.DEFAULT_TAG,
    parseRepo: common.parseRepo,
    parseIndex: common.parseIndex,
    parseRepoAndTag: common.parseRepoAndTag
};
