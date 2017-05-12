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
 * Copyright 2017, Joyent, Inc.
 *
 * Substitute for 'zoneevent.c' that uses Vminfod or sysevents (as appropriate)
 * as an event source
 *
 */

var ZoneEvent = require('/usr/vm/node_modules/zoneevent').ZoneEvent;
var zone = require('/usr/node/node_modules/zonename');

var name = process.argv[2] || 'zoneevent CLI';
var zw = new ZoneEvent(name);

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
