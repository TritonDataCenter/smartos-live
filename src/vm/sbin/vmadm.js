#!/usr/node/bin/node --abort_on_uncaught_exception
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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var fs = require('fs');
var fwlog = require('/usr/fw/lib/util/log');
var VM = require('/usr/vm/node_modules/VM');
var nopt = require('/usr/vm/node_modules/nopt');
var onlyif = require('/usr/node/node_modules/onlyif');
var panic = require('/usr/node/node_modules/panic');
var sprintf = require('/usr/node/node_modules/sprintf').sprintf;
var tty = require('tty');
var util = require('util');
var draining_stdout_and_exiting = false;

VM.logname = 'vmadm';

// VM.DEBUG=true;

var COMMANDS = [
    'start', 'boot',
    'console',
    'create',
    'create-snapshot',
    'delete', 'destroy',
    'delete-snapshot',
    'stop', 'halt',
    'help',
    'info',
    'install',
    'get', 'json',
    'list',
    'lookup',
    'reboot',
    'receive', 'recv',
    'reprovision',
    'rollback-snapshot',
    'send',
    'sysrq',
    'update',
    'validate'
];

/*
 * To add a field as 'listable', add it here.  If it exists as a field in a
 * vm object, that is enough.  If it's a 'fake' field, you'll also need
 * to add it to the addFakeFields() function.
 *
 */
var LIST_FIELDS = {
    alias: {header: 'ALIAS', width: 10},
    autoboot: {header: 'AUTOBOOT', width: 8},
    billing_id: {header: 'BILLING_ID', width: 36},
    brand: {header: 'BRAND', width: 14},
    cpu_cap: {header: 'CPU_CAP', width: 7},
    cpu_shares: {header: 'CPU_SHARE', width: 9},
    cpu_type: {header: 'CPU_TYPE', width: 8},
    create_timestamp: {header: 'CREATE_TIMESTAMP', width: 24},
    dns_domain: {header: 'DOMAIN', width: 32},
    do_not_inventory: {header: 'DNI', width: 5},
    firewall_enabled: {header: 'FIREWALL_ENABLED', width: 16},
    hostname: {header: 'HOSTNAME', width: 32},
    image_uuid: {header: 'IMAGE_UUID', width: 36},
    ram: {header: 'RAM', width: 7},
    max_locked_memory: {header: 'MAX_LOCKED', width: 10},
    max_lwps: {header: 'MAX_LWP', width: 7},
    max_physical_memory: {header: 'MAX_PHYS', width: 8},
    max_swap: {header: 'MAX_SWAP', width: 8},
    owner_uuid: {header: 'OWNER_UUID', width: 36},
    package_name: {header: 'PACKAGE_NAME', width: 32},
    package_version: {header: 'PACKAGE_VER', width: 11},
    pid: {header: 'PID', width: 6},
    qemu_extra_opts: {header: 'QEMU_EXTRA_OPTS', width: 15},
    quota: {header: 'QUOTA', width: 5},
    zone_state: {header: 'ZONE_STATE', width: 10},
    state: {header: 'STATE', width: 16},
    tmpfs: {header: 'TMPFS', width: 5},
    type: {header: 'TYPE', width: 4},
    uuid: {header: 'UUID', width: 36},
    vcpus: {header: 'VCPUS', width: 5},
    zfs_io_priority: {header: 'IO_PRIORITY', width: 11},
    zpool: {header: 'ZPOOL', width: 12},
    zonename: {header: 'ZONENAME', width: 12},
    zonepath: {header: 'ZONEPATH', width: 40},
    zoneid: {header: 'ZONEID', width: 6}
};

var DEFAULT_SORT = 'ram,uuid';
var DEFAULT_ORDER = 'uuid,type,ram,state,alias';

