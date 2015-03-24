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


var WRKDIR = '/var/tmp/img-test-create'
var TESTDIR = __dirname;

// Base image from which we'll be creating a custom images.
var BASE_UUID = 'f669428c-a939-11e2-a485-b790efc0f0c1'; // base 13.1.0

var envWithTrace = objCopy(process.env);
envWithTrace.TRACE = '1';



// ---- internal support stuff

function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}


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


// ---- tests

test('custom image (compression=none)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/1 none >%s/mk-custom-image.1.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.1.log';
        var cmd = format('%s/try-custom-image %s/1.imgmanifest %s/1.zfs >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (incremental, compression=none)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/1i none -i >%s/mk-custom-image.1i.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.1i.log';
        var cmd = format('%s/try-custom-image %s/1i.imgmanifest %s/1i.zfs >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (compression=gzip)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/2 gzip >%s/mk-custom-image.2.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.2.log';
        var cmd = format('%s/try-custom-image %s/2.imgmanifest %s/2.zfs.gz >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (incremental, compression=gzip)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/2i gzip -i >%s/mk-custom-image.2i.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.2i.log';
        var cmd = format('%s/try-custom-image %s/2i.imgmanifest %s/2i.zfs.gz >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (incremental, compression=bzip2)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/3i bzip2 -i >%s/mk-custom-image.3i.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.3i.log';
        var cmd = format('%s/try-custom-image %s/3i.imgmanifest %s/3i.zfs.bz2 >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (compression=xz)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/4 xz >%s/mk-custom-image.4.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.4.log';
        var cmd = format('%s/try-custom-image %s/4.imgmanifest %s/4.zfs.xz >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});

test('custom image (incremental, compression=xz)', function (t) {
    var cmd = format('%s/mk-custom-image %s %s/4i xz -i >%s/mk-custom-image.4i.log 2>&1',
        TESTDIR, BASE_UUID, WRKDIR, WRKDIR);
    exec(cmd, {env: envWithTrace}, function (err, stdout, stderr) {
        t.ifError(err, format('error running "%s": %s', cmd, err));
        var logfile = WRKDIR + '/try-custom-image.4i.log';
        var cmd = format('%s/try-custom-image %s/4i.imgmanifest %s/4i.zfs.xz >%s 2>&1',
            TESTDIR, WRKDIR, WRKDIR, logfile);
        exec(cmd, function (err) {
            t.ifError(err, format('error running "%s": %s', cmd, err));
            var output = fs.readFileSync(logfile, 'utf8');
            t.ok(output.indexOf('hi from mk-custom-image') !== -1,
                format('could not find expected marker in output:\n--\n%s\n--\n',
                    output));
            t.end();
        });
    });
});
