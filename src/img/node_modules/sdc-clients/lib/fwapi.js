/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Firewall API (FWAPI)
 */

var assert = require('assert-plus');
var RestifyClient = require('./restifyclient');
var util = require('util');
var format = util.format;



// --- Exported Client



/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function FWAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(FWAPI, RestifyClient);



// --- Misc methods



/**
 * Ping FWAPI server.
 *
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.ping = function (callback) {
    return this.get('/ping', callback);
};



// --- Rule methods



/**
 * Lists all rules.
 *
 * @param {Function} params : filter parameters (optional)
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.listRules = function (params, callback) {
    return this.get('/rules', params, callback);
};


/**
 * Gets a rule by UUID.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.getRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    return this.get(format('/rules/%s', uuid), params, callback);
};


/**
 * Updates the rule specified by uuid.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Object} params : the parameters to update.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.updateRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    assert.object(params, 'params');
    return this.put(format('/rules/%s', uuid), params, callback);
};


/**
 * Creates a rule.
 *
 * @param {Object} params : the rule parameters.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.createRule = function (params, callback) {
    assert.object(params, 'params');
    return this.post('/rules', params, callback);
};


/**
 * Deletes the rule specified by uuid.
 *
 * @param {String} uuid : the rule UUID.
 * @param {Object} params : optional parameters.
 * @param {Function} callback : of the form f(err, res).
 */
FWAPI.prototype.deleteRule = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    return this.del(format('/rules/%s', uuid), params, callback);
};



module.exports = FWAPI;
