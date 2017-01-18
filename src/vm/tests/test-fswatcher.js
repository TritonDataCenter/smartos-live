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
 * Copyright 2016, Joyent, Inc.
 */

var assert = require('assert');
var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var vasync = require('/usr/vm/node_modules/vasync');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var FsWatcher = require('/usr/vm/node_modules/vminfod/fswatcher.js').FsWatcher;
var log = bunyan.createLogger({
    level: 'info',
    name: 'fswatcher-test-dummy',
    streams: [ { stream: process.stderr, level: 'info' } ],
    serializers: bunyan.stdSerializers
});
var testdir = path.join('/tmp', 'test-fswatcher-' + process.pid);

before(function (cb) {
    execFile('/usr/bin/mkdir', ['-p', testdir], function (err, stdout, stderr) {
        assert(!err);
        cb();
    });
});

test('try starting and stopping watcher', function (t) {
    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');
    t.ok(!fsw.running(), 'watcher not running');

    fsw.once('ready', function () {
        t.ok(fsw.running(), 'watcher running');
        fsw.stop();
        t.end();
    });

    fsw.start();
});

test('try starting already running watcher', function (t) {
    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');

    fsw.once('ready', function () {
        t.ok(fsw.running(), 'watcher running');
        t.throws(function () {
            fsw.start();
        }, null, 'start twice');

        fsw.stop();
        t.end();
    });

    fsw.start();
});

test('try stopping a stopped watcher', function (t) {
    var fsw = new FsWatcher({log: log});
    t.ok(fsw, 'created watcher');
    t.ok(!fsw.running(), 'watcher not running');

    t.throws(function () {
        fsw.stop();
    }, null, 'stop stopped');

    t.end();
});

test('try watching files with illegal characters', function (t) {
    var fsw = new FsWatcher({log: log});


    fsw.once('ready', function () {
        vasync.forEachPipeline({
            inputs: ['pipe|char', 'newline\nchar', 'nulbyte\0char'],
            func: function (f, cb) {
                fsw.watch(f, function (err) {
                    t.ok(err, 'error is expected: '
                        + JSON.stringify(err.message));
                    cb();
                });
            }
        }, function (err) {
            fsw.stop();
            t.end();
        });
    });

    fsw.start();
});

test('try watching an existent file and catching CHANGE and DELETE',
    function (t) {
        var filename = path.join(testdir, 'hello.txt');
        var saw_change = false;
        var saw_delete = false;

        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        function cleanup() {
            fsw.unwatch(filename, function () {
                fsw.stop();
                t.ok(saw_change, 'saw change event at cleanup');
                t.ok(saw_delete, 'saw delete event at cleanup');
                t.end();
            });
        }

        fs.writeFileSync(filename, 'hello world\n');

        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('delete', function (evt) {
            t.equal(evt.pathname, filename, 'delete was for correct filename');
            t.ok(saw_change, 'at delete time, already saw change');
            saw_delete = true;
            cleanup();
        });

        fsw.on('change', function (evt) {
            t.equal(evt.pathname, filename, 'change was for correct filename');
            t.ok(!saw_delete, 'at change time, did not yet see delete');
            if (!saw_change) {
                // avoid doing twice if there are multiple changes
                saw_change = true;
                fs.unlinkSync(filename); // should trigger DELETE
            }
        });

        function watchcb(err) {
            t.ok(!err, (err ? err.message : 'started watching ' + filename));
            if (err) {
                cleanup();
                return;
            }

            // should trigger CHANGE
            fs.writeFileSync(filename, 'goodbye world\n');
        }

        fsw.once('ready', function (evt) {
            fsw.watch(filename, watchcb);
        });

        fsw.start();
    }
);

test('try watching a non-existent file then create it', function (t) {
    var filename = path.join(testdir, '/file/that/shouldnt/exist.txt');
    var dirname = path.dirname(filename);
    var saw_create = false;

    var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

    function cleanup() {
        fsw.unwatch(filename, function () {
            fsw.stop();
            t.ok(saw_create, 'saw create event at cleanup');
            t.end();
        });
    }

    fsw.once('ready', function (evt) {
        async.waterfall([
            function (cb) {
                fsw.watch(filename, cb);
            }, function (cb) {
                // create directory
                execFile('/usr/bin/mkdir', ['-p', dirname],
                    function (err, stdout, stderr) {
                        t.ok(!err, 'mkdir -p ' + dirname);
                        cb(err);
                    }
                );
            }, function (cb) {
                t.ok(!saw_create, 'haven\'t seen "create" event yet');
                // create file
                fs.writeFile(filename, 'hello world\n', function (err) {
                    t.ok(!err, 'wrote "hello world" to ' + filename);
                    cb(err);
                });
            }
        ], function (err) {
            if (err) {
                t.ok(!err, err.message);
                cleanup();
            }
        });
    });

    fsw.on('create', function (evt) {
        t.equal(evt.pathname, filename, 'saw create event for ' + filename);
        saw_create = true;
        cleanup();
    });

    fsw.start();
});

