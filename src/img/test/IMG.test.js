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
 * Copyright (c) 2015, Joyent, Inc. All rights reserved.
 */

/*
 * Test IMG.js API.
 */

var p = console.log;
var format = require('util').format;
var exec = require('child_process').exec;


// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;

var common = require('../lib/common');


var IMG;
var EXISTS_UUID;
var NO_EXIST_UUID = 'ffffffff-9af3-11e4-9a12-1347427b8f9a';

test('setup: get existing UUID', function (t) {
    exec('imgadm list -H -o uuid', function (err, stdout, stderr) {
        t.ifError(err);
        EXISTS_UUID = stdout.split(/\n/g)[0];
        t.end();
    });
});

test('require("/usr/img/lib/IMG")', function (t) {
    IMG = require('/usr/img/lib/IMG');
    t.end();
});

test('IMG.*', function (t) {
    IMG.quickGetImage;
    t.end();
});

test('IMG.quickGetImage', function (t) {
    var opts = {uuid: EXISTS_UUID, zpool: common.DEFAULT_ZPOOL};
    IMG.quickGetImage(opts, function (err, info) {
        t.ifError(err);
        t.ok(info);
        t.equal(info.manifest.uuid, EXISTS_UUID);
        t.end();
    });
});

test('IMG.quickGetImage err', function (t) {
    var opts = {uuid: NO_EXIST_UUID, zpool: common.DEFAULT_ZPOOL};
    IMG.quickGetImage(opts, function (err, info) {
        t.ok(err);
        t.equal(err.exitStatus, 3);
        t.equal(err.code, 'ImageNotInstalled');
        t.end();
    });
});

