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


// IMPORTANT:
//
//  Some of these properties get translated below into backward compatible
//  names.
//
var GLOBAL_PROPS = [
    'autoboot',
    'brand',
    'limitpriv',
    'zonename',
    'zonepath',
    'ram',
    'vm-autoboot',
    'never-booted',
    'vcpus',
    'cpu-type',
    'cpu-shares',
    'owner-uuid',
    'billing-id',
    'package-name',
    'package-version',
    'hostname',
    'dns-domain',
    'resolvers',
    'tmpfs',
    'default-gateway',
    'qemu-opts',
    'qemu-extra-opts',
    'tags',
    'alias',
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
    'media',
    'image-uuid',
    'image-name',
    'image-size',
    'size'
];

var cp     = require('child_process');
var exec   = cp.exec;
var fs     = require('fs');
var onlyif = require('onlyif');
var path   = require('path');

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
    out("Usage:", process.argv[1], "<uuid|zonename>");
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
    var nets = [], attrs = [], devices = [], rctls = [];
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
                case 'rctl':
                    obj = rctls[rctls.length - 1];
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
                    case 'rctl':
                        rctls.push({});
                        break;
                    case 'capped-memory':
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
                    result.zonename = props[obj];
                } else if (obj === 'autoboot') {
                    result.zone_autoboot = props[obj];
                } else if (obj === 'cpu-shares') {
                    result.cpu_shares = Number(props[obj]);
                } else {
                    result[obj] = fixBoolean(props[obj]);
                }
            } else if (DEBUG) {
                out("WARNING: ignoring unknown zone prop:", obj);
            }
        }
    }

    for (rctl in rctls) {
        if (rctls.hasOwnProperty(rctl)) {
            key = rctls[rctl].name;
            value = rctls[rctl].value.match(/limit=([^,]+),/)[1];
            switch (key) {
            case 'zone.cpu-cap':
                result['cpu_cap'] = Number(value);
                break;
            case 'zone.zfs-io-priority':
                result['zfs_io_priority'] = Number(value);
                break;
            case 'zone.max-lwps':
                result['max_lwps'] = Number(value);
                break;
            case 'zone.max-physical-memory':
                result['max_physical_memory'] = value / (1024 * 1024);
                break;
            case 'zone.max-locked-memory':
                result['max_locked_memory'] = value / (1024 * 1024);
                break;
            case 'zone.max-swap':
                result['max_swap'] = value / (1024 * 1024);
                break;
            }
        }
    }

    for (attr in attrs) {
        if (attrs.hasOwnProperty(attr)) {
            if (GLOBAL_PROPS.indexOf(attrs[attr].name) !== -1) {
                key = attrs[attr].name;
                if (key === 'vm-autoboot') {
                    key = 'autoboot';
                } else if (key === 'capped-cpu') {
                    key = 'capped_cpu';
                } else if (key === 'owner-uuid') {
                    key = 'owner_uuid';
                } else if (key === 'never-booted') {
                    key = 'never_booted';
                } else if (key === 'billing-id') {
                    key = 'billing_id';
                } else if (key === 'package-name') {
                    key = 'package_name';
                } else if (key === 'package-version') {
                    key = 'package_version';
                } else if (key === 'cpu-type') {
                    key = 'cpu_type';
                } else if (key === 'dns-domain') {
                    key = 'dns_domain';
                } else if (key === 'tags') {
                    key = 'tags';
                } else if (key === 'alias') {
                    key = 'alias';
                } else if (key === 'qemu-opts') {
                    key = 'qemu_opts';
                } else if (key === 'qemu-extra-opts') {
                    key = 'qemu_extra_opts';
                }

                if (key === 'resolvers') {
                  if (key != '') {
                      result[key] = attrs[attr].value.split(',');
                  }
                } else if ([
                    'alias',
                    'tags',
                    'qemu_opts',
                    'qemu_extra_opts'
                    ].indexOf(key) !== -1) {

                    result[key] = new Buffer(attrs[attr].value,
                        'base64').toString('ascii');
                } else if ([
                    'ram',
                    'tmpfs',
                    'vcpus'
                    ].indexOf(key) !== -1) {

                    result[key] = Number(attrs[attr].value);
                } else {
                    result[key] = fixBoolean(attrs[attr].value);
                }
            } else if (DEBUG) {
                out("WARNING: ignoring unknown zone prop:", attrs[attr].name);
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
                            tmp['nic_tag'] = nets[nic][obj];
                        } else if (key === 'mac-addr') {
                            tmp['mac'] = nets[nic][obj];
                        } else if (key === 'vlan-id') {
                            tmp['vlan_id'] = Number(nets[nic][obj]);
                        } else if (key === 'index') {
                            tmp['index'] = Number(nets[nic][obj]);
                        } else {
                            tmp[key] = fixBoolean(nets[nic][obj]);
                        }
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
                        } else if (obj === 'image-size' || obj === 'size' ||
                            obj === 'index') {

                            tmp[obj.replace('-','_')] = Number(devices[disk][obj]);
                        } else {
                            tmp[obj.replace('-','_')] = fixBoolean(devices[disk][obj]);
                        }
                    } else if (DEBUG) {
                        out("WARNING: ignoring unknown disk prop:", obj);
                    }
                }
            }
            result.disks.push(tmp);
        }
    }

    if (result.hasOwnProperty('zonepath')) {
        result.zfs_storage_pool_name = result.zonepath.split('/')[1];
    }

    if (result.brand === 'joyent') {
        if (result.hasOwnProperty('zone_autoboot')) {
            result.autoboot = result.zone_autoboot;
        }

        // joyent zones don't have disks.
        delete result.disks;
    }
    delete result.zone_autoboot;

    return result;
}

