/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Generic restify client with basic auth
 */

var restify = require('restify');


/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *    - username {String} username for basic auth.
 *    - password {String} password for basic auth.
 *    - url {String} NAPI url.
 *    - ... any other options allowed to `restify.createJsonClient`
 *
 */
function RestifyClient(options) {
    if (!options)
        throw new TypeError('options required');
    if (!options.url)
        throw new TypeError('options.url (String) is required');

    this.client = restify.createJsonClient(options);

    if (options.username && options.password)
        this.client.basicAuth(options.username, options.password);
}


/**
 * Generic GET method
 *
 * Note that you can call this with or without params,
 * eg: f(path, cb) or f(path, params, cb)
 *
 * @param {String} path : the path to get
 * @param {Object} params : the parameters to filter on (optional)
 * @param {Function} callback : of the form f(err, obj) or
 *        f(err, obj, req, res) if you need the extra data
 *
 *
 * DEPRECATION NOTE: The first argument to this function should be an object
 *     instead. It would effectively be the same object that gets passed to the
 *     restify request functions (get, put, post, del) so the following options
 *     can be passed (for the entire list please refer to restify docs):
 *     - agent
 *     - connectTimeout
 *     - headers
 *     - query
 *     - path
 *     ...
 *
 * The following examples show equivalent requests can in the object format.
 * Note how params in GET and DELETE are replaced by opts.query (more consistent
 * with restify)
 *
 * client.get('/vms', cb)
 *    -> client.get({ path: '/vms' }, cb)
 *
 * client.get('/vms', { state: 'running' }, cb)
 *    -> client.get({ path: '/vms', query: { state: 'running' } }, cb)
 *
 * And now that the first argument to these functions is an object, clients can
 * now specify request headers for every single function call
 *
 * client.get('/vms', cb) # No way to specify headers before
 *    -> client.get({ path: '/vms', headers: { 'x-request-id': <uuid> } }, cb)
 *
 */
RestifyClient.prototype.get = function (path, params, callback) {
    if (!path)
        throw new TypeError('path is required');
    if (!params)
        throw new TypeError('callback (Function) is required');
    if (typeof (params) !== 'function' && typeof (params) !== 'object')
        throw new TypeError('params must be an object');

    // Allow calling .get(path, callback):
    if (typeof (params) === 'function')
        callback = params;
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    var opts;
    if (typeof (path) === 'string') {
        opts = { path: path };
    } else {
        opts = path;
    }

    if (typeof (params) === 'object' && Object.keys(params).length !== 0)
        opts.query = params;

    return this.client.get(opts, function (err, req, res, obj) {
        if (err) {
            return callback(err, null, req, res);
        }
        return callback(null, obj, req, res);
    });
};


/**
 * Generic PUT method
 *
 * @param {String} path : the path to put. (Please refer to RestifyClient.get)
 * @param {Object} body : the body to put
 * @param {Function} callback : of the form f(err, obj) or
 *        f(err, obj, req, res) if you need the extra data
 */
RestifyClient.prototype.put = function (path, body, callback) {
    if (!path)
        throw new TypeError('path is required');
    if (!body || typeof (body) !== 'object')
        throw new TypeError('body is required (object)');
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    var opts;
    if (typeof (path) === 'string') {
        opts = { path: path };
    } else {
        opts = path;
    }

    return this.client.put(opts, body, function (err, req, res, obj) {
        if (err) {
            return callback(err, null, req, res);
        }
        return callback(null, obj, req, res);
    });
};


/**
 * Generic POST method
 *
 * @param {String} path : the path to post. (Please refer to RestifyClient.get)
 * @param {Object} body : the body to post
 * @param {Function} callback : of the form f(err, obj) or
 *        f(err, obj, req, res) if you need the extra data
 */
RestifyClient.prototype.post = function (path, body, callback) {
    if (!path)
        throw new TypeError('path is required');
    if (!body || typeof (body) !== 'object')
        throw new TypeError('body is required (object)');
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    var opts;
    if (typeof (path) === 'string') {
        opts = { path: path };
    } else {
        opts = path;
    }

    return this.client.post(opts, body, function (err, req, res, obj) {
        if (err) {
            return callback(err, null, req, res);
        }
        return callback(null, obj, req, res);
    });
};


/**
 * Generic DELETE method
 *
 * @param {String} path : the path to post. (Please refer to RestifyClient.get)
 * @param {Object} path : the request options
 * @param {Function} callback : of the form f(err, obj) or
 *        f(err, obj, req, res) if you need the extra data
 */
RestifyClient.prototype.del = function (path, params, callback) {
    if (!path)
        throw new TypeError('path is required');
    if (!params)
        throw new TypeError('callback (Function) is required');
    if (typeof (params) !== 'function' && typeof (params) !== 'object')
        throw new TypeError('params must be an object');

    // Allow calling .del(path, callback):
    if (typeof (params) === 'function')
        callback = params;
    if (!callback || typeof (callback) !== 'function')
        throw new TypeError('callback (Function) is required');

    var opts;
    if (typeof (path) === 'string') {
        opts = { path: path };
    } else {
        opts = path;
    }

    if (typeof (params) === 'object' && Object.keys(params).length !== 0)
        opts.query = params;

    return this.client.del(opts, function (err, req, res, obj) {
        if (err) {
            return callback(err, null, req, res);
        }
        return callback(null, obj, req, res);
    });
};


/**
 * Close the underlying restify client.
 */
RestifyClient.prototype.close = function ()
{
    this.client.close();
};

module.exports = RestifyClient;
