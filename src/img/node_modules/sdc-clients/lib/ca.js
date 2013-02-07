// Copyright 2012 Joyent, Inc.  All rights reserved.

var assert = require('assert');

var restify = require('restify');
var sprintf = require('util').format;



// --- Globals

var CA_FMT = '/ca/customers/%s';
var INST_BASE_FMT = CA_FMT + '/instrumentations';
var INST_FMT = INST_BASE_FMT + '/%s';
var INST_CLONE_FMT = INST_FMT + '/clone';
var RAW_FMT = INST_FMT + '/value/raw';
var HEATMAP_IMG_FMT = INST_FMT + '/value/heatmap/image';
var HEATMAP_DETAILS_FMT = INST_FMT + '/value/heatmap/details';



// --- Helpers

if (!String.prototype.capitalize) {
    String.prototype.capitalize = function capitalize() {
        return this.charAt(0).toUpperCase() + this.slice(1);
    };
}


function translateError(err) {
    assert.ok(err);

    if (err instanceof restify.RestError) {
        if (err.body && err.body.error) {
            switch (err.body.error.code) {
            case 'ECA_INVAL':
            case 'ECA_EXISTS':
            case 'ECA_INCOMPAT':
                return new restify.InvalidArgumentError(err.body.error.message);

            case 'ECA_NOENT':
                return new restify.ResourceNotFoundError(
                    err.body.error.message);

            default:
              // noop
                break;
            }
        }
    } else if (err instanceof restify.HttpError) {
        switch (err.statusCode) {
        case 400:
            return new restify.RestError(400, 'BadRequest',
                                       err.message || 'bad request');
        case 404:
            return new restify.ResourceNotFoundError(err.message ||
                                                   'resource not found');

        default:
          // noop
            break;
        }
    }

    return new restify.InternalError('An unknown error occurred');
}


function commonCallback(callback) {
    return function (err, req, res, data) {
        if (err)
          return callback(translateError(err));

        return callback(null, data);
    };
}


function assertArg(name, type, arg) {
    if (typeof (arg) !== type)
      throw new TypeError(name + ' (' + type.capitalize() + ') required');
}


// --- Exported CA Client

/**
 * Constructor
 *
 * Note that in options you can pass in any parameters that the restify
 * RestClient constructor takes (for example retry/backoff settings).
 *
 * @param {Object} options
 *                  - url {String} CA location.
 *
 */
function CA(options) {
    assertArg('options', 'object', options);

    options.headers = options.headers || {};
    options.headers['x-api-version'] = 'ca/0.1.8';
    this.client = restify.createJsonClient(options);
}
module.exports = CA;


/**
 * Does a listing of the "root" CA endpoint.
 *
 * This hoss gives you the "schema" that CA supports.
 *
 * @param {String} customer a CAPI customer uuid.
 * @param {Function} callback of the form f(err, schema).
 */
CA.prototype.listSchema = function (customer, callback) {
    assertArg('customer', 'string', customer);
    assertArg('callback', 'function', callback);

    var path = sprintf(CA_FMT, customer);
    return this.client.get(path, commonCallback(callback));
};
CA.prototype.getSchema = CA.prototype.listSchema;
CA.prototype.list = CA.prototype.listSchema;
CA.prototype.describe = CA.prototype.listSchema;


/**
 * Lists all instrumentations created for a customer.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Function} callback of the form f(err, instrumentations).
 */
CA.prototype.listInstrumentations = function (customer, callback) {
    assertArg('customer', 'string', customer);
    assertArg('callback', 'function', callback);

    var path = sprintf(INST_BASE_FMT, customer);
    return this.client.get(path, commonCallback(callback));
};


/**
 * Creates a new CA instrumentation.
 *
 * Refer to the CA documentation for an explanation of what goes in params.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {Object} params the intstrumentation parameters.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.createInstrumentation = function (customer, params, callback) {
    assertArg('customer', 'string', customer);
    assertArg('params', 'object', params);
    assertArg('callback', 'function', callback);

    var path = sprintf(INST_BASE_FMT, customer);
    return this.client.post(path, params, commonCallback(callback));
};


/**
 * Clones a CA instrumentation.
 *
 * Refer to the CA documentation for an explanation of what goes in params.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} id the CA instrumentation id.
 * @param {Object} params the intstrumentation parameters.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.cloneInstrumentation = function (customer,
                                             instrumentation,
                                             params,
                                             callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('params', 'object', params);
    assertArg('callback', 'function', callback);

    var path = sprintf(INST_CLONE_FMT, customer, instrumentation);
    return this.client.post(path, params, commonCallback(callback));
};


/**
 * Retrieves a single instrumentation by CA instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} id the intstrumentation id.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.getInstrumentation = function getInstrumentation(customer,
                                                              instrumentation,
                                                              callback) {
    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('callback', 'function', callback);

    var path = sprintf(INST_FMT, customer, instrumentation);
    return this.client.get(path, commonCallback(callback));
};


/**
 * Retrieves a single "raw" instrumentation by CA instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Object} params see the CA docs.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.getInstrumentationValueRaw = function (customer,
                                                   instrumentation,
                                                   params,
                                                   callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('params', 'object', params);
    assertArg('callback', 'function', callback);

    var request = {
        path: sprintf(RAW_FMT, customer, instrumentation),
        query: params
    };
    return this.client.get(request, commonCallback(callback));
};
CA.prototype.getInstrumentationValue = CA.prototype.getInstrumentationValueRaw;


/**
 * Retrieves an instrumentation heatmap image from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Object} params see the CA docs.
 * @param {Function} callback of the form f(err, heatmap).
 */
CA.prototype.getHeatmapImage = function getHeatmapImage(customer,
                                                        instrumentation,
                                                        params,
                                                        callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('params', 'object', params);
    assertArg('callback', 'function', callback);

    var request = {
        path: sprintf(HEATMAP_IMG_FMT, customer, instrumentation),
        query: params
    };
    return this.client.get(request, commonCallback(callback));
};
CA.prototype.getHeatmap = CA.prototype.getHeatmapImage;
CA.prototype.getInstrumentationHeatmap = CA.prototype.getHeatmap;
CA.prototype.getInstrumentationHeatmapImage = CA.prototype.getHeatmap;



/**
 * Retrieves an instrumentation heatmap detail from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Object} params see the CA docs.
 * @param {Function} cb of the form f(err, details).
 */
CA.prototype.getHeatmapDetails = function (customer,
                                          instrumentation,
                                          params,
                                          callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('params', 'object', params);
    assertArg('callback', 'function', callback);

    var request = {
        path: sprintf(HEATMAP_DETAILS_FMT, customer, instrumentation),
        query: params
    };
    return this.client.get(request, commonCallback(callback));
};
CA.prototype.getInstrumentationHeatmapDetails = CA.prototype.getHeatmapDetails;


/**
 * Deletes an instrumentation from CA by instrumentation id.
 *
 * @param {String} customer the CAPI customer uuid.
 * @param {String} instrumentation the intstrumentation id.
 * @param {Function} callback of the form f(err, instrumentation).
 */
CA.prototype.deleteInstrumentation = function (customer,
                                              instrumentation,
                                              callback) {

    assertArg('customer', 'string', customer);
    assertArg('instrumentation', 'string', instrumentation);
    assertArg('callback', 'function', callback);

    var request = {
        path: sprintf(INST_FMT, customer, instrumentation)
    };
    return this.client.del(request, commonCallback(callback));
};
CA.prototype.destroyInstrumentation = CA.prototype.deleteInstrumentation;
