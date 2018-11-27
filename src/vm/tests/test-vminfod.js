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
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

var assert = require('/usr/node/node_modules/assert-plus');
var bunyan = require('/usr/vm/node_modules/bunyan');
var common = require('./common');
var f = require('util').format;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var VM = require('/usr/vm/node_modules/VM');
var vasync = require('/usr/vm/node_modules/vasync');
var vminfod = require('/usr/vm/node_modules/vminfod/client');
var vmtest = require('../common/vmtest.js');

var log = bunyan.createLogger({
    level: 'fatal',
    name: 'vminfod-test-dummy',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var PAYLOAD = {
    alias: f('test-vminfod-%d', process.pid),
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    image_uuid: IMAGE_UUID,
    quota: 5,
    ram: 64
};

test('create VminfodClient object and test /status', function (t) {
    var vc = new vminfod.VminfodClient();
    t.ok(vc, 'VminfodClient created');

    vc.status(function (err, stats) {
        t.ifError(err, 'vc.status no error');
        t.ok(stats, 'vc.status object found');
        t.end();
    });
});

/*
 * Ensure that errors created as a result of a vminfod timeout contain specific
 * bits of information.
 */
test('vminfod event stream timeout errors', function (t) {
    var vs;
    var name = f('test-vminfod.js custom-vminfod-identifier-%d', process.pid);

    vasync.pipeline({funcs: [
        // create an event stream
        function (_, cb) {
            vs = new vminfod.VminfodEventStream({
                name: name,
                log: log
            });

            vs.on('ready', function () {
                cb();
            });
        },

        // watchForEvent timeout
        function (_, cb) {
            // watch for an event that will never happen
            var obj = {
                invalid_root_key: 'foo'
            };

            var opts = {
                timeout: 1 // 1 ms
            };

            vs.watchForEvent(obj, opts, function (err, ev) {
                t.ok(err, 'error set');

                if (!err) {
                    cb();
                    return;
                }

                assert.string(err.message, 'err.message');
                var msg = err.message.trim();

                t.ok(msg, 'error message: ' + msg);
                t.ok(msg.match(/watchForEvent/), 'watchForEvent message');
                t.ok(msg.match(/timeout exceeded/), 'timeout exceeded message');
                t.ok(msg.indexOf(name) >= 0, 'name in error message');

                cb();
            });
        },

        // watchForChanges timeout
        function (_, cb) {
            // watch for changes that will never happen
            var obj = {
                uuid: '00000000-0000-0000-0000-000000000000'
            };

            var changes = [
                {
                    path: ['invalid_root_key'],
                    newValue: 'foo'
                }
            ];

            var opts = {
                timeout: 1 // 1 ms
            };

            vs.watchForChanges(obj, changes, opts, function (err) {
                t.ok(err, 'error set');

                if (!err) {
                    cb();
                    return;
                }

                assert.string(err.message, 'err.message');
                var msg = err.message.trim();

                t.ok(msg, 'error message: ' + msg);
                t.ok(msg.match(/watchForChanges/), 'watchForEvent message');
                t.ok(msg.match(/timeout exceeded/), 'timeout exceeded message');
                t.ok(msg.indexOf(name) >= 0, 'name in error message');

                cb();
            });
        }
    ]}, function (err) {
        common.ifError(t, err, 'cleanup');

        vs.stop();
        t.end();
    });
});

/*
 * Modifying the zone's XML file directly can result in a "delete" event seen
 * for the file, even though the zone itself may not be deleted.  This test
 * will create e "delete" event for a zone that isn't deleted, and ensure that
 * vminfod doesn't think the zone is actually deleted.
 */
test('test vminfod zone XML delete event', function (t) {
    var vmobj;
    var xmlFile;
    var tmpXmlFile = '/tmp/.vminfod-test-delete-event.xml';
    var vs;

    vasync.pipeline({funcs: [
        // Create a vminfod stream
        function (_, cb) {
            vs = new vminfod.VminfodEventStream({
                name: 'test-vminfod.js zone XML delete event',
                log: log
            });
            vs.on('ready', function () {
                cb();
            });
        },

        // Create a new VM
        function (_, cb) {
            VM.create(PAYLOAD, function (err, _vmobj) {
                common.ifError(t, err, 'VM.create');

                if (err) {
                    cb(err);
                    return;
                }

                vmobj = _vmobj;
                assert.object(vmobj, 'vmobj');
                assert.uuid(vmobj.zonename, 'vmobj.zonename');

                xmlFile = f('/etc/zones/%s.xml', vmobj.zonename);
                cb();
            });
        },

        // Copy the zone's XML file
        function (_, cb) {
            var opts = {
                encoding: 'utf8'
            };

            fs.readFile(xmlFile, opts, function (err, data) {
                common.ifError(t, err, f('read %s', xmlFile));
                if (err) {
                    cb(err);
                    return;
                }

                fs.writeFile(tmpXmlFile, data, opts, function (_err) {
                    common.ifError(t, _err, f('write %s', tmpXmlFile));
                    cb(_err);
                });
            });
        },

        /*
         * Rename the temporary XML file to the zone's XML file location.
         *
         * `mv(1)` is used here because fs.rename will fail.  `/etc/zones` is on
         * its own mounted filesystem and the temp file is in `/tmp`.  Because
         * `mv` or fs.rename can be used, and the temporary file could live
         * inside or outside the `/etc/zones` filesystem, there are 4 possible
         * scenarios:
         *
         * 1. `mv` temp file from `/etc/zones`: FILE_EXCEPTION FILE_RENAME_TO
         * 2. `mv` temp file from `/tmp`:       FILE_EXCEPTION FILE_DELETE
         * 3. fs.rename file from `/etc/zones`: FILE_EXCEPTION FILE_RENAME_TO
         * 4. fs.rename file from '/tmp`:       EXDEV, cross-device link not
         *    permitted
         *
         * The first three scenarios show the events as seen from event ports,
         * and the 4th scenario shows the error that fs.rename returns. `mv(1)`
         * attempts to rename(2) the file first, and will then move on to a full
         * file copy (if the source is a regular file) if EXDEV is the error
         * given.
         *
         * The code below will create scenario 2.
         *
         * This logic will simultaneously block on vminfod for the delete event
         * to be seen (which shouldn't happen), and ensure that instead a
         * timeout is seen.
         */
        function (_, cb) {
            var cancelFn;

            vasync.parallel({funcs: [
                function (cb2) {
                    // This event should *not* happen - we expect a timeout
                    var obj = {
                        type: 'delete',
                        uuid: vmobj.uuid
                    };
                    var opts = {
                        timeout: 5 * 1000,
                        catchErrors: true,
                        startFresh: true
                    };

                    cancelFn = vs.watchForEvent(obj, opts, function (err) {
                        if (err && err.code === 'ETIMEOUT') {
                            t.ok(true, 'vminfod watchForEvent timeout');
                            cb2();
                            return;
                        }

                        // if we are here, something is wrong
                        if (err) {
                            common.ifError(t, err,
                                'vminfod watchForEvent delete');
                        } else {
                            t.ok(false, 'vminfod delete event seen!');
                        }

                        cb2(err);
                    });
                }, function (cb2) {
                    var args = [
                        'mv',
                        tmpXmlFile,
                        xmlFile
                    ];

                    common.exec(args, function (err, out) {
                        common.ifError(t, err, f('mv %s -> %s',
                            tmpXmlFile, xmlFile));

                        if (err) {
                            cancelFn(err);
                            cb2(err);
                            return;
                        }

                        cb2();
                    });
                }]
            }, cb);
        }

    ]}, function (e) {
        // catch any error above
        common.ifError(t, e, 'test-vminfod-zone-xml-delete-event');

        /*
         * Cleanup
         *
         * Errors are handled by the test suite but ignored inside this call to
         * vasync.pipeline to ensure all tasks are run.
         */
        vasync.pipeline({funcs: [
            // Stop the vminfod stream
            function (_, cb) {
                if (vs) {
                    vs.stop();
                    vs = null;
                }
                cb();
            },
            // Remove the VM
            function (_, cb) {
                if (!vmobj) {
                    cb();
                    return;
                }

                VM.delete(vmobj.uuid, function (err) {
                    common.ifError(t, err, 'VM.delete');
                    cb();
                });
            }
        ]}, function () {
            t.end();
        });
    });
});

/*
 * OS-7365: vminfod crashes when restarting watches for nonexistent zone
 *
 * vminfod has relatively complex logic to handle a ZFS rollback of a dataset
 * for a zone.  When a zone's dataset is rolled back, the state of the files in
 * the dataset are now effectively unknown, so vminfod restarts the filesystem
 * watches for each file related to the zone affected.  vminfod could crash,
 * however, if the filesystem watches are attempted to be restarted for a
 * zone that doesn't exist.
 *
 * This would happen (before OS-7365) 1. if the zone was deleted between when
 * the rollback happened and when the event was processed or 2. if vminfod
 * thinks the zfs event was for a zone when it actually wasn't.  This test
 * ensures that vminfod doesn't crash as a result of a ZFS rollback.
 *
 * To accomplish this, the test first creates a VminfodEventStream and ensures
 * that the stream stays open for the entire test.  If vminfod were to crash,
 * the stream will break.  With this stream created, it then:
 *
 * 1. Creates an empty dataset with a random UUID to zones/<uuid>.
 * 2. Creates a new VM.
 * 3. Does a rollback on the empty dataset created in step 1.
 * 4. Updates the new VM.
 *
 * As long as the stream stays up, then we know vminfod handled all of the
 * events without error.
 *
 * The VM created in step 2 and updated in step 4 is to ensure that vminfod has
 * handled the ZFS events from steps 1 and 3.  Because all events get serialized
 * by vminfod, we can use this as a way to ensure certain events are processed
 * in an order we expect.  We won't get any feedback from vminfod that it has
 * seen the ZFS create event from step 1, but by following up with step 2 and
 * ensuring its success we can know that the ZFS event from step 1 was
 * processed - because of the order of events.  The same is true for steps 3 and
 * 4: by updating something ZFS related of the VM (like quota), we can ensure
 * that vminfod has seen the ZFS event generated by step 3.  As long as all VM
 * operations are successful, and the vminfod streams stays up, we know that
 * vminfod has handled these scenarios correctly without crashing.
 *
 * In the ideal scenario, vminfod will not crash and this test will run to
 * completion.  However, when tested on a platform without the fix implemented,
 * it can be the case that this test itself will crash and not finish
 * gracefully.  This test creates an event stream and equips a handler for any
 * "error" event emitted.  Immediately after the call to `zfs rollback` is
 * successful, the test then tries to do a `VM.update`; `VM.update` will also
 * open a vminfod event stream.  If `VM.update` opens its event stream before
 * vminfod crashes, then it becomes a 50/50 shot (or so it seems) as to which
 * will fail first: the stream opened by the test suite (with the error handler
 * attached) or the stream opened by `VM.update` (without the error handler
 * attached).  Because of this, if vminfod crashes, it's possible that this test
 * will finish gracefully (with failures), or completely crash this test file.
 * Errors being purposefully left unhandled by VM.js was intentional, as vminfod
 * disappearing mid-task (typically invoked via `vmadm`) is a fatal condition
 * and should result in a process crash.  Either way, regardless of which stream
 * dies first, this test will result in a failure indicating there was an issue.
 *
 * The VM created for testing will be removed when the test is done.
 *
 */
test('test vminfod zfs rollback', function (t) {
    // ZFS dataset that *looks* like it would belong to a zone
    var dataset = f('zones/%s', libuuid.create());
    var snapshot = f('%s@snap', dataset);
    var vmobj;
    var vs;

    vasync.pipeline({funcs: [
        // Create a vminfod stream
        function (_, cb) {
            vs = new vminfod.VminfodEventStream({
                name: 'test-vminfod.js vminfod zfs rollback',
                log: log
            });
            vs.on('ready', function () {
                cb();
            });
            vs.once('error', function (err) {
                // This should not occur
                common.ifError(t, err, 'VminfodEventStream error');
                t.end();
            });
        },

        /*
         * Ensure that the generated ZFS dataset doesn't already exist.
         *
         * This is admittedly a paranoid thing to do, but in the off chance that
         * we somehow generate a UUID that already exists as a dataset we should
         * bail right here.  If this happens, the most probable reason is that
         * the UUID generation library is flawed.
         */
        function (_, cb) {
            var args = [
                'get',
                '-Ho',
                'value',
                'name',
                dataset
            ];
            common.zfs(args, function (err, out) {
                if (!err) {
                    err = new Error(f('dataset %s already exists', dataset));
                    common.ifError(t, err, 'dataset exists');
                    cb(err);
                }

                assert.string(err.message, 'err.message');
                var msg = err.message.trim();

                if (!msg.match(/dataset does not exist$/)) {
                    common.ifError(t, err, 'zfs error');
                    cb(err);
                }

                cb();
            });
        },

        // (Step 1): Create the new dataset
        function (_, cb) {
            var args = [
                'create',
                dataset
            ];
            common.zfs(args, function (err, out) {
                common.ifError(t, err, f('zfs %s', args.join(' ')));
                cb(err);
            });
        },

        // Create a snapshot for the rollback on the new dataset
        function (_, cb) {
            var args = [
                'snapshot',
                snapshot
            ];
            common.zfs(args, function (err, out) {
                common.ifError(t, err, f('zfs %s', args.join(' ')));
                cb(err);
            });
        },

        // (Step 2): Create a new VM
        function (_, cb) {
            VM.create(PAYLOAD, function (err, _vmobj) {
                common.ifError(t, err, 'VM.create');

                if (err) {
                    cb(err);
                    return;
                }

                vmobj = _vmobj;
                cb();
            });
        },

        // Ensure the quota is properly set
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, _vmobj) {
                common.ifError(t, err, 'VM.load');

                if (err) {
                    cb(err);
                    return;
                }

                vmobj = _vmobj;

                t.equal(vmobj.quota, 5, 'quota is 5');

                cb();
            });
        },

        // (Step 3): Rollback the dataset to the snapshot
        function (_, cb) {
            var args = [
                'rollback',
                snapshot
            ];
            common.zfs(args, function (err, out) {
                common.ifError(t, err, f('zfs %s', args.join(' ')));
                cb(err);
            });
        },

        // (Step 4): Update the quota of the VM
        function (_, cb) {
            var payload = {
                quota: 6
            };
            VM.update(vmobj.uuid, payload, function (err) {
                common.ifError(t, err, 'VM.update');
                cb(err);
            });
        },

        // Ensure the quota is properly set
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, _vmobj) {
                common.ifError(t, err, 'VM.load');

                if (err) {
                    cb(err);
                    return;
                }

                vmobj = _vmobj;

                t.equal(vmobj.quota, 6, 'quota is 6');

                cb();
            });
        }
    ]}, function (e) {
        common.ifError(t, e, 'test-zfs-rollback');

        /*
         * Cleanup
         *
         * Errors are handled by the test suite but ignored inside this call to
         * vasync.pipeline to ensure all tasks are run.
         */
        vasync.pipeline({funcs: [
            // Stop the vminfod stream
            function (_, cb) {
                if (vs) {
                    vs.stop();
                    vs = null;
                }
                cb();
            },

            // Destroy the ZFS dataset
            function (_, cb) {
                var args = [
                    'destroy',
                    '-r',
                    dataset
                ];
                common.zfs(args, function (err) {
                    common.ifError(t, err, f('zfs %s', args.join(' ')));
                    cb();
                });
            },

            // Remove the VM
            function (_, cb) {
                if (!vmobj) {
                    cb();
                    return;
                }

                VM.delete(vmobj.uuid, function (err) {
                    common.ifError(t, err, 'VM.delete');
                    cb();
                });
            }
        ]}, function () {
            t.end();
        });
    });
});