function usage(message, code)
{
    var out;

    if (!code) {
        code = 2;
    }

    if (code === 0) {
        out = console.log;
    } else {
        out = console.error;
    }

    if (message) {
        out(message);
    }

    out('Usage: ' + process.argv[1] + ' <command> [options]');
    out('');
    out('create [-f <filename>]');
    out('create-snapshot <uuid> <snapname>');
    out('console <uuid>');
    out('delete <uuid>');
    out('delete-snapshot <uuid> <snapname>');
    out('get <uuid>');
    out('info <uuid> [type,...]');
    out('install <uuid>');
    out('list [-p] [-H] [-o field,...] [-s field,...] [field=value ...]');
    out('lookup [-j|-1] [-o field,...] [field=value ...]');
    out('reboot <uuid> [-F]');
    out('receive [-f <filename>]');
    out('reprovision [-f <filename>]');
    out('rollback-snapshot <uuid> <snapname>');
    out('send <uuid> [target]');
    out('start <uuid> [option=value ...]');
    out('stop <uuid> [-F]');
    out('sysrq <uuid> <nmi|screenshot>');
    out('update <uuid> [-f <filename>]');
    out(' -or- update <uuid> property=value [property=value ...]');
    out('validate create [-f <filename>]');
    out('validate update <brand> [-f <filename>]');
    out('');
    out('For more detailed information on the use of this command,'
        + 'type \'man vmadm\'.');

    process.exit(code);
}

function validFilterKey(key)
{
    var disk_re;
    var nic_re;

    disk_re = new RegExp('^disks\.[\*0-9]*\.'
        + '(boot|image_name|image_size|image_uuid|size|media|model|zpool)$');
    nic_re = new RegExp('nics\.[\*0-9]*\.'
        + '(dhcp_server|gateway|interface|ip|mac|model|netmask|nic_tag'
        + '|vlan_id)$');

    if (LIST_FIELDS.hasOwnProperty(key)) {
        return true;
    }

    // for complex fields we need a regex

    if (key.match(disk_re)) {
        return true;
    }

    if (key.match(nic_re)) {
        return true;
    }

    if (key.match(/^(tags|customer_metadata|internal_metadata)\..*/)) {
        return true;
    }

    return false;
}

// just rules out some confusing options that work for lookup but don't make
// sense in list form.
function validColumnKey(key)
{
    var bad_re;

    // when we have a .*. we won't know which one to show
    bad_re = new RegExp('^(disks|filesystems|nics)\.\\*\.*');

    if (key.match(bad_re)) {
        return false;
    }

    return true;
}

function getListProperties(field)
{
    var fields = [];

    if (LIST_FIELDS.hasOwnProperty(field)) {
        return LIST_FIELDS[field];
    }

    fields = field.split('.');
    if (fields.length === 3
        && VM.FLATTENABLE_ARRAY_HASH_KEYS.indexOf(fields[0]) !== -1) {

        return {header: field.toUpperCase(), width: 20};
    } else if (fields.length === 2
        && VM.FLATTENABLE_HASH_KEYS.indexOf(fields[0]) !== -1) {

        return {header: field.toUpperCase(), width: 20};
    }

    return undefined;
}

function getUUID(command, p)
{
    var uuid;

    if (p.argv.remain.length > 0) {
        uuid = p.argv.remain.shift();
        if (uuid.length === 36
            && uuid[8] === '-' && uuid[13] === '-'
            && uuid[18] === '-' && uuid[23] === '-') {

            return uuid;
        }
    }

    return usage('Invalid or missing UUID for ' + command);
}

/*
 * When the 'multiple' argument is true, we return an array of values like:
 *
 * [ {key1: value1}, {key2: value2} ]
 *
 * when false we return an object and where keys collide, last one wins.
 */
function parseKeyEqualsValue(args, multiple)
{
    var arg;
    var key;
    var kv;
    var obj;
    var parsed;
    var val;

    if (multiple) {
        parsed = [];
    } else {
        parsed = {};
    }

    for (arg in args) {
        kv = args[arg].split('=');
        if (kv < 2) {
            usage('Bad arguments: unable to split ' + args[arg]);
        } else {
            key = kv[0];
            val = kv.slice(1).join('=');
            if (multiple) {
                obj = {};
                obj[key] = val;
                parsed.push(obj);
            } else {
                parsed[key] = val;
            }
        }
    }

    return parsed;
}

