/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Networking API (NAPI)
 */

var assert = require('assert-plus');
var util = require('util');
var format = util.format;
var RestifyClient = require('./restifyclient');



// --- Exported Client



/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function NAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(NAPI, RestifyClient);


/**
 * Ping NAPI server.
 *
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.ping = function (callback) {
    return this.get('/ping', callback);
};



// --- Network pool methods



/**
 * Creates a Network Pool
 *
 * @param {String} name: the name.
 * @param {Object} params : the pool parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.createNetworkPool = function (name, params, callback) {
    assert.string(name, 'name');
    assert.object(params, 'params');
    params.name = name;

    return this.post('/network_pools', params, callback);
};


/**
 * Deletes the Network Pool specified by UUID.
 *
 * @param {String} uuid : the UUID.
 * @param {Object} params : optional parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.deleteNetworkPool = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    return this.del(format('/network_pools/%s', uuid), params, callback);
};


/**
 * Gets a Network Pool by UUID
 *
 * @param {String} uuid : the UUID.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getNetworkPool = function (uuid, callback) {
    assert.string(uuid, 'uuid');
    return this.get(format('/network_pools/%s', uuid), callback);
};


/**
 * Lists all Network Pools
 *
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.listNetworkPools = function (params, callback) {
    return this.get('/network_pools', params, callback);
};


/**
 * Updates the Network Pool specified by UUID.
 *
 * @param {String} uuid : the UUID.
 * @param {Object} params : the parameters to update.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.updateNetworkPool = function (uuid, params, callback) {
    assert.string(uuid, 'uuid');
    return this.put(format('/network_pools/%s', uuid), params, callback);
};



// --- Nic methods



/**
 * Lists all Nics
 *
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.listNics = function (params, callback) {
    return this.get('/nics', params, callback);
};


/**
 * Gets a Nic by MAC address.
 *
 * @param {String} macAddr : the MAC address.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getNic = function (macAddr, callback) {
    if (!macAddr)
        throw new TypeError('macAddr is required (string)');
    return this.get(format('/nics/%s', macAddr.replace(/:/g, '')), callback);
};


/**
 * Updates the Nic specified by MAC address.
 *
 * @param {String} macAddr : the MAC address.
 * @param {Object} params : the parameters to update.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.updateNic = function (macAddr, params, callback) {
    if (!macAddr)
        throw new TypeError('macAddr is required (string)');
    return this.put(format('/nics/%s', macAddr.replace(/:/g, '')),
        params, callback);
};


/**
 * Gets the nics for the given owner
 *
 * @param {String} belongsTo : the UUID that the nics belong to
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getNics = function (belongsTo, callback) {
    if (!belongsTo)
        throw new TypeError('belongsTo is required (string)');
    return this.listNics({ belongs_to_uuid: belongsTo }, callback);
};


/**
 * Creates a Nic
 *
 * @param {String} macAddr : the MAC address.
 * @param {Object} params : the nic parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.createNic = function (macAddr, params, callback) {
    if (!macAddr)
        throw new TypeError('macAddr is required (string)');
    if (!params || typeof (params) !== 'object')
        throw new TypeError('params is required (object)');

    params.mac = macAddr;

    return this.post('/nics', params, callback);
};


/**
 * Provisions a new Nic, with an IP address on the given logical network
 *
 * @param {String} network : the logical network to create this nic on
 * @param {Object} params : the nic parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.provisionNic = function (network, params, callback) {
    if (!network)
        throw new TypeError('network is required (string)');
    return this.post(format('/networks/%s/nics', network), params, callback);
};


/**
 * Deletes the Nic specified by MAC address.
 *
 * @param {String} macAddr : the MAC address.
 * @param {Object} params : optional parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.deleteNic = function (macAddr, params, callback) {
    if (!macAddr)
        throw new TypeError('macAddr is required (string)');
    return this.del(format('/nics/%s', macAddr.replace(/:/g, '')),
        params, callback);
};



// --- Network methods



/**
 * Lists all Networks
 *
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.listNetworks = function (params, callback) {
    return this.get('/networks', params, callback);
};


/**
 * Creates a Network
 *
 * @param {Object} params : the network parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.createNetwork = function (params, callback) {
    if (!params || typeof (params) !== 'object')
        throw new TypeError('params is required (object)');

    return this.post('/networks', params, callback);
};


/**
 * Gets a Network by UUID.
 *
 * @param {String} uuid : the UUID.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getNetwork = function (uuid, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.get(format('/networks/%s', uuid), callback);
};


/**
 * Deletes a Network by UUID.
 *
 * @param {String} uuid : the UUID.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.deleteNetwork = function (uuid, params, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.del(format('/networks/%s', uuid), params, callback);
};


/**
 * Lists the IPs for the given logical network
 *
 * @param {String} network : the logical network to list IPs on
 * @param {Object} params : the parameters to pass
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.listIPs = function (network, params, callback) {
    if (!network)
        throw new TypeError('network is required (string)');
    return this.get(format('/networks/%s/ips', network), params, callback);
};


/**
 * Gets an IP on the given logical network
 *
 * @param {String} network : the logical network that the IP is on
 * @param {String} ipAddr : the IP address to get info for
 * @param {Object} params : the parameters to pass
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getIP = function (network, ipAddr, params, callback) {
    if (!network)
        throw new TypeError('network is required (string)');
    if (!ipAddr)
        throw new TypeError('ip address is required (string)');
    return this.get(
        format('/networks/%s/ips/%s', network, ipAddr), params, callback);
};


/**
 * Updates an IP on the given logical network
 *
 * @param {String} network : the logical network the IP is on
 * @param {String} ipAddr : the address of the IP to update
 * @param {Object} params : the parameters to update
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.updateIP = function (network, ipAddr, params, callback) {
    if (!network)
        throw new TypeError('network is required (string)');
    if (!ipAddr)
        throw new TypeError('ip address is required (string)');
    if (!params || typeof (params) !== 'object')
        throw new TypeError('params is required (object)');
    return this.put(
        format('/networks/%s/ips/%s', network, ipAddr), params, callback);
};



// --- Nic Tag methods



/**
 * Lists all Nic Tags
 *
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.listNicTags = function (params, callback) {
    return this.get('/nic_tags', params, callback);
};


/**
 * Creates a Nic Tag
 *
 * @param {String} name : the name of the nic tag.
 * @param {Object} params : the parameters to create the tag with (optional).
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.createNicTag = function (name, params, callback) {
    if (!name)
        throw new TypeError('name is required (string)');
    if (!callback) {
        callback = params;
        params = {};
    }

    params.name = name;

    return this.post('/nic_tags', params, callback);
};


/**
 * Gets a Nic tag by UUID
 *
 * @param {String} uuid : the UUID.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.getNicTag = function (uuid, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.get(format('/nic_tags/%s', uuid), callback);
};


/**
 * Updates the Nic tag specified by UUID
 *
 * @param {String} uuid : the UUID.
 * @param {Object} params : the parameters to update.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.updateNicTag = function (uuid, params, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.put(format('/nic_tags/%s', uuid),
        params, callback);
};


/**
 * Deletes the Nic tag specified by UUID
 *
 * @param {String} uuid : the UUID to update
 * @param {Object} params : the optional parameters.
 * @param {Function} callback : of the form f(err, res).
 */
NAPI.prototype.deleteNicTag = function (uuid, params, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.del(format('/nic_tags/%s', uuid),
        params, callback);
};


module.exports = NAPI;
