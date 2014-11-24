/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Client library for the SDC Image API (IMGAPI).
 *
 * Usage without auth (e.g. when talking to in-SDC IMGAPI on admin network):
 *
 *      var imgapi = require('sdc-clients/lib/imgapi');
 *      var client = imgapi.createClient({url: <URL>});
 *      client.ping(function (err, pong, res) { ... });
 *
 * Usage with HTTP Basic auth (no current IMGAPI deploys using this):
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          user: <USERNAME>,
 *          password: <PASSWORD>
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * Usage with HTTP-Signature auth (e.g. https://images.joyent.com -- however
 * GETs to images.joyent.com don't require auth):
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          user: <USERNAME>,
 *          log: <BUNYAN-LOGGER>,
 *          sign: imgapi.cliSigner({
 *              keyId: <KEY-ID>,        // ssh fingerprint, priv key path
 *              user: <USERNAME>,
 *              log: <BUNYAN-LOGGER>,
 *          })
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * For IMGAPIs that support channels -- separate buckets for images -- you
 * can specify the channel in the constructor as a separate field:
 *
 *      var client = imgapi.createClient({
 *          url: <URL>,
 *          channel: <CHANNEL>
 *          ...
 *      });
 *
 * or as a query param on the `url`, e.g.
 * <https://updates.joyent.com?channel=staging>.
 */

var p = console.log;
var util = require('util'),
    format = util.format;
var qs = require('querystring');
var fs = require('fs');
var crypto = require('crypto');
var vasync = require('vasync');
var async = require('async');
var once = require('once');
var WError = require('verror').WError;
var assert = require('assert-plus');
var restify = require('restify');
var SSHAgentClient = require('ssh-agent');
var mod_url = require('url');



// ---- globals

var nodeVer = process.versions.node.split('.').map(Number);
var writeStreamFinishEvent = 'finish';
if (nodeVer[0] === 0 && nodeVer[1] <= 8) {
    writeStreamFinishEvent = 'close';
}


// ---- client errors

function ChecksumError(cause, actual, expected) {
    this.code = 'ChecksumError';
    if (expected === undefined) {
        expected = actual;
        actual = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(actual);
    assert.string(expected);

    var args = [];
    if (cause) args.push(cause);
    args = args.concat('content-md5 expected to be %s, but was %s',
        expected, actual);
    WError.apply(this, args);
}
util.inherits(ChecksumError, WError);

/**
 * An error signing a request.
 */
function SigningError(cause) {
    this.code = 'SigningError';
    assert.optionalObject(cause);
    var msg = 'error signing request';
    var args = (cause ? [cause, msg] : [msg]);
    WError.apply(this, args);
}
util.inherits(SigningError, WError);




// ---- internal support stuff

function BunyanNoopLogger() {}
BunyanNoopLogger.prototype.trace = function () {};
BunyanNoopLogger.prototype.debug = function () {};
BunyanNoopLogger.prototype.info = function () {};
BunyanNoopLogger.prototype.warn = function () {};
BunyanNoopLogger.prototype.error = function () {};
BunyanNoopLogger.prototype.fatal = function () {};
BunyanNoopLogger.prototype.child = function () { return this; };
BunyanNoopLogger.prototype.end = function () {};


/**
 * Note: Borrowed from muskie.git/lib/common.js. The hope is that this hack
 * will no longer be necessary in node 0.10.x.
 *
 * This is so shitty...
 * Node makes no guarantees it won't emit. Even if you call pause.
 * So basically, we buffer whatever chunks it decides it wanted to
 * throw at us. Later we go ahead and remove the listener we setup
 * to buffer, and then re-emit.
 */
function pauseStream(stream) {
    function _buffer(chunk) {
        stream.__buffered.push(chunk);
    }

    function _catchEnd(chunk) {
        stream.__imgapi_ended = true;
    }

    stream.__imgapi_ended = false;
    stream.__imgapi_paused = true;
    stream.__buffered = [];
    stream.on('data', _buffer);
    stream.once('end', _catchEnd);
    stream.pause();

    stream._resume = stream.resume;
    stream.resume = function _imgapi_resume() {
        if (!stream.__imgapi_paused)
            return;

        stream.removeListener('data', _buffer);
        stream.removeListener('end', _catchEnd);

        stream.__buffered.forEach(stream.emit.bind(stream, 'data'));
        stream.__buffered.length = 0;

        stream._resume();
        stream.resume = stream._resume;

        if (stream.__imgapi_ended)
            stream.emit('end');
    };
}


function extendErrFromRawBody(err, res, callback) {
    if (!res) {
        callback(err);
        return;
    }

    function finish_() {
        if (errBody && (!err.body.message || !err.body.code)) {
            try {
                var data = JSON.parse(errBody);
                err.message = data.message;
                err.body.message = data.message;
                err.body.code = data.code;
            } catch (e) {
                err.message = errBody;
                err.body.message = errBody;
            }
        }
        callback(err);
    }
    var finish = once(finish_);

    var errBody = '';
    res.on('data', function (chunk) { errBody += chunk; });
    res.on('error', finish);
    res.on('end', finish);
}


function objCopy(obj) {
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return copy;
}

function simpleMerge(a, b) {
    assert.object(a, 'a');
    assert.object(b, 'b');
    var bkeys = Object.keys(b);
    bkeys.forEach(function (key) {
        a[key] = b[key];
    });
}


// ---- client API

/**
 * Create an IMGAPI client.
 *
 * @param options {Object}
 *      - `url` {String} IMGAPI url. This may optionally include a
 *        '?channel=<channel>' query param. If both this and `options.channel`
 *        are given, the latter wins.
 *      - `channel` {String} Optional. The channel to use, for IMGAPI servers
 *        that use channels.
 *        See <https://mo.joyent.com/docs/imgapi/master/#ListChannels>.
 *      - `user` {String} Optional. Used for basic or http-signature auth.
 *      - `password` {String} Optional. If provided, this implies that basic
 *        auth should be used for client requests.
 *      - `sign` {Function} Optional. Implies http-signature auth. This is
 *        a function that handles signing. It is of the form
 *        `function (<string-to-sign>, <callback>)`.
 *      - `version` {String} Optional. Used for the accept-version
 *        header in requests to the IMGAPI server. If unspecified this
 *        defaults to '*', meaning that over time you could experience breaking
 *        changes. Specifying a value is strongly recommended. E.g. '~2'.
 *      - ... and any other standard restify client options,
 *        e.g. `options.userAgent`.
 *
 * Authentication (i.e. the 'Authorization' header) is applied for all client
 * requests if either the 'password' or 'sign' options are provided. The
 * former implies Basic auth, the latter http-signature auth.
 */
function IMGAPI(options) {
    assert.object(options, 'options');
    assert.string(options.url, 'options.url');
    assert.optionalString(options.channel, 'options.channel');
    assert.optionalString(options.user, 'options.user');
    assert.optionalString(options.password, 'options.password');
    assert.optionalFunc(options.sign, 'options.sign');
    assert.ok(!(options.password && options.sign),
        'not both "options.password" and "options.sign"');
    if (options.version) {
        // Allow options.version=null to avoid default, mainly for testing.
        assert.string(options.version, 'options.version');
    }
    options = objCopy(options);

    // `this.url` is the URL with the optional channel query param *removed*.
    var parsed = mod_url.parse(options.url);
    if (parsed.query) {
        var params = qs.parse(parsed.query);
        if (params.channel) {
            this.channel = params.channel;
        }
        delete parsed.search;
        this.url = mod_url.format(parsed);
    } else {
        this.url = options.url;
    }
    this._basePath = parsed.path;  // the URL subpath *without* a trailing '/'
    if (this._basePath.slice(-1) === '/') {
        this._basePath = this._basePath.slice(0, -1);
    }

    if (options.channel) {
        this.channel = options.channel;
        delete options.channel;
    }

    // Make sure a given bunyan logger has reasonable client_re[qs]
    // serializers.
    if (options.log && options.log.serializers &&
        !options.log.serializers.client_req) {
        options.log = options.log.child({
            serializers: restify.bunyan.serializers
        });
    }
    if (options.version === undefined) {
        options.version = '*';
    }
    this.client = restify.createJsonClient(options);
    // Work around <https://github.com/mcavage/node-restify/pull/291>.
    // Switch to `restify.createHttpClient` when that pull is in.
    options.type = 'http';
    this.rawClient = restify.createClient(options);
    if (options.password) {
        assert.string(options.user, 'options.password, but no options.user');
        this.client.basicAuth(options.user, options.password);
        this.rawClient.basicAuth(options.user, options.password);
    } else if (options.sign) {
        assert.string(options.user, 'options.sign, but no options.user');
        this.user = options.user;
        this.sign = options.sign;
    }
}

IMGAPI.prototype.close = function close() {
    this.client.close();
    this.rawClient.close();
};

IMGAPI.prototype._getAuthHeaders = function _getAuthHeaders(callback) {
    var self = this;
    if (!self.sign) {
        callback(null, {});
        return;
    }

    var headers = {};
    headers.date = new Date().toUTCString();
    var sigstr = 'date: ' + headers.date;

    self.sign(sigstr, function (err, signature) {
        if (err || !signature) {
            callback(new SigningError(err));
            return;
        }

        // Note that we are using the *user* for the "keyId" in the
        // HTTP-Signature scheme. This is because on the server-side (IMGAPI)
        // only the username is used to determine relevant keys with which to
        // verify. The `keyId` in this code is only meaningful client-side.
        //
        // We *could* change and pass through the `keyId` and an additional
        // `user` param. Then the server-side would only need to verify
        // against a specific key signature. This is what Manta currently
        // does.
        headers.authorization = format(
            'Signature keyId="%s",algorithm="%s",signature="%s"',
            self.user, signature.algorithm, signature.signature);
        callback(null, headers);
    });
};


/**
 * Return an appropriate query string *with the leading '?'* from the given
 * fields. If any of the field values are undefined or null, then they will
 * be excluded.
 */
IMGAPI.prototype._qs = function _qs(fields, fields2) {
    assert.object(fields, 'fields');
    assert.optionalObject(fields2, 'fields2'); // can be handy to pass in 2 objs

    var query = {};
    Object.keys(fields).forEach(function (key) {
        var value = fields[key];
        if (value !== undefined && value !== null) {
            query[key] = value;
        }
    });
    if (fields2) {
        Object.keys(fields2).forEach(function (key) {
            var value = fields2[key];
            if (value !== undefined && value !== null) {
                query[key] = value;
            }
        });
    }

    if (Object.keys(query).length === 0) {
        return '';
    } else {
        return '?' + qs.stringify(query);
    }
};


/**
 * Return an appropriate full URL *path* given an IMGAPI subpath.
 * This handles prepending the API's base path, if any: e.g. if the configured
 * URL is "https://example.com/base/path".
 *
 * Optionally an object of query params can be passed in to include a query
 * string. This just calls `this._qs(...)`.
 */
IMGAPI.prototype._path = function _path(subpath, qparams, qparams2) {
    assert.string(subpath, 'subpath');
    assert.ok(subpath[0] === '/');
    assert.optionalObject(qparams, 'qparams');
    assert.optionalObject(qparams2, 'qparams2'); // can be handy to pass in 2

    var path = this._basePath + subpath;
    if (qparams) {
        path += this._qs(qparams, qparams2);
    }
    return path;
};



/**
 * Ping. <https://mo.joyent.com/docs/imgapi/master/#Ping>
 *
 * @param error {String} Optional error code. If given, the ping is expected
 *      to respond with a sample error with that code (if supported).
 * @param callback {Function} `function (err, pong, res)`
 */
IMGAPI.prototype.ping = function ping(error, callback) {
    var self = this;
    if (typeof (error) === 'function') {
        callback = error;
        error = undefined;
    }
    assert.optionalString(error, 'error');
    assert.func(callback, 'callback');

    var path = self._path('/ping', {error: error});
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var reqOpts = {
            path: path,
            headers: headers,
            connectTimeout: 15000 // long default for spotty internet
        };
        self.client.get(reqOpts, function (err, req, res, pong) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, pong, res);
            }
        });
    });
};


