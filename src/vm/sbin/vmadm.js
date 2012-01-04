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

var fs = require('fs');
var VM = require('VM');
var nopt = require('nopt');
var onlyif = require('onlyif');
var path = require('path');
var sprintf = require('sprintf').sprintf;
var tty = require('tty');

//VM.DEBUG=true;

var COMMANDS = [
    'start', 'boot',
    'console',
    'create',
    'delete', 'destroy',
    'stop', 'halt',
    'info',
    'get', 'json',
    'list',
    'lookup',
    'reboot',
    'sysrq',
    'update'
];

/*
 * To add a field as 'listable', add it here.  If it exists as a field in a
 * vm object, that is enough.  If it's a 'fake' field, you'll also need
 * to add it to the addFakeFields() function.
 *
 */
var LIST_FIELDS = {
    'alias': {header: 'ALIAS', width: 10},
    'autoboot': {header: 'AUTOBOOT', width: 8},
    'billing_id': {header: 'BILLING_ID', width: 36},
    'brand': {header: 'BRAND', width: 6},
    'cpu_cap': {header: 'CPU_CAP', width: 7},
    'cpu_shares': {header: 'CPU_SHARE', width: 9},
    'cpu_type': {header: 'CPU_TYPE', width: 8},
    'create_timestamp': {header: 'CREATE_TIMESTAMP', width: 24},
    'dns_domain': {header: 'DOMAIN', width: 32},
    'hostname': {header: 'HOSTNAME', width: 32},
    'ram': {header: 'RAM', width: 7},
    'max_locked_memory': {header: 'MAX_LOCKED', width: 10},
    'max_lwps': {header: 'MAX_LWP', width: 7},
    'max_physical_memory': {header: 'MAX_PHYS', width: 8},
    'max_swap': {header: 'MAX_SWAP', width: 8},
    'owner_uuid': {header: 'OWNER_UUID', width: 36},
    'package_name': {header: 'PACKAGE_NAME', width: 32},
    'package_version': {header: 'PACKAGE_VER', width: 11},
    'pid': {header: 'PID', width: 6},
    'qemu_extra_opts': {header: 'QEMU_EXTRA_OPTS', width: 15},
    'quota': {header: 'QUOTA', width: 5},
    'real_state': {header: 'REAL_STATE', width: 10},
    'state': {header: 'STATE', width: 16},
    'tmpfs': {header: 'TMPFS', width: 5},
    'type': {header: 'TYPE', width: 4},
    'uuid': {header: 'UUID', width: 36},
    'vcpus': {header: 'VCPUS', width: 5},
    'zfs_io_priority': {header: 'IO_PRIORITY', width: 11},
    'zfs_storage_pool_name': {header: 'ZFS_POOL', width: 12},
    'zonename': {header: 'ZONENAME', width: 12},
    'zoneid': {header: 'ZONEID', width: 6}
};

var DEFAULT_SORT = 'ram,uuid';
var DEFAULT_ORDER = 'uuid,type,ram,state,alias';

function usage(message)
{
    if (message) {
        console.error(message);
    }
    console.error('Usage: ' + process.argv[1] + ' <command> [options]');
    process.exit(2);
}

function getListProperties(field)
{
    var result = {};
    var fields = [];

    if (LIST_FIELDS.hasOwnProperty(field)) {
        return LIST_FIELDS[field];
    }

    fields = field.split('.');
    if (fields.length === 3 && VM.FLATTENABLE_ARRAY_HASH_KEYS.indexOf(fields[0]) !== -1) {
        return {"header": field.toUpperCase(), "width": 20};
    } else if (fields.length === 2 && VM.FLATTENABLE_HASH_KEYS.indexOf(fields[0]) !== -1) {
        return {"header": field.toUpperCase(), "width": 20};
    }

    return undefined;
}

function getUUID(command, p)
{
    var uuid;

    if (p.argv.remain.length > 0) {
        uuid = p.argv.remain.shift();
        if (uuid.length === 36 &&
            uuid[8] === '-' && uuid[13] === '-' &&
            uuid[18] === '-' && uuid[23] === '-') {

            return uuid;
        }
    }

    usage('Invalid or missing UUID for ' + command);
}

function parseKeyEqualsValue(args)
{
    var kv, key, value;
    var parsed = {};

    for (arg in args) {
        kv = args[arg].split('=');
        if (kv < 2) {
            usage('Bad arguments: unable to split ' + args[arg]);
        } else {
            key = kv[0];
            val = kv.slice(1).join('=');
            parsed[key] = val;
        }
    }

    return parsed;
}

