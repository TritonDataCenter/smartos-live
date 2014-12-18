/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Docker Index API client. See the README for an intro.
 * <https://docs.docker.com/reference/api/docker-io_api/>
 * <https://docs.docker.com/reference/api/hub_registry_spec/>
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var fmt = require('util').format;
var mod_url = require('url');
var restify = require('restify');

var common = require('./common');



// --- Globals

var INDEX_URL = 'https://index.docker.io';



// --- IndexClient

function IndexClient(opts) {
    assert.optionalObject(opts, 'opts');
    opts = opts || {};
    assert.optionalString(opts.url, 'opts.url');
    assert.optionalObject(opts.log, 'opts.log');

    this.log = opts.log
        ? opts.log.child({
                component: 'index-client',
                serializers: restify.bunyan.serializers
            })
        : bunyan.createLogger({
                name: 'index-client',
                serializers: restify.bunyan.serializers
            });
    this.url = opts.url || INDEX_URL;

    // TODO add passing through other restify options: agent, userAgent, ...
    this.client = restify.createJsonClient({
        url: this.url,
        log: this.log
    });
}


/**
 * List images in the given repository.
 *
 * Note: This same endpoint is typically used to get a registry auth token and
 * endpoint URL. See the `getRepoAuth` method for sugar that handles this.
 */
IndexClient.prototype.listRepoImgs = function listRepoImgs(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.repo, 'opts.repo');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var parsed = common.strictParseRepo(opts.repo);
    var encodedRepo = fmt('%s/%s', encodeURIComponent(parsed.ns),
        encodeURIComponent(parsed.name));

    this.client.get({
        path: fmt('/v1/repositories/%s/images', encodedRepo),
        headers: opts.headers
    }, function _afterListRepoImgs(err, req, res, repoImgs) {
        if (err) {
            cb(err);
        } else {
            cb(null, repoImgs, res);
        }
    });
};


/**
 * Get repo auth to start a registry session.
 *
 * Getting repo auth involves hitting the `listRepoImgs` endpoint, at least
 * currently, to get a 'X-Docker-Token' header. While the *body* of that
 * response is not the goal, it *can* provide useful information: some
 * more recent images include a checksum that can be useful for later
 * downloads, e.g. this extract for the busybox repo:
 *
 *      {
 *          "checksum": "tarsum+sha256:32abf29cb55c24e05ae534...117b0f44c98518",
 *          "id": "a943c4969b70574bb546a26bb28dc880...878f6e61be553de0aee1e61"
 *      },
 *
 * Therefore, we pass back `repoImgs`. If getting auth eventually
 * moves to a separate endpoint, this may go away.
 */
IndexClient.prototype.getRepoAuth = function getRepoAuth(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.repo, 'opts.repo');
    assert.func(cb, 'cb');

    this.listRepoImgs({
        repo: opts.repo,
        headers: {
            'X-Docker-Token': true
        }
    }, function (err, repoImgs, res) {
        if (err) {
            cb(err);
        } else {
            var registries;
            if (res.headers['x-docker-endpoints'] !== undefined) {
                var proto = mod_url.parse(self.url).protocol;
                /*JSSTYLED*/
                registries = res.headers['x-docker-endpoints'].split(/\s*,\s*/g)
                    .map(function (e) { return proto + '//' + e; });
            }
            cb(null, {
                token: res.headers['x-docker-token'],
                registries: registries,
                repoImgs: repoImgs
            }, res);
        }
    });
};


/**
 * Search for images in the docker index
 */
IndexClient.prototype.search = function search(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.term, 'opts.term');
    assert.func(cb, 'cb');

    this.client.get({
        path: '/v1/search',
        query: { q: opts.term },
        headers: {
            'X-Docker-Token': true
        }
    }, function _afterSearch(err, req, res, images) {
        if (err) {
            cb(err);
        } else {
            cb(null, images, res);
        }
    });
};


// --- Exports

function createIndexClient(opts) {
    return new IndexClient(opts);
}

module.exports = {
    createIndexClient: createIndexClient
};
