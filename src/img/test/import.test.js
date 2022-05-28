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
 * Copyright 2020 Joyent, Inc.
 * Copyright 2022 MNX Cloud, Inc.
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
 * Pick an image that (a) exists on images.smartos.org (they *do* occasionally
 * get deprecated) and (b) is relatively small and (c) is unlikely to collide
 * with current usage.
 */
// minimal-32@15.2.0
var TEST_IMAGE_UUID = '0764d78e-3472-11e5-8949-4f31abea4e05';

/*
 * An image that only exists on the experimental channel of
 * updates.tritondatacenter.com. Similar to the note above, hopefully this
 * image will always be here and will not be present on images.smartos.org,
 * since tests rely on this fact. During setup, we import the origin image for
 * this experimental image. The origin image must exist on images.smartos.org
 * because the experimental source hasn't been added when the origin is
 * imported.
 */
var TEST_EXPERIMENTAL_SOURCE =
    'https://updates.tritondatacenter.com?channel=experimental';
// triton-origin-multiarch-15.4.1
var TEST_EXPERIMENTAL_ORIGIN = '04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f';
// vmapi@TRITON-2-20170509T232314Z-g59995b6
var TEST_EXPERIMENTAL_UUID = '7322d2f6-350f-11e7-9aac-cb944265a7cd';

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

test('setup: ensure images.smartos.org source', function (t) {
    exec('imgadm sources -a https://images.smartos.org', function (err, o, e) {
        t.ifError(err);
        t.end();
    });
});

test('setup: get test image in local SDC IMGAPI (if available)', function (t) {
    var cmd = 'sdc-imgadm import ' + TEST_IMAGE_UUID
        + ' -S https://images.smartos.org || true';
    exec(cmd, function (err, o, e) {
        t.ifError(err);
        t.end();
    });
});

test('setup: get origin for experimental image', function (t) {
    exec('imgadm import ' + TEST_EXPERIMENTAL_ORIGIN, function (err, o, e) {
        t.ifError(err);
        t.end();
    });
});

test('setup: CACHEDIR (' + CACHEDIR + ')', function (t) {
    mkdirp(CACHEDIR, function (err) {
        t.ifError(err);
        t.end();
    });
});