/**
 * Get IMGAPI internal state (for dev/debugging).
 *
 * @param {Function} callback : `function (err, state, res)`
 */
IMGAPI.prototype.adminGetState = function adminGetState(callback) {
    var self = this;
    assert.func(callback, 'callback');

    var path = self._path('/state');
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};



/**
 * Lists Images
 * <https://mo.joyent.com/docs/imgapi/master/#ListImages>
 *
 * @param filters {Object} Optional filter params, e.g. `{os: 'smartos'}`.
 *      See the doc link above for a full list of supported filters.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param callback {Function} `function (err, images, res)`
 *
 * NOTE about filters.limit and filters.marker:
 *
 * When no limit is passed we want to allow listImages to automatically
 * loop through all available images because there is default 'hard'
 * limit of 1k images being imposed because of the moray backend. When
 * a limit is passed we are already overriding that so we don't need to
 * do multiple queries to form our response
 */
IMGAPI.prototype.listImages = function listImages(filters, options, callback) {
    var self = this;
    if (typeof (filters) === 'function') {
        callback = filters;
        options = {};
        filters = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.object(filters, 'filters');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }

        if (filters.limit) {
            listImagesWithLimit(headers, callback);
        } else {
            listAllImages(headers, callback);
        }
    });

    function listImagesWithLimit(headers, cb) {
        // limit and marker come straight from filters
        var path = self._path('/images', filters, {channel: self.channel});
        var reqOpts = {
            path: path,
            headers: headers
        };

        self.client.get(reqOpts, function (err, req, res, images) {
            if (err) {
                cb(err, null, res);
            } else {
                cb(null, images, res);
            }
        });
    }

    function listAllImages(headers, cb) {
        var limit = undefined;
        var marker = filters.marker;
        var images = [];
        var lastRes;
        var stop = false;

        // Since we can have more than 1000 images in a IMGAPI repository we
        // need to loop through /images until we are able to fetch all of them
        async.whilst(
            function testAllImagesFetched() {
                return !stop;
            },
            listImagesFromSource,
            function doneFetching(fetchErr) {
                return cb(fetchErr, images, lastRes);
            });

        function listImagesFromSource(whilstNext) {
            // These options are passed once they are set for the first time
            // or they are passed by the client calling listImages()
            if (marker) {
                filters.marker = marker;
            }
            if (limit) {
                filters.limit = limit;
            }

            var path = self._path('/images', filters, {channel: self.channel});
            var reqOpts = {
                path: path,
                headers: headers
            };

            self.client.get(reqOpts, function (listErr, req, res, sImages) {
                // This may involve several request-responses so we keep a
                // reference to the last reponse received
                lastRes = res;
                if (listErr) {
                    stop = true;
                    return whilstNext(listErr);
                }

                // On every query we do this:
                // - check if result size is less than limit (stop)
                // - if we have to keep going set a new marker,
                //   otherwise shift() because the first element is
                //   our marker
                // - concat to full list of images
                if (!limit) {
                    limit = 1000;
                }
                if (sImages.length < limit) {
                    stop = true;
                }
                // No marker means this is the first query and we
                // shouldn't shift() the array
                if (marker) {
                    sImages.shift();
                }
                // We hit this when we either reached an empty page of
                // results or an empty first result
                if (!sImages.length) {
                    stop = true;
                    return whilstNext();
                }
                // Safety check if remote server doesn't support limit
                // and marker yet. In this case we would be iterating
                // over the same list of /images
                var newMarker = sImages[sImages.length - 1].uuid;
                if (marker && marker === newMarker) {
                    stop = true;
                    return whilstNext();
                }
                marker = newMarker;
                images = images.concat(sImages);

                return whilstNext();
            });
        }
    }
};



