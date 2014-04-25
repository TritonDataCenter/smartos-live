/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
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
 *      var imgapi = require('sdc-clients/lib/imgapi');
 *      var client = imgapi.createClient({
 *              url: <URL>,
 *              user: <USERNAME>,
 *              password: <PASSWORD>
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * Usage with HTTP-Signature auth (e.g. https://images.joyent.com):
 *
 *      var imgapi = require('sdc-clients/lib/imgapi');
 *      var client = imgapi.createClient({
 *              url: <URL>,
 *              user: <USERNAME>,
 *              log: <BUNYAN-LOGGER>,
 *              sign: imgapi.cliSigner({
 *                  keyId: <KEY-ID>,        // ssh fingerprint, priv key path
 *                  user: <USERNAME>,
 *                  log: <BUNYAN-LOGGER>,
 *              })
 *      });
 *      client.ping(function (err, pong, res) { ... });
 *
 * See <https://mo.joyent.com/imgapi-cli/blob/master/bin/imgapi-cli> for an
 * example of the latter.
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


function clone(obj) {
    if (null === obj || 'object' != typeof (obj)) {
        return obj;
    }

    var copy = obj.constructor();

    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) {
            copy[attr] = obj[attr];
        }
    }
    return copy;
}

function simpleMerge(a, b) {
    if (!a || typeof (a) !== 'object') {
        throw new TypeError('First object is required (object)');
    }
    if (!b || typeof (b) !== 'object') {
        throw new TypeError('Second object is required (object)');
    }
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
 *      - `url` {String} IMGAPI url
 *      - `user` {String} Optional. Used for basic or http-signature auth.
 *      - `password` {String} Optional. If provided, this implies that basic
 *        auth should be used for client requests.
 *      - `sign` {Function} Optional. Implies http-signature auth. This is
 *        a function that handles signing. It is of the form
 *        `function (<string-to-sign>, <callback>)`.
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
    assert.optionalString(options.user, 'options.user');
    assert.optionalString(options.password, 'options.password');
    assert.optionalFunc(options.sign, 'options.sign');
    assert.ok(!(options.password && options.sign),
        'not both "options.password" and "options.sign"');

    // Make sure a given bunyan logger has reasonable client_re[qs]
    // serializers.
    if (options.log && options.log.serializers &&
        !options.log.serializers.client_req) {
        options.log = options.log.child({
            serializers: restify.bunyan.serializers
        });
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

    var path = '/ping';
    if (error) {
        path += '?' + qs.stringify({error: error});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var opts = {
            path: path,
            headers: headers,
            connectTimeout: 15000 // long default for spotty internet
        };
        self.client.get(opts, function (err, req, res, pong) {
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

    var path = '/state';
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.get(opts, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param callback {Function} `function (err, images, res)`
 */
IMGAPI.prototype.listImages = function listImages(filters, options, callback) {
    var self = this;
    if (typeof (filters) === 'function') {
        callback = filters;
        filters = {};
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.func(callback, 'callback');
    assert.object(filters);

    var path = '/images';
    var query = qs.stringify(filters);
    if (query.length > 0) {
        path += '?' + query;
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.get(opts, function (err, req, res, images) {
            if (err) {
                callback(err, null, res);
            } else {
                callback(null, images, res);
            }
        });
    });
};



/**
 * Gets an image by UUID.
 *
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account who is querying.
 *      If given this will only return images accessible to that account.
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.getImage =
function getImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (account) === 'object') {
        callback = options;
        options = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.get(opts, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.createImage =
function createImage(data, account, options, callback) {
    var self = this;
    assert.object(data, 'data');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }

    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = '/images';
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, data, function (err, req, res, image) {
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

    var path = '/images';
    var query = {action: 'create-from-vm', vm_uuid: options.vm_uuid};
    if (options.incremental) {
        query.incremental = options.incremental;
    }
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, data, function (err, req, res, job) {
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
 *      - source {String} Optional. the source IMGAPI repository. If a source
 *          URL is passed then the only key needed for the data of the image is
 *          its uuid, any additional properties are going to be ignored.
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
    assert.optionalObject(options.headers, 'options.headers');
    assert.func(callback, 'callback');
    assert.string(data.uuid, 'data.uuid');

    var query = {action: 'import'};
    if (options.skipOwnerCheck) {
        query.skip_owner_check = true;
    }
    if (options.source) {
        query.source = options.source;
    }

    var path = format('/images/%s?%s', data.uuid, qs.stringify(query));
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };

        // When passing a source a body is not POSTed
        if (options.source) {
            self.client.post(opts, onPost);
        } else {
            self.client.post(opts, data, onPost);
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

    var query = { action: 'import-remote', source: source };
    if (options.skipOwnerCheck) {
        query.skip_owner_check = true;
    }
    var path = format('/images/%s?%s', uuid, qs.stringify(query));
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, obj) {
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

    var query = { action: 'import-remote', source: source };
    if (options.skipOwnerCheck) {
        query.skip_owner_check = true;
    }
    var path = format('/images/%s?%s', uuid, qs.stringify(query));
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, image) {
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

    // Separate code path
    if (options.source) {
        assert.string(options.source, 'options.source');
        var query = { source: options.source };
        if (options.storage) {
            query.storage = options.storage;
        }
        var path = format('/images/%s/file?%s', uuid, qs.stringify(query));
        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var opts = {
                path: path,
                headers: headers
            };
            self.client.put(opts, function (err, req, res, image) {
                if (err) {
                    callback(err, null, res);
                } else {
                    callback(null, image, res);
                }
            });
        });
        return;
    }

    // Normal file/stream addImageFile
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

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = 'application/octet-stream';
            headers['Content-Length'] = size;
            headers['Accept'] = 'application/json';
            var path = format('/images/%s/file', uuid);
            var query = {compression: options.compression};
            if (account) {
                query.account = account;
            }
            if (options.sha1) {
                query.sha1 = options.sha1;
            }
            if (options.dataset_guid) {
                query.dataset_guid = options.dataset_guid;
            }
            if (options.storage) {
                query.storage = options.storage;
            }
            path += '?' + qs.stringify(query);
            if (options.headers) {
                simpleMerge(headers, options.headers);
            }
            var opts = {
                path: path,
                headers: headers
            };
            self.rawClient.put(opts, function (connectErr, req) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageFile =
function getImageFile(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s/file', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(opts, function (connectErr, req) {
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
 * @param {Object} options : Request options.
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
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s/file', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(opts, function (connectErr, req) {
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

        self._getAuthHeaders(function (hErr, headers) {
            if (hErr) {
                callback(hErr);
                return;
            }
            headers['Content-Type'] = options.contentType;
            headers['Content-Length'] = size;
            headers['Accept'] = 'application/json';
            var path = format('/images/%s/icon', uuid);
            var query = {};
            if (account) {
                query.account = account;
            }
            if (options.sha1) {
                query.sha1 = options.sha1;
            }
            path += '?' + qs.stringify(query);
            if (options && options.headers) {
                simpleMerge(headers, options.headers);
            }
            var opts = {
                path: path,
                headers: headers
            };
            self.rawClient.put(opts, function (connectErr, req) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.getImageIcon =
function getImageIcon(uuid, filePath, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.string(filePath, 'filePath');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s/icon', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(opts, function (connectErr, req) {
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
 * @param {Object} options : Request options.
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
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s/icon', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.rawClient.get(opts, function (connectErr, req) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.deleteImageIcon =
function deleteImageIcon(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s/icon', uuid);
    if (account) {
        path += '?' + qs.stringify({account: account});
    }
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.del(opts, function (err, req, res, image) {
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
    assert.string(options.manta_path, 'manta_path');
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = { action: 'export', manta_path: options.manta_path };
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, obj) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.activateImage =
function activateImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {action: 'activate'};
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.disableImage =
function disableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {action: 'disable'};
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.enableImage =
function enableImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {action: 'enable'};
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.addImageAcl =
function addImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.func(callback, 'callback');

    var path = format('/images/%s/acl', uuid);
    var query = { action: 'add' };
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, acl, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.removeImageAcl =
function removeImageAcl(uuid, acl, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.arrayOfString(acl, 'acl');
    assert.func(callback, 'callback');

    var path = format('/images/%s/acl', uuid);
    var query = { action: 'remove' };
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, acl, function (err, req, res, image) {
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
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, image, res)`
 */
IMGAPI.prototype.updateImage =
function updateImage(uuid, data, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        options = undefined;
    }
    assert.optionalString(account, 'account');
    assert.object(data, 'data');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {action: 'update'};
    if (account) {
        query.account = account;
    }
    path += '?' + qs.stringify(query);
    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.post(opts, data, function (err, req, res, image) {
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
 * @param {String} uuid : the UUID of the image.
 * @param {UUID} account : Optional. The UUID of the account on behalf of whom
 *      this request is being made. If given this will restrict to images
 *      accessible to that account.
 * @param {Object} options : Request options.
 * @param {Function} callback : `function (err, res)`
 */
IMGAPI.prototype.deleteImage =
function deleteImage(uuid, account, options, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    if (typeof (account) === 'function') {
        callback = account;
        account = undefined;
    } else if (typeof (options) === 'function') {
        callback = options;
        // gross
        if (typeof (account) === 'object') {
            // uuid, options, callback
            options = account;
            account = undefined;
        } else {
            // uuid, account, callback
            options = undefined;
        }
    }
    assert.optionalString(account, 'account');
    assert.func(callback, 'callback');

    var path = format('/images/%s', uuid);
    var query = {};
    if (account) {
        query.account = account;
    }
    if (options && options.purge && options.purge === true) {
        query.purge = true;
    }
    path += '?' + qs.stringify(query);

    self._getAuthHeaders(function (hErr, headers) {
        if (hErr) {
            callback(hErr);
            return;
        }
        if (!headers['content-length']) {
            headers['content-length'] = 0;
        }
        if (options && options.headers) {
            simpleMerge(headers, options.headers);
        }
        var opts = {
            path: path,
            headers: headers
        };
        self.client.del(opts, function (err, req, res) {
            if (err) {
                callback(err, res);
            } else {
                callback(null, res);
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