function parseStartArgs(args)
{
    var extra = {};
    var model;
    var p;
    var pair;
    var parsed;
    var saw_order = false;
    var key;
    var val;

    parsed = parseKeyEqualsValue(args, true);
    for (pair in parsed) {
        pair = parsed[pair];
        for (key in pair) {
            val = pair[key];
            if (key === 'order') {
                // only want one order option, multiple will be an error here.
                if (saw_order) {
                    usage('You can only specify \'order\' once when starting a '
                        + 'VM');
                    // NOTREACHED
                }
                extra.boot = 'order=' + val;
                saw_order = true;
            } else if (key === 'disk' || key === 'cdrom') {
                p = val.split(',')[0];
                model = val.split(',')[1];
                if (!model || !p || p.length === 0 || model.length === 0) {
                    usage('Parameter to ' + key + ' must be: path,model');
                }
                if (VM.DISK_MODELS.indexOf(model) === -1) {
                    usage('Invalid model "' + model + '": model must be one '
                        + 'of: ' + VM.DISK_MODELS.join(','));
                }
                if (!extra.disks) {
                    extra.disks = [];
                }
                extra.disks.push({path: p, model: model, media: key});
            } else {
                usage('Invalid argument to start: ' + key);
                // NOTREACHED
            }
        }
    }

    return extra;
}

function parseInfoArgs(args)
{
    var arg;
    var type;
    var types = [];

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
    case 'boot':
    case 'create-snapshot':
    case 'console':
    case 'delete':
    case 'delete-snapshot':
    case 'destroy':
    case 'get':
    case 'help':
    case 'info':
    case 'install':
    case 'json':
    case 'rollback-snapshot':
    case 'send':
    case 'start':
    case 'sysrq':
        // these only take uuid or 'special' args like start order=cd
        break;
    case 'lookup':
        opts.json = Boolean;
        shorts.j = ['--json'];
        opts.output = String;
        shorts.o = ['--output'];
        opts.unique = Boolean;
        shorts['1'] = ['--unique'];
        break;
    case 'create':
    case 'receive':
    case 'recv':
    case 'reprovision':
    case 'update':
    case 'validate':
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
    case 'reboot':
    case 'stop':
        opts.force = Boolean;
        shorts.F = ['--force', 'true'];
        break;
    default:
        console.error('Unknown command: ' + command);
        break;
    }
}

function getInfo(uuid, types, callback)
{
    VM.info(uuid, types, function (err, data) {
        if (err) {
            // Our error message here gets shown to the user.
            callback(new Error('Unable to get VM info for VM ' + uuid
                + ': ' + err.message));
        } else {
            console.log(JSON.stringify(data, null, 2));
            callback();
        }
    });
}

