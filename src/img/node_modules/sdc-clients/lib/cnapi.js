/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Compute Node API (CNAPI)
 */

var util = require('util');
var format = util.format;

var RestifyClient = require('./restifyclient');



// --- Exported Client


/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function CNAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(CNAPI, RestifyClient);


/**
 * Gets boot params for the given CN
 *
 * @param {String} uuid : CN UUID to get
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getBootParams = function (uuid, callback) {
    if (!uuid)
        throw new TypeError('uuid is required (string)');
    return this.get(format('/boot/%s', uuid), callback);
};



/**
 * Lists all servers
 *
 * @param {Object} params : Filter params.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.listServers = function (params, callback) {
    if (typeof (params) === 'function') {
        callback = params;
        params = {};
    }
    return this.get('/servers', params, callback);
};



/**
 * Gets a server by UUID
 *
 * @param {String} uuid : the UUID of the server.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getServer = function (uuid, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');

    return this.get(format('/servers/%s', uuid), callback);
};

/**
 * Setup a server by UUID
 *
 * @param {String} uuid : the UUID of the server.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.setupServer = function (uuid, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');

    return this.put(format('/servers/%s/setup', uuid), {}, callback);
};


/**
 * Gets a task
 *
 * @param {String} id : the task id.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getTask = function (id, callback) {
    if (!id)
        throw new TypeError('Task Id is required');

    return this.get(format('/tasks/%s', id), callback);
};



/**
 * Creates a vm
 *
 * @param {String} server : the UUID of the server.
 * @param {Object} params : attributes of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.createVm = function (server, params, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!params || typeof (params) !== 'object')
        throw new TypeError('params is required (object)');

    return this.post(format('/servers/%s/vms', server), params, callback);
};



/**
 * Gets a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.getVm = function (server, uuid, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');

    return this.get(format('/servers/%s/vms/%s', server, uuid), callback);
};



/**
 * Stops a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.stopVm = function (server, uuid, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');

    return this.post(format('/servers/%s/vms/%s/stop', server, uuid),
                     {}, callback);
};



/**
 * Starts a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.startVm = function (server, uuid, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');

    return this.post(format('/servers/%s/vms/%s/start', server, uuid),
                     {}, callback);
};



/**
 * Reboots a vm on a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.rebootVm = function (server, uuid, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');

    return this.post(format('/servers/%s/vms/%s/reboot', server, uuid),
                     {}, callback);
};

/**
 * Update a server
 *
 * @param {String} uuid : server uuid
 * @param {Object} params : Filter params.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.updateServer = function (uuid, params, callback) {
    if (!uuid)
        throw new TypeError('UUID is required');

    if (typeof (params) !== 'object')
        throw new TypeError('params must be an object');

    return this.post('/servers/' + uuid, params, callback);
};




/**
 * Deletes a vm from a server
 *
 * @param {String} server : the UUID of the server.
 * @param {String} uuid : the UUID of the vm.
 * @param {Function} callback : of the form f(err, res).
 */
CNAPI.prototype.deleteVm = function (server, uuid, callback) {
    if (!server)
        throw new TypeError('Server UUID is required');
    if (!uuid)
        throw new TypeError('VM UUID is required');

    return this.del(format('/servers/%s/vms/%s', server, uuid), callback);
};



module.exports = CNAPI;
