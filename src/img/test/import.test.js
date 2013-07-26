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
 *
 * Test 'imgadm import' and 'imgadm install'.
 */

var p = console.log;
var format = require('util').format;
var exec = require('child_process').exec;
var fs = require('fs');

var rimraf = require('rimraf');
var mkdirp = require('mkdirp');

// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;



var IMGADM = 'imgadm';
var WRKDIR = '/var/tmp/img-test-import';
var CACHEDIR = '/var/tmp/img-test-cache';

// smartos 1.6.2, because its file is relatively small and it is unlikely to
// collide with current usage.
var TEST_IMAGE_UUID = 'a93fda38-80aa-11e1-b8c1-8b1f33cd9007';



// ---- setup

test('setup: clean WRKDIR (' + WRKDIR + ')', function (t) {
    rimraf(WRKDIR, function (err) {
        t.ifError(err);
        mkdirp(WRKDIR, function (err2) {
            t.ifError(err2);
            t.end();
        });
    });
});

test('setup: ensure images.joyent.com source', function (t) {
    exec('imgadm sources -a https://images.joyent.com', function (err, o, e) {
        t.ifError(err);
        t.end();
    });
});

test('setup: CACHEDIR (' + CACHEDIR + ')', function (t) {
    mkdirp(CACHEDIR, function (err) {
        t.ifError(err);
        t.end();
    })
});

test('setup: cache test image manifest', function (t) {
    var pth = format('%s/%s.imgmanifest', CACHEDIR, TEST_IMAGE_UUID);
    fs.exists(pth, function (exists) {
        if (!exists) {
            var cmd = format('curl -kf https://images.joyent.com/images/%s >%s',
                TEST_IMAGE_UUID, pth);
            exec(cmd, function (err, stdout, stderr) {
                t.ifError(err);
                t.end();
            });
        } else {
            t.end();
        }
    });
});

test('setup: cache test image file', function (t) {
    var pth = format('%s/%s.file', CACHEDIR, TEST_IMAGE_UUID);
    fs.exists(pth, function (exists) {
        if (!exists) {
            var cmd = format(
                'curl -kf https://images.joyent.com/images/%s/file >%s',
                TEST_IMAGE_UUID, pth);
            exec(cmd, function (err, stdout, stderr) {
                t.ifError(err);
                t.end();
            });
        } else {
            t.end();
        }
    });
});


// ---- tests

test('precondition: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

test('imgadm import ' + TEST_IMAGE_UUID, function (t) {
    t.exec('imgadm import ' + TEST_IMAGE_UUID, function () {
        t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
            t.end();
        });
    });
});

test('precondition: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

test('imgadm install ... ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format('imgadm install -m %s/%s.imgmanifest -f %s/%s.file',
        CACHEDIR, TEST_IMAGE_UUID, CACHEDIR, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
            t.end();
        });
    });
});