/**
 * Gets an image by UUID.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account who is querying.
 *      If given this will only return images accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage =
function getImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path('/images/' + uuid, {
        account: account,
        channel: self.channel
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Create an image.
 *
 * @param {String} data : the image data.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImage =
function createImage(data, account, options, callback) {
    var self = this;
    assert.object(data, 'data');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path('/images', {account: account, channel: self.channel});
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Creates a new Image from an existing customer VM. The VM in question cannot
 * be running for this action to be successful. This is the async version of
 * this action, meaning that it will return a job object and it is up to the
 * client to poll the job until it completes.
 *
 * @param {String} data : the image data.
 * @param {Object} options: Required.
 *      - vm_uuid {Boolean} Required. VM from which the Image is going to be
 *        created.
 *      - incremental {Boolean} Optional. Default false. Create an incremental
 *        image.
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, job, res)`
 */
IMGAPI.prototype.createImageFromVm =
function createImageFromVm(data, options, account, callback) {
    var self = this;
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.string(options.vm_uuid, 'options.vm_uuid');
    assert.optionalBool(options.incremental, 'options.incremental');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = self._path('/images');
    path += self._qs({
        channel: self.channel,
        action: 'create-from-vm',
        vm_uuid: options.vm_uuid,
        incremental: options.incremental,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, job) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, job, res);
            }
        });
    });
};