function parseStartArgs(args)
{
    var key, value;
    var parsed, extra = {};
    var path, model;

    parsed = parseKeyEqualsValue(args);
    for (key in parsed) {
        val = parsed[key];
        if (key === 'order') {
            extra.boot = 'order=' + val;
        } else if (key === 'disk' || key === 'cdrom') {
            path = val.split(',')[0];
            model = val.split(',')[1];
            if (!model || !path || path.length === 0 || model.length === 0) {
                usage('Parameter to ' + key + ' must be: path,model');
            }
            if (!extra.disks) {
                extra.disks = [];
            }
            extra.disks.push({'path': path, 'model': model, 'media': key});
        } else {
            usage('Invalid argument to start: ' + key);
        }
    }

    return extra;
}

function parseInfoArgs(args)
{
    types = [];

    for (arg in args) {
        types = types.concat(args[arg].split(','));
    }

    for (type in types) {
        if (VM.INFO_TYPES.indexOf(types[type]) === -1) {
            usage('Invalid info type: ' + types[type]);
        }
    }

    if (types.length === 0) {
        types.push('all');
    }
    return types;
}

function addCommandOptions(command, opts, shorts)
{
    opts.verbose = Boolean;
    shorts.v = ['--verbose', 'true'];
    opts.debug = Boolean;
    shorts.d = ['--debug', 'true'];

    switch (command) {
    case 'start':
    case 'boot':
    case 'delete':
    case 'destroy':
    case 'info':
    case 'get':
    case 'json':
    case 'sysrq':
        // these only take uuid or 'special' args like start order=cd
        break;
    case 'lookup':
        opts.json = Boolean;
        shorts.j = ['--json'];
        opts.unique = Boolean;
        shorts['1'] = ['--unique'];
        break;
    case 'create':
    case 'update':
        opts.file = path;
        shorts.f = ['--file'];
        break;
    case 'list':
        opts.order = String;
        shorts.o = ['--order'];
        opts.sortby = String;
        shorts.s = ['--sortby'];
        opts.parsable = [Boolean, 'false'];
        shorts.p = ['--parsable', 'true'];
        opts.header = [Boolean, 'true'];
        shorts.h = ['--header', 'true'];
        shorts.H = ['--header', 'false'];
        break;
    case 'halt':
    case 'stop':
    case 'reboot':
        opts.force = Boolean;
        shorts.F = ['--force', 'true'];
        break;
    }
}

function getInfo(uuid, types, callback)
{
    VM.info(uuid, types, function (err, data) {
        if (err) {
            // Our error message here gets shown to the user.
            return callback(new Error('Unable to get VM info for ' + uuid +
                ':', err.message));
        }
        console.log(JSON.stringify(data, null, 2));
        callback();
    });
}

function startVM(uuid, extra, callback)
{
    VM.start(uuid, extra, function (err, result) {
        if (err) {
            // Our error message here gets shown to the user.
            return callback(new Error('Unable to start VM ' + uuid +
                ':', err.message));
        }
        callback();
    });
}

function addFakeFields(m)
{
    if (m.brand === 'kvm') {
        m.type = 'KVM';
    } else {
        m.ram = m.max_physical_memory;
        m.type = 'OS';
    }
}

function sortVM(a, b, sort_fields)
{
    var field;
    var fields;
    var direction;
    var avalue, bvalue;

    for (field in sort_fields) {
        direction = 1;
        field = sort_fields[field];

        if (field[0] === '+') {
            field = field.substr(1);
            direction = 1;
        } else if (field[0] === '-') {
            field = field.substr(1);
            direction = -1;
        } else {
            direction = 1;
        }

        avalue = VM.flatten(a, field);
        bvalue = VM.flatten(b, field);

        if (avalue > bvalue || (!avalue && bvalue) ||
            ((avalue === undefined) && (bvalue !== undefined))) {

            return (direction);
        } else if (avalue < bvalue || avalue && !bvalue ||
            ((avalue !== undefined) && (bvalue === undefined))) {

            return (direction * -1);
        }

        // if they're equal we keep going to the next field
    }

    // didn't find any field where one was > the other.
    return 0;
}

function rtrim(str, chars)
{
    chars = chars || "\\s";
    str = str || "";
    return str.replace(new RegExp("[" + chars + "]+$", "g"), "");
}

