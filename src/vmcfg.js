#!/usr/bin/node
/*
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 */


// IMPORTANT:
//
//  Some of these properties get translated below into backward compatible
//  names.
//
var GLOBAL_PROPS = [
    'zonename',
    'zonepath',
    'ram',
    'vm-autoboot',
    'vcpus',
    'cpu-type',
    'owner-uuid',
    'hostname',
    'boot'
];

var NET_PROPS = [
    'global-nic',
    'mac-addr',
    'physical',
    'vlan-id',
    'index',
    'model',
    'ip',
    'netmask',
    'gateway'
];

var DISK_PROPS = [
    'index',
    'model',
    'boot',
    'match',
    'zpool',
    'media'
];

var cp   = require('child_process');
var exec = cp.exec;
var path = require('path');

var DEBUG = false;
if (process.env.DEBUG) {
    DEBUG = true;
}

function out()
{
    console.log.apply(this, arguments);
}

function usage()
{
    out("Usage:", process.argv[1], "<uuid>");
    process.exit(1);
}

function ltrim(str, chars) {
    chars = chars || "\\s";
    str = str || "";
    return str.replace(new RegExp("^[" + chars + "]+", "g"), "");
}

function rtrim(str, chars) {
    chars = chars || "\\s";
    str = str || "";
    return str.replace(new RegExp("[" + chars + "]+$", "g"), "");
}

function trim(str, chars)
{
    return ltrim(rtrim(str, chars), chars);
}

function indexSort(a, b)
{
    return a.index - b.index;
}

function fixBoolean(str)
{
    if (str === 'true') {
        return true;
    } else if (str === 'false') {
        return false;
    } else {
        return str;
    }
}

function parseConfig(input)
{
    var result = {};
    var obj;
    var line, lines;
    var section;
    var kv, key, value;
    var tmp;
    var attr, nic, disk;
    var nets = [], attrs = [], devices = [];
    var props = {};

    lines = input.split('\n');
    for (line in lines) {
        if (lines.hasOwnProperty(line)) {
            line = rtrim(lines[line]);
            if (line[0] === '\t') {
                line = ltrim(line);
                kv = line.split(':');
                key = trim(kv[0], "\\s\\[");
                value = trim(kv.slice(1).join(':'), "\\s\\]");

                if (key === "property") {
                    // handle form: "property": "(name=model,value=\"virtio\")"
                    key = value.match(/name=([^,]+),value=\"([^\"]+)\"/)[1];
                    value = value.match(/name=([^,]+),value=\"([^\"]+)\"/)[2];
                }

                value = fixBoolean(value);

                switch (section) {
                case 'net':
                    obj = nets[nets.length - 1];
                    obj[key] = value;
                    break;
                case 'device':
                    obj = devices[devices.length - 1];
                    obj[key] = value;
                    break;
                case 'attr':
                    obj = attrs[attrs.length - 1];
                    obj[key] = value;
                    break;
                case 'default':
                    if (DEBUG) {
                        out('WARNING ignoring line', line);
                    }
                    break;
                }
            } else {
                kv = line.split(':');
                key = trim(kv[0], "\\s\\[");
                value = fixBoolean(trim(kv.slice(1).join(':'), "\\s\\]"));

                if (key === "") {
                    continue;
                }
                if (value === "") {
                    // start of a new section is a key with no value
                    section = key;
                    switch (section) {
                    case 'net':
                        nets.push({});
                        break;
                    case 'device':
                        devices.push({});
                        break;
                    case 'attr':
                        attrs.push({});
                        break;
                    case 'capped-memory':
                    case 'rctl':
                    case 'bootargs':
                    case 'pool':
                    case 'limitpriv':
                    case 'scheduling-class':
                    case 'hostid':
                    case 'fs-allowed':
                        // ignore these for now
                        break;
                    default:
                        if (DEBUG) {
                            out("WARNING: ignoring section type '" + section +
                                "'");
                        }
                        break;
                    }
                } else {
                    // not section header, but top-level key
                    section = null;
                    props[key] = value;
                }
            }
        }
    }

    for (obj in props) {
        if (props.hasOwnProperty(obj)) {
            if (GLOBAL_PROPS.indexOf(obj) !== -1) {
                if (obj === 'zonename') {
                    result.uuid = props[obj];
                } else {
                    result[obj] = fixBoolean(props[obj]);
                }
            } else if (DEBUG) {
                out("WARNING: ignoring unknown VM prop:", obj);
            }
        }
    }

    for (attr in attrs) {
        if (attrs.hasOwnProperty(attr)) {
            if (GLOBAL_PROPS.indexOf(attrs[attr].name) !== -1) {
                key = attrs[attr].name;
                if (key === 'vm-autoboot') {
                    key = 'autoboot';
                } else if (key === 'owner-uuid') {
                    key = 'customer_uuid';
                } else if (key === 'cpu-type') {
                    key = 'cpu_type';
                }
                result[key] = fixBoolean(attrs[attr].value);
            } else if (DEBUG) {
                out("WARNING: ignoring unknown VM prop:", attrs[attr].name);
            }
        }
    }

    result.nics = [];
    nets.sort(indexSort);
    for (nic in nets) {
        if (nets.hasOwnProperty(nic)) {
            tmp = {};
            for (obj in nets[nic]) {
                if (nets[nic].hasOwnProperty(obj)) {
                    if (NET_PROPS.indexOf(obj) !== -1) {
                        key = obj;
                        if (key === 'global-nic') {
                            key = 'nic_tag';
                        } else if (key === 'mac-addr') {
                            key = 'mac';
                        } else if (key === 'vlan-id') {
                            key = 'vlan';
                        }
                        tmp[key] = fixBoolean(nets[nic][obj]);
                    } else if (DEBUG) {
                        out("WARNING: ignoring unknown nic prop:", obj);
                    }
                }
            }
            result.nics.push(tmp);
        }
    }

    result.disks = [];
    devices.sort(indexSort);
    for (disk in devices) {
        if (devices.hasOwnProperty(disk)) {
            tmp = {};
            for (obj in devices[disk]) {
                if (devices[disk].hasOwnProperty(obj)) {
                    if (DISK_PROPS.indexOf(obj) !== -1) {
                        if (obj === 'match') {
                            tmp.path = devices[disk][obj];
                            tmp.zpool = path.basename(path.dirname(tmp.path));
                            tmp.zfs_filesystem = tmp.zpool + '/' +
                                path.basename(tmp.path);
                        } else {
                            tmp[obj] = fixBoolean(devices[disk][obj]);
                        }
                    } else if (DEBUG) {
                        out("WARNING: ignoring unknown disk prop:", obj);
                    }
                }
            }
            result.disks.push(tmp);
        }
    }

    return result;
}

function dumpVMConfig(uuid, callback)
{
    var cmd = '/usr/sbin/zonecfg -z ' + uuid + ' info';
    var vmcfg;

    exec(cmd, function (err, stdout, stderr) {
        if (err) {
            return callback(rtrim(stderr));
        }

        vmcfg = parseConfig(stdout);

        out(JSON.stringify(vmcfg, null, 2));

        callback();
    });
}

function main()
{
    var uuid;

    if ((process.argv.length !== 3) ||
        (['-h', '-?'].indexOf(process.argv[2]) !== -1)) {

        usage();
    }

    uuid = process.argv[2];

    dumpVMConfig(uuid, function (err) {
        if (err) {
            out("Error:", err);
            process.exit(1);
        }
        process.exit(0);
    });
}

main();