/**
 * Creates a new Image from an existing customer VM. The VM in question cannot
 * be running for this action to be successful. This is the sync version of this
 * action, meaning that it will block until the Image creation operation has
 * completed.
 *
 * @param {String} data : the image data.
 * @param {Object} options: Required.
 *      - vm_uuid {Boolean} Required. VM from which the Image is going to be
 *        created.
 *      - incremental {Boolean} Optional. Default false. Create an incremental
 *        image.
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImageFromVmAndWait =
function createImageFromVmAndWait(data, options, account, callback) {
    var self = this;
    var fn;
    if (callback === undefined) {
        callback = account;
        account = undefined;
        fn = self.createImageFromVm.bind(self, data, options);
    } else {
        fn = self.createImageFromVm.bind(self, data, options, account);
    }

    fn.call(self, function (err, job, res) {
        if (err) {
            callback(err, null, res);
        } else {
            var wfapiUrl = res.headers['workflow-api'];

            assert.string(wfapiUrl, 'wfapiUrl');
            assert.string(job['job_uuid'], 'job_uuid');
            assert.string(job['image_uuid'], 'image_uuid');

            waitForJob(wfapiUrl, job['job_uuid'], function (jErr) {
                if (jErr) {
                    callback(jErr);
                    return;
                }
                self.getImage(job['image_uuid'], callback);
            });
        }
    });
};


/**
 * Import an image (operator/admin use only).
 *
 * This differs from `createImage` in that you can import an image and
 * persist its `uuid` (and `published_at`). This is for operator use only.
 * Typically it is for importing existing images from images.joyent.com. When
 * a `source` URL of a remote IMGAPI repository is passed then the IMGAPI will
 * retrieve the manifest directly, allowing clients to not need to have a
 * manifest file at hand. When doing this the first parameter for the function
 * should only be an object with a single key which is the `uuid` of the image
 *
 * @param {String} data : the image data.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - source {String} Optional. The source IMGAPI repository. If a source
 *          URL is passed then the only key needed for the data of the image is
 *          its uuid, any additional properties are going to be ignored.
 *          Append '?channel=<channel>' to select a particular source
 *          channel, if relevant.
 *      - headers {Object} Optional Additional request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.adminImportImage = function adminImportImage(
        data, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalString(options.source, 'options.source');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');
    assert.string(data.uuid, 'data.uuid');

    var path = self._path('/images/' + data.uuid);
    path += self._qs({
        channel: self.channel,
        action: 'import',
        skip_owner_check: options.skipOwnerCheck,
        source: options.source
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };

        // When passing a source a body is not POSTed
        if (options.source) {
            self.client.post(reqOpts, onPost);
        } else {
            self.client.post(reqOpts, data, onPost);
        }
        function onPost(err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        }
    });
};


/**
 * Import a remote image (operator/admin use only).
 *
 * This differs from `AdminImportImage` in that IMGAPI will download the image
 * manifest, add files and activate the image in a single step. A `source`
 * parameter needs to be passed so IMGAPI can find the remote image manifest to
 * be imported. This is for operator use only.
 * Typically it is for importing existing images from images.joyent.com.
 * This API call is blocking, meaning that the callback provided won't be called
 * until the image has been imported completely into the local IMGAPI.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} source : the source IMGAPI repository.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - headers {Object} Optional Additional request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.adminImportRemoteImageAndWait =
function adminImportRemoteImageAndWait(uuid, source, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.string(uuid, 'uuid');
    assert.string(source, 'source');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path('/images/' + uuid, {
        channel: self.channel,
        action: 'import-remote',
        source: source,
        skip_owner_check: options.skipOwnerCheck
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, obj) {
            if (err) {
                callback(err, null, res);
            } else {
                var wfapiUrl = res.headers['workflow-api'];

                assert.string(wfapiUrl, 'wfapiUrl');
                assert.string(obj['job_uuid'], 'job_uuid');
                assert.string(obj['image_uuid'], 'image_uuid');

                waitForJob(wfapiUrl, obj['job_uuid'], function (jErr) {
                    if (jErr) {
                        callback(jErr);
                        return;
                    }
                    self.getImage(obj['image_uuid'], callback);
                });
            }
        });
    });
};


/*
 * Wait for a job to complete.  Returns an error if the job fails with an error
 * other than the (optional) list of expected errors. Taken from SAPI
 */
function waitForJob(url, job_uuid, cb) {
    assert.string(url, 'url');
    assert.string(job_uuid, 'job_uuid');
    assert.func(cb, 'cb');

    var client = restify.createJsonClient({url: url, agent: false});
    pollJob(client, job_uuid, function (err, job) {
        if (err)
            return cb(err);
        var result = job.chain_results.pop();
        if (result.error) {
            var errmsg = result.error.message || JSON.stringify(result.error);
            return cb(new Error(errmsg));
        } else {
            return cb();
        }
    });
}



/*
 * Poll a job until it reaches either the succeeded or failed state.
 * Taken from SAPI.
 *
 * Note: if a job fails, it's the caller's responsibility to check for a failed
 * job.  The error object will be null even if the job fails.
 */
function pollJob(client, job_uuid, cb) {
    var attempts = 0;
    var errors = 0;

    var timeout = 5000;  // 5 seconds
    var limit = 720;     // 1 hour

    var poll = function () {
        client.get('/jobs/' + job_uuid, function (err, req, res, job) {
            attempts++;

            if (err) {
                errors++;
                if (errors >= 5) {
                    return cb(err);
                } else {
                    return setTimeout(poll, timeout);
                }
            }

            if (job && job.execution === 'succeeded') {
                return cb(null, job);
            } else if (job && job.execution === 'failed') {
                return cb(null, job);
            } else if (attempts > limit) {
                return cb(new Error('polling for import job timed out'), job);
            }

            return setTimeout(poll, timeout);
        });
    };

    poll();
}


/**
 * Import a remote image (operator/admin use only).
 *
 * This differs from `AdminImportImage` in that IMGAPI will download the image
 * manifest, add files and activate the image in a single step. A `source`
 * parameter needs to be passed so IMGAPI can find the remote image manifest to
 * be imported. This is for operator use only.
 * Typically it is for importing existing images from images.joyent.com.
 * This is the async version of adminImportRemoteImageAndWait. The callback
 * returns an object that contains the job_uuid where clients can get details
 * about the progress of the import job.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} source : the source IMGAPI repository.
 * @param {Object} options: For backward compat, this argument is optional.
 *      - skipOwnerCheck {Boolean} Optional. Default false.
 *      - headers {Object} Optional Additional request headers.
 * @param {Function} callback : `function (err, job, res)`
 */
