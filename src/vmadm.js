#!/usr/bin/node
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
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 */

var async   = require('async');
var net     = require('net');
var onlyif  = require('onlyif');
var sprintf = require('sprintf').sprintf;
var sys     = require('sys');

var INFO_TYPES = ['all', 'version', 'chardev', 'block', 'blockstats', 'cpus',
    'pci', 'kvm', 'vnc'];

function out()
{
    console.log.apply(this, arguments);
}

function usage()
{
    out("Usage:", process.argv[1], " <command> [options]\n");
    out("  Commands:\n");
    out("    boot <uuid> [options] . boots the specified VM");
    out("    destroy <uuid> ........ destroy the specified VM");
    out("    dump <uuid> ........... output the JSON representation of a VM");
    out("    events ................ outputs a message for each VM event");
    out("    kill <uuid> ........... powers the specified VM off");
    out("    halt <uuid> [timeout] . halts the specified VM (default " +
        "timeout=180s)");
    out("    list [-v] ............. lists all VMs (optional verbose list)");
    out("    reset <uuid> .......... resets (power-cycles) the specified VM");
    out("    nmi <uuid> ............ sends an NMI to the specified VM");
    out("    info <uuid> [type] .... prints detailed info about specified VM");
    out("    mac <macaddr> ......... prints network info for specified MAC");
    out("\n  'boot' Options:\n");
    out("    order=cdn[,once=d] .... c=harddisk, d=cdrom, n=network");
    out("    cdrom=/path/to/image.iso,[ide|scsi|virtio]");
    out("    disk=/path/to/disk,[ide|scsi|virtio]");
    out("");
    process.exit(1);
}

function fatal()
{
    var args = [];

    args.push('Fatal Error:');
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    console.log.apply(this, args);
    process.exit(1);
}

// convert from cmdline args to payload args
function convertArgs(action, data, callback)
{
    var args = data.args;
    var arglist;
    var kv;
    var arg;
    var key, val;
    var path, model;

    delete data.args;

    if (!args || args.length < 1) {
        return;
    }

    switch (action) {
    case 'boot':
        for (arg in args) {
            if (args.hasOwnProperty(arg)) {
                kv = args[arg].split('=');
                if (kv < 2) {
                    return callback('unable to split ' + args[arg]);
                } else {
                    key = kv[0];
                    val = kv.slice(1).join('=');
                    if (key === 'order') {
                        data.boot = 'order=' + val;
                    } else if (key === 'disk' || key === 'cdrom') {
                        path = val.split(',')[0];
                        model = val.split(',')[1];
                        if (path.length === 0 || model.length === 0) {
                            return callback('parameter to ' + key +
                                ' must be: path,model');
                        }
                        if (!data.disks) {
                            data.disks = [];
                        }
                        data.disks.push({'path': path, 'model': model,
                            'media': key});
                    }
                }
            }
        }
        break;
    case 'info':
        if (args.length > 0) {
            arg = args[0];
            arglist = arg.split(',');

            for (arg in arglist) {
                if (arglist.hasOwnProperty(arg)) {
                    if (INFO_TYPES.indexOf(arglist[arg]) === -1) {
                        return callback('Unknown info type: ' + arglist[arg]);
                    }
                }
            }
            data.types = arglist;
        }
        break;
    case 'halt':
        if (args.length > 0) {
            arg = args[0];
            if (!isNaN(parseInt(arg, 10))) {
                data.timeout = (arg * 1000);
            } else {
                return callback('parameter to halt must be an integer number' +
                    'of seconds.');
            }
        }
        break;
    }

    callback();
}

