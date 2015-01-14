/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Docker Registry API client. See the README for an intro.
 * <https://docs.docker.com/reference/api/registry_api/>
 * <https://docs.docker.com/reference/api/hub_registry_spec/>
 */

var p = console.log;

var assert = require('assert-plus');
var bunyan = require('bunyan');
var fmt = require('util').format;
var mod_url = require('url');
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');

var index_client = require('./index-client');
var common = require('./common');



// --- Globals

var REGISTRY_URL = 'https://registry-1.docker.io';


// --- internal support stuff

/**
 * Note: Borrowed from muskie.git/lib/common.js around node 0.8 days.
 * I think I'm living in the past in still using this. TODO: investigate
 * dropping this in favour of 'non-flowing' mode stream usage with node 0.10+.
 */
function pauseStream(stream) {
    function _buffer(chunk) {
        stream.__buffered.push(chunk);
    }

    function _catchEnd(chunk) {
        stream.__dockerreg_ended = true;
    }

    stream.__dockerreg_ended = false;
    stream.__dockerreg_paused = true;
    stream.__buffered = [];
    stream.on('data', _buffer);
    stream.once('end', _catchEnd);
    stream.pause();

    stream._resume = stream.resume;
    stream.resume = function _dockerreg_resume() {
        if (!stream.__dockerreg_paused)
            return;

        stream.removeListener('data', _buffer);
        stream.removeListener('end', _catchEnd);

        stream.__buffered.forEach(stream.emit.bind(stream, 'data'));
        stream.__buffered.length = 0;

        stream._resume();
        stream.resume = stream._resume;

        if (stream.__dockerreg_ended)
            stream.emit('end');
    };
}



// --- RegistryClient

function RegistryClient(opts) {
    assert.optionalObject(opts, 'opts');
    opts = opts || {};
    assert.optionalString(opts.url, 'opts.url');
    assert.optionalObject(opts.log, 'opts.log');

    this.log = opts.log
        ? opts.log.child({
                component: 'registry-client',
                serializers: restify.bunyan.serializers
            })
        : bunyan.createLogger({
                name: 'registry-client',
                serializers: restify.bunyan.serializers
            });
    this.url = opts.url || REGISTRY_URL;

    // TODO add passing through other restify options: agent, userAgent, ...
    this.client = restify.createJsonClient({
        url: this.url,
        log: this.log
    });
}

/**
 * <https://docs.docker.com/reference/api/registry_api/#status>
 */
RegistryClient.prototype.getStatus = function getStatus(cb) {
    assert.func(cb, 'cb');

    this.client.get({
        path: '/v1/_ping'
    }, function _afterGetStatus(err, req, res, obj) {
        if (err) {
            return cb(err);
        }
        return cb(null, obj, res);
    });
};



// --- RegistrySession
// AFAIK it could be useful to call `getStatus` on the registry endpoint
// setup via `createRegistrySession`, so we'll subclass `RegistryClient`
// to inherit those methods.

function RegistrySession(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.token, 'opts.token');
    assert.string(opts.repo, 'opts.repo');

    this.repo = opts.repo;
    var parsed = common.strictParseRepo(opts.repo);
    this.encodedRepo = fmt('%s/%s', encodeURIComponent(parsed.ns),
        encodeURIComponent(parsed.name));
    this.headers = {
        Authorization: 'Token ' + opts.token
    };

    RegistryClient.apply(this, opts);
}
util.inherits(RegistrySession, RegistryClient);



/**
 * <https://docs.docker.com/reference/api/registry_api/#list-repository-tags>
 */
RegistrySession.prototype.listRepoTags = function listRepoTags(cb) {
    assert.func(cb, 'cb');

    this.client.get({
        path: fmt('/v1/repositories/%s/tags', this.encodedRepo),
        headers: this.headers
    }, function _afterListRepoTags(err, req, res, repoTags) {
        if (err) {
            return cb(err);
        }
        return cb(null, repoTags, res);
    });
};


/**
 * // JSSTYLED
 * <https://docs.docker.com/reference/api/registry_api/#get-image-id-for-a-particular-tag>
 */
RegistrySession.prototype.getImgId = function getImgId(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.tag, 'opts.tag');
    assert.func(cb, 'cb');

    this.client.get({
        path: fmt('/v1/repositories/%s/tags/%s',
            this.encodedRepo, encodeURIComponent(opts.tag)),
        headers: this.headers
    }, function _afterGetImgId(err, req, res, imgId) {
        if (err) {
            return cb(err);
        }
        return cb(null, imgId, res);
    });
};


/**
 * Gets the image's ancestry: all of the image layers that are required for
 * it to be functional.
 */
