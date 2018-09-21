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

var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');
var util = require('util');

var assert = require('/usr/node/node_modules/assert-plus');
var bunyan = require('/usr/vm/node_modules/bunyan');
var FsWatcher = require('/usr/vm/node_modules/fswatcher').FsWatcher;
var vasync = require('/usr/vm/node_modules/vasync');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var log = bunyan.createLogger({
    level: 'error',
    name: 'fswatcher-test-dummy',
    streams: [ { stream: process.stderr, level: 'error' } ],
    serializers: bunyan.stdSerializers
});
var testdir = path.join('/tmp', 'test-fswatcher-' + process.pid);

test('try creating temp directory', function createTmpDir(t) {
    execFile('/usr/bin/mkdir', ['-p', testdir],
        function mkdir(err, stdout, stderr) {

        assert.ifError(err);
        t.end();
    });
});

test('try starting and stopping watcher', function startAndStopTest(t) {
    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');
    t.ok(!fsw.isRunning(), 'watcher not running');

    fsw.once('ready', function fswOnReady() {
        t.ok(fsw.isRunning(), 'watcher running');
        fsw.stop(function fswStop() {
            t.end();
        });
    });

    fsw.start();
});

test('try starting already running watcher',
    function startAlreadyRunningTest(t) {

    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');

    fsw.once('ready', function fswOnReady() {
        t.ok(fsw.isRunning(), 'watcher running');
        t.throws(function startThrow() {
            fsw.start();
        }, null, 'start twice');

        fsw.stop(function fswStop() {
            t.end();
        });
    });

    fsw.start();
});

test('try stopping a stopped watcher', function stopAlreadyStoppedTest(t) {
    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');
    t.ok(!fsw.isRunning(), 'watcher not running');

    t.throws(function stopThrow() {
        fsw.stop(function noop() {});
    }, null, 'stop stopped');

    t.end();
});

test('try watching files with illegal characters',
    function illegalFilenameTest(t) {

    var fsw = new FsWatcher({log: log});

    fsw.once('ready', function fswOnReady() {
        vasync.forEachPipeline({
            inputs: ['newline\nchar', 'nulbyte\0char'],
            func: function watchInvalidFile(f, cb) {
                fsw.watch(f, function (err) {
                    t.ok(err, 'error is expected: '
                        + JSON.stringify((err || {}).message));
                    cb();
                });
            }
        }, function doneWatchInvalidFile(err) {
            fsw.stop(function fswStop() {
                t.end();
            });
        });
    });

    fsw.start();
});

test('try watching an existent file and catching CHANGE and DELETE',
    function changeAndDeleteTest(t) {
        var filename = path.join(testdir, 'hello.txt');
        var saw_change = false;
        var saw_delete = false;

        var fsw = new FsWatcher({log: log});

        fs.writeFileSync(filename, 'hello world\n');
        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('delete', function fswOnDelete(evt) {
            t.equal(evt.pathname, filename, 'delete was for correct filename');
            t.ok(saw_change, 'at delete time, already saw change');
            saw_delete = true;
            cleanup();
        });

        fsw.on('change', function fswOnChange(evt) {
            t.equal(evt.pathname, filename, 'change was for correct filename');
            t.ok(!saw_delete, 'at change time, did not yet see delete');
            if (!saw_change) {
                // avoid doing twice if there are multiple changes
                saw_change = true;
                fs.unlinkSync(filename); // should trigger DELETE
            }
        });

        fsw.once('ready', function fswOnReady(evt) {
            fsw.watch(filename, watchcb);
        });

        fsw.start();

        function watchcb(err) {
            t.ok(!err, (err ? err.message : 'started watching ' + filename));
            if (err) {
                cleanup();
                return;
            }

            // should trigger CHANGE
            fs.writeFileSync(filename, 'goodbye world\n');
        }

        function cleanup() {
            fsw.unwatch(filename, function fswUnwatch() {
                fsw.stop(function fswStop() {
                    t.ok(saw_change, 'saw change event at cleanup');
                    t.ok(saw_delete, 'saw delete event at cleanup');
                    t.end();
                });
            });
        }
    }
);

