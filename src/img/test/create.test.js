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
 * Copyright (c) 2019, Joyent, Inc. All rights reserved.
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
var createImgadm = require('/usr/img/lib/imgadm').createTool;
var VM = require('/usr/vm/node_modules/VM');
var vminfod = require('/usr/vm/node_modules/vminfod/client');
var common = require('/usr/vm/test/tests/common');
var zfs = common.zfs;
var vasync = require('/usr/img/node_modules/vasync');
var bunyan = require('/usr/img/node_modules/bunyan');
var jsprim = require('/usr/vm/node_modules/jsprim');

var log = bunyan.createLogger({name: 'imgadm-create-test'});

// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;


var WRKDIR = '/var/tmp/img-test-create'
var TESTDIR = __dirname;

// Base images from which we'll be creating a custom images.
var BASE_UUID = 'f669428c-a939-11e2-a485-b790efc0f0c1'; // base 13.1.0

// This image is installed in /usr/img/test/runtests
var BHYVE_IMAGE_UUID = 'ac99517a-72ac-44c0-90e6-c7ce3d944a0a'; // ubuntu 18.04.1

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

function waitForUserScript(uuid, callback) {
    var watchObj = {
        uuid: uuid
    };

    var changes = [
        {
            path: ['customer_metadata', 'userScriptHasRun'],
            action: 'changed',
            oldValue: 'false',
            newValue: 'true'
        }
    ];

    var opts = {
        timeout: 300 * 1000,
        teardown: true
    };

    var vs = new vminfod.VminfodEventStream();
    vs.watchForChanges(watchObj, changes, opts, callback);
}

