// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var async = require('async');
var bunyan = require('bunyan');
var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var FsWatcher = require('vmevent/fswatcher').FsWatcher;
var log = bunyan.createLogger({
        level: 'info',
        name: 'fswatcher-test-dummy',
        streams: [ { stream: process.stderr, level: 'info' } ],
        serializers: bunyan.stdSerializers
});
var testdir = '/tmp/' + process.pid;


before(function (cb) {
    execFile('/usr/bin/mkdir', ['-p', testdir], function (err, stdout, stderr) {
        assert(!err);
        cb();
    });
});

test('try watching an existent file and catching CHANGE and DELETE',
    function (t) {
        var filename = path.join(testdir, 'hello.txt');
        var ival;
        var loops = 0;
        var saw_change = false;
        var saw_delete = false;

        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        function cleanup() {
            fsw.unwatch(filename);
            // XXX can unwatch call callback instead
            setTimeout(function () {
                fsw.shutdown();
                t.end();
            }, 200);
        }

        fs.writeFileSync(filename, 'hello world\n');

        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('delete', function (evt) {
            t.equal(evt.pathname, filename, 'delete was for correct filename');
            t.ok(saw_change, 'at delete time, already saw change');
            saw_delete = true;
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

        ival = setInterval(function () {
            loops++;
            if ((saw_change && saw_delete) || (loops > 100)) {
                clearInterval(ival);
                t.ok(saw_change, 'saw change event');
                t.ok(saw_delete, 'saw delete event');
                cleanup();
            }
        }, 100);

        var watchcb = function (err) {
            t.ok(!err, (err ? err.message : 'started watching ' + filename));
            if (err) {
                cleanup();
                return;
            }

            // should trigger CHANGE
            fs.writeFileSync(filename, 'goodbye world\n');
        };

        fsw.once('ready', function (evt) {
            fsw.watch(filename, watchcb);
        });

        fsw.start();
    }
);

test('try watching a non-existent file then create it', function (t) {
    var dirname;
    var filename = path.join(testdir, '/file/that/shouldnt/exist.txt');
    var saw_create = false;

    var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

    dirname = path.dirname(filename);

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
            }, function (cb) {
                var depth = 0;

                // poll on saw_create being true
                function check_whether_created() {
                    depth++;
                    if (depth > 50) { // 10 seconds
                        cb(new Error('timeout waiting for "create" event'));
                        return;
                    }
                    setTimeout(function () {
                        if (saw_create) {
                            t.ok(true, 'saw "create" event');
                            cb();
                        } else {
                            check_whether_created();
                        }
                    }, 200);
                }

                check_whether_created();
            }
        ], function (err) {
            fsw.shutdown();
            t.ok(!err, (err ? err.message : 'created file successfully'));
            t.end();
        });
    });

    fsw.on('create', function (evt) {
        t.ok(evt.pathname === filename, 'saw create event for ' + filename);
        saw_create = true;
    });

    fsw.start();
});

test('try watching an existent file, unwatching and ensure no events',
    function (t) {
        /*
         * events_after_stop needs to be -1 and not 0 because every event will
         * fire both the specific 'change' event in addition to the 'all' event.
         * The initial write will trigger both a change and all, so we'll need
         * to start at -1.
         */
        var events_after_stop = -1;
        var filename = path.join(testdir, 'tricky.txt');
        var saw_change = false;
        var stopped_watching = false;

        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});

        fs.writeFileSync(filename, 'look at me, I\'m so tricky!\n');
        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('all', function (evt) {
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
                        fsw.shutdown();
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
                fsw.shutdown();
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
            fsw.shutdown();
            t.end();
        });
    }
);

