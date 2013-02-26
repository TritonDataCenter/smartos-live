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
 * Some base imgadm tests.
 */

var format = require('util').format;
var exec = require('child_process').exec;


// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;


var IMGADM = 'imgadm';


before(function (next) {
    next();
});


test('imgadm --version', function (t) {
    exec(IMGADM + ' --version', function (err, stdout, stderr) {
        t.ifError(err, err);
        t.equal(stderr, '', 'stderr');
        t.ok(/^imgadm \d+\.\d+\.\d+/.test(stdout),
            format('stdout is a version: "%s"', stdout.trim()));
        t.end();
    });
});

['', ' --help', ' -h', ' help'].forEach(function (args) {
    test('imgadm' + args, function (t) {
        exec(IMGADM + args, function (err, stdout, stderr) {
            t.ifError(err, err);
            t.equal(stderr, '', 'stderr');
            t.ok(/\nUsage:/.test(stdout), 'stdout has help');
            t.end();
        });
    });
});

test('imgadm help sources', function (t) {
    exec(IMGADM + ' help sources', function (err, stdout, stderr) {
        t.ifError(err, err);
        t.equal(stderr, '', 'stderr');
        t.ok(/imgadm sources/.test(stdout),
            format('stdout is imgadm sources help: "%s..."',
                   stdout.trim().split(/\n/, 1)[0]));
        t.end();
    });
});


var BOGUS_UUID = '29fa922a-7fa7-11e2-bffa-5b6fe63a8d5e';
test('`imgadm info BOGUS_UUID` ImageNotInstalled error', function (t) {
    exec(IMGADM + ' info ' + BOGUS_UUID, function (err, stdout, stderr) {
        t.ok(err, err);
        t.equal(err.code, 3);
        t.ok(/ImageNotInstalled/.test(stderr),
            'ImageNotInstalled error code on stderr');
        t.equal(stdout, '', 'no stdout');

        t.end();
    });
});
