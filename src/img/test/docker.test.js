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
 * Test Docker source integration.
 */

var p = console.log;
var format = require('util').format;
var exec = require('child_process').exec;
var fs = require('fs');

var async = require('async');
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
var WRKDIR = '/var/tmp/img-test-docker';
var CACHEDIR = '/var/tmp/img-test-cache';

var sourcesHadDockerHub;
var testImgArg = 'busybox:ubuntu-12.04'; // ideally small and typically unused
var testImg;



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

/**
 * Also note if we *had* a docker hub source already to know to not remove
 * it at the end.
 */
test('setup: ensure docker hub source', function (t) {
    t.exec('imgadm sources -j', function (err, stdout, stderr) {
        var sources = JSON.parse(stdout);
        sourcesHadDockerHub = false;
        sources.forEach(function (s) {
            if (s.type === 'docker' && s.url === 'https://index.docker.io') {
                sourcesHadDockerHub = true;
            }
        });
        t.exec('imgadm sources --add-docker-hub', function () {
            t.end();
        });
    });
});

test('setup: get test image id', function (t) {
    t.exec('imgadm show ' + testImgArg, function (err, stdout) {
        testImg = JSON.parse(stdout);
        t.end();
    });
});


// ---- tests

// TODO: should remove as much as possible of its layer chain.
test('precondition1: remove image UUID-OF:' + testImgArg, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        testImg.uuid, testImg.uuid);
    t.exec(cmd, function () {
        t.end();
    });
});

test('imgadm import ' + testImgArg, function (t) {
    t.exec('imgadm import ' + testImgArg, function () {
        t.exec('imgadm get ' + testImg.uuid, function () {
            t.end();
        });
    });
});


test('imgadm ancestry UUID-OF:' + testImgArg, function (t) {
    t.exec('imgadm ancestry ' + testImg.uuid, function (e, stdout, stderr) {
        var lines = stdout.trim().split(/\n/g);
        t.ok(lines.length > 2);
        t.equal(lines[0].split(/ +/g)[0], 'UUID');
        t.equal(lines[1].split(/ +/g)[0], testImg.uuid);
        t.equal(stderr.trim().length, 0);
        t.end();
    });
});

test('imgadm ancestry -j UUID-OF:' + testImgArg, function (t) {
    t.exec('imgadm ancestry -j ' + testImg.uuid, function (e, stdout) {
        var ancestry = JSON.parse(stdout);
        t.ok(ancestry.length > 1);
        t.equal(ancestry[0].manifest.uuid, testImg.uuid);
        t.equal(ancestry[0].zpool, 'zones');
        t.end();
    });
});


test('imgadm list type=docker', function (t) {
    t.exec('imgadm list type=docker', function (e, stdout) {
        var lines = stdout.trim().split(/\n/g);
        t.ok(lines.length > 2);
        t.equal(lines.filter(function (line) {
            return line.split(/ +/g)[0] === testImg.uuid;
        }).length, 1);
        t.end();
    });
});

test('imgadm list --docker', function (t) {
    t.exec('imgadm list --docker', function (e, stdout) {
        var lines = stdout.trim().split(/\n/g);

        var drc = require('docker-registry-client');
        var rat = drc.parseRepoAndTag(testImgArg);

        var matches = lines.filter(function (line) {
            var parts = line.split(/ +/g);
            return (
                parts[0] === testImg.uuid
                && parts[1] === rat.repo
                && parts[2] === rat.tag
            );
        });
        t.equal(matches.length, 1);
        t.end();
    });
});


// TODO: should remove as much as possible of its layer chain.
test('cleanup: remove image UUID-OF:' + testImgArg, function (t) {
    t.exec('imgadm delete ' + testImg.uuid, function () {
        t.end();
    });
});