test('try watching a non-existent file then create it',
    function createWatchedFileTest(t) {

    var filename = path.join(testdir, '/file/that/shouldnt/exist.txt');
    var dirname = path.dirname(filename);
    var saw_create = false;

    var fsw = new FsWatcher({log: log});

    fsw.once('ready', function fswOnReady(evt) {
        vasync.pipeline({funcs: [
            function (_, cb) {
                fsw.watch(filename, cb);
            }, function (_, cb) {
                // create directory
                execFile('/usr/bin/mkdir', ['-p', dirname],
                    function mkdir(err, stdout, stderr) {
                        t.ok(!err, 'mkdir -p ' + dirname);
                        cb(err);
                    }
                );
            }, function (_, cb) {
                t.ok(!saw_create, 'haven\'t seen "create" event yet');
                // create file
                fs.writeFile(filename, 'hello world\n',
                    function writeFileDone(err) {

                    t.ok(!err, 'wrote "hello world" to ' + filename);
                    cb(err);
                });
            }
        ]}, function (err) {
            if (err) {
                t.ok(!err, err.message);
                cleanup();
            }
        });
    });

    fsw.on('create', function fswOnCreate(evt) {
        t.equal(evt.pathname, filename, 'saw create event for ' + filename);
        saw_create = true;
        cleanup();
    });

    fsw.start();

    function cleanup() {
        fsw.unwatch(filename, function fswUnwatch() {
            fsw.stop(function fswStop() {
                t.ok(saw_create, 'saw create event at cleanup');
                t.end();
            });
        });
    }
});

test('try watching an existent file, unwatching and ensure no events',
    function strayEventsTest(t) {

    var events_after_stop = 0;
    var filename = path.join(testdir, 'tricky.txt');
    var saw_change = false;
    var stopped_watching = false;

    var fsw = new FsWatcher({log: log});

    fs.writeFileSync(filename, 'look at me, I\'m so tricky!\n');
    t.ok(fs.existsSync(filename), 'file was created');

    fsw.on('event', function fswOnEvent(evt) {
        if (stopped_watching) {
            events_after_stop++;
        }
    });

    fsw.on('change', function fswOnChange(evt) {
        t.equal(evt.pathname, filename, 'change was for correct filename');
        t.ok(!stopped_watching, 'when change event happened, we have not '
            + 'stopped watching');

        // avoid doing twice if there are multiple changes
        if (saw_change)
            return;

        saw_change = true;

        if (stopped_watching)
            return;

        fsw.unwatch(filename, function fswUnwatch() {
            stopped_watching = true;

            // would trigger DELETE, but we shouldn't get it.
            fs.unlinkSync(filename);

            // leave some time for rogue events to show up
            setTimeout(function waitForMorePossibleEvents() {
                fsw.stop(function fswStop() {
                    t.equal(events_after_stop, 0, 'should not see events '
                        + 'after stopping');
                    t.end();
                });
            }, 2000);
        });
    });

    fsw.once('ready', function fswOnReady(evt) {
        fsw.watch(filename, function fswWatch(err) {
            fs.writeFileSync(filename, 'now we are writing junk!\n');
            // now change event should have been triggered and we should
            //  have stopped watcher. Control should pass to
            // fsw.on('change'... above.
            return;
        });
    });

    fsw.start();
});

test('create a file and ensure we get multiple modify events',
    function multipleModifyEventsTest(t) {

    var filename = path.join(testdir, 'changeme.txt');

    var fsw = new FsWatcher({log: log});

    fs.writeFileSync(filename, 'initial data\n');
    t.ok(fs.existsSync(filename), 'file was created');

    fsw.on('event', function fswOnEvent(evt) {
        t.ok(evt.changes.indexOf('FILE_MODIFIED') > -1,
            'type of "event" event is "change"');
    });

    fsw.on('change', function fswOnChange(evt) {
        t.equal(evt.pathname, filename, 'change was for correct filename');
        fsw.stop(function fswStop() {
            t.end();
        });
    });

    fsw.once('ready', function fswOnReady(evt) {
        fsw.watch(filename, function fswWatch(err) {
            fs.writeFileSync(filename, 'first modification!\n');
            return;
        });
    });

    fsw.start();
});