function getZonename(input, callback)
{
    var cmd;

    // this gives us a zonename if input is *either* of: a zonename or uuid.
    if (input.length === 36 &&
        input[8] === '-' && input[13] === '-' &&
        input[18] === '-' && input[23] === '-') {

        cmd = '/usr/sbin/zoneadm -z ' + input + ' -u ' + input + ' '  +
            'list -p';
    } else {
        cmd = '/usr/sbin/zoneadm -z ' + input + ' '  + 'list -p';
    }

    exec(cmd, function (err, stdout, stderr) {
        var fields;
        if (err) {
            return callback(rtrim(stderr));
        }

        fields = rtrim(stdout).split(':');
        callback(null, [fields[1], fields[4]]);
    });
}

function loadQuota(vmcfg, callback)
{
    var cmd;
    var dataset;

    if (vmcfg.zonepath && vmcfg.zonepath[0] === '/') {
        dataset = vmcfg.zonepath.substr(1);

        cmd = '/usr/sbin/zfs get -o value -p -H quota ' + dataset;

        exec(cmd, function (err, stdout, stderr) {
            var quota;
            if (err) {
                return callback(rtrim(stderr));
            }
            quota = rtrim(stdout) / (1024 * 1024 * 1024);
            return callback(null, quota);
        });
    } else {
        return callback('Unable to determine zonepath for detecting quota');
    }
}

function loadMetadata(vmcfg, callback)
{
    var filename;

    if (vmcfg.zonepath) {
        filename = vmcfg.zonepath + '/config/metadata.json';
        if (DEBUG) {
            out('loading metadata from', filename);
        }
        path.exists(filename, function (exists) {
            if (exists) {
                fs.readFile(filename, function (error, data) {
                    var metadata;
                    if (error) {
                        return callback(error);
                    }
                    try {
                        metadata = JSON.parse(data.toString());
                    } catch (e) {
                        metadata = {};
                    }
                    return callback(null, metadata);
                });
            } else {
                return callback(null, {});
            }
      });
    } else {
        return callback(null, {});
    }
}

function dumpZoneConfig(zonename, uuid, callback)
{
    var cmd = '/usr/sbin/zonecfg -z ' + zonename + ' info';
    var vmcfg;

    exec(cmd, function (err, stdout, stderr) {
        if (err) {
            return callback(rtrim(stderr));
        }

        vmcfg = parseConfig(stdout);
        vmcfg.uuid = uuid;
        loadMetadata(vmcfg, function (err, metadata) {
            if (err) {
                return callback('Unable to add metadata:' + err.toSring());
            }
            loadQuota(vmcfg, function(err, quota) {
                if (err) {
                    return callback('Unable to determine quota: ' +
                        err.toString());
                }
                if (quota > 0) {
                    vmcfg.quota = quota;
                }
                for (k in metadata) {
                    if (DEBUG) {
                        out('metadata: k,v', k, metadata[k]);
                    }
                    vmcfg[k] = metadata[k];
                }
                if (!vmcfg.hasOwnProperty('customer_metadata')) {
                    vmcfg.customer_metadata = {};
                }
                out(JSON.stringify(vmcfg, null, 2));
                callback();
            });
        });
    });
}

function main()
{
    if ((process.argv.length !== 3) ||
        (['-h', '-?'].indexOf(process.argv[2]) !== -1)) {

        usage();
    }

    input = process.argv[2];

    getZonename(input, function (error, info) {
        var uuid, zonename;
        if (error) {
            out("Error:", error);
            process.exit(1);
        }
        zonename = info[0];
        uuid = info[1];
        dumpZoneConfig(zonename, uuid, function (err) {
            if (err) {
                out("Error:", err);
                process.exit(1);
            }
            process.exit(0);
        });
    });
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        console.log('Fatal: cannot run because: ' + err);
        process.exit(1);
    }
    main();
});
