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
 * Copyright (c) 2015, Pagoda Box, Inc. All rights reserved.
 *
 */

var net = require('net');

var HOST = '127.0.0.1';
var PORT = 9090;

exports.DEFAULT_HOST = HOST;
exports.DEFAULT_PORT = PORT;

/*
 * Runs a simple check against the vminfo socket to see if it's connectable
 */
exports.isOnline(function (cb) {
    var client = net.connect({port: PORT, host: HOST}, function () {
        client.end();
        cb(true);
    });

    client.on('error', function () {
        cb(false);
    });
});

/*
 * Checks to see if the socket is accepting connections AND also checks
 * to see if the vminfo daemon is available to process requests.
 */
exports.isReady(function (cb) {
    // TODO: make it work :)
});