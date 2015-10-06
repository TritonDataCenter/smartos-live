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
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * * *
 * imgadm tests using the old DSAPI (still supported, but nearing obsolete).
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


// ---- globals

/*
 * Pick an image that (a) exists on datasets.jo (they *do* occassionally get
 * deprecated) and (b) is relatively small and (c) is unlikely to collide with
 * current usage.
 *
 * Also don't collide with TEST_IMAGE_UUID used in "import.test.js".
 */
// minimal-64@15.2.0
var TEST_IMAGE_UUID = '0764d78e-3472-11e5-8949-4f31abea4e05';


// ---- tests
// For some of the DSAPI-using tests we need to make sure that
// datasets.jo is *before* images.jo in the list of sources. `imgadm sources`
// doesn't provide an easy way to add in order.

test('imgadm sources -d images.jo', function (t) {
    exec('imgadm sources -d https://images.joyent.com',
            function (err, stdout, stderr) {
        t.ifError(err, err);
        t.end();
    });
});
test('imgadm sources -a DSAPI', function (t) {
    exec('imgadm sources -a https://datasets.joyent.com/datasets -t dsapi',
            function (err, stdout, stderr) {
        t.ifError(err, err);
        t.end();
    });
});


// OS-2981: we broke 'imgadm avail' with a DSAPI source once.
test('imgadm avail', function (t) {
    exec('imgadm avail -o source,uuid,name | grep datasets.joyent.com',
            function (err, stdout, stderr) {
        t.ifError(err, err);
        t.ok(/base/.test(stdout), 'datasets.joyent.com provides a "base" img');
        t.end();
    });
});


// Ensure import from DSAPI works.
test('setup: remove image ' + TEST_IMAGE_UUID, function (t) {
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
test('cleanup: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});


// Clean up imgadm sources. We're *presuming* images.jo was on the list.
test('imgadm sources -d DSAPI', function (t) {
    exec('imgadm sources -d https://datasets.joyent.com/datasets',
            function (err, stdout, stderr) {
        t.ifError(err, err);
        t.end();
    });
});
test('imgadm sources -a images.jo', function (t) {
    exec('imgadm sources -a https://images.joyent.com',
            function (err, stdout, stderr) {
        t.ifError(err, err);
        t.end();
    });
});