test('setup: cache test image manifest', function (t) {
    var pth = format('%s/%s.imgmanifest', CACHEDIR, TEST_IMAGE_UUID);
    fs.exists(pth, function (exists) {
        if (!exists) {
            var cmd = format(
                'curl -kf https://images.smartos.org/images/%s >%s',
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
    fs.exists(CACHEFILE, function (exists) {
        if (!exists) {
            var cmd = format(
                'curl -kf https://images.smartos.org/images/%s/file >%s',
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
            var cmd = format(
                'imgadm install -m %s/%s.imgmanifest -f %s/%s.file',
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
    );
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
    );
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
            // The '.' instead of '"' is to make jsstyle happy.
            var marker = /.msg.:.using pre-downloaded image file/;
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
test('pre-downloaded file (bad size); imgadm import ' + TEST_IMAGE_UUID,
    function (t) {

    var wrongSizeFile = '/usr/img/package.json';
    var downFile = common.downloadFileFromUuid(TEST_IMAGE_UUID);
    t.exec(format('cp %s %s', wrongSizeFile, downFile), function () {
        t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function (err, o, e) {
            // Stderr has the imgadm log output. Look for the tell-tale sign
            // that the pre-downloaded image file was discarded.
            // The '.' instead of '"' is to make jsstyle happy.
            var marker = /.msg.:.unexpected size for pre-downloaded image/;
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
test('pre-downloaded file (bad checksum); imgadm import ' + TEST_IMAGE_UUID,
    function (t) {

    // Copy in our cached file and change it (keeping same size):
    var downFile = common.downloadFileFromUuid(TEST_IMAGE_UUID);
    t.exec(format('cp %s %s', CACHEFILE, downFile), function () {
    t.exec('echo -ne BLARG | dd conv=notrunc bs=1 count=5 of=' + downFile,
        function () {

        // Then test import with that bogus file there.
        t.exec('imgadm -v import ' + TEST_IMAGE_UUID, function (err, o, e) {
            // Stderr has the imgadm log output. Look for the tell-tale sign
            // that the pre-downloaded image file was discarded.
            // The '.' instead of '"' is to make jsstyle happy.
            var marker = /.msg.:.unexpected checksum for pre-downloaded image/;
            t.ok(marker.test(e), 'pre-downloaded image file was discarded');
            t.notOk(fs.existsSync(downFile));
            t.exec('imgadm get ' + TEST_IMAGE_UUID, function () {
                t.end();
            });
        });

    }); // BLARG
    }); // cp
});

// Force removal of any dangling experimental image and sources which might
// prevent these tests from reporting correct results.
test('setup8: rm experimental image ' + TEST_EXPERIMENTAL_UUID, function (t) {
    var cmd = format(
        'imgadm delete %s ;'
            + 'imgadm sources -d https://updates.tritondatacenter.com ;'
            + 'imgadm sources -d '
            + TEST_EXPERIMENTAL_SOURCE,
        TEST_EXPERIMENTAL_UUID);
    t.exec(cmd, function () {
        // it's ok if any of these fail, since those may not have been
        // configured in the first place.
        t.end();
    });
});

// With no configured experimental sources, this should fail, which will
// also help determine whether the image has perhaps been added to
// images.smartos.org, in which case, maintainers should select a different
// TEST_EXPERIMENTAL_UUID (and TEST_EXPERIMENTAL_ORIGIN if necessary)
test('experimental image import fails', function (t) {
    var cmd = 'imgadm import ' + TEST_EXPERIMENTAL_UUID;
    exec(cmd, function (err, o, e) {
        t.ok(/ActiveImageNotFound/.test(e),
            'ActiveImageNotFound error code on stderr');
        t.end();
    });
});

test('setup9: add updates.tritondatacenter.com source', function (t) {
    var cmd = 'imgadm sources -a https://updates.tritondatacenter.com';
    exec(cmd, function () {
        t.end();
    });
});

// With a -C argument, this should succeed, assuming our test experimental
// image does still exist on that channel.
test('experimental image import with -C arg', function (t) {
    var cmd = 'imgadm import -C experimental ' + TEST_EXPERIMENTAL_UUID;
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err);
        exec('imgadm get ' + TEST_EXPERIMENTAL_UUID, function (err2, o, e) {
            t.ifError(err2);
            t.end();
        });
    });
});

test('setup10: delete experimental image', function (t) {
    var cmd = format('imgadm delete %s', TEST_EXPERIMENTAL_UUID);
    exec(cmd, function () {
        t.end();
    });
});

// With a -S argument, this should succeed
test('experimental image import with -S channel url', function (t) {
    var cmd = ('imgadm import '
            + '-S ' + TEST_EXPERIMENTAL_SOURCE + ' '
            + TEST_EXPERIMENTAL_UUID);
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err);
        exec('imgadm get ' + TEST_EXPERIMENTAL_UUID, function (err2, o, e) {
            t.ifError(err2);
            t.end();
        });
    });
});

// delete our experimental image and our updates.tritondatacenter.com url, then
// add that source, this time with a channel.
test('setup11: delete experimental image', function (t) {
    var cmd = format(
        'imgadm delete %s ; '
            + 'imgadm sources -d https://updates.tritondatacenter.com ; '
            + 'imgadm sources -a '
            + TEST_EXPERIMENTAL_SOURCE + ' ',
        TEST_EXPERIMENTAL_UUID);
    exec(cmd, function (err, o, e) {
        t.ifError(err);
        t.end();
    });
});

// With a configured experimental channel, this should succeed
test('experimental image import configured channel', function (t) {
    var cmd = 'imgadm import ' + TEST_EXPERIMENTAL_UUID;
    exec(cmd, function (err, stdout, stderr) {
        t.ifError(err);
        exec('imgadm get ' + TEST_EXPERIMENTAL_UUID, function (err2, o, e) {
            t.ifError(err2);
            t.end();
        });
    });
});

test('experimental channel sources show up in list output', function (t) {
    exec('imgadm list -o uuid,source | grep ' + TEST_EXPERIMENTAL_UUID,
    function (err, o, e) {
        t.ifError(err);
        var firstLine = o.split(/\n/g)[0];
        var results = firstLine.split('  ');
        t.equal(results.length, 2);
        t.equal(results[0], TEST_EXPERIMENTAL_UUID);
        t.equal(results[1], TEST_EXPERIMENTAL_SOURCE);
        t.end();
    });
});

// Need a test IMGAPI for the following:
// TODO: test case importing from IMGAPI *with an origin*
// TODO: test case 'imgadm ancestry' on the zfs-dataset image with origin
// TODO: test case for a layer download error in multi-layer import
