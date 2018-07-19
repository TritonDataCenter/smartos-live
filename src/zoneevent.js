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
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

/*
 * Substitute for 'zoneevent.c' that uses `VM.events` as the event source.
 */

var f = require('util').format;

var bunyan = require('/usr/node/node_modules/bunyan');
var getopt = require('/usr/node/node_modules/getopt');
var ZoneEvent = require('/usr/vm/node_modules/zoneevent').ZoneEvent;
var zone = require('/usr/node/node_modules/zonename');

// ms to wait before retrying VM.events
var TRY_TIMEOUT = 1000;

var opts = [
    'h(help)',
    'i:(ident)',
    'l:(level)'
].join('');
var parser = new getopt.BasicParser(opts, process.argv);

var name = 'zoneevent CLI';
var logLevel = 'fatal';
var option;
while ((option = parser.getopt())) {
    switch (option.option) {
    case 'h':
        usage();
        process.exit(0);
        break;
    case 'i':
        name += f(' (%s)', option.optarg);
        break;
    case 'l':
        logLevel = option.optarg;
        break;
    default:
        usage();
        process.exit(1);
        break;
    }
}

var log = bunyan.createLogger({
    level: logLevel,
    name: 'zoneevent',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

function usage() {
    var out = [
        'Usage: zoneevent [-i <ident>] [-l <level>] [-h]',
        '',
        'Options',
        '  -h, --help           Print this help message and exit',
        '  -i, --ident <ident>  Identifier string to be used for this',
        '                       invocation (used for vminfod user-agent)',
        '  -l, --level <level>  Bunyan log level to use, defaults to fatal'
    ];
    console.log(out.join('\n'));
}

function start() {
    var ze = new ZoneEvent({
        name: name,
        log: log
    });

    ze.on('ready', function zoneEventReady(err, obj) {
        if (err) {
            throw err;
        }
    });

    ze.on('event', function zoneEventEventReceived(ev) {
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

    ze.on('error', function zoneEventError(err) {
        log.warn({err: err}, 'zoneEventError');

        setTimeout(start, TRY_TIMEOUT);
    });
}

start();
