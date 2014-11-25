/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var assert = require('assert-plus');
var bunyan = require('bunyan');
var fmt = require('util').format;
var restify = require('restify');



// --- Globals



var INDEX_URL = 'https://index.docker.io';



// --- Index object



function Index(opts) {
    assert.object(opts, 'opts');
    assert.optionalObject(opts.log, 'opts.log');

    this.log = opts.log || bunyan.createLogger({ name: 'index' });
    this.url = opts.url || INDEX_URL;
}


Index.prototype.jsonClient = function jsonClient(opts) {
    return restify.createJsonClient({
        log: this.log,
        url: this.url
    });
};


/**
 * Get repository information from the index.
 */
Index.prototype.getRepository = function getRepository(repo, callback) {
    var client = this.jsonClient();

    // XXX: Might need to support repos without a slash in them, which have an
    // implicit 'library', eg: 'mongo' -> 'library/mongo'

    client.get({
        path: fmt('/v1/repositories/%s/images', repo),
        headers: {
            'X-Docker-Token': true
        }
    }, function _afterGetRepo(err, req, res, obj) {
        if (err) {
            return callback(err);
        }

        var endpoints = res.headers['x-docker-endpoints'];
        var repoObj = {
            images: obj,
            headers: res.headers,
            registries: endpoints ? endpoints.split(',') : [],
            token: res.headers['x-docker-token']
        };

        return callback(null, repoObj);
    });
};



// --- Exports



function createIndexClient(opts) {
    return new Index(opts);
}



module.exports = {
    create: createIndexClient
};
