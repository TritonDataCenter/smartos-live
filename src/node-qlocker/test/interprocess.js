/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Verifies that when multiple processes are trying to get a lock that only one
 * of them gets it at a time.
 */

var tap = require('tap');
var qlocker = require('../lib/qlocker');
var assert = require('assert-plus');
var cp = require('child_process');
var fs = require('fs');

/*
 * The child process receives messages like the following from the parent:
 *
 * Lock `somefile` for 200 ms:
 *   { 'cmd': 'lock', 'path': 'somefile', 'timeout': 200 }
 * Exit the subprocess with exit code 0:
 *   { 'cmd': 'die' }
 *
 * The child sends messages like the following to the parent:
 *
 * Ready to lock files:
 *   { 'subject': 'ready' }
 * File locked:
 *   { 'subject': 'locked' }
 * File unlocked:
 *   { 'subject': 'unlocked', 'heldtime': [sec, usec] }
 *
 * The heldtime is as is returned from process.hrtime(start_hrt).
 *
 * If the parent dies without sending a 'die', the child will exit 0.
 *
 * Note that 'die' can be used while the lock is held to verify that the lock is
 * released when he holder exits.
 */
if (process.argv.length > 2 && process.argv[2] === 'child') {
    process.on('message', function parentSaid(msg) {
        assert.object(msg, 'msg');
        assert.string(msg.cmd, 'msg.cmd');

        if (msg.cmd === 'die') {
            process.exit(0);
        }

        assert.equal(msg.cmd, 'lock');
        assert.string(msg.path, 'msg.path');
        assert.number(msg.timeout, 'msg.timeout');

        qlocker.lock(msg.path, function childLocked(err, unlocker) {
            if (err) {
                throw err;
            }

            var childLockedAt = process.hrtime();
            process.send({'subject': 'locked'});

            setTimeout(function unlockChild() {
                unlocker(function notifyParent() {
                    process.send({
                        'subject': 'unlocked',
                        'heldtime': process.hrtime(childLockedAt)
                    });
                });
            }, msg.timeout);
        });
    });

    process.on('disconnect', function parentGone() {
        process.exit(1);
    });

    process.send({'subject': 'ready'});

} else {
    tap.test('interprocess locks are respected', function _test1(t) {
        var path = 'inter_file_01';
        var handlers = {};
        var child = cp.fork('./test/interprocess.js', ['child']);
        var childTimeout = 200;

        t.teardown(function _teardown() {
            fs.unlinkSync(path);
        });

        child.on('error', function childError(err) {
            child.unref();
            throw err;
        });

        child.on('message', function childSaid(msg) {
            assert.object(msg, 'msg');
            if (!msg.subject) {
                t.fail('unexpected msg: ' + JSON.stringify(msg));
                return;
            }
            handlers[msg.subject](msg);
        });

        handlers.ready = function childReady() {
            var childLockedAt;

            t.setTimeout(childTimeout * 2);

            handlers.locked = function childLocked() {
                childLockedAt = process.hrtime();

                qlocker.lock(path, function locked(err, unlocker) {
                    var ms = hrTimeToMs(process.hrtime(childLockedAt));
                    t.ok(ms >= childTimeout, 'Parent lock must wait at least ' +
                        childTimeout + 'ms. Waited ' + ms + 'ms.');
                });
            };

            handlers.unlocked = function childUnlocked(msg) {
                assert(childLockedAt);
                assert.arrayOfNumber(msg.heldtime);
                var ms = hrTimeToMs(msg.heldtime);
                t.ok(ms >= childTimeout, 'Child lock must be held at least ' +
                    childTimeout+ 'ms. Waited ' + ms + 'ms.');
                child.send({'cmd': 'die'});
                child.unref();
                t.end();
            };
        };

        child.send({'cmd': 'lock', 'path': path, 'timeout': childTimeout});
    });

    tap.test('locks are dropped when a process dies', function _test2(t) {
        var path = 'inter_file_02';
        var handlers = {};
        var child = cp.fork('./test/interprocess.js', ['child']);
        var childTimeout = 200;
        var killAfter = 100;

        t.teardown(function _teardown() {
            fs.unlinkSync(path);
        });

        child.on('error', function childError(err) {
            child.unref();
            throw err;
        });

        child.on('message', function childSaid(msg) {
            assert.object(msg, 'msg');
            if (!msg.subject) {
                t.fail('unexpected msg: ' + JSON.stringify(msg));
                return;
            }
            handlers[msg.subject](msg);
        });

        handlers.ready = function childReady() {
            var childLockedAt;

            handlers.locked = function childLocked() {
                childLockedAt = process.hrtime();

                t.setTimeout(childTimeout * 2);

                // Tell the child to go away
                setTimeout(function killChild() {
                    child.send({'cmd': 'die'});
                }, killAfter);

                qlocker.lock(path, function locked(err, unlocker) {
                    var ms = hrTimeToMs(process.hrtime(childLockedAt));
                    t.ok(ms >= killAfter, 'Parent lock must wait at least ' +
                        killAfter + 'ms. Waited ' + ms + 'ms.');
                    t.ok(ms < childTimeout, 'Parent lock must less than ' +
                        childTimeout + 'ms. Waited ' + ms + 'ms.');
                    unlocker(function parentUnlock() {
                        child.unref();
                        t.end();
                    });
                });
            };
        };

        // There is intentionally no handler.unlock because the child should die
        // before it would be called.

        child.send({'cmd': 'lock', 'path': path, 'timeout': childTimeout});

    });
}

function hrTimeToMs(hrt) {
    return (hrt[0] * 1000 + hrt[1] / 1000000);
}