RegistrySession.prototype.getImgAncestry = function getImgAncestry(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    this.client.get({
        path: fmt('/v1/images/%s/ancestry', encodeURIComponent(opts.imgId)),
        headers: this.headers
    }, function _afterGetImgAncestry(err, req, res, ancestry) {
        if (err) {
            return cb(err);
        }
        return cb(null, ancestry, res);
    });
};


/**
 * Gets the image's JSON (i.e. its metadata).
 * Though a poor name, IMHO, docker.git/registry/session.go calls it the image
 * "JSON".
 *
 * Note: There is a possibly interesting header:
 *      X-Docker-Size: 456789
 *
 * Note: There is also **occassionally** this header:
 *      X-Docker-Payload-Checksum: sha256:490b550231696db...bd028fa98250b54b
 * However, IME, it is not always defined and the returned content from
 * `getImgLayerStream` doesn't match as expected. As well, the `docker` CLI
 * doesn't seem to be checking this value, so we'll ignore it here for now
 * as well.
 *
 * The response is returned in the callback, so you can get the size header
 * like this:
 *
 *      sess.getImgJson({imgId: '...'}, function (err, imgJson, res) {
 *          console.log('size:', res.headers['x-docker-size']);
 *      });
 */
RegistrySession.prototype.getImgJson = function getImgJson(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    this.client.get({
        path: fmt('/v1/images/%s/json', encodeURIComponent(opts.imgId)),
        headers: this.headers
    }, function _afterGetImgJson(err, req, res, imgJson) {
        if (err) {
            return cb(err);
        }
        cb(null, imgJson, res);
    });
};


/**
 * Get a (paused) readable stream to the given image's layer.
 *
 * Possible usage:
 *
 *      sess.getImgLayerStream({imgId: '...'}, function (err, stream) {
 *          var fout = fs.createWriteStream('/var/tmp/layer.file');
 *          fout.on('finish', function () {
 *              console.log('Done downloading image layer');
 *          });
 *
 *          stream.pipe(fout);
 *          stream.resume();
 *      });
 *
 * @param opts {Object}
 *      - imgId {String}
 * @param cb {Function} `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
RegistrySession.prototype.getImgLayerStream =
function getImgLayerStream(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.imgId, 'opts.imgId');
    assert.func(cb, 'cb');

    // We want a non-redirect (i.e. non-3xx) response to return. Use a
    // barrier to gate that.
    var nonRedirRes;
    var barrier = vasync.barrier();
    barrier.on('drain', function _onGetNonRedirResult() {
        self.log.trace({res: nonRedirRes, imgId: opts.imgId},
            'got a non-redir response');
        pauseStream(nonRedirRes); // living in the past (node 0.8)
        cb(null, nonRedirRes);
    });

    var MAX_NUM_REDIRS = 3;
    var numRedirs = 0;

    barrier.start('nonRedirRes');
    makeReq({
        url: self.url,
        path: fmt('/v1/images/%s/layer', encodeURIComponent(opts.imgId)),
        headers: self.headers
    });

    function makeReq(reqOpts) {
        if (numRedirs >= MAX_NUM_REDIRS) {
            cb(new Error(fmt('maximum number of redirects (%s) hit when '
                + 'attempt to get image layer stream for image %s',
                MAX_NUM_REDIRS, opts.imgId)));
            return;
        }
        numRedirs += 1;

        var client = restify.createHttpClient({
            url: reqOpts.url,
            log: self.log,
            agent: false
        });
        client.get(reqOpts, function _onConn(connErr, req) {
            if (connErr) {
                cb(connErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    cb(resultErr);
                    return;
                }
                if (res.statusCode === 302) {
                    var loc = mod_url.parse(res.headers.location);
                    makeReq({
                        url: loc.protocol + '//' + loc.host,
                        path: loc.path
                    });
                } else {
                    nonRedirRes = res;
                    barrier.done('nonRedirRes');
                }
            });
        });
    }
};



// --- Exports

function createRegistryClient(opts) {
    return new RegistryClient(opts);
}

/**
 * Hit the Index API to get an auth token for the given repo, then create
 * a `RegistrySession` instance using that token.
 */
function createRegistrySession(opts, cb) {
    assert.object(opts, 'opts');
    assert.string(opts.repo, 'opts.repo');
    assert.optionalObject(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var idx = index_client.createIndexClient({log: opts.log});
    idx.getRepoAuth({repo: opts.repo}, function (err, repoAuth) {
        if (err) {
            cb(err);
        } else {
            var sess = new RegistrySession({
                token: repoAuth.token,
                // Randomize this at some point? For now the world only ever
                // returns one registry endpoint.
                url: repoAuth.registries[0],
                repo: opts.repo,
                log: opts.log
            });
            // See discussion on `index-client.getRepoAuth` for why `repoImgs`
            // are included.
            cb(null, sess, repoAuth.repoImgs);
        }
    });
}

module.exports = {
    createRegistryClient: createRegistryClient,
    createRegistrySession: createRegistrySession
};