IMGAPI.prototype.adminImportRemoteImage =
function adminImportRemoteImage(uuid, source, options, callback) {
    var self = this;
    if (callback === undefined) {
        callback = options;
        options = {};
    }
    assert.string(uuid, 'uuid');
    assert.string(source, 'source');
    assert.object(options, 'options');
    assert.optionalBool(options.skipOwnerCheck, 'options.skipOwnerCheck');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path('/images/' + uuid, {
        channel: self.channel,
        action: 'import-remote',
        source: source,
        skip_owner_check: options.skipOwnerCheck
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Add an image file.
 *
 * @param {Object} options
 *      - {String} uuid : the UUID of the image.
 *      - {String} source. Optional. the source IMGAPI repository. If a source
 *        URL is passed then the rest of values passed within this object (
 *        other than `uuid`) are going to be ignored as they are only needed
 *        when a local file is loaded into IMGAPI.
 *      - {String|Object} file : Readable stream or path to the image file.
 *        If a stream is passed in it must be paused. Also, if this is
 *        node < v0.10 then it must be paused with `imgapi.pauseStream` or
 *        similar due to a node stream API bug.
 *      - {Number} size : The number of bytes. If `file` is a stream, then
 *        this is required, otherwise it will be retrieved with `fs.stat`.
 *      - {String} compression : One of 'bzip2', 'gzip', or 'none'.
 *      - {String} sha1 : SHA-1 hash of the file being uploaded.
 *      - {String} storage : The type of storage preferred for this image file.
 *        Can be "local" or "manta". Will try to default to "manta" when
 *        available, otherwise "local".
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageFile = function addImageFile(options, account,
                                                      callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.uuid, 'options.uuid');
    assert.optionalObject(options.headers, 'options.headers');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.func(callback, 'callback');
    var uuid = options.uuid;

    // Separate code path for undocumented AddImageFileFromSource endpoint.
    if (options.source) {
        assert.string(options.source, 'options.source');
        var path = self._path(format('/images/%s/file', uuid), {
            channel: self.channel,
            source: options.source,
            storage: options.storage
        });
        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: path,
                headers: headers
            };
            self.client.put(reqOpts, function (err, req, res, image) {
                if (err) {
                    callback(err, null, res);
                } else {
                    callback(null, image, res);
                }
            });
        });
        return;
    }

    // Normal file/stream AddImageFile
    assert.string(options.compression, 'options.compression');
    assert.ok(['string', 'object'].indexOf(typeof (options.file)) !== -1,
        'options.file');
    assert.optionalString(options.sha1, 'options.sha1');
    assert.optionalNumber(options.size, 'options.size');
    assert.optionalString(account, 'account');
    var file = options.file;

    function getFileStreamAndSize(next) {
        if (typeof (file) === 'object') {
            assert.number(options.size, 'options.size');
            return next(null, file, options.size);
        } else if (options.size) {
            var stream = fs.createReadStream(file);
            pauseStream(stream);
            return next(null, stream, options.size);
        } else {
            return fs.stat(file, function (statErr, stats) {
                if (statErr) {
                    return next(statErr);
                }
                var stream = fs.createReadStream(file);
                pauseStream(stream);
                return next(null, stream, stats.size);
            });
        }
    }

    getFileStreamAndSize(function (err, stream, size) {
        if (err) {
            callback(err);
            return;
        }

        var path = self._path(format('/images/%s/file', uuid), {
            channel: self.channel,
            compression: options.compression,
            account: account,
            sha1: options.sha1,
            dataset_guid: options.dataset_guid,
            storage: options.storage
        });

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = 'application/octet-stream';
            headers['Content-Length'] = size;
            headers['Accept'] = 'application/json';
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: path,
                headers: headers
            };
            self.rawClient.put(reqOpts, function (connectErr, req) {
                if (connectErr) {
                    callback(connectErr);
                    return;
                }

                stream.pipe(req);
                stream.resume();

                req.on('result', function (resultErr, res) {
                    if (resultErr) {
                        extendErrFromRawBody(resultErr, res, function () {
                            callback(resultErr, null, res);
                        });
                        return;
                    }

                    var chunks = [];
                    res.setEncoding('utf8');
                    res.on('data', function (chunk) {
                        chunks.push(chunk);
                    });
                    res.on('end', function () {
                        var body = chunks.join('');
                        var data;
                        try {
                            data = JSON.parse(body);
                        } catch (syntaxErr) {
                            callback(new WError(syntaxErr,
                                'invalid image data in response: \'%s\'',
                                body));
                            return;
                        }
                        callback(null, data, res);
                    });
                });
            });
        });
    });
};