test('watch 10000 non-existent files, create them, modify them and delete them',
    function createManyFilesTest(t) {

    var then = new Date();

    var count = 10000;
    var fsw = new FsWatcher({log: log});
    var files = [];

    // events seen per file
    var events = {};

    // events seen
    var seen = {
        create: 0,
        change: 0,
        delete: 0
    };

    // array of filenames to watch and manage
    for (var i = 0; i < count; i++) {
        var filename = path.join(testdir, 'testfile.' + i);
        files.push(filename);
        events[filename] = [];
    }

    // Because we are managing a large number of files, a vasync queue is used
    // to manage all file creations, modifications, and deletions.
    var q = vasync.queue(function vasyncQueue(task, cb) {
        task(cb);
    }, 100);

    // deadman switch - we stop this if it takes too long
    var timeout = setTimeout(function killSwitch() {
        var e = new Error('timeout exceeded');
        cleanup(e);
    }, 60 * 1000);

    vasync.pipeline({funcs: [
        function (_, cb) {
            // start the FsWatcher
            fsw.once('ready', function fswOnReady(evt) {
                cb();
            });
            fsw.start();
        }, function (_, cb) {
            // start watching for events
            var done = 0;

            fsw.on('create', function fswOnCreate(evt) {
                if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                    log.error({evt: evt},
                        'throwing out event for file %s',
                        evt.pathname);
                    return;
                }

                seen.create++;
                events[evt.pathname].push('create-seen');

                // modify the file - triggers 'change' event
                q.push(function modifyFileToTriggerChange(cb2) {
                    events[evt.pathname].push('change');
                    fs.truncate(evt.pathname, 0, cb2);
                });
            });

            fsw.on('change', function fswOnChange(evt) {
                if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                    log.error({evt: evt},
                        'throwing out event for file %s',
                        evt.pathname);
                    return;
                }

                if (events[evt.pathname].indexOf('change-seen') > -1) {
                    log.error({evt: evt},
                        'change event already seen for file %s',
                        evt.pathname);
                    return;
                }

                seen.change++;
                events[evt.pathname].push('change-seen');

                // delete the file - triggers 'delete' event
                q.push(function deleteFileToTriggerDelete(cb2) {
                    events[evt.pathname].push('delete');
                    fs.unlink(evt.pathname, cb2);
                });
            });

            fsw.on('delete', function fswOnDelete(evt) {
                if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                    log.error({evt: evt},
                        'throwing out event for file %s',
                        evt.pathname);
                    return;
                }

                seen.delete++;
                events[evt.pathname].push('delete-seen');

                fsw.unwatch(evt.pathname, function fswUnwatch() {
                    delete events[evt.pathname];
                    // check if we're done
                    if (++done === count) {
                        clearTimeout(timeout);
                        cleanup();
                    }
                });
            });

            cb();
        }, function (_, cb) {
            // add watches for all non-existent files
            vasync.forEachParallel({
                func: function watchNonexistentFile(f, cb2) {
                    events[f].push('watch');
                    fsw.watch(f, cb2);
                },
                inputs: files
            }, function (err) {
                t.ok(!err, (err ? err.message : 'no errors'));
                cb();
            });
        }, function (_, cb) {
            // all files are being watched, create them
            vasync.forEachParallel({
                func: function createNewFile(f, cb2) {
                    q.push(function createNewFileTask(cb3) {
                        var data = 'foo ' + f;
                        fs.writeFile(f, data, function writeFileDone(err) {
                            events[f].push('create');
                            cb3(err); // tell queue we're done
                            cb2(err); // tell forEachParallel we're done
                        });
                    });
                },
                inputs: files
            }, function (err) {
                t.ok(!err, (err ? err.message : 'no errors'));
                cb();
            });
        }
    ]}, function (err) {
        // control is passed onto fsw events now
    });

    function cleanup(err) {
        var now = new Date();
        var delta = now - then;
        t.ok(!err, (err ? err.message : 'no errors'));
        t.ok(true, 'took ' + delta + 'ms to complete');

        Object.keys(seen).forEach(function eventSeen(ev) {
            t.equal(seen[ev], count,
                util.format('have seen %d / %d %s events',
                seen[ev], count, ev));
        });

        var keys = Object.keys(events);
        t.equal(keys.length, 0, '0 files left');
        if (keys.length > 0) {
            console.error(events);
        }

        fsw.status(function fswStatus(_, obj) {
            if (err) {
                log.error({obj: obj}, 'fswatcher status before exit');
            }
            fsw.stop(function fswStop() {
                t.end();
            });
        });
    }
});

test('cleanup', function testCleanup(t) {
    t.ok(true, 'cleaning up');
    execFile('/usr/bin/rm', ['-rf', testdir],
        function removeTmpDir(err, stdout, stderr) {
            t.ok(!err, (err ? err.message : 'cleaned up'));
            t.end();
        }
    );
});
