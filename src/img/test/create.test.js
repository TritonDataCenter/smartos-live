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
 * Testing 'imgadm create'.
 */

var p = console.log;
var format = require('util').format;
var exec = require('child_process').exec;
var fs = require('fs');

var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var IMGAPI = require('sdc-clients').IMGAPI;

// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;


var WRKDIR = '/var/tmp/imgadm-test-create'
var TESTDIR = __dirname;

// Base image from which we'll be creating a custom images.
var BASE_UUID = 'f669428c-a939-11e2-a485-b790efc0f0c1'; // base 13.1.0


// ---- setup

test('setup: clean WRKDIR', function (t) {
    rimraf(WRKDIR, function (err) {
        t.ifError(err);
        mkdirp(WRKDIR, function (err2) {
            t.ifError(err2);
            t.end();
        });
    });
});


// ---- tests

test('custom image (compression=none)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/1 none',
        TESTDIR, BASE_UUID, WRKDIR);
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var cmd = format('%s/try-custom-image %s/1.imgmanifest %s/1.zfs',
            TESTDIR, WRKDIR, WRKDIR);
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            t.ok(stdout.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in stdout:\n--\n%s\n--\n',
                    stdout));
            t.end();
        });
    });
});

test('custom image (compression=gzip)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/2 gzip',
        TESTDIR, BASE_UUID, WRKDIR);
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var cmd = format('%s/try-custom-image %s/2.imgmanifest %s/2.zfs.gz',
            TESTDIR, WRKDIR, WRKDIR);
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            t.ok(stdout.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in stdout:\n--\n%s\n--\n',
                    stdout));
            t.end();
        });
    });
});

test('custom image (compression=bzip2)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/3 bzip2', TESTDIR, BASE_UUID, WRKDIR);
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var cmd = format('%s/try-custom-image %s/3.imgmanifest %s/3.zfs.bz2',
            TESTDIR, WRKDIR, WRKDIR);
        exec(cmd, function (err, stdout, stderr) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            t.ok(stdout.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in stdout:\n--\n%s\n--\n',
                    stdout));
            t.end();
        });
    });
});