function performAction(action, data, callback)
{
    var stream = net.Stream();
    var packet = { "action": action, "payload": data };
    var chunks, buffer = '';

    if (packet.payload.args) {
        convertArgs(action, packet.payload, function (err) {
            if (err) {
                return callback(err);
            }
        });
    }

    try {
        stream.setEncoding('utf8');

        stream.on('connect', function () {
            stream.write(JSON.stringify(packet) + '\n\n');
        });

        stream.on('data', function (chunk) {
            var result;
            buffer += chunk.toString();
            chunks = buffer.split('\n');
            while (chunks.length > 1) {
                result = JSON.parse(chunks.shift());
                if (result.type === 'failure') {
                    fatal(JSON.stringify(result.data));
                }
                if (result.type === 'update') {
                    out(JSON.stringify(result.data));
                } else if (result.type === 'success') {
                    callback(null, result);
                    stream.end();
                } else {
                    fatal('Unknown result type: ' + result.type);
                }
            }
            buffer = chunks.pop();
        });

        stream.connect('/tmp/vmadmd.sock');
    } catch (e) {
        callback(e);
    }
}

function formatVMList(result, flag)
{
    var res, err;

    if (result.data) {
        res = result.data;
        if (res.length > 0) {
            if (flag === '-v') {
                out(sprintf('%-36s  %-16s', 'UUID', 'STATUS'));
                res.forEach(function (vm) {
                    out(sprintf('%-36s  %-16s', vm.uuid, vm.state));
                });
            } else {
                res.forEach(function (vm) {
                    out(vm.uuid);
                });
            }
        }
        return 0;
    } else {
        out('error:', result);
        return 1;
    }
}

function formatVMDump(result, flag)
{
    var res, err;

    if (result.data) {
        res = result.data;
        out(JSON.stringify(res, null, 2));
        return 0;
    } else {
        out('error:', result);
        return 1;
    }
}

function die(error)
{
    out('fatal:', error);
    process.exit(1);
}

function main()
{
    var uuid;
    var debug = false;

    if (process.argv.length < 3) {
        usage();
    }

    switch (process.argv[2]) {
    case 'events':
        performAction("events", "", function (err, result) {
            if (err) {
                die(err);
            }
        });
        break;
    case 'list':
        performAction("list", "", function (err, result) {
            if (err) {
                die(err);
            }
            if (formatVMList(result, process.argv[3]) !== 0) {
                process.exit(1);
            }
        });
        break;
    case 'mac':
        var mac = process.argv[3];
        if (!mac) {
            console.log("Must supply mac address for " + process.argv[2] + "!");
            usage();
        } else {
            performAction(process.argv[2], { "mac": mac },
                function (err, result)
                {
                    if (err) {
                        die(err);
                    }
                    console.log(JSON.stringify(result.data));
                }
            );
        }
        break;
    case 'destroy':
    case 'dump':
    case 'halt':
    case 'kill':
    case 'reset':
    case 'nmi':
    case 'info':
    case 'boot':
        uuid = process.argv[3];
        if (!uuid) {
            console.log("Must supply uuid for " + process.argv[2] + "!");
            usage();
        } else if (uuid === 'all' && process.argv[2] === 'halt') {
            // only the 'halt' action currently supports 'all'
            performAction("list", "", function (err, result) {
                var res;
                var halts = [];
                if (err) {
                    die(err);
                }
                res = result.data;
                if (res.length > 0) {
                    res.forEach(function (vm) {
                        if (vm.state !== 'off') {
                            halts.push(function (cb) {
                                console.log('trying to halt', vm.uuid,
                                    'with current state', vm.state);
                                performAction('halt', { "uuid": vm.uuid }, cb);
                            });
                        }
                    });

                    async.parallel(halts, function (e, results) {
                        console.log('HALT-ALL:', e, results);
                    });
                }
            });
        } else {
            performAction(process.argv[2], { "uuid": uuid,
                "args": process.argv.slice(4) },
                function (err, result)
                {
                    if (err) {
                        die(err);
                    }
                    if (process.argv[2] === "dump") {
                        formatVMDump(result);
                    } else if (process.argv[2] === "info") {
                        formatVMDump(result);
                    } else if (debug) {
                        console.log(JSON.stringify(result));
                    }
                }
            );
        }
        break;
    default:
        console.log("Invalid command '" + process.argv[2] + "'");
        usage();
        break;
    }
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        console.log('Fatal: cannot run because: ' + err);
        process.exit(1);
    }
    main();
});