/**
 * Get an image file.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} filePath : Path to which to save the image file.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageFile =
function getImageFile(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/file', uuid), {
        channel: self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }

                var hash = null;
                var out = res.pipe(fs.createWriteStream(filePath));
                hash = crypto.createHash('md5');
                res.on('data', function (chunk) { hash.update(chunk); });

                function finish_(err) {
                    if (!err) {
                        var md5_expected = res.headers['content-md5'];
                        var md5_actual = hash.digest('base64');
                        if (md5_actual !== md5_expected) {
                            err = new ChecksumError(md5_actual,
                                                    md5_expected);
                        }
                    }
                    callback(err, res);
                }
                var finish = once(finish_);
                res.on('error', finish);
                out.on('error', finish);
                out.on(writeStreamFinishEvent, finish);
            });
        });
    });
};


/**
 * Get an image file stream.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
IMGAPI.prototype.getImageFileStream = function getImageFileStream(
        uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/file', uuid), {
        channel: self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }
                pauseStream(res);
                callback(null, res);
            });
        });
    });
};


/**
 * Add an image icon.
 *
 * @param {Object} options
 *      - {String} uuid : the UUID of the image.
 *      - {String} contentType : the content type of the icon.
 *      - {String|Object} file : Readable stream or path to the image icon.
 *        If a stream is passed in it must be paused. Also, if this is
 *        node < v0.10 then it must be paused with `imgapi.pauseStream` or
 *        similar due to a node stream API bug.
 *      - {Number} size : The number of bytes. If `file` is a stream, then
 *        this is required, otherwise it will be retrieved with `fs.stat`.
 *      - {String} sha1 : SHA-1 hash of the icon file being uploaded.
 *      - headers {Object} Optional Additional request headers.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageIcon = function addImageIcon(options, account,
                                                      callback) {
    var self = this;
    assert.object(options, 'options');
    assert.string(options.uuid, 'options.uuid');
    assert.string(options.contentType, 'options.contentType');
    assert.ok(['string', 'object'].indexOf(typeof (options.file)) !== -1,
        'options.file');
    assert.optionalString(options.sha1, 'options.sha1');
    assert.optionalNumber(options.size, 'options.size');
    assert.optionalObject(options.headers, 'options.headers');
    if (callback === undefined) {
        callback = account;
        account = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');
    var uuid = options.uuid;
    var file = options.file;

    function getFileStreamAndSize(next) {
        if (typeof (file) === 'object') {
            assert.number(options.size, 'options.size');
            return next(null, file, options.size);
        } else if (options.size) {
            var stream = fs.createReadStream(file);
            pauseStream(stream);
            return next(null, stream, options.size);
        } else {
            return fs.stat(file, function (statErr, stats) {
                if (statErr) {
                    return next(statErr);
                }
                var stream = fs.createReadStream(file);
                pauseStream(stream);
                return next(null, stream, stats.size);
            });
        }
    }

    getFileStreamAndSize(function (err, stream, size) {
        if (err) {
            callback(err);
            return;
        }

        var path = self._path(format('/images/%s/icon', uuid), {
            channel: self.channel,
            account: account,
            sha1: options.sha1
        });

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = options.contentType;
            headers['Content-Length'] = size;
            headers['Accept'] = 'application/json';
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var reqOpts = {
                path: path,
                headers: headers
            };
            self.rawClient.put(reqOpts, function (connectErr, req) {
                if (connectErr) {
                    callback(connectErr);
                    return;
                }

                stream.pipe(req);
                stream.resume();

                req.on('result', function (resultErr, res) {
                    if (resultErr) {
                        extendErrFromRawBody(resultErr, res, function () {
                            callback(resultErr, null, res);
                        });
                        return;
                    }

                    var chunks = [];
                    res.setEncoding('utf8');
                    res.on('data', function (chunk) {
                        chunks.push(chunk);
                    });
                    res.on('end', function () {
                        var body = chunks.join('');
                        var data;
                        try {
                            data = JSON.parse(body);
                        } catch (syntaxErr) {
                            callback(new WError(syntaxErr,
                                'invalid image data in response: \'%s\'',
                                body));
                            return;
                        }
                        callback(null, data, res);
                    });
                });
            });
        });
    });
};


/**
 * Get an image icon.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {String} filePath : Path to which to save the image icon.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageIcon =
function getImageIcon(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }

                var hash = null;
                var out = res.pipe(fs.createWriteStream(filePath));
                hash = crypto.createHash('md5');
                res.on('data', function (chunk) { hash.update(chunk); });

                function finish_(err) {
                    if (!err) {
                        var md5_expected = res.headers['content-md5'];
                        var md5_actual = hash.digest('base64');
                        if (md5_actual !== md5_expected) {
                            err = new ChecksumError(md5_actual,
                                                    md5_expected);
                        }
                    }
                    callback(err, res);
                }
                var finish = once(finish_);

                res.on('error', finish);
                out.on('error', finish);
                out.on(writeStreamFinishEvent, finish);
            });
        });
    });
};


/**
 * Get an image icon stream.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
IMGAPI.prototype.getImageIconStream = function getImageIconStream(
        uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(reqOpts, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    extendErrFromRawBody(resultErr, res, function () {
                        callback(resultErr, res);
                    });
                    return;
                }
                pauseStream(res);
                callback(null, res);
            });
        });
    });
};


/**
 * Delete the image icoon.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.deleteImageIcon =
function deleteImageIcon(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/icon', uuid), {
        channel: self.channel,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.del(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Exports an image to the specified Manta path. Only images that already live
 * on manta can be exported, locally stored images are not supported.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given then the manta_path prefix must
 *      resolve to a location that is owned by the account. If not given then
 *      the manta_path prefix is assumed to (and must) resolve to a path that is
 *      owned by the admin uuser
 * @param {Object} options: Required.
 *      - manta_path {String} Required. Manta path prefix where the image file
 *          file and manifest should be exported to. If "manta_path" is a dir,
 *          then the files are saved to it. If the basename of "PATH" is not a
 *          dir, then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are created.
 *      - headers {Object} Optional. Additional request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.exportImage =
function exportImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (options) === 'function') {
        callback = options;
        options = account;
        account = undefined;
    }
    assert.object(options, 'options');
    assert.string(options.manta_path, 'manta_path');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        action: 'export',
        manta_path: options.manta_path,
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, obj) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, obj, res);
            }
        });
    });
};


/**
 * Activate an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.activateImage =
function activateImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        action: 'activate',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Disable an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.disableImage =
function disableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        action: 'disable',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Enable an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.enableImage =
function enableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        action: 'enable',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Add more UUIDs to the Image ACL.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Array} acl : list of UUIDs to add to the image ACL.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageAcl =
function addImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/acl', uuid), {
        channel: self.channel,
        action: 'add',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, acl, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Remove UUIDs from the Image ACL.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Array} acl : list of UUIDs to remove from the image ACL.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.removeImageAcl =
function removeImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s/acl', uuid), {
        channel: self.channel,
        action: 'remove',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, acl, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Updates an image.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Object} data : attributes of the image that will be replaced.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will only return images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.updateImage =
function updateImage(uuid, data, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(data, 'data');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        action: 'update',
        account: account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.post(reqOpts, data, function (err, req, res, image) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, image, res);
            }
        });
    });
};


/**
 * Delete an image.
 *
 * The image is remove from the current channel. When an image is removed
 * from its last channel, it is deleted from the repository. See
 * `forceAllChannels` below.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param options {Object} Optional request options.
 *      - headers {Object} Optional extra request headers.
 *      - forceAllChannels {Boolean} Optional. Set to true for force actual
 *        deletion ofa
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.deleteImage =
function deleteImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        options = {};
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = {};
    }
    assert.optionalString(account, 'account');
    assert.object(options, 'options');
    assert.optionalObject(options.headers, 'options.headers');
    assert.optionalBool(options.forceAllChannels, 'options.forceAllChannels');
    assert.func(callback, 'callback');

    var path = self._path(format('/images/%s', uuid), {
        channel: self.channel,
        account: account,
        force_all_channels: options.forceAllChannels
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (!headers['content-length']) {
            headers['content-length'] = 0;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.del(reqOpts, function (err, req, res) {
            if (err) {
                callback(err, res);
            } else {
                callback(null, res);
            }
        });
    });
};


/**
 * ListChannels
 * <https://mo.joyent.com/docs/imgapi/master/#ListChannels>
 *
 * @param opts {Object} Required. Request options.
 *      - headers {Object} Optional. Additional request headers.
 * @param cb {Function} `function (err, channels, res, req)`
 */
