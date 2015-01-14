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
 */

var p = console.log;

var assert = require('assert-plus');
var dsapi = require('sdc-clients/lib/dsapi');
var path = require('path');
var util = require('util');

var common = require('../common');
var errors = require('../errors');
var Source = require('./source');
var ImgapiSource = require('./imgapi');


// ---- dsapi source
// Mostly like the 'imgapi' source with some diffs.

function DsapiSource(opts) {
    var self = this;

    this.__defineGetter__('client', function () {
        if (this._client === undefined) {
            if (! /\/datasets\/?$/.test(self.normUrl)) {
                throw new errors.ConfigError(format(
                    '"dsapi" source URL does not end with "/datasets": "%s"',
                    self.normUrl));
            }
            // drop 'datasets/' tail
            var baseNormUrl = path.dirname(self.normUrl);
            this._client = dsapi.createClient({
                url: baseNormUrl,
                log: self.log,
                rejectUnauthorized: (process.env.IMGADM_INSECURE !== '1'),
                userAgent: self.userAgent
            });
        }
        return this._client;
    });

    Source.call(this, opts);
}
util.inherits(DsapiSource, ImgapiSource);

DsapiSource.prototype.type = 'dsapi';

DsapiSource.prototype.ping = function ping(cb) {
    var self = this;
    this.client.ping(function (err, pong, res) {
        if (err || res.statusCode !== 200) {
            if (res && res.headers['content-type'] !== 'application/json') {
                var body = res.body;
                if (body && body.length > 1024) {
                    body = body.slice(0, 1024) + '...';
                }
                err = new Error(format(
                    'statusCode %s, response not JSON:\n%s',
                    res.statusCode, common.indent(body)));
            }
            cb(new errors.SourcePingError(err, self));
            return;
        }
        cb();
    });
};


module.exports = DsapiSource;
