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


function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}



test('imgadm --version', function (t) {
    exec('imgadm --version', function (err, stdout, stderr) {
        t.ifError(err, err);
        t.equal(stderr, '', 'stderr');
        t.ok(/^imgadm \d+\.\d+\.\d+/.test(stdout),
            format('stdout is a version: "%s"', stdout.trim()));
        version = stdout.split(/\s+/g)[1];
        var expectedVersion = require('/usr/img/package.json').version;
        t.equal(version, expectedVersion);
        t.end();
    });
});

['', ' --help', ' -h', ' help'].forEach(function (args) {
    test('imgadm' + args, function (t) {
        exec('imgadm' + args, function (err, stdout, stderr) {
            t.ifError(err, err);
            t.equal(stderr, '', 'stderr');
            t.ok(/\nUsage:/.test(stdout), 'stdout has help');
            t.end();
        });
    });
});


test('imgadm -v   # bunyan debug log on stderr', function (t) {
    exec('imgadm -v bogus', function (err, stdout, stderr) {
        t.ok(err);
        t.equal(err.code, 1);
        t.equal(stdout, '', 'stdout');
        t.ok(stderr);
        var firstLine = stderr.split(/\n/g)[0];
        var record = JSON.parse(firstLine);
        t.equal(record.name, 'imgadm',
            'first line of stderr is a bunyan log record');
        t.end();
    });
});

test('IMGADM_LOG_LEVEL=trace imgadm   # bunyan "src" log on stderr', function (t) {
    var env = objCopy(process.env);
    env.IMGADM_LOG_LEVEL = 'trace';
    var execOpts = {env: env};
    exec('imgadm bogus', execOpts, function (err, stdout, stderr) {
        t.ok(err);
        t.equal(err.code, 1);
        t.equal(stdout, '', 'stdout');
        t.ok(stderr);
        var firstLine = stderr.split(/\n/g)[0];
        var record = JSON.parse(firstLine);
        t.equal(record.name, 'imgadm',
            'first line of stderr is a bunyan log record');
        t.ok(record.src, 'have "src" info in logging');
        t.ok(!isNaN(record.src.line), '"src.line" is a number');
        t.end();
    });
});


test('imgadm -E -vv   # structured error last line', function (t) {
    exec('imgadm -E -vv bogus', function (err, stdout, stderr) {
        t.ok(err);
        t.equal(err.code, 1);
        t.equal(stdout, '', 'stdout');
        t.ok(stderr);
        var lastLine = stderr.trim().split(/\n/g).slice(-1);
        try {
            var record = JSON.parse(lastLine);
        } catch (e) {
            t.ok(false, 'could not parse last line of stderr: ' + lastLine);
        }
        if (record) {
            t.equal(record.name, 'imgadm',
                'last line of stderr is a bunyan log record');
            t.ok(record.err, 'last line has error info');
            t.equal(record.err.code, 'UnknownCommand');
        }
        t.end();
    });
});


test('imgadm help sources', function (t) {
    exec('imgadm help sources', function (err, stdout, stderr) {
        t.ifError(err, err);
        t.equal(stderr, '', 'stderr');
        t.ok(/imgadm sources/.test(stdout),
            format('stdout is imgadm sources help: "%s..."',
                   stdout.trim().split(/\n/, 1)[0]));
        t.end();
    });
});


var BOGUS_UUID = '29fa922a-7fa7-11e2-bffa-5b6fe63a8d5e';
test('`imgadm info BOGUS_UUID` ImageNotInstalled error, rv 3', function (t) {
    exec('imgadm info ' + BOGUS_UUID, function (err, stdout, stderr) {
        t.ok(err, err);
        t.equal(err.code, 3);
        t.ok(/ImageNotInstalled/.test(stderr),
            'ImageNotInstalled error code on stderr');
        t.equal(stdout, '', 'no stdout');

        t.end();
    });
});
