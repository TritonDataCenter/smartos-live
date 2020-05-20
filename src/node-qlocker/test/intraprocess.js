/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Verifies that when one process takes the same lock many times that the lock
 * is granted in the order in which it was requested.
 */

var tap = require('tap');
var qlocker = require('../lib/qlocker');
var vasync = require('vasync');
var fs = require('fs');

tap.test('intraprocess ordering', function _test(t) {
    var waiters = [];
    var max = 200;
    var path = 'intra_file';

    t.teardown(function _teardown() {
        fs.unlinkSync(path);
    });

    vasync.forEachParallel({
        'func': lockone,
        'inputs': Array.from(Array(max).keys())
    }, function (err, results) {
        if (err) {
            throw err;
        }
        t.end();
    });

    function lockone(waiter, next) {
        waiters.push(waiter);

        qlocker.lock(path, function locked(err, unlocker) {
            t.equal(err, null, 'no error expected');
            if (err) {
                throw err;
            }

            var delay;
            if (waiter === 0) {
                // The first waiter waits for all the others to make progress
                delay = 500;
            } else {
                // Others hold lock for a decreasing amount of time
                delay = (max - waiter) / 5;
            }

            setTimeout(function unlocking() {
                t.equal(waiters.length, max - waiter,
                    'verify length of waiters list');
                t.equal(waiter, waiters.shift(),
                    'got lock for expected waiter');

                unlocker(function unlocked() {
                    t.pass('unlocked ' + waiter);
                    next();
                });
            }, delay);
        });
    }
});
