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

var async = require('async');
var exec = require('child_process').exec;
var format = require('util').format;
var fs = require('fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');

var common = require('/usr/img/lib/common');

// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;



// ---- globals

var WRKDIR = '/var/tmp/img-test-import';
var CACHEDIR = '/var/tmp/img-test-cache';

/*
 * Pick an image that (a) exists on datasets.jo (they *do* occassionally get
 * deprecated) and (b) is relatively small and (c) is unlikely to collide with
 * current usage.
 *
 * Also don't collide with TEST_IMAGE_UUID used in "dsapi.test.js".
 */
// minimal-32@15.2.0
var TEST_IMAGE_UUID = '0764d78e-3472-11e5-8949-4f31abea4e05';

var CACHEFILE = format('%s/%s.file', CACHEDIR, TEST_IMAGE_UUID);



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

test('setup: get test image in local SDC IMGAPI (if available)', function (t) {
    var cmd = 'sdc-imgadm import ' + TEST_IMAGE_UUID +
        ' -S https://images.joyent.com || true';
    exec(cmd, function (err, o, e) {
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
    fs.exists(CACHEFILE, function (exists) {
        if (!exists) {
            var cmd = format(
                'curl -kf https://images.joyent.com/images/%s/file >%s',
                TEST_IMAGE_UUID, CACHEFILE);
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

test('setup1: remove image ' + TEST_IMAGE_UUID, function (t) {
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

test('imgadm ancestry ' + TEST_IMAGE_UUID, function (t) {
    t.exec('imgadm ancestry ' + TEST_IMAGE_UUID, function (e, stdout, stderr) {
        var lines = stdout.trim().split(/\n/g);
        t.equal(lines.length, 2);
        t.equal(lines[0].split(/ +/g)[0], 'UUID');
        t.equal(lines[1].split(/ +/g)[0], TEST_IMAGE_UUID);
        t.equal(stderr.trim().length, 0);
        t.end();
    });
});

test('imgadm ancestry -j ' + TEST_IMAGE_UUID, function (t) {
    t.exec('imgadm ancestry -j ' + TEST_IMAGE_UUID, function (e, stdout) {
        var ancestry = JSON.parse(stdout);
        t.equal(ancestry.length, 1);
        t.equal(ancestry[0].manifest.uuid, TEST_IMAGE_UUID);
        t.equal(ancestry[0].zpool, 'zones');
        t.end();
    });
});


test('setup2: remove image ' + TEST_IMAGE_UUID, function (t) {
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


test('setup3: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

test('concurrent: imgadm install ... ' + TEST_IMAGE_UUID, function (t) {
    async.each(
        ['alice', 'bob', 'charlie'],
        function installTheImage(who, next) {
            // TODO: capture this log and assert that there was some waiting
            //       on locks?
            var cmd = format('imgadm install -m %s/%s.imgmanifest -f %s/%s.file',
                CACHEDIR, TEST_IMAGE_UUID, CACHEDIR, TEST_IMAGE_UUID);
            t.exec(cmd, function () {
                t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                    next();
                });
            });
        },
        function doneAll(err) {
            t.ifError(err);
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        }
    )
});


test('setup4: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

test('concurrent: imgadm import ' + TEST_IMAGE_UUID, function (t) {
    async.each(
        ['alice', 'bob', 'charlie'],
        function importTheImage(who, next) {
            // TODO: capture this log and assert that there was some waiting
            //       on locks?
            t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function () {
                t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                    next();
                });
            });
        },
        function doneAll(err) {
            t.ifError(err);
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        }
    )
});


test('setup5: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

/*
 * Test 'imgadm import' works using the *internal* imgadm download dir.
 * This is a dir that imgadm uses internally to download image files before
 * checking and installing. Tests:
 * 1. with a valid pre-downloaded file
 * 2. incorrect file size
 * 3. incorrect file checksum
 */
test('pre-downloaded file; imgadm import ' + TEST_IMAGE_UUID, function (t) {
    var downFile = common.downloadFileFromUuid(TEST_IMAGE_UUID);
    t.exec(format('cp %s %s', CACHEFILE, downFile), function () {
        t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function (err, o, e) {
            // Stderr has the imgadm log output. Look for the tell-tale sign
            // that the pre-downloaded image file was used.
            var marker = /"msg":"using pre-downloaded image file/;
            t.ok(marker.test(e), 'pre-downloaded image file was used');
            t.notOk(fs.existsSync(downFile));
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        });
    });
});

test('setup6: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

// This is #2 pre-downloaded-image-file test. See above.
test('pre-downloaded file (bad size); imgadm import ' + TEST_IMAGE_UUID, function (t) {
    var wrongSizeFile = '/usr/img/package.json';
    var downFile = common.downloadFileFromUuid(TEST_IMAGE_UUID);
    t.exec(format('cp %s %s', wrongSizeFile, downFile), function () {
        t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function (err, o, e) {
            // Stderr has the imgadm log output. Look for the tell-tale sign
            // that the pre-downloaded image file was discarded.
            var marker = /"msg":"unexpected size for pre-downloaded image/;
            t.ok(marker.test(e), 'pre-downloaded image file was discarded');
            t.notOk(fs.existsSync(downFile));
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        });
    });
});

test('setup7: remove image ' + TEST_IMAGE_UUID, function (t) {
    var cmd = format(
        'imgadm get %s 2>/dev/null >/dev/null && imgadm delete %s || true',
        TEST_IMAGE_UUID, TEST_IMAGE_UUID);
    t.exec(cmd, function () {
        t.end();
    });
});

// This is #3 pre-downloaded-image-file test. See above.
test('pre-downloaded file (bad checksum); imgadm import ' + TEST_IMAGE_UUID, function (t) {
    // Copy in our cached file and change it (keeping same size):
    var downFile = common.downloadFileFromUuid(TEST_IMAGE_UUID);
    t.exec(format('cp %s %s', CACHEFILE, downFile), function () {
    t.exec('echo -ne BLARG | dd conv=notrunc bs=1 count=5 of=' + downFile, function () {

        // Then test import with that bogus file there.
        t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function (err, o, e) {
            // Stderr has the imgadm log output. Look for the tell-tale sign
            // that the pre-downloaded image file was discarded.
            var marker = /"msg":"unexpected checksum for pre-downloaded image/;
            t.ok(marker.test(e), 'pre-downloaded image file was discarded');
            t.notOk(fs.existsSync(downFile));
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        });

    }); // BLARG
    }); // cp
});



// Need a test IMGAPI for the following:
// TODO: test case importing from IMGAPI *with an origin*
// TODO: test case 'imgadm ancestry' on the zfs-dataset image with origin
// TODO: test case for a layer download error in multi-layer import
