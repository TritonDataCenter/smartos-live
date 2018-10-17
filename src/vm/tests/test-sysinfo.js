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

var fs = require('fs');

var common = require('./common');

var SYSINFO_PROG = '/usr/bin/sysinfo';
var SYSINFO_FILE = '/tmp/.sysinfo.json';

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

function parseSysinfoOutput(t, out) {
    var info;

    try {
        info = JSON.parse(out);
    } catch (e) {
        common.ifError(t, e, 'parse sysinfo output');
        return;
    }

    t.equal(typeof (info), 'object', 'output is an object');
}

test('sysinfo executable', function (t) {
    fs.stat(SYSINFO_PROG, function (err, stats) {
        common.ifError(t, err, 'stat sysinfo');

        /* jsl:ignore octal_number */
        var mode = stats.mode & 0777;
        t.ok(mode & 0111, 'sysinfo executable');
        /* jsl:end */

        t.end();
    });
});

test('sysinfo (no args)', function (t) {
    common.exec([SYSINFO_PROG], function (err, out) {
        common.ifError(t, err, 'exec sysinfo');

        parseSysinfoOutput(t, out);

        t.end();
    });
});

test('sysinfo -f', function (t) {
    common.exec([SYSINFO_PROG, '-f'], function (err, out) {
        common.ifError(t, err, 'exec sysinfo');

        parseSysinfoOutput(t, out);

        t.end();
    });
});

test('sysinfo file: ' + SYSINFO_FILE, function (t) {
    fs.readFile(SYSINFO_FILE, 'utf8', function (err, out) {
        common.ifError(t, err, 'read sysinfo file');

        parseSysinfoOutput(t, out);

        t.end();
    });
});