function outputVMListLine(order_fields, m, options)
{
    var fmt = '';
    var args = [];
    var fields;
    var width;
    var value;
    var output;

    for (field in order_fields) {
        field = order_fields[field];
        if (options.parsable && fmt.length !== 0) {
            fmt = fmt + ':';
        } else if (fmt.length !== 0) {
            fmt = fmt + '  ';
        }
        width = getListProperties(field).width;

        if (!m) {
            // This is special case to just write the header.
            value = getListProperties(field).header;
        } else if (VM.flatten(m, field)) {
            value = VM.flatten(m, field).toString();
        } else if (options.parsable) {
            value = '';
        } else {
            value = '-';
        }

        if (options.parsable) {
            // TODO: escape ':' characters in each bit.
            fmt = fmt + '%s';
        } else {
            fmt = fmt + '%-' + width + 's';
        }
        args.push(value);
    }
    args.unshift(fmt);

    output = rtrim(sprintf.apply(this, args));
    console.log(output);
}

function formatVMList(vmobjs, order, sortby, options, callback)
{
    var res, err;
    var sort_fields;
    var order_fields;

    if (vmobjs) {

        sort_fields = sortby.split(',');
        if (sort_fields.length === 0) {
            return callback(new Error('no sort fields provided'));
        }

        for (field in sort_fields) {
            field = sort_fields[field];
            if (field[0] === '-' || field[0] === '+') {
                if (!getListProperties(field.substr(1))) {
                    return callback(new Error('invalid sort field: ' + field));
                }
            } else {
                if (!getListProperties(field)) {
                    return callback(new Error('invalid sort field: ' + field));
                }
            }
        }

        order_fields = order.split(',');
        if (order_fields.length === 0) {
            return callback(new Error('no order fields provided'));
        }

        for (field in order_fields) {
            field = order_fields[field];
            if (!getListProperties(field)) {
                return callback(new Error('invalid order field: ' + field));
            }
        }

        vmobjs.sort(function (a, b) {
            // wrap just so we can add our order parameter.
            return sortVM(a, b, sort_fields);
        });

        // With the -H option, we don't print a header.
        if (!options.hasOwnProperty('header') || options.header === true) {
            outputVMListLine(order_fields, null, options)
        }

        vmobjs.forEach(function (m) {
            outputVMListLine(order_fields, m, options);
        });
    } else {
        return callback(new Error('no vms to list'));
    }
}

function listVM(spec, order, sortby, options, callback)
{
    vmobjs=[];

    if (!spec) {
        spec = {};
    }

    VM.lookup(spec, {"full": true, "transform": addFakeFields},
        function (err, vmobjs)
        {
            if (err) {
                return callback(err);
            }
            formatVMList(vmobjs, order, sortby, options, callback);
        }
    );
}

function readFile(filename, callback)
{
    var data = new Buffer('');

    if (filename === '-') {
        filename = '/dev/stdin';
    }

    fs.readFile(filename, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(new Error('File: ' + filename +
                    ' does not exist.'));
            } else {
                return callback(new Error('Error reading: ' + filename +
                    ' ' + JSON.stringify(err)));
            }
        }
        payload = JSON.parse(data.toString());
        return callback(null, payload);
    });
}