test('try watching an existent file, unwatching and ensure no events',
    function (t) {
        var events_after_stop = 0;
        var filename = path.join(testdir, 'tricky.txt');
        var saw_change = false;
        var stopped_watching = false;

        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        fs.writeFileSync(filename, 'look at me, I\'m so tricky!\n');
        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('event', function (evt) {
            if (stopped_watching) {
                events_after_stop++;
            }
        });

        fsw.on('change', function (evt) {
            t.equal(evt.pathname, filename, 'change was for correct filename');
            t.ok(!stopped_watching, 'when change event happened, we have not '
                + 'stopped watching');
            if (!saw_change) {
                // avoid doing twice if there are multiple changes
                saw_change = true;
            }
            if (!stopped_watching) {
                fsw.unwatch(filename, function () {
                    stopped_watching = true;

                    // should trigger DELETE, but we shouldn't get it.
                    fs.unlinkSync(filename);

                    // leave some time for rogue events to show up
                    setTimeout(function () {
                        fsw.stop();
                        t.equal(events_after_stop, 0, 'should not see events '
                            + 'after stopping');
                        t.end();
                    }, 2000);
                });
            }
        });

        fsw.once('ready', function (evt) {
            fsw.watch(filename, function (err) {
                fs.writeFileSync(filename, 'now we are writing junk!\n');
                // now change event should have been triggered and we should
                //  have stopped watcher. Control should pass to
                // fsw.on('change'... above.
                return;
            });
        });

        fsw.start();
    }
);

test('create a file and ensure we get multiple modify events',
    function (t) {
        var changes = 0;
        var filename = path.join(testdir, 'changeme.txt');

        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        fsw.on('all', function (evt) {
            if (evt.type === 'ready') {
                return;
            }
            t.deepEqual(evt.changes, ['FILE_MODIFIED'],
                'type of "all" event is "change"');
        });

        fsw.on('change', function (evt) {
            t.equal(evt.pathname, filename, 'change was for correct filename');
            changes++;
            if (changes > 0) {
                fsw.unwatch(filename);
                fsw.stop();
                t.end();
            }
        });

        fsw.once('ready', function (evt) {
            fs.writeFileSync(filename, 'initial data\n');
            t.ok(fs.existsSync(filename), 'file was created');

            fsw.watch(filename, function (err) {
                fs.writeFileSync(filename, 'first modification!\n');
                return;
            });
        });

        fsw.start();
    }
);

