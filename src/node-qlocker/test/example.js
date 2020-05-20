/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Verifies that code that looks a lot like that in the example in README.md
 * works.
 */

var tap = require('tap');
var qlocker = require('../lib/qlocker');
var path = 'some_file';
var fs = require('fs');

tap.test('able to lock ' + path, function _test(t) {
    t.teardown(function _teardown() {
        fs.unlinkSync(path);
    });

    qlocker.lock(path, function locked(err, unlocker) {
        t.equal(err, null, 'no error expected');
        if (err) {
            throw err;
        }

        // Critical section here (lock is held)

        unlocker(function unlocked() {
            t.end();
        });
    });
});

tap.test('fail fast with impossible path', function impossible(t) {
    qlocker.lock('/dev/null/some_file', function lock_cb(err, unlocker) {
        t.type(err, Error, 'expect an error');
        t.ok(!unlocker, 'unlocker is not truthy');
        t.end();
    });
});
