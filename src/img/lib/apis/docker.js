/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * * *
 * An IMGAPI-like API (as used by 'imgadm') front end for the Docker
 * Hub/Registry APIs.
 *
 *      var docker = require('./apis/docker');
 *      var client = docker.createClient({url: <URL>, ...});
 *      client.ping(function (err, pong, res) { ... });
 */

var p = console.log;

var assert = require('assert-plus');
var dockerRegistryClient = require('docker-registry-client');

var errors = require('../errors');



// ---- globals


// ---- internal support stuff


// ---- DockerClient class

/**
 * By which we mean a client for the Docker *registry* (and Hub, aka Index)
 * API -- as opposed to the Docker Remote API.  This one is wrapped up to
 * look like IMGAPI, specifically the subset of IMGAPI used by imgadm and
 * supported by imgadm docker integration.
 */
function DockerClient(opts) {
    assert.object(opts, 'opts');
    assert.string(opts.url, 'opts.url');
    assert.optionalObject(opts.log, 'opts.log');

    this.client = dockerRegistryClient.registry.create({
        url: opts.url,
        log: opts.log
    });
}


DockerClient.prototype.ping = function ping(cb) {
    this.client.getStatus(function (err, body, res) {
        cb(err, body, res);
    });
};


DockerClient.prototype.listImages = function listImages(filters, opts, cb) {
    XXX // can't list all docker images, can't search with same filters
    // Perhaps 'imgadm avail' just isn't supported for type=docker, ...
    // or only with a search term. Or 'avail' looks at the current docker
    // repos in use and searches for those?
};


// ---- exports

/**
 * Create an IMGADM tool.
 *
 * @params options {Object}
 *      - log {Bunyan Logger} Required.
 * @params callback {Function} `function (err)`
 */
function createClient(opts) {
    return new DockerClient(opts);
}

module.exports = {
    createClient: createClient
};
