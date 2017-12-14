#!/usr/node/bin/node
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
 * Copyright (c) 2017, Joyent, Inc.
 *
 */

/*
 * Substitute for 'zoneevent.c' that uses `VM.events` as the event source.
 */

var f = require('util').format;

var bunyan = require('/usr/node/node_modules/bunyan');
var ZoneEvent = require('/usr/vm/node_modules/zoneevent').ZoneEvent;
var zone = require('/usr/node/node_modules/zonename');

var name = 'zoneevent CLI';

if (process.argv[2]) {
    name += f(' (%s)', process.argv[2]);
}

var log = bunyan.createLogger({
    level: 'fatal',
    name: 'zoneevent',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

var zw = new ZoneEvent({
    name: name,
    log: log
});

zw.on('ready', function (err, obj) {
    if (err)
        throw err;

    // It's unfortunate, but `zoneevent.c` never published a "ready" event, so
    // we just silently ignore this if everything works as expected.
});

zw.on('event', function (ev) {
    /*
     * ZoneEvent returns an object that looks like this:
     *
     * {
     *   "date": "2017-05-12T19:33:33.097Z",
     *   "zonename": "fb622681-3d62-413b-dc8a-c7515367464f",
     *   "newstate": "running",
     *   "oldstate": "ready"
     * }
     *
     * Which must be transformed to look like this:
     *
     * {
     *   "zonename": "fb622681-3d62-413b-dc8a-c7515367464f",
     *   "newstate": "running",
     *   "oldstate": "ready",
     *   "when": "1494617613097227838",
     *   "channel": "com.sun:zones:status",
     *   "class": "status",
     *   "zoneid": "463",
     *   "subclass": "change"
     * }
     *
     * With channel, class and subclass omitted
     */

    var zoneid;
    try {
        zoneid = zone.getzoneidbyname(ev.zonename);
    } catch (e) {
        zoneid = -1;
    }

    var obj = {
        zonename: ev.zonename,
        oldstate: ev.oldstate,
        newstate: ev.newstate,
        zoneid: zoneid.toString(),
        when: (ev.date.getTime().toString()) + '000000'
    };

    console.log(JSON.stringify(obj));
});
