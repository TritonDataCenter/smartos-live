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
 * Copyright 2015, Joyent, Inc.
 */

var bunyan = require('bunyan');
var execFile = require('child_process').execFile;

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var TIMEOUT = 10 * 1000;
var DATASET = 'zones/zpoolwatcher-test-dummy-' + process.pid;

function zfs(args, cb) {
    var opts = {encoding: 'utf8'};
    execFile('zfs', args, opts, function (err, stdout, stderr) {
        if (err) {
            cb(err);
            return;
        } else if (stderr) {
            cb(new Error('stderr produced: ' + stderr));
            return;
        }
        cb(null, stdout);
    });
}

var ZpoolWatcher = require('vminfod/zpoolwatcher').ZpoolWatcher;
var log = bunyan.createLogger({
    level: 'warn',
    name: 'zpoolwatcher-test-dummy',
    streams: [ { stream: process.stderr, level: 'warn' } ],
    serializers: bunyan.stdSerializers
});
var zw = new ZpoolWatcher({log: log});

test('creating a ZFS dataset and catching the event', function (t) {
    var timeout = setTimeout(function () {
        t.ok(false, 'timeout');
        t.end();
    }, TIMEOUT);

    zw.on('all', function (ev) {
        if (ev.dsname === DATASET && ev.action === 'create'
            && ev.pool === 'zones') {
            clearTimeout(timeout);
            zw.removeAllListeners('all');
            t.end();
        }
    });

    zfs(['create', DATASET], function (err, out) {
        t.ifError(err, 'error creating dataset');
    });
});

test('modifying a ZFS dataset and catching the event', function (t) {
    var timeout = setTimeout(function () {
        t.ok(false, 'timeout');
        t.end();
    }, TIMEOUT);

    var found = 0;
    zw.on('all', function (ev) {
        if (ev.dsname === DATASET && ev.action === 'set'
            && ev.pool === 'zones') {

            if (ev.extra.atime === '1')
                found++;
            if (ev.extra.sync === '1')
                found++;

            if (found >= 2) {
                clearTimeout(timeout);
                zw.removeAllListeners('all');
                t.end();
            }
        }
    });

    zfs(['set', 'atime=on', 'sync=always', DATASET], function (err, out) {
        t.ifError(err, 'error modifying dataset');
    });
});

test('destroying a ZFS dataset and catching the event', function (t) {
    var timeout = setTimeout(function () {
        t.ok(false, 'timeout');
        t.end();
    }, TIMEOUT);

    zw.on('all', function (ev) {
        if (ev.dsname === DATASET && ev.action === 'destroy'
            && ev.pool === 'zones') {
            clearTimeout(timeout);
            zw.removeAllListeners('all');
            t.end();
        }
    });

    zfs(['destroy', DATASET], function (err, out) {
        t.ifError(err, 'error destroying dataset');
    });
});


test('cleanup', function (t) {
    t.ok(true, 'cleaning up');
    zw.shutdown();
    t.end();
});
