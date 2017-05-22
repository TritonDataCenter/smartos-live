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
 * Vminfod CLI
 */

var util = require('util');

var assert = require('/usr/node/node_modules/assert-plus');
var bunyan = require('/usr/node/node_modules/bunyan');
var getopt = require('/usr/node/node_modules/getopt');
var vminfod = require('/usr/vm/node_modules/vminfod/client');

var f = util.format;

var log = bunyan.createLogger({
    level: 'error',
    name: 'Vminfod CLI',
    stream: process.stderr,
    serializers: bunyan.stdSerializers
});

var client = new vminfod.VminfodClient({
    name: 'Vminfod CLI',
    log: log
});

function usage() {
    var _args = Array.prototype.slice.call(arguments);
    var msg = f.apply(null, _args);
    var out = [
        'Usage: vminfod [command] [args]',
        '',
        'Commands',
        '  ping               get vminfod ping     (GET /ping)',
        '  status [-f]        get vminfod status   (GET /status)',
        '  vms                get all vms          (GET /vms)',
        '  vm <uuid>          get vm info          (GET /vm/:uuid)',
        '  events [-jf]       trace vminfod events (GET /events)'
    ];
    if (msg) {
        out.unshift('');
        out.unshift(msg);
    }
    console.log(out.join('\n'));
}

function do_ping(args) {
    client.ping(function (err, msg) {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }

        assert.object(msg, 'msg');
        assert.string(msg.ping, 'msg.ping');

        console.log(msg.ping);
    });
}

function do_status(args) {
    var opts = [
        'f(full)'
    ].join('');
    var parser = new getopt.BasicParser(opts, args);

    opts = {};

    var option;
    while ((option = parser.getopt())) {
        switch (option.option) {
        case 'f':
            opts.query = opts.query || {};
            opts.query.full = true;
            break;
        default:
            usage();
            process.exit(1);
            break;
        }
    }

    client.status(opts, function (err, msg) {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }

        assert.object(msg, 'msg');

        console.log(JSON.stringify(msg, null, 2));
    });
}

function do_vms(args) {
    client.vms(function (err, msg) {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }

        assert.object(msg, 'msg');

        console.log(JSON.stringify(msg, null, 2));
    });
}

function do_vm(args) {
    var zonename = args[2];

    if (!zonename) {
        usage('vm zonename must be specified');
        process.exit(1);
    }

    client.vm(zonename, function (err, msg) {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }

        assert.object(msg, 'msg');

        console.log(JSON.stringify(msg, null, 2));
    });
}

function do_events(args) {
    var opts = [
        'f(full)',
        'j(json)'
    ].join('');
    var parser = new getopt.BasicParser(opts, args);


    var opt_f = false;
    var opt_j = false;

    var option;
    while ((option = parser.getopt())) {
        switch (option.option) {
        case 'f':
            opt_f = true;
            break;
        case 'j':
            opt_j = true;
            break;
        default:
            usage();
            process.exit(1);
            break;
        }
    }

    var vs = new vminfod.VminfodEventStream({
        name: 'Vminfod CLI',
        log: log
    });

    vs.on('readable', function () {
        var ev;
        while ((ev = vs.read()) !== null) {
            if (opt_j) {
                console.log(JSON.stringify(ev));
                return;
            }

            var zn;
            var date;
            if (opt_f) {
                date = ev.date.toISOString();
                zn = ev.zonename;
            } else {
                date = ev.date.toISOString().split('T')[1];
                zn = ev.zonename.split('-')[0];
            }

            var alias = (ev.vm || {}).alias || '-';
            if (alias.length > 30) {
                alias = f('%s...', alias.substr(0, 27));
            }

            // format the output nicely
            var base = f('[%s] %s %s %s',
                date, zn, alias, ev.type);

            delete ev.vm;
            if (ev.changes) {
                ev.changes.forEach(function (change) {
                    console.log('%s: %s %s :: %j -> %j',
                        base,
                        change.prettyPath,
                        change.action,
                        change.from,
                        change.to);
                });
            } else {
                console.log(base);
            }
        }
    });
}

function main() {
    var opts = [
        'h(help)'
    ].join('');
    var parser = new getopt.BasicParser(opts, process.argv);

    var option;
    while ((option = parser.getopt())) {
        switch (option.option) {
        case 'h':
            usage();
            process.exit(0);
            break;
        default:
            usage();
            process.exit(1);
            break;
        }
    }

    var args = process.argv.slice(parser.optind());
    var cmd = args.shift();

    // put 2 empty elements in front of the existing "args"
    // this can be removed if posix-getopt is updated
    args = ['', ''].concat(args);

    switch (cmd) {
    case 'ping':
        do_ping(args);
        break;
    case 'status':
        do_status(args);
        break;
    case 'vms':
        do_vms(args);
        break;
    case 'vm':
        do_vm(args);
        break;
    case 'events':
        do_events(args);
        break;
    case 'help':
        usage();
        process.exit(0);
        break;
    case undefined:
        usage('Command must be specified as the first argument');
        process.exit(1);
        break;
    default:
        usage('Unknown command: %s', cmd);
        process.exit(1);
        break;
    }
}
main();