test('watch 10000 non-existent files, create them, modify them and delete them',
    function (t) {

        var count = 10000;
        var files = {};
        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        async.waterfall([
            function (cb) {
                fsw.once('ready', function (evt) {
                    cb();
                });
                fsw.start();
            }, function (cb) {
                execFile('/usr/bin/mkdir', ['-p', testdir],
                    function (err, stdout, stderr) {
                        assert(!err);
                        cb();
                    }
                );
            }, function (cb) {
                fsw.on('create', function (evt) {
                    var idx;

                    if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                        // console.error('\n\nIGNORING: '
                        //     + evt.pathname + '\n\n');
                        return;
                    }

                    idx = path.basename(evt.pathname).split('.')[1];
                    files[idx].push('create-observed');

                    // should trigger modify
                    fs.writeFileSync(evt.pathname, 'I said my name was '
                        + idx + '\n');
                });

                fsw.on('change', function (evt) {
                    var idx;

                    if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                        // console.error('\n\nIGNORING: '
                        //     + evt.pathname + '\n\n');
                        return;
                    }

                    idx = path.basename(evt.pathname).split('.')[1];
                    if (files[idx].indexOf('change-observed') === -1) {
                        files[idx].push('change-observed');
                    }

                    // should trigger delete
                    fs.stat(evt.pathname, function (err, stats) {
                        if (err) {
                            if (err.code === 'ENOENT') {
                                // console.log('saw ENOENT0: '
                                //     + evt.pathname);
                                return;
                            } else {
                                throw err;
                            }
                        }
                        // console.error('\n\nDELETING '
                        //     + evt.pathname + '\n\n');
                        try {
                            fs.unlinkSync(evt.pathname);
                        } catch (e) {
                            if (e.code === 'ENOENT') {
                                // console.log('saw ENOENT1: ' + evt.pathname);
                                return;
                            } else {
                                throw (e);
                            }
                        }
                        if (files[idx].indexOf('deleted') === -1) {
                            files[idx].push('deleted');
                        }
                    });
                });

                fsw.on('delete', function (evt) {
                    var idx;

                    if (!evt.pathname.match(/\/testfile.[0-9]+$/)) {
                        // console.error('\n\nIGNORING: '
                        //     + evt.pathname + '\n\n');
                        return;
                    }

                    idx = path.basename(evt.pathname).split('.')[1];
                    fsw.unwatch(evt.pathname, function () {
                        // SETTING DELETE-OBSERVED FOR [9] /tmp/27448/testfile.5
                        files[idx].push('delete-observed');
                    });

                });

                cb();
            }, function _createWatches(callback) {
                var completed = 0;
                var idx;
                var ival;
                var loops = 0;

                function addWatch(watch_idx) {
                    var filename = path.join(testdir, 'testfile.' + watch_idx);
                    fsw.watch(filename, function (err) {
                        files[watch_idx.toString()] = ['init'];
                        completed++;
                    });
                }

                for (idx = 0; idx < count; idx++) {
                    addWatch(idx);
                }

                ival = setInterval(function () {
                    if (completed === count) {
                        clearInterval(ival);
                        t.ok(true, 'created ' + count + ' watches');
                        callback();
                    } else {
                        // console.error('created ' + completed + ' / ' + count
                        //     + ' watches');
                        loops++;
                        if (loops > 600) {
                            clearInterval(ival);
                            callback(new Error('timed out creating files'));
                        }
                    }
                }, 100);
            }, function _createFiles(callback) {
                var completed = 0;
                var idx;
                var ival;
                var loops = 0;

                for (idx = 0; idx < count; idx++) {
                    var filename = path.join(testdir, 'testfile.' + idx);
                    files[idx.toString()].push('created');
                    fs.writeFile(filename, 'hi, my name is ' + idx + '\n',
                        function (err) {
                            if (err) {
                                return;
                            }
                            completed++;
                        }
                    );
                }

                ival = setInterval(function () {
                    if (completed === count) {
                        clearInterval(ival);
                        t.ok(true, 'created ' + count + ' files');
                        callback();
                    } else {
                        // console.error('created ' + completed + ' / ' + count
                        //     + ' files');
                        loops++;
                        if (loops > 600) {
                            clearInterval(ival);
                            callback(new Error('timed out creating files'));
                        }
                    }
                }, 100);
            }, function _checkFiles(callback) {
                var ival = null;
                var timeout = null;

                // TODO: check that they've got the right state at the end
                timeout = setTimeout(function () {
                    // We won't wait forever.
                    if (ival) {
                        clearInterval(ival);
                    }

                    callback(new Error('timed out waiting for all deletes'));
                }, 60000);


                ival = setInterval(function () {
                    var done = true;
                    var idx;
                    var missing;

                    for (idx = 0; idx < count; idx++) {
                        missing = false;
                        [
                            'init',
                            'created',
                            'create-observed',
                            'change-observed',
                            'deleted',
                            'delete-observed'
                        ].forEach(function (state) {
                            if (files[idx.toString()].indexOf(state) === -1) {
                                missing = true;
                            }
                        });
                        if (missing) {
                            // console.error('STILL WAITING FOR ' + idx + '('
                            //     + JSON.stringify(files[idx]) + ')');
                            done = false;
                            break;
                        }
                    }

                    if (done) {
                        if (timeout) {
                            clearTimeout(timeout);
                        }
                        clearInterval(ival);
                        callback();
                    }
                }, 100);
            }
        ], function (err) {
            t.ok(!err, (err ? err.message : 'no errors'));
            fsw.stop();
            t.end();
        });
    }
);

test('cleanup', function (t) {
    t.ok(true, 'cleaning up');
    execFile('/usr/bin/rm', ['-rf', testdir],
        function (err, stdout, stderr) {
            t.ok(!err, (err ? err.message : 'cleaned up'));
            t.end();
        }
    );
});