function main(callback)
{
    var args = process.argv.slice(1);
    var command = process.argv[2];
    var filename;
    var extra = {};
    var options = {};
    var knownOpts = {};
    var order;
    var parsed;
    var shortHands = {};
    var sortby;
    var type;
    var uuid;

    if (!command) {
        usage();
    } else if (COMMANDS.indexOf(command) === -1) {
        usage('Invalid command: "' + command + '".');
    }

    addCommandOptions(command, knownOpts, shortHands);
    parsed = nopt(knownOpts, shortHands, args, 2);

    //console.log("parsed =\n"+ require("util").inspect(parsed));

    if (parsed.debug) {
        VM.loglevel = 'DEBUG';
    } else {
        VM.loglevel = 'INFO';
    }

    switch (command) {
    case 'start':
    case 'boot':
        uuid = getUUID(command, parsed);
        extra = parseStartArgs(parsed.argv.remain);
        return startVM(uuid, extra, function (err) {
            if (err) {
                return callback(err);
            }
            return callback(null, 'Successfully started ' + uuid);
        });
    case 'console':
        uuid = getUUID(command, parsed);
        return VM.console(uuid, function (err) {
            return callback(err);
        });
    case 'update':
        uuid = getUUID(command, parsed);
        extra = parseKeyEqualsValue(parsed.argv.remain);

        if (parsed.hasOwnProperty('file') && parsed.file !== '-') {
            filename = parsed.file;
        } else {
            filename = '-';
        }
        if (JSON.stringify(extra) !== '{}') {
            VM.update(uuid, extra, function (err, info) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null, 'Successfully updated ' + uuid);
                }
            });
        } else {
            if (filename === '-' && tty.isatty(0)) {
                usage('Will not ' + command + ' from stdin when stdin is a tty.');
            }
            readFile(filename, function (err, payload) {
                if (err) {
                    return callback(err);
                }
                VM.update(uuid, payload, function (err, info) {
                    if (err) {
                        return callback(err);
                    }
                    return callback(null, 'Successfully updated ' + uuid);
                });
            });
        }
        break;
    case 'create':
        if (parsed.hasOwnProperty('file') && parsed.file !== '-') {
            filename = parsed.file;
        } else {
            filename = '-';
        }
        if (filename === '-' && tty.isatty(0)) {
            usage('Will not ' + command + ' from stdin when stdin is a tty.');
        }
        return readFile(filename, function (err, payload) {
            if (err) {
                return callback(err);
            }
            VM.create(payload, function (err, info) {
                if (err) {
                    return callback(err);
                }
                return callback(null, 'Successfully created ' + info.uuid);
            });
        });
    case 'delete':
    case 'destroy':
        uuid = getUUID(command, parsed);
        return VM.delete(uuid, function (err) {
            if (err) {
                return callback(err);
            }
            return callback(null, 'Successfully deleted ' + uuid);
        });
    case 'get':
    case 'json':
        uuid = getUUID(command, parsed);
        VM.load(uuid, function (err, obj) {
            if (err) {
                return callback(err);
            }
            console.log(JSON.stringify(obj, null, 2));
            return callback();
        });
        break;
    case 'info':
        uuid = getUUID(command, parsed);
        types = parseInfoArgs(parsed.argv.remain);
        return getInfo(uuid, types, callback);
    case 'lookup':
        extra = parseKeyEqualsValue(parsed.argv.remain);
        options = {"transform": addFakeFields};
        if (parsed.json) {
            options.full = true;
        }
        return VM.lookup(extra, options, function (err, results) {
            var m;
            if (err) {
                return callback(err);
            }
            if (parsed.unique && results.length !== 1) {
                return callback(new Error('Requested unique lookup but found ' +
                    results.length + ' results.'));
            }
            if (parsed.json) {
                console.log(JSON.stringify(results, null, 2));
            } else {
                for (m in results) {
                    m = results[m];
                    console.log(m);
                }
            }
        });
    case 'sysrq':
        uuid = getUUID(command, parsed);
        if (!parsed.argv.remain || parsed.argv.remain.length !== 1) {
            return usage('Wrong number of parameters to "sysrq"');
        }
        type = parsed.argv.remain[0];
        if (VM.SYSRQ_TYPES.indexOf(type) !== 1) {
            return usage('Invalid sysrq type: ' + type);
        }

        return VM.sysrq(uuid, type, {}, function (err) {
            if (err) {
                return callback(err);
            }
            return callback(null, 'Sent ' + type + ' sysrq to ' + uuid);
        });
    case 'list':
        extra = parseKeyEqualsValue(parsed.argv.remain);
        sortby = DEFAULT_SORT;
        order = DEFAULT_ORDER;
        options = {};
        if (parsed.hasOwnProperty('sortby')) {
            sortby = parsed.sortby;
        }
        if (parsed.hasOwnProperty('order')) {
            order = parsed.order;
        }
        if (parsed.parsable) {
            options.parsable = true;
            options.header = false;
        }
        if (parsed.hasOwnProperty('header')) {
            // allow -h to force header on or -H to force off.
            options.header = parsed.header;
        }
        return listVM(extra, order, sortby, options, callback);
    case 'halt':
        command = 'stop';
    case 'stop':
    case 'reboot':
        uuid = getUUID(command, parsed);
        if (parsed.force) {
            extra = {force: true};
        }
        return VM[command](uuid, extra, function (err) {
            if (err) {
                return callback(err);
            }
            callback(null, 'Succesfully completed ' + command + ' for ' + uuid);
        });
    default:
        return callback();
    }
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        console.error('FATAL: cannot run because: ' + err);
        process.exit(2);
    }
    main(function (err, message) {
        if (err) {
            console.error(err.message);
            process.exit(1);
        }
        if (message) {
            console.error(message);
        }
        process.exit(0);
    });
});
