// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');
var VM = require('/usr/vm/node_modules/VM');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var FsWatcher = require('./fswatcher.js').FsWatcher;
var log = bunyan.createLogger({
        level: 'trace',
        name: 'fswatcher-test-dummy',
        streams: [ { stream: process.stderr, level: 'trace' } ],
        serializers: bunyan.stdSerializers
});
var testdir = '/tmp/' + process.pid;


before(function (cb) {
    console.log('setting up');
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

        var fsw = new FsWatcher(log);

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
            console.error('XXXXXXXX STARTING TO WATCH');
            t.ok(!err, (err ? err.message : 'started watching ' + filename));
            if (err) {
                cleanup();
                return;
            }

            // should trigger CHANGE
            fs.writeFileSync(filename, 'goodbye world\n');
        };

        fsw.watch(filename, watchcb);
    }
);

test('try watching a non-existent file then create it', function (t) {
    var dirname;
    var filename = path.join(testdir, '/file/that/shouldnt/exist.txt');
    var saw_create = false;

    var fsw = new FsWatcher(log);

    dirname = path.dirname(filename);

    fsw.watch(filename);

    fsw.on('create', function (evt) {
        t.ok(evt.pathname === filename, 'saw create event for ' + filename);
        saw_create = true;
    });

    async.waterfall([
        function (cb) {
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
                console.error('CHECK_WHETHER(' + depth + ')');
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
        console.error('shutting down!');
        fsw.shutdown();
        t.ok(!err, (err ? err.message : 'created file successfully'));
        t.end();
    });
});

test('try watching an existent file, unwatching and ensure no events',
    function (t) {
        var events_after_stop = 0;
        var filename = path.join(testdir, 'tricky.txt');
        var saw_change = false;
        var stopped_watching = false;

        var fsw = new FsWatcher(log);

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

        fsw.watch(filename, function (err) {
            fs.writeFileSync(filename, 'now we are writing junk!\n');
            // now change event should have been triggered and we should have
            // stopped watcher. Control should pass to fsw.on('change'... above.
            return;
        });
    }
);

test('create a file and ensure we get multiple modify events',
    function (t) {
        var changes = 0;
        var filename = path.join(testdir, 'changeme.txt');

        var fsw = new FsWatcher(log);

        fs.writeFileSync(filename, 'initial data\n');
        t.ok(fs.existsSync(filename), 'file was created');

        fsw.on('all', function (evt) {
            t.deepEqual(evt.changes, ['FILE_MODIFIED'], 'change',
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

        fsw.watch(filename, function (err) {
            fs.writeFileSync(filename, 'first modification!\n');
            return;
        });
    }
);

after(function (cb) {
    console.log('cleaning up');
    execFile('/usr/bin/rm', ['-rf', '/tmp/' + process.pid],
        function (err, stdout, stderr) {
            cb();
        }
    );
});
