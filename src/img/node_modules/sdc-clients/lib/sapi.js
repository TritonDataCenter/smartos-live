/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Client library for the SDC Services API (SAPI)
 */

var assert = require('assert-plus');
var util = require('util');

var sprintf = require('util').format;

var RestifyClient = require('./restifyclient');


// --- Exported Client

/**
 * Constructor
 *
 * See the RestifyClient constructor for details
 */
function SAPI(options) {
    RestifyClient.call(this, options);
}

util.inherits(SAPI, RestifyClient);


// --- Applications

/**
 * Create an application
 *
 * @param {Function} callback: of the form f(err, app).
 */
function createApplication(name, owner_uuid, opts, callback) {
    assert.string(name, 'name');
    assert.string(owner_uuid, 'owner_uuid');

    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    opts.name = name;
    opts.owner_uuid = owner_uuid;

    return (this.post('/applications', opts, callback));
}

SAPI.prototype.createApplication = createApplication;


/**
 * Lists all applications
 *
 * @param {Function} callback: of the form f(err, apps).
 */
function listApplications(callback) {
    return (this.get('/applications', callback));
}

SAPI.prototype.listApplications = listApplications;


/**
 * Gets an application by UUID
 *
 * @param {String} uuid: the UUID of the applications.
 * @param {Function} callback: of the form f(err, app).
 */
function getApplication(uuid, callback) {
    return (this.get(sprintf('/applications/%s', uuid), callback));
}

SAPI.prototype.getApplication = getApplication;


/**
 * Deletes  an application by UUID
 *
 * @param {String} uuid: the UUID of the applications.
 * @param {Function} callback : of the form f(err).
 */
function deleteApplication(uuid, callback) {
    return (this.del(sprintf('/applications/%s', uuid), callback));
}

SAPI.prototype.deleteApplication = deleteApplication;



// --- Services

/**
 * Create a service
 *
 * @param {Function} callback: of the form f(err, app).
 */
function createService(name, application_uuid, opts, callback) {
    assert.string(name, 'name');
    assert.string(application_uuid, 'application_uuid');

    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    opts.name = name;
    opts.application_uuid = application_uuid;

    return (this.post('/services', opts, callback));
}

SAPI.prototype.createService = createService;


/**
 * Lists all services
 *
 * @param {Function} callback: of the form f(err, apps).
 */
function listServices(callback) {
    return (this.get('/services', callback));
}

SAPI.prototype.listServices = listServices;


/**
 * Gets a service by UUID
 *
 * @param {String} uuid: the UUID of the services.
 * @param {Function} callback: of the form f(err, app).
 */
function getService(uuid, callback) {
    return (this.get(sprintf('/services/%s', uuid), callback));
}

SAPI.prototype.getService = getService;


/**
 * Deletes a service by UUID
 *
 * @param {String} uuid: the UUID of a service.
 * @param {Function} callback : of the form f(err).
 */
function deleteService(uuid, callback) {
    return (this.del(sprintf('/services/%s', uuid), callback));
}

SAPI.prototype.deleteService = deleteService;



// --- Instances

/**
 * Create an instance
 *
 * @param {Function} callback: of the form f(err, app).
 */
function createInstance(name, service_uuid, opts, callback) {
    assert.string(name, 'name');
    assert.string(service_uuid, 'service_uuid');

    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    opts.name = name;
    opts.service_uuid = service_uuid;

    return (this.post('/instances', opts, callback));
}

SAPI.prototype.createInstance = createInstance;


/**
 * Lists all instances
 *
 * @param {Function} callback: of the form f(err, instances).
 */
function listInstances(callback) {
    return (this.get('/instances', callback));
}

SAPI.prototype.listInstances = listInstances;


/**
 * Gets an instance by UUID
 *
 * @param {String} uuid: the UUID of the instance.
 * @param {Function} callback: of the form f(err, instance).
 */
function getInstance(uuid, callback) {
    return (this.get(sprintf('/instances/%s', uuid), callback));
}

SAPI.prototype.getInstance = getInstance;


/**
 * Deletes an instance by UUID
 *
 * @param {String} uuid: the UUID of an instance.
 * @param {Function} callback : of the form f(err).
 */
function deleteInstance(uuid, callback) {
    return (this.del(sprintf('/instances/%s', uuid), callback));
}

SAPI.prototype.deleteInstance = deleteInstance;



// --- Configs

/**
 * Create a config
 *
 * @param {Function} callback: of the form f(err, app).
 */
function createConfig(name, template, path, type, service, callback) {
    assert.string(name, 'name');
    assert.string(template, 'template');
    assert.string(path, 'path');
    assert.string(type, 'type');

    if (typeof (service) === 'function') {
        callback = service;
        service = null;
    }

    var opts = {};
    opts.name = name;
    opts.template = template;
    opts.path = path;
    opts.type = type;
    if (service)
        opts.service = service;

    return (this.post('/config', opts, callback));
}

SAPI.prototype.createConfig = createConfig;


/**
 * Lists all configs
 *
 * @param {Function} callback: of the form f(err, configs).
 */
function listConfigs(callback) {
    return (this.get('/config', callback));
}

SAPI.prototype.listConfigs = listConfigs;


/**
 * Gets a config by UUID
 *
 * @param {String} uuid: the UUID of the config.
 * @param {Function} callback: of the form f(err, config).
 */
function getConfig(uuid, callback) {
    return (this.get(sprintf('/config/%s', uuid), callback));
}

SAPI.prototype.getConfig = getConfig;


/**
 * Deletes a config by UUID
 *
 * @param {String} uuid: the UUID of a config.
 * @param {Function} callback : of the form f(err).
 */
function deleteConfig(uuid, callback) {
    return (this.del(sprintf('/config/%s', uuid), callback));
}

SAPI.prototype.deleteConfig = deleteConfig;



// -- Images

function searchImages(name, callback) {
    assert.string(name, 'name');
    assert.func(callback, 'callback');

    return (this.get(sprintf('/images?name=%s', name), callback));
}

SAPI.prototype.searchImages = searchImages;

function downloadImage(uuid, callback) {
    assert.string(uuid, 'uuid');
    assert.func(callback, 'callback');

    return (this.post(sprintf('/images/%s', uuid), callback));
}

SAPI.prototype.downloadImage = downloadImage;



module.exports = SAPI;
