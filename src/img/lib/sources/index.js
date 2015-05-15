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

/**
 * Abstracted API for talking to different imgadm sources: imgapi,
 * dsapi (deprecated), docker (experimental).
 */

var p = console.log;

var assert = require('assert-plus');
var imgapi = require('sdc-clients/lib/imgapi');
var util = require('util');

var common = require('../common');
var errors = require('../errors');

var Source = require('./source');
var DockerSource = require('./docker');
var DsapiSource = require('./dsapi');
var ImgapiSource = require('./imgapi');


// ---- exports

/**
 * Create an imgadm `Source`
 */
function createSource(type, opts) {
    assert.string(type, 'type');
    assert.optionalObject(opts, 'opts');

    var source;
    switch (type) {
    case 'imgapi':
        source = new ImgapiSource(opts);
        break;
    case 'docker':
        source = new DockerSource(opts);
        break;
    case 'dsapi':
        source = new DsapiSource(opts);
        break;
    default:
        throw new Error(format('invalid source type: "%s"', type));
    };

    return source;
}


function isSource(s) {
    return (s instanceof Source);
}


module.exports = {
    createSource: createSource,
    isSource: isSource
};
