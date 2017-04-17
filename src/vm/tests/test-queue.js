/*
 * Copyright 2017, Joyent, Inc.
 *
 */

var Queue = require('/usr/vm/node_modules/queue').Queue;
var bunyan = require('/usr/vm/node_modules/bunyan');
var vasync = require('/usr/vm/node_modules/vasync');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var log = bunyan.createLogger({
    level: 'error',
    name: 'queue-test-dummy',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

test('test queue unpaused 100 tasks', function (t) {
    var tasks = 100;

    var q = new Queue({
        log: log,
        workers: 10
    });

    var i = 0;
    for (var j = 0; j < tasks; j++) {
        q.enqueue({
            description: 'task ' + j,
            func: function (extras, cb) {
                if (++i === tasks) {
                    t.ok(true, 'tasks completed');
                    t.end();
                }
                cb();
            }
        });
    }
});

test('test queue paused 100 tasks', function (t) {
    var tasks = 100;

    var q = new Queue({
        log: log,
        paused: true,
        workers: 10
    });

    var i = 0;
    for (var j = 0; j < tasks; j++) {
        q.enqueue({
            description: 'task ' + j,
            func: function (extras, cb) {
                if (++i === tasks) {
                    t.ok(true, 'tasks completed');
                    t.end();
                }
                cb();
            }
        });
    }

    setImmediate(function () {
        t.ok(true, 'unpausing queue');
        q.resume();
    });
});

test('test queue throws to prevent unintended states', function (t) {
    var q = new Queue({
        log: log,
        workers: 1
    });

    vasync.pipeline({funcs: [
        function (_, cb) {
            // ensure the queue is running
            testIsRunning();
            cb();
        }, function (_, cb) {
            // pause the queue and ensure it is stopped, pause is async
            q.pause(function (err) {
                testIsPaused();
                cb(err);
            });
        }, function (_, cb) {
            // resume the queue and ensure it is running, resume is sync
            q.resume();
            testIsRunning();
            cb();
        }, function (_, cb) {
            // try to resume the queue again, should throw an error
            t.throws(function () {
                q.resume();
            }, null, 'queue is already running');
            testIsRunning();
            cb();
        }, function (_, cb) {
            // pause the queue again and ensure it is stopped
            q.pause(function (err) {
                testIsPaused();
                cb(err);
            });
        }, function (_, cb) {
            // try to pause the queue again
            t.throws(function () {
                q.pause(function () {});
            }, null, 'queue is already paused');
            cb();
        }
    ]}, function (err) {
        t.ok(!err, 'error: ' + (err ? err.message : 'none'));
        t.end();
    });

    function testIsRunning() {
        t.equal(q.paused, false, 'queue is running');
    }
    function testIsPaused() {
        t.equal(q.paused, true, 'queue is paused');
    }
});

test('test queue fast-forward', function (t) {
    var ret;

    var q = new Queue({
        log: log,
        workers: 5,
        paused: true
    });

    var done = {
        foo: false,
        bar: false,
        bat: false
    };

    ret = q.enqueue({
        description: 'foo',
        func: function (extras, cb) {
            done.foo = true;
            cb();
        }
    });
    t.equal(ret, true, 'task foo enqueued');

    ret = q.enqueue({
        description: 'bar',
        func: function (extras, cb) {
            done.bar = true;
            cb();
        }
    });
    t.equal(ret, true, 'task bar enqueued');

    var time = process.hrtime();

    // enqueue the 'bat' task after we grab the timestamp
    setTimeout(function () {
        ret = q.enqueue({
            description: 'bat',
            func: function (extras, cb) {
                done.bat = true;
                cb();
            }
        });
        t.equal(ret, true, 'task bat enqueued');

        // fast forward queue: this should process foo and bar, but not bat
        q.fastForward(time, function (err) {
            t.ok(!err, 'error: ' + (err ? err.message : 'none'));
            t.equal(done.foo, true, 'task foo is done');
            t.equal(done.bar, true, 'task bar is done');
            t.equal(done.bat, false, 'task bat is not done');
            t.end();
        });
    }, 5);
});

test('test deduplication', function (t) {
    var ret;

    var q = new Queue({
        log: log,
        workers: 5,
        dedup: true,
        paused: true
    });

    ret = q.enqueue({
        description: 'foo',
        func: function (extras, cb) {
            cb();
        }
    });
    t.equal(ret, true, 'task foo enqueued');

    ret = q.enqueue({
        description: 'foo',
        func: function (extras, cb) {
            cb();
        }
    });
    t.equal(ret, false, 'task foo is discarded');

    ret = q.enqueue({
        description: 'bar',
        func: function (extras, cb) {
            cb();
        }
    });
    t.equal(ret, true, 'task bar enqueued');

    ret = q.enqueue({
        description: 'bar',
        func: function (extras, cb) {
            cb();
        }
    });
    t.equal(ret, false, 'task bar is discarded');

    t.end();
});