test('create image from bhyve vm', function (t) {
    var dsQuota;
    var imgadm;
    var imgFilePath;
    var manifest;
    var manifestPath;
    var vmobj;

    var payloadCommon = {
        brand: 'bhyve',
        autoboot: true,
        do_not_inventory: true,
        ram: 512,
        disks: [
            {
                boot: true,
                image_uuid: BHYVE_IMAGE_UUID,
                model: 'virtio'
            },
            {
                size: 512,
                model: 'virtio'
            }
        ]
    };

    vasync.pipeline({
        funcs: [
            function createImgadmClient(_, next) {
                createImgadm({log: log}, function onCreated(err, tool) {
                    common.ifError(t, err, 'error creating imgadm');

                    if (err) {
                        next(err);
                        return;
                    }

                    imgadm = tool;
                    next();
                });
            },
            function createVm(_, next) {
                var payload = jsprim.deepCopy(payloadCommon);
                payload.alias = 'test-image-create-' + process.pid;
                payload.customer_metadata = {
                    'user-script': [
                        'mdata-put userScriptHasRun "false"',
                        'echo -n "foo" > /etc/motd',
                        'cat /etc/motd | mdata-put disktest',
                        'mdata-put userScriptHasRun "true"'
                    ].join('\n')
                };

                VM.create(payload, function createdVm(err, obj) {
                    common.ifError(t, err, 'error creating VM');

                    if (err) {
                        next(err);
                        return;
                    }

                    vmobj = obj;
                    next();
                });
            },
            function waitForBoot(_, next) {
                waitForUserScript(vmobj.uuid, function onUserScript(err) {
                    common.ifError(t, err, 'error waiting for user script');
                    next(err);
                });
            },
            function verifyCustomization(_, next) {
                VM.load(vmobj.uuid, function onLoaded(err, obj) {
                    common.ifError(t, err, 'loading VM after customization');

                    if (err) {
                        next(err);
                        return;
                    }

                    vmobj = obj;

                    t.strictEqual(vmobj.customer_metadata.disktest, 'foo',
                            'File written to disk');
                    next();
                });
            },
            function stopVm(_, next) {
                VM.stop(vmobj.uuid, {}, function vmStopped(err) {
                    common.ifError(t, err, 'error stopping VM');
                    next(err);
                });
            },
            function loadQuota(_, next) {
                var zfsArgs = ['list', '-Hp', '-o', 'quota',
                    vmobj.zfs_filesystem];

                zfs(zfsArgs, function onList(err, stdout) {
                    common.ifError(t, err, 'error getting quota');

                    if (err) {
                        next(err);
                        return;
                    }

                    dsQuota = stdout;
                    next();
                });
            },
            function createImageFromVm(_, next) {
                var createImageOpts = {
                    vmUuid: vmobj.uuid,
                    savePrefix: WRKDIR,
                    manifest: {
                        name: 'test-image-create-' + process.pid,
                        version: '1.0.0'
                    }
                };

                imgadm.createImage(createImageOpts,
                    function onCreate(err, info) {
                        common.ifError(t, err, 'error creating image');

                        if (err) {
                            next(err);
                            return;
                        }

                        t.ok(info.manifest, 'has manifest');
                        t.ok(info.manifestPath, 'has manifestPath');
                        t.ok(info.filePath, 'has filePath');

                        manifest = info.manifest;
                        manifestPath = info.manifestPath;
                        imgFilePath = info.filePath;

                        next();
                    }
                );
            },
            function verifyQuotaRestored(_, next) {
                var zfsArgs = ['list', '-Hp', '-o', 'quota',
                    vmobj.zfs_filesystem];

                zfs(zfsArgs, function onList(err, stdout) {
                    common.ifError(t, err, 'error getting quota');

                    if (err) {
                        next(err);
                        return;
                    }

                    t.strictEqual(dsQuota, stdout, 'dataset quota is restored');
                    next();
                });
            },
            function destroyVm(_, next) {
                if (!vmobj.uuid) {
                    next();
                    return;
                }

                VM.delete(vmobj.uuid, function (err) {
                    common.ifError(t, err, 'error deleting VM');
                    next(err);
                });
            },
            function installImage(_, next) {
                var installArgs = {
                    manifest: manifest,
                    zpool: 'zones',
                    file: imgFilePath,
                    logCb: console.log
                };

                imgadm.installImage(installArgs, function installed(err) {
                    common.ifError(t, err, 'error installing image');
                    next(err);
                });
            },
            function createVmFromImage(_, next) {
                var payload = jsprim.deepCopy(payloadCommon);
                payload.alias = 'test-new-image-create-' + process.pid;
                payload.disks[0].image_uuid = manifest.uuid;
                payload.customer_metadata = {
                    'user-script': [
                        'mdata-put userScriptHasRun "false"',
                        'cat /etc/motd | mdata-put disktest',
                        'mdata-put userScriptHasRun "true"'
                    ].join('\n')
                };

                VM.create(payload, function createVm(err, obj) {
                    common.ifError(t, err, 'error creating VM');

                    if (err) {
                        next(err);
                        return;
                    }

                    vmobj = obj;
                    next();
                });
            },
            function waitForNewBoot(_, next) {
                waitForUserScript(vmobj.uuid, function onUserScript(err) {
                    common.ifError(t, err, 'error waiting for user script');
                    next(err);
                });
            },
            function verifyCustomization(_, next) {
                VM.load(vmobj.uuid, function onLoaded(err, obj) {
                    common.ifError(t, err, 'loading VM after create');

                    if (err) {
                        next(err);
                        return;
                    }

                    t.strictEqual(obj.customer_metadata.disktest, 'foo',
                            'File written to disk');
                    next();
                });
            },
            function destroyVm(_, next) {
                if (!vmobj.uuid) {
                    next();
                    return;
                }

                VM.delete(vmobj.uuid, function (err) {
                    common.ifError(t, err, 'error deleting VM');
                    next(err);
                });
            },
            function deleteImage(_, next) {
                var deleteOpts = {
                    uuid: manifest.uuid,
                    zpool: 'zones'
                };

                imgadm.deleteImage(deleteOpts, function onDelete(err) {
                    common.ifError(t, err, 'error deleting image');
                    next(err);
                    return;
                });
            },
            function deleteImgFiles(_, next) {
                vasync.parallel({
                    funcs: [
                        function deletManifest(done) {
                            fs.unlink(manifestPath, function onDelete(err) {
                                common.ifError(t, err,
                                    'error deleting manifest file');
                                done(err);
                            });
                        },
                        function deleteFile(done) {
                            fs.unlink(imgFilePath, function onDelete(err) {
                                common.ifError(t, err,
                                'error deleting image file');
                                done(err);
                            });
                        }
                    ]
                }, function onFinished(err) {
                    next(err);
                });
            }
        ]
    }, function onDone(err) {
        common.ifError(t, err, 'error testing image create');
        t.end();
    });
});