function startVM(uuid, extra, callback)
{
    VM.start(uuid, extra, function (err, result) {
        var new_err;

        if (err) {
            // Our error message here gets shown to the user.
            new_err = new Error('Unable to start VM ' + uuid
                + ': ' + err.message);
            if (err.hasOwnProperty('code')) {
                new_err.code = err.code;
            }
            callback(new_err);
        } else {
            callback();
        }
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

        if (avalue > bvalue || (!avalue && bvalue)
            || ((avalue === undefined) && (bvalue !== undefined))) {

            return (direction);
        } else if (avalue < bvalue || avalue && !bvalue
            || ((avalue !== undefined) && (bvalue === undefined))) {

            return (direction * -1);
        }

        // if they're equal we keep going to the next field
    }

    // didn't find any field where one was > the other.
    return 0;
}

function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function outputVMListLine(order_fields, m, options)
{
    var args = [];
    var field;
    var fmt = '';
    var output;
    var value;
    var width;

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
    var field;
    var order_fields;
    var sort_fields;

    if (vmobjs) {

        sort_fields = sortby.split(',');
        if (sort_fields.length === 0) {
            callback(new Error('no sort fields provided'));
            return;
        }

        for (field in sort_fields) {
            field = sort_fields[field];
            if (field[0] === '-' || field[0] === '+') {
                if (!getListProperties(field.substr(1))) {
                    callback(new Error('invalid sort field: ' + field));
                    return;
                }
            } else {
                if (!getListProperties(field)) {
                    callback(new Error('invalid sort field: ' + field));
                    return;
                }
            }
        }

        order_fields = order.split(',');
        if (order_fields.length === 0) {
            callback(new Error('no order fields provided'));
            return;
        }

        for (field in order_fields) {
            field = order_fields[field];
            if (!getListProperties(field)) {
                callback(new Error('invalid order field: ' + field));
                return;
            }
        }

        vmobjs.sort(function (a, b) {
            // wrap just so we can add our order parameter.
            return sortVM(a, b, sort_fields);
        });

        // With the -H option, we don't print a header.
        if (!options.hasOwnProperty('header') || options.header === true) {
            outputVMListLine(order_fields, null, options);
        }

        vmobjs.forEach(function (m) {
            outputVMListLine(order_fields, m, options);
        });

        callback();
    } else {
        callback(new Error('no vms to list'));
    }
}

function listVM(spec, order, sortby, options, callback)
{
    var fields;
    var lookup_fields = [];

    if (!spec) {
        spec = {};
    }

    fields = order.split(',');

    // some fields are added by addFakeFields and not real lookup fields
    // lookup will return these because of the transform we pass in, but
    // we need to also add the stuff transform needs to get these.
    if (fields.indexOf('type') !== -1) {
        if (fields.indexOf('brand') === -1) {
            fields.push('brand');
        }
    }
    if (fields.indexOf('ram') !== -1) {
        fields.push('max_physical_memory');
    }

    // not all fields we're passed as order are looked up directly. When you
    // want nics.0.ip for example, we just request the whole .nics object.
    fields.forEach(function (field) {
        if (field.match(/\./)) {
            if (lookup_fields.indexOf(field.split('.')[0]) === -1) {
                lookup_fields.push(field.split('.')[0]);
            }
        } else {
            if (lookup_fields.indexOf(field) === -1) {
                lookup_fields.push(field);
            }
        }
    });

    VM.lookup(spec, {fields: lookup_fields, transform: addFakeFields},
        function (err, vmobjs) {
            if (err) {
                callback(err);
            } else {
                formatVMList(vmobjs, order, sortby, options, callback);
            }
        }
    );
}

function readFile(filename, callback)
{
    if (filename === '-') {
        filename = '/dev/stdin';
    }

    fs.readFile(filename, function (err, data) {
        var payload;

        if (err) {
            if (err.code === 'ENOENT') {
                callback(new Error('File: ' + filename + ' does not exist.'));
            } else {
                callback(new Error('Error reading: ' + filename
                    + ' ' + JSON.stringify(err)));
            }
        } else {
            try {
                payload = JSON.parse(data.toString());
                callback(null, payload);
            } catch (e) {
                e.message = 'Invalid JSON payload: ' + e.message;
                callback(e);
            }
        }
    });
}

function main(callback)
{
    var args = process.argv.slice(1);
    var command = process.argv[2];
    var filename;
    var extra = {};
    var options = {};
    var out_fields = [];
    var key;
    var knownOpts = {};
    var order;
    var order_list;
    var parsed;
    var shortHands = {};
    var snapname;
    var sortby;
    var sortby_list;
    var type;
    var types;
    var uuid;

    if (!command) {
        usage();
    } else if (command == '-h' || command == '-?') {
        usage(null, 0);
    } else if (COMMANDS.indexOf(command) === -1) {
        usage('Invalid command: "' + command + '".');
    }

    addCommandOptions(command, knownOpts, shortHands);
    parsed = nopt(knownOpts, shortHands, args, 2);

    // console.log("parsed =\n"+ require("util").inspect(parsed));

    // always set log level to debug
    VM.loglevel = 'debug';

    switch (command) {
    case 'start':
    case 'boot':
        uuid = getUUID(command, parsed);
        extra = parseStartArgs(parsed.argv.remain);
        startVM(uuid, extra, function (err) {
            if (err) {
                // if the error was because zone is already running (returned by
                // VM.start()), we'll treat as noop and exit 0.
                if (err.code === 'EALREADYRUNNING') {
                    callback(null, err.message);
                } else {
                    callback(err);
                }
            } else {
                callback(null, 'Successfully started VM ' + uuid);
            }
        });
        break;
    case 'console':
        uuid = getUUID(command, parsed);
        VM.console(uuid, function (err) {
            callback(err);
        });
        break;
    case 'reprovision':
        uuid = getUUID(command, parsed);
        if (parsed.hasOwnProperty('file') && parsed.file !== '-') {
            filename = parsed.file;
        } else {
            filename = '-';
        }
        if (filename === '-' && tty.isatty(0)) {
            usage('Will not take payload from stdin when stdin is a tty.');
        }
        readFile(filename, function (err, payload) {
            if (err) {
                callback(err);
                return;
            }

            VM.reprovision(uuid, payload, function (e) {
                if (e) {
                    callback(e);
                } else {
                    callback(null, 'Successfully reprovisioned VM ' + uuid);
                }
            });
        });
        break;
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
                    callback(err);
                } else {
                    callback(null, 'Successfully updated VM ' + uuid);
                }
            });
        } else {
            if (filename === '-' && tty.isatty(0)) {
                usage('Will not ' + command + ' from stdin when stdin is a '
                    + 'tty.');
            }
            readFile(filename, function (err, payload) {
                if (err) {
                    callback(err);
                } else {
                    VM.update(uuid, payload, function (e, info) {
                        if (e) {
                            callback(e);
                        } else {
                            callback(null, 'Successfully updated VM ' + uuid);
                        }
                    });
                }
            });
        }
        break;
    case 'install':
        uuid = getUUID(command, parsed);
        VM.install(uuid, function (err) {
            if (err) {
                callback(err);
                return;
            }
            callback(null, 'Successfully installed VM ' + uuid);
        });
        break;
    case 'recv':
    case 'receive':
        VM.receive('-', {}, function (e, info) {
            if (e) {
                callback(e);
            } else {
                callback(null, 'Successfully received VM ' + info.uuid);
            }
        });
        break;
    case 'create':
        if (parsed.hasOwnProperty('file') && parsed.file !== '-') {
            filename = parsed.file;
        } else {
            filename = '-';
        }
        if (filename === '-' && tty.isatty(0)) {
            usage('Will not create from stdin when stdin is a tty.');
        }
        readFile(filename, function (err, payload) {
            if (err) {
                callback(err);
                return;
            }

            VM.create(payload, function (e, info) {
                if (e) {
                    callback(e);
                } else {
                    callback(null, 'Successfully created VM ' + info.uuid);
                }
            });
        });
        break;
    case 'create-snapshot':
        uuid = getUUID(command, parsed);
        if (!parsed.argv.remain || parsed.argv.remain.length !== 1) {
            usage('Wrong number of parameters to "create-snapshot"');
        } else {
            snapname = parsed.argv.remain[0];
            VM.create_snapshot(uuid, snapname, {}, function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, 'Created snapshot ' + snapname + ' for VM '
                        + uuid);
                }
            });
        }
        break;
    case 'delete-snapshot':
        uuid = getUUID(command, parsed);
        if (!parsed.argv.remain || parsed.argv.remain.length !== 1) {
            usage('Wrong number of parameters to "delete-snapshot"');
        } else {
            snapname = parsed.argv.remain[0];
            VM.delete_snapshot(uuid, snapname, {}, function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, 'Deleted snapshot ' + snapname + ' for VM '
                        + uuid);
                }
            });
        }
        break;
    case 'rollback-snapshot':
        uuid = getUUID(command, parsed);
        if (!parsed.argv.remain || parsed.argv.remain.length !== 1) {
            usage('Wrong number of parameters to "rollback-snapshot"');
        } else {
            snapname = parsed.argv.remain[0];
            VM.rollback_snapshot(uuid, snapname, {}, function (err) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, 'Rolled back snapshot ' + snapname
                        + ' for VM ' + uuid);
                }
            });
        }
        break;
    case 'send':
        uuid = getUUID(command, parsed);
        VM.send(uuid, process.stdout, {}, function (e, info) {
            if (e) {
                callback(e);
            } else {
                callback(null, 'Successfully sent VM ' + uuid);
            }
        });
        break;
    case 'delete':
    case 'destroy':
        uuid = getUUID(command, parsed);
        VM.delete(uuid, function (err) {
            if (err) {
                err.message = 'Failed to delete VM ' + uuid + ': '
                    + err.message;
                callback(err);
            } else {
                callback(null, 'Successfully deleted VM ' + uuid);
            }
        });
        break;
    case 'get':
    case 'json':
        uuid = getUUID(command, parsed);
        VM.load(uuid, function (err, obj) {
            if (err) {
                callback(err);
            } else {
                console.log(JSON.stringify(obj, null, 2));
                callback();
            }
        });
        break;
    case 'info':
        uuid = getUUID(command, parsed);
        types = parseInfoArgs(parsed.argv.remain);
        getInfo(uuid, types, callback);
        break;
    case 'validate':
        if (parsed.hasOwnProperty('file') && parsed.file !== '-') {
            filename = parsed.file;
        } else {
            filename = '-';
        }
        if (filename === '-' && tty.isatty(0)) {
            usage('Will not ' + command + ' from stdin when stdin is a '
                + 'tty.');
        }
        if (!parsed.argv.remain || parsed.argv.remain.length < 1) {
            usage('Will not ' + command + ' without a valid action.');
        }
        if (parsed.argv.remain[0] === 'update'
            && parsed.argv.remain.length !== 2) {

            usage('Will not ' + command + ' without a valid action and brand.');
        }
        readFile(filename, function (err, payload) {
            var brand;
            var action = parsed.argv.remain[0];

            if (err) {
                callback(err);
                return;
            }

            if (action === 'update') {
                brand = parsed.argv.remain[1];
            } else {
                brand = payload.brand;
            }

            VM.validate(brand, action, payload, function (e) {
                if (e) {
                    callback(new Error(JSON.stringify(e, null, 2)));
                } else {
                    callback(null, 'VALID \'' + action
                        + '\' payload for ' + brand + ' brand VMs.');
                }
            });
        });
        break;
    case 'help':
        usage(null, 0);
        break;
    case 'lookup':
        extra = parseKeyEqualsValue(parsed.argv.remain);
        options = {transform: addFakeFields};

        if (parsed.json) {
            if (parsed.hasOwnProperty('output')) {
                out_fields = parsed.output.split(',');
                options.fields = out_fields;
            } else {
                options.full = true;
            }
        } else if (parsed.hasOwnProperty('output')) {
            callback(new Error('Cannot specify -o without -j'));
            return;
        } else {
            // not JSON output, just a list of uuids.
            options.fields = ['uuid'];
        }

        for (key in extra) {
            if (!validFilterKey(key)) {
                callback(new Error('Invalid lookup key: "' + key + '"'));
                return;
            }
        }

        VM.lookup(extra, options, function (err, results) {
            var m;

            if (err) {
                callback(err);
            } else if (parsed.unique && results.length !== 1) {
                callback(new Error('Requested unique lookup but found '
                    + results.length + ' results.'));
            } else if (parsed.json) {
                console.log(JSON.stringify(results, null, 2));
            } else {
                // Here we're just looking for the list, results is an array
                // of uuids.
                for (m in results) {
                    m = results[m];
                    console.log(m.uuid);
                }
            }
        });
        break;
    case 'sysrq':
        uuid = getUUID(command, parsed);
        if (!parsed.argv.remain || parsed.argv.remain.length !== 1) {
            usage('Wrong number of parameters to "sysrq"');
        } else {
            type = parsed.argv.remain[0];
            if (VM.SYSRQ_TYPES.indexOf(type) === -1) {
                usage('Invalid sysrq type: ' + type);
            } else {
                VM.sysrq(uuid, type, {}, function (err) {
                    if (err) {
                        callback(err);
                    } else {
                        callback(null, 'Sent ' + type + ' sysrq to VM ' + uuid);
                    }
                });
            }
        }
        break;
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

        for (key in extra) {
            if (!validFilterKey(key)) {
                callback(new Error('Invalid filter key: "' + key + '"'));
                return;
            }
        }

        order_list = order.split(',');
        for (key in order_list) {
            if (!validColumnKey(order_list[key])) {
                callback(new Error('Invalid order key: "' + order_list[key]
                    + '"'));
                return;
            }
        }

        sortby_list = sortby.split(',');
        for (key in sortby_list) {
            if (!validColumnKey(sortby_list[key])) {
                callback(new Error('Invalid sort key: "' + sortby_list[key]
                    + '"'));
                return;
            }
        }

        listVM(extra, order, sortby, options, callback);
        break;
    case 'halt':
        command = 'stop';
        /*jsl:fallthru*/
    case 'stop':
    case 'reboot':
        uuid = getUUID(command, parsed);
        if (parsed.force) {
            extra = {force: true};
        }
        VM[command](uuid, extra, function (err) {
            if (err) {
                // if the error was because zone is not running (returned by
                // VM.stop()), we'll treat as noop and exit 0.
                if (err.code === 'ENOTRUNNING') {
                    callback(null, err.message);
                } else {
                    callback(err);
                }
            } else {
                callback(null, 'Successfully completed ' + command + ' for VM '
                    + uuid);
            }
        });
        break;
    default:
        callback();
        break;
    }
}