test('watch some files, kill the fswatcher child, then modify files',
    function (t) {
        var killed = false;
        var pid;
        var filename1 = path.join(testdir, 'killtest-1');
        var filename2 = path.join(testdir, 'killtest-2');
        var fsw = new FsWatcher({log: log, dedup_ns: 2000000000});
        var scoreboard = {};

        fs.writeFileSync(filename1, 'initial data 1\n');
        fs.writeFileSync(filename2, 'initial data 2\n');
        t.ok(fs.existsSync(filename1), 'file1 was created');
        t.ok(fs.existsSync(filename2), 'file2 was created');

        fsw.on('all', function (evt) {
            if (!evt.changes) {
                return;
            }
            t.deepEqual(evt.changes, ['FILE_MODIFIED'], 'change',
                'type of "all" event is "change"');

            if (!scoreboard[evt.pathname]) {
                scoreboard[evt.pathname] = {};
            }

            if (evt.changes.indexOf('FILE_MODIFIED') !== -1) {
                if (killed) {
                    if (!scoreboard[evt.pathname].after) {
                        scoreboard[evt.pathname].after = [];
                    }
                    scoreboard[evt.pathname].after.push('modified');
                } else {
                    if (!scoreboard[evt.pathname].before) {
                        scoreboard[evt.pathname].before = [];
                    }
                    scoreboard[evt.pathname].before.push('modified');
                }
            }
        });

        function _waitForModification(which, cb) {
            // wait for both modification events
            var err;
            var files = [filename1, filename2];
            var ival;
            var loops = 0;

            ival = setInterval(function () {
                var done = true;
                files.forEach(function (file) {
                    if (!scoreboard[file] || !scoreboard[file][which]
                        || (scoreboard[file][which]
                        .indexOf('modified') === -1)) {

                        done = false;
                    }
                });

                if (done) {
                    clearInterval(ival);
                    t.ok(true, 'saw ' + which + ' modification for '
                        + JSON.stringify(files));
                    cb();
                    return;
                }

                if (loops > 100) {
                    clearInterval(ival);

                    err = new Error('timed out waiting for ' + which
                        + ' modification. scoreboard: '
                        + JSON.stringify(scoreboard));
                    t.ok(false, err.message);
                    cb(err);
                }

                loops++;
            }, 100);
        }

        async.waterfall([
            function (cb) {
                fsw.once('ready', function (evt) {
                    cb();
                });
                fsw.start();
            }, function (cb) {
                fsw.watch(filename1, function (err) {
                    t.ok(!err, 'watching file1');
                    fs.writeFileSync(filename1, 'first modification 1!\n');
                    cb(err);
                });
            }, function (cb) {
                fsw.watch(filename2, function (err) {
                    t.ok(!err, 'watching file2');
                    fs.writeFileSync(filename2, 'first modification 2!\n');
                    cb(err);
                });
            }, function (cb) {
                _waitForModification('before', cb);
            }, function (cb) {
                pid = fsw.watcherPID();
                t.ok(pid, 'fswatcher PID is ' + pid);
                process.kill(pid, 'SIGKILL');
                killed = true;
                // XXX delete a file while the watcher is restarting?
                cb();
            }, function (cb) {
                fs.writeFile(filename1, 'second modification 1!\n',
                    function (err) {
                        t.ok(!err,
                            (err ? err.message : 'modified file1 again'));
                        cb(err);
                    }
                );
            }, function (cb) {
                fs.writeFile(filename2, 'second modification 2!\n',
                    function (err) {
                        t.ok(!err,
                            (err ? err.message : 'modified file2 again'));
                        cb(err);
                    }
                );
            }, function (cb) {
                _waitForModification('after', cb);
            }, function (cb) {
                fsw.shutdown();
                t.ok(true, 'shut down FsWatcher');
                cb();
            }, function (cb) {
                cb();
            }
        ], function (err) {
            t.end();
        });
    }
);

test('cleanup', function (t) {
    t.ok(true, 'cleaning up');
    execFile('/usr/bin/rm', ['-rf', '/tmp/' + process.pid],
        function (err, stdout, stderr) {
            t.ok(!err, (err ? err.message : 'cleaned up'));
            t.end();
        }
    );
});
