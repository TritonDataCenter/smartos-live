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
                i++;

                if (i < tasks) {
                    cb();
                    return;
                }

                if (i === tasks) {
                    t.ok(true, 'tasks completed');
                    t.end();
                    cb();
                    return;
                }

                // something is wrong if we are here
                t.ok(false, 'task ' + i + ' called');
                cb();
            }
        });
    }
});

test('test queue paused 100 tasks', function (t) {
    var tasks = 100;
    var queue_running = false;

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
                if (!queue_running) {
                    t.ok(false, 'queue started too early');
                    t.end();
                    return;
                }

                if (++i === tasks) {
                    t.ok(true, 'tasks completed');
                    t.end();
                }

                cb();
            }
        });
    }

    setTimeout(function () {
        // all tasks should still be enqueued as the queue is currently paused
        t.equal(q.paused, true, 'queue is paused');
        t.equal(q.paused_queue.length, tasks, 'tasks currently paused: '
            + tasks);

        queue_running = true;
        q.resume();
    }, 10);
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

test('test queue idleTime instant', function (t) {
    var isIdleCalled = false;

    var q = new Queue({
        log: log,
        workers: 1,
        paused: true
    });

    t.expect(6);

    t.equal(q.idle, false, 'queue is not idle while paused');

    q.resume();

    t.equal(q.idle, true, 'queue idle when resumed');

    q.enqueue({
        description: 'foo',
        func: function (extras, cb) {
            t.equal(q.idle, false, 'queue not idle when running task');
            setTimeout(cb, 5);
        }
    });

    t.equal(q.idle, false, 'queue not idle when task was pushed');

    q.once('idle', function () {
        isIdleCalled = true;
        t.equal(q.idle, true, 'queue idle when once("idle") called');
    });

    // sometime in the future after the task is done
    setTimeout(function () {
        t.equal(isIdleCalled, true, '"idle" event seen');
        t.end();
    }, 250);
});

test('test queue idleTime delay', function (t) {
    var maxTasks = 10;

    var tasksDone = [];
    var i;

    var q = new Queue({
        log: log,
        workers: 1,
        idleTime: maxTasks * 10
    });

    t.expect(maxTasks + 2);

    t.equal(q.idle, true, 'queue idle when created');

    q.once('idle', function () {
        t.equal(tasksDone.length, maxTasks, maxTasks + ' tasks done');
        t.end();
    });

    function pushTask(_i) {
        var ret = q.enqueue({
            description: 'idleTime: ' + _i,
            func: function (extras, cb) {
                // the quickest possible task
                tasksDone.push(_i);
                cb();
            }
        });
        t.equal(ret, true, 'task enqueued: ' + _i);
    }

    function enqueueDelayedTask(_i, delay) {
        setTimeout(function () {
            pushTask(_i);
        }, delay);
    }

    for (i = 0; i < maxTasks; i++) {
        enqueueDelayedTask(i, i*5);
    }
});