function flushLogs(callback)
{
    var streams;

    if (!VM.log) {
        fwlog.flush(VM.fw_log, callback);
        return;
    }

    streams = VM.log.streams;
    async.forEachSeries(streams, function (str, cb) {
        var called_back = false;

        if (!str || !str.stream) {
            cb();
            return;
        }

        str.stream.once('drain', function () {
            if (!called_back) {
                called_back = true;
                cb();
            }
        });

        if (str.stream.write('')) {
            // according to node docs true here means we're done
            if (!called_back) {
                called_back = true;
                cb();
            }
        } else {
            // false means: wait for 'drain' to call cb();
            /*jsl:pass*/
        }
        return;
    }, function () {
        fwlog.flush(VM.fw_log, callback);
        return;
    });
}

process.stdout.on('error', function (err) {
    if (err.code === 'EPIPE') {
        // See <https://github.com/trentm/json/issues/9>.
        drainStdoutAndExit(0);
    } else {
        console.warn(err.message);
        drainStdoutAndExit(1);
    }
});

/**
 *
 * This function is a modified version of the one from Trent Mick's excellent
 * jsontool at:
 *
 *  https://github.com/trentm/json
 *
 * A hacked up version of "process.exit" that will first drain stdout
 * before exiting. *WARNING: This doesn't stop event processing.* IOW,
 * callers have to be careful that code following this call isn't
 * accidentally executed.
 *
 * In node v0.6 "process.stdout and process.stderr are blocking when they
 * refer to regular files or TTY file descriptors." However, this hack might
 * still be necessary in a shell pipeline.
 */
function drainStdoutAndExit(code) {
    var flushed;

    if (draining_stdout_and_exiting) {
        // only want drainStdoutAndExit() run once
        return;
    }
    draining_stdout_and_exiting = true;

    process.stdout.on('drain', function () {
        process.exit(code);
    });

    flushed = process.stdout.write('');
    if (flushed) {
        process.exit(code);
    }
}

onlyif.rootInSmartosGlobal(function (err) {
    if (err) {
        console.error('FATAL: cannot run because: ' + err);
        process.exit(2);
        return;
    }

    panic.enablePanicOnCrash({
        'skipDump': true,
        'abortOnPanic': true
    });

    main(function (e, message) {
        if (e) {
            console.error(e.message);
            flushLogs(function () {
                process.exit(1);
            });
        } else {
            if (message) {
                console.error(message);
            }
            flushLogs(function () {
                process.exit(0);
            });
        }
    });
});