IMGAPI.prototype.listChannels = function listChannels(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    var path = self._path('/channels');
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            cb(hErr);
            return;
        }
        if (opts && opts.headers) {
            simpleMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        self.client.get(reqOpts, function (err, req, res, channels) {
            if (err) {
                cb(err, null, res, req);
            } else {
                cb(null, channels, res, req);
            }
        });
    });
};


/**
 * ChannelAddImage
 * <https://mo.joyent.com/docs/imgapi/master/#ChannelAddImage>
 *
 * @param opts {Object} Required. Request options.
 *      - uuid {UUID} Required. UUID of image to add to a channel.
 *      - channel {String} Required. Channel to which to add the image.
 *      - account {String} Optional. The UUID of the account who is querying.
 *        If given this will restrict to images accessible to that account.
 *      - headers {Object} Optional. Additional request headers.
 * @param cb {Function} `function (err, img, res, req)`
 */
IMGAPI.prototype.channelAddImage = function channelAddImage(opts, cb) {
    var self = this;
    assert.object(opts, 'opts');
    assert.string(opts.uuid, 'opts.uuid');
    assert.string(opts.channel, 'opts.channel');
    assert.optionalString(opts.account, 'opts.account');
    assert.optionalObject(opts.headers, 'opts.headers');
    assert.func(cb, 'cb');

    /**
     * Dev Note: There are *two* "channel" vars in play here.
     * 1. The "channel" query param, used to find the given image (as with
     *    most other endpoints), and
     * 2. the "channel" param in the *body*, giving the channel to which to
     *    add image.
     */

    var path = self._path('/images/' + opts.uuid, {
        channel: self.channel,
        action: 'channel-add',
        account: opts.account
    });
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            cb(hErr);
            return;
        }
        if (opts && opts.headers) {
            simpleMerge(headers, opts.headers);
        }
        var reqOpts = {
            path: path,
            headers: headers
        };
        var data = {channel: opts.channel};
        self.client.post(reqOpts, data, function (err, req, res, img) {
            if (err) {
                cb(err, null, res, req);
            } else {
                cb(null, img, res, req);
            }
        });
    });
};



// ---- http-signature auth signing

var FINGERPRINT_RE = /^([a-f0-9]{2}:){15}[a-f0-9]{2}$/;


/**
 * Calculate the fingerprint of the given ssh public key data.
 */
function fingerprintFromSshpubkey(sshpubkey) {
    assert.string(sshpubkey, 'sshpubkey');

    // Let's accept either:
    // - just the base64 encoded data part, e.g.
    //   'AAAAB3NzaC1yc2EAAAABIwAA...2l24uq9Lfw=='
    // - the full ssh pub key file content, e.g.:
    //   'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAA...2l24uq9Lfw== my comment'
    if (/^ssh-[rd]sa /.test(sshpubkey)) {
        sshpubkey = sshpubkey.split(/\s+/, 2)[1];
    }

    var fingerprint = '';
    var hash = crypto.createHash('md5');
    hash.update(new Buffer(sshpubkey, 'base64'));
    var digest = hash.digest('hex');
    for (var i = 0; i < digest.length; i++) {
        if (i && i % 2 === 0)
            fingerprint += ':';
        fingerprint += digest[i];
    }

    return (fingerprint);
}


/**
 * Get an ssh public key fingerprint, e.g.:
 *      28:21:57:10:fd:f4:a4:2f:0c:4a:86:39:07:a5:de:72
 * from the given keyId.
 *
 * @param keyId {String} An ssh public key fingerprint or ssh private key path.
 * @param callback {Function} `function (err, fingerprint)`
 */
function fingerprintFromKeyId(keyId, callback) {
    if (FINGERPRINT_RE.test(keyId)) {
        callback(null, keyId);
        return;
    }

    // Try to get it from .pub public key file beside the ssh private key
    // path.
    var pubKeyPath = keyId + '.pub';
    fs.exists(pubKeyPath, function (exists) {
        if (!exists) {
            callback(new Error(format(
                'no SSH public key file, "%s", for keyId "%s"',
                pubKeyPath, keyId)));
            return;
        }
        fs.readFile(pubKeyPath, 'ascii', function (err, data) {
            if (err) {
                callback(err);
                return;
            }
            callback(err, fingerprintFromSshpubkey(data));
        });
    });
}


/**
 * Get a key object from ssh-agent for the given keyId.
 *
 * @param agent {SSHAgentClient}
 * @param keyId {String} An ssh public key fingerprint or ssh private key path.
 * @param callback {Function} `function (err, agentKey)`
 */
function agentKeyFromKeyId(agent, keyId, callback) {
    assert.object(agent, 'agent');
    assert.string(keyId, 'keyId');
    assert.func(callback, 'callback');

    fingerprintFromKeyId(keyId, function (err, fingerprint) {
        if (err) {
            callback(err);
            return;
        }

        agent.requestIdentities(function (err, keys) {
            if (err) {
                callback(err);
                return;
            }

            /**
             * A key looks like this:
             *   { type: 'ssh-rsa',
             *     ssh_key: 'AAAAB3Nz...',
             *     comment: '/Users/bob/.ssh/foo.id_rsa',
             *     _raw: < Buffer 00 00 00 07 ... > },
             */
            var key = (keys || []).filter(function (k) {
                // DSA over agent doesn't work
                if (k.type === 'ssh-dss')
                    return (false);
                // console.log("%s == %s ? %s [keyId=%s]",
                //    fingerprint, fingerprintFromSshpubkey(k.ssh_key),
                //    (fingerprint === fingerprintFromSshpubkey(k.ssh_key)),
                //    keyId);
                return (fingerprint === fingerprintFromSshpubkey(k.ssh_key));
            }).pop();

            if (!key) {
                callback(new Error('no key ' + fingerprint + ' in ssh agent'));
                return;
            }

            callback(null, key);
        });
    });
}


