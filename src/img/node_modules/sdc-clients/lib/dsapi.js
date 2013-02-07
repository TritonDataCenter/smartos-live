/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the (old) SDC Datasets API (DSAPI).
 *
 * DSAPI is now deprecated in favor of IMGAPI, but continues on for
 * backward compat and transition from SDC 6.5.
 */

var util = require('util'),
    format = util.format,
    restify = require('restify'),
    qs = require('querystring');
var assert = require('assert-plus');



function DSAPI(options) {
    if (typeof (options) !== 'object') {
        throw new TypeError('options (Object) required');
    }
    if (typeof (options.url) !== 'string') {
        throw new TypeError('options.url (String) required');
    }

    this.client = restify.createJsonClient(options);
    // Work around <https://github.com/mcavage/node-restify/pull/291>.
    // Switch to `restify.clientHttpClient` when that pull is in.
    options.type = 'http';
    this.rawClient = restify.createClient(options);
    if (options.username && options.password) {
        this.client.basicAuth(options.username, options.password);
        this.rawClient.basicAuth(options.username, options.password);
    }
}


/**
 * Ping
 */
DSAPI.prototype.ping = function ping(callback) {
    var self = this;
    assert.func(callback, 'callback');

    var path = '/ping';
    self.client.get(path, function (err, req, res, pong) {
        if (err) {
            callback(err, null, res);
        } else {
            callback(null, pong, res);
        }
    });
};


/**
 * Lists all Images
 *
 * @param {Object} params : Filter params. Images can be filtered by
 *                          'name', 'version', 'type', 'os',
 *                          'restricted_to_uuid' & 'creator_uuid' params.
 * @param {Function} callback : of the form f(err, imgs).
 */
DSAPI.prototype.listImages = function (params, cb) {
    var self = this,
        path = '/datasets';

    if (typeof (params) === 'function') {
        cb = params;
        params = {};
    } else if (typeof (params) !== 'object') {
        throw new TypeError('params (Object) required');
    }

    params = qs.stringify(params);

    if (params !== '') {
        path += '?' + params;
    }

    return self.client.get(path, function (err, req, res, imgs) {
        if (err) {
            return cb(err);
        } else {
            return cb(null, imgs);
        }
    });
};


/**
 * Gets an IMAGE by UUID
 *
 * @param {String} image_uuid : the UUID of the IMAGE.
 * @param {Function} callback : of the form f(err, img).
 */
DSAPI.prototype.getImage = function (image_uuid, cb) {
    var self = this,
        path;

    if (typeof (image_uuid) !== 'string') {
        throw new TypeError('image_uuid (String) required');
    }

    path = format('/datasets/%s', image_uuid);

    return self.client.get(path, function (err, req, res, img) {
        if (err) {
            return cb(err);
        } else {
            return cb(null, img);
        }
    });
};



/**
 * Get an image file stream.
 * Note: This
 *
 * @param {String} uuid : the UUID of the image.
 * @param {Function} callback : `function (err, stream)`
 *      The `stream` is also an HTTP response object, i.e. headers are on
 *      `stream.headers`.
 */
DSAPI.prototype.getImageFileStream = function getImageFileStream(
        uuid, callback) {
    var self = this;
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');

    self.getImage(uuid, function (getErr, image) {
        if (getErr) {
            callback(getErr);
            return;
        }
        var path = image.files[0].url;
        self.rawClient.get(path, function (connectErr, req) {
            if (connectErr) {
                callback(connectErr);
                return;
            }
            req.on('result', function (resultErr, res) {
                if (resultErr) {
                    if (!res) {
                        callback(resultErr);
                    } else {
                        var finished = false;
                        function finish(err) {
                            if (finished)
                                return;
                            finished = true;
                            if (!resultErr.body.message && errMessage) {
                                resultErr.body.message = errMessage;
                            }
                            callback(resultErr, res);
                        }
                        var errMessage = '';
                        res.on('data', function (chunk) {
                            errMessage += chunk;
                        });
                        res.on('error', finish);
                        res.on('end', finish);
                    }
                    return;
                }
                callback(null, res);
            });
        });
    });
};


// ---- exports

module.exports = DSAPI;

module.exports.createClient = function createClient(options) {
    return new DSAPI(options);
};