function sshAgentSign(agent, agentKey, data, callback) {
    assert.object(agent, 'agent');
    assert.object(agentKey, 'agentKey');
    assert.object(data, 'data (Buffer)');
    assert.func(callback, 'callback');

    agent.sign(agentKey, data, function (err, sig) {
        if (err) {
            callback(err);
            return;
        }
        callback(null, {algorithm: 'rsa-sha1', signature: sig.signature});
    });
}


/**
 * Load a local ssh private key (in PEM format). PEM format is the OpenSSH
 * default format for private keys.
 *
 * @param keyId {String} An ssh public key fingerprint or ssh private key path.
 * @param log {Bunyan Logger}
 * @param callback {Function} `function (err, sshPrivKeyData)`
 */
function loadSSHKey(keyId, log, callback) {
    // If `keyId` is already a private key path, then just read it and return.
    if (!FINGERPRINT_RE.test(keyId)) {
        fs.readFile(keyId, 'utf8', callback);
        return;
    }

    // Else, look at all priv keys in "~/.ssh" for a matching fingerprint.
    var fingerprint = keyId;
    var keyDir = process.env.HOME + '/.ssh';
    fs.readdir(keyDir, function (readdirErr, filenames) {
        if (readdirErr) {
            callback(readdirErr);
            return;
        }

        var match = null;
        async.forEachSeries(
            filenames || [],
            function oneFile(pubKeyFilename, next) {
                if (match || /\.pub$/.test(pubKeyFilename)) {
                    next();
                    return;
                }

                var pubKeyPath = keyDir + '/' + pubKeyFilename;
                fs.readFile(pubKeyPath, 'utf8', function (readErr, data) {
                    if (readErr) {
                        log.debug(readErr, 'could not read "%s"', pubKeyPath);
                    } else if (fingerprintFromSshpubkey(data) === fingerprint) {
                        match = pubKeyPath;
                    }
                    next();
                });
            },
            function done(err) {
                if (err) {
                    callback(err);
                    return;
                } else if (match) {
                    var privKeyPath = match.split(/\.pub$/)[0];
                    fs.readFile(privKeyPath, 'utf8', callback);
                }
            });
    });
}



/**
 * Create an IMGAPI request signer for the http-signature auth scheme
 * approriate for use with a CLI tool. This handles integrate with ssh keys
 * and ssh-agent.
 *
 * @param options {Object}
 *      - `user` {String} The user name.
 *      - `keyId` or `keyIds` {String} One or more key ids with which to
 *        sign. A key id is either an ssh key *fingerprint* or a path to
 *        a private ssh key.
 *      - `log` {Bunyan Logger} Optional.
 */
function cliSigner(options) {
    assert.object(options, 'options');
    assert.optionalObject(options.log, 'options.log');
    assert.string(options.user, 'options.user');
    assert.optionalString(options.keyId, 'options.keyId');
    assert.optionalArrayOfString(options.keyIds, 'options.keyIds');
    assert.ok(options.keyId || options.keyIds &&
              !(options.keyId && options.keyIds),
        'one of "options.keyId" or "options.keyIds"');

    var log = options.log || new BunyanNoopLogger();
    var keyIds = (options.keyId ? [options.keyId] : options.keyIds);
    var user = options.user;

    // Limitation. TODO: remove this limit
    assert.ok(keyIds.length === 1, 'only a single keyId currently supported');
    var keyId = keyIds[0];

    function sign(str, callback) {
        assert.string(str, 'string');
        assert.func(callback, 'callback');

        var arg = {};
        vasync.pipeline({
            arg: arg,
            funcs: [
                function tryAgent(arg, next) {
                    log.debug('looking for %s in agent', keyId);
                    try {
                        arg.agent = new SSHAgentClient();
                    } catch (e) {
                        log.debug(e, 'unable to create agent');
                        next();
                        return;
                    }
                    agentKeyFromKeyId(arg.agent, keyId, function (err, key) {
                        if (err) {
                            log.debug(err, 'key not in agent');
                        } else {
                            log.debug({key: key.ssh_key}, 'key in agent');
                            arg.key = key;
                        }
                        next();
                    });
                },
                function agentSign(arg, next) {
                    if (!arg.key) {
                        next();
                        return;
                    }

                    log.debug('signing with agent');
                    var data = new Buffer(str);
                    sshAgentSign(arg.agent, arg.key, data, function (err, res) {
                        if (err) {
                            log.debug(err, 'agent sign fail');
                        } else {
                            res.keyId = keyId;
                            res.user = user;
                            arg.res = res;
                        }
                        next();
                    });
                },
                function loadKey(arg, next) {
                    if (arg.res) {
                        next();
                        return;
                    }

                    log.debug('loading private key');
                    loadSSHKey(keyId, log, function (err, key) {
                        if (err) {
                            log.debug(err, 'loading private key failed');
                            next(err);
                            return;
                        }

                        var alg = / DSA /.test(key) ? 'DSA-SHA1' : 'RSA-SHA256';
                        log.debug({algorithm: alg}, 'loaded private key');
                        arg.algorithm = alg;
                        arg.key = key;
                        next();
                    });
                },
                function keySign(arg, next) {
                    if (arg.res) {
                        next();
                        return;
                    }

                    var s = crypto.createSign(arg.algorithm);
                    s.update(str);
                    var signature = s.sign(arg.key, 'base64');
                    arg.res = {
                        algorithm: arg.algorithm.toLowerCase(),
                        keyId: keyId,
                        signature: signature,
                        user: user
                    };
                    next();
                }
            ]
        }, function (err) {
            if (err) {
                callback(err);
            } else {
                callback(null, arg.res);
            }
        });
    }

    return (sign);
}



// ---- exports

module.exports = IMGAPI;

module.exports.ChecksumError = ChecksumError;
module.exports.SigningError = SigningError;

module.exports.createClient = function createClient(options) {
    return new IMGAPI(options);
};

module.exports.cliSigner = cliSigner;

// A useful utility that must be used on a stream passed into the
// `addImageFile` API to not lose leading chunks.
module.exports.pauseStream = pauseStream;
