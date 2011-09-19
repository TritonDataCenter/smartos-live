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
 *
 * SYNOPSIS:
 *
 * /smartdc/bin/create-machine -f <filename.json>
 *
 *
 * DESCRIPTION:
 *
 * This tool takes a JSON payload and creates either a 'kvm' or 'joyent' brand
 * zone with the properties specified in the input JSON.  Normal output is a
 * series of single-line JSON objects with type set to one of:
 *
 *  success, failure, update, notice
 *
 * each object having at least the 'type' and 'message' fields.  A message of
 * type 'success' or 'failure' will be followed by the process exiting with the
 * exit status 0 indicating success and all other exits indicating failure.
 *
 *
 * JSON PARAMETERS
 *
 *    Both VMs + Zones
 *    ================
 *
 *    "alias"
 *      - a "customer-friendly" name for this machine
 *      - default: none
 *
 *    "autoboot"
 *      - boolean, true means this VM will be started after create
 *      - default: true
 *
 *    "brand"
 *      - either 'joyent' or 'kvm', determines the type of machine created
 *      - default: 'joyent'
 *
 *    "billing_id"
 *      - an identifier representing the billing type of this machine
 *      - default: dataset_uuid if provided, otherwise:
 *        00000000-0000-0000-0000-000000000000
 *
 *    "cpu_cap"
 *      - sets a CPU cap for this machine
 *      - default: no cap
 *
 *    "cpu_shares"
 *      - The (relative) shares of the CPU this machine should get
 *      - default: 100
 *
 *    "customer_metadata"
 *       - A json object of key/value pairs for the metadata agent to provide to
 *         the zone/vm.
 *       - default: {}
 *
 *    "default_gateway"
 *       - The IP Address of the router that should act as the default gateway
 *
 *    "limit_priv"
 *       - a comma separated list of priviledges to give this zone
 *       - default: use brand's default privs
 *
 *    "max_lwps"
 *       - The maximum number of lightweight processes in this machine
 *       - default: 2000
 *
 *    "max_locked_memory"
 *       - Max locked memory in MiB for this machine
 *       - default: max_physical_memory
 *
 *    "max_physical_memory"
 *       - Max memory in MiB for this machine
 *       - VM default: ram
 *       - Zone default: 256
 *
 *    "max_swap"
 *       - Max total virtual memory in MiB for this machine
 *       - default: max_physical_memory
 *
 *    "nics" -- array of nic objects:
 *
 *      nic.blocked_outgoing_ports
 *        - array of ports on which this nic is prevented from sending traffic.
 *        - default: []
 *      nic.gateway
 *        - The IPv4 router on this network
 *      nic.ip
 *        - IPv4 unicast address for this NIC
 *      nic.mac
 *        - MAC address of virtual NIC (we'll generate one by default)
 *      nic.model
 *        - The driver for this NIC [virtio|e1000|rtl8136|...]
 *      nic.netmask
 *        - The netmask for this NIC's network
 *      nic.vlan_id
 *        - The vlan with which to tag this NIC's traffic (0 = none)
 *        - default: 0
 *
 *    "owner_uuid"
 *      - The UUID of the customer to associate this VM with
 *      - default: 00000000-0000-0000-0000-000000000000
 *
 *    "package_name"
 *      - The name of the package this VM/Zone was provisioned with
 *
 *    "package_version"
 *      - The version of the package this VM/Zone was provisioned with
 *
 *    "quota"
 *      - quota for the ZFS filesystem we'll create for this zone (in GiB)
 *      - default: 10
 *
 *    "resolvers"
 *       - JSON array of IP addresses to use as resolvers for this machine
 *       - eg: [ '8.8.8.8', '8.8.4.4' ]
 *
 *    "tags"
 *      - a JSON structure of user tags for this machine
 *      - eg: { group: "deployment", type: "database" }
 *
 *    "uuid"
 *      - pre-specify a UUID for this machine (default is to create one)
 *      - this gets used as default for zonename if none specified
 *      - default: we'll generate a new uuid
 *
 *    "zfs_io_priority"
 *      - The (relative) shares of the IO this machine should get
 *      - default: 100
 *
 *    "zfs_storage_pool_name"
 *      - specify the ZFS pool for this VM and its disks
 *      - default: 'zones'
 *
 *    VMs Only
 *    ========
 *
 *    "cpu_type"
 *      - The type of the virtual CPU [qemu64|host]
 *
 *    "disk_driver"
 *      - The default model for disks attached to this VM
 *
 *    "disks"
 *      - array of disk objects:
 *
 *        disk.boot -- boolean whether this disk should be bootable (only one should)
 *        disk.image_name -- name of dataset from which to clone this VM's disk
 *        disk.image_size -- size of ^^ in MiB
 *        disk.image_uuid -- uuid of dataset from which to clone this VM's disk
 *        disk.size -- size of disk in MiB (only if not using an image)
 *        disk.media -- either 'disk' or 'cdrom'
 *        disk.model -- driver for this disk [virtio|ide|scsi]
 *        disk.zpool -- zpool in which to create this VM and its zvol
 *
 *    "nic_driver"
 *      - The default model for nics attached to this VM
 *
 *    "qemu_opts"
 *      - replacement for default opts:
 *        '-vnc unix:/tmp/vm.vnc -parallel none -usb -usbdevice tablet -k en-us -vga cirrus'
 *        important: this replaces *all* of the above options, so rewrite to
 *        still include those you want to keep.
 *      - default: no replacement
 *
 *    "qemu_extra_opts"
 *      - lists of *additional* qemu cmdline arguments, this string (if set)
 *        will be appended to the end of the qemu cmdline.
 *      - default: none
 *
 *    "ram"
 *      - The amount of virtual RAM to attach to the VM (in MiB)
 *
 *    "vcpus"
 *      - The number of virtual CPUs to attach to this VM
 *
 *    Zones Only
 *    ==========
 *
 *    "dns_domain"
 *      - The DNS domain name of this machine (for /etc/hosts)
 *      - default here is .local
 *
 *    "hostname"
 *      - The hostname portion of the /etc/hosts entry for this machine
 *
 *    "tmpfs"
 *      - The maximum number of MiB to use for the /tmp filesystem
 *
 *    "zonename"
 *      - specifies the name of this zone when it is intended that the zonename
 *        not match the uuid.
 *      - default: uuid
 *
 * VM EXAMPLE JSON
 *
 *   {
 *     "brand": "kvm",
 *     "vcpus": 1,
 *     "ram": 256,
 *     "disks": [
 *       {
 *         "boot": true,
 *         "model": "virtio",
 *         "image_uuid": "e173ecd7-4809-4429-af12-5d11bcc29fd8",
 *         "image_name": "ubuntu-10.04.2.7",
 *         "image_size": 5120
 *       }
 *     ],
 *     "nics": [
 *       {
 *         "nic_tag": "external",
 *         "model": "virtio",
 *         "ip": "10.88.88.51",
 *         "netmask": "255.255.255.0",
 *         "gateway": "10.88.88.2"
 *       }
 *     ]
 *   }
 *
 *
 * ZONE EXAMPLE JSON
 *
 *   {
 *     "brand": "joyent",
 *     "zfs_io_priority": 30,
 *     "quota": 20,
 *     "dataset_uuid": "47e6af92-daf0-11e0-ac11-473ca1173ab0",
 *     "nics": [
 *       {
 *         "nic_tag": "external",
 *         "ip": "10.88.88.52",
 *         "netmask": "255.255.255.0",
 *         "gateway": "10.88.88.2"
 *       }
 *     ]
 *   }
 *
 *
 * DEBUGGING
 *
 *    Extra debugging can be enabled to stderr by setting the DEBUG environment
 *    variable.
 *
 */

var async    = require('async');
var cp       = require('child_process');
var exec     = cp.exec;
var execFile = cp.execFile;
var fs       = require('fs');
var net      = require('net');
var onlyif   = require('onlyif');
var spawn    = cp.spawn;
var sys      = require('sys');

var logfile  = null;

if (process.env.DEBUG) {
    var DEBUG = true;
}

// Write a message to stdout, turned into a single line of JSON
function output(type, message, data)
{
    var obj = data || {};

    obj.type = type;
    obj.message = message;

    console.log(JSON.stringify(obj));
}

function outputProgress(pct, message) {
    output('update', message, {'percent': pct});
}

// Write a message to the log file and optionally stderr with a timestamp
// IMPORTANT: this debug output on stderr is *not* converted to JSON
function debug()
{
    var now = new Date;
    var args = [];

    args.push(now.toISOString() + ' -- ' + process.pid + ' --');
    for (var i = 0; i < arguments.length; i++) {
        if (typeof(arguments[i]) === 'string') {
            args.push(arguments[i].replace(/\n/g, '\\n'));
        } else {
            args.push(JSON.stringify(arguments[i]));
        }
    }
    args.push('\n');

    if (DEBUG) {
        process.stderr.write(args.join(' '));
    }

    if (logfile) {
        logfile.write(args.join(' '));
    }
}

function usage()
{
    process.stderr.write('Usage: ' + process.argv[1] +
        '-f <filename.json>\n\n');
    process.stderr.write('This tool will create either a VM or Zone based on ' +
        'a JSON payload.\n');
    process.exit(1);
}

// XXX Lifted from vmadm.js, need to merge the implementations.
function performVmadmdAction(action, data, callback)
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
                    return callback({'vmadmd-failure': result});
                }
                if (result.type === 'update') {
                    output('update', action + ' is still running',
                        {'vmadmd-data': result.data});
                } else if (result.type === 'success') {
                    callback(null, result);
                    stream.end();
                } else {
                    return callback({'vmadmd-unknown': result});
                }
            }
            buffer = chunks.pop();
        });

        stream.on('error', function(err) {
            callback(err);
        });

        stream.connect('/tmp/vmadmd.sock');
    } catch (e) {
        callback(e);
    }
}

// create a random new locally administered MAC address
function generateMAC()
{
    var data;

    debug('genericMAC()');

    // time in milliseconds + 3 random digits
    data = ((Date.now() * 1000) +
        (Math.floor(Math.random()*1000) % 1000)).toString(16);

    // split to correct number of characters
    data = data.substr(data.length - 12)

    // set the 'locally administered' bit and don't set the multicast bit.
    // locally administered MAC addresses, won't conflict with OUIs
    data = data.substr(0, 1) + '2' + data.substr(2);

    // turn into MAC format
    return data.match(/../g).join(':');
}

// Ensure we've got all the datasets necessary to create this VM
//
// IMPORTANT:
//
// On SmartOS, we assume a provisioner or some other external entity has already
// loaded the dataset into the system. This function just confirms that the
// dataset actually exists.
//
function checkDatasets(payload, progress, callback)
{
    var checkme = [];
    var d;
    var disk;

    debug('checkDatasets()');

    // build list of datasets we need to download (downloadme)
    for (disk in payload.disks) {
        if (payload.disks.hasOwnProperty(disk)) {
            d = payload.disks[disk];
            if (d.hasOwnProperty('image_uuid')) {
                checkme.push(payload.zfs_storage_pool_name + '/' + d.image_uuid);
            }
        }
    }

    function checker(dataset, cb)
    {
        exec('zfs list -o name -H ' + dataset, function (err, stdout, stderr) {
            if (err) {
                debug('zfs list ' + dataset + ' exited with code ' +
                    err.code + ' stdout: "' + stdout + '" stderr:"' +
                    stderr + '"');
                return cb('unable to find dataset: ' + dataset);
            } else {
                return cb();
            }
        });
    }

    // create all the volumes we found that we need.
    async.forEach(checkme, checker, function (err) {
        if (err) {
            debug('checkDatasets(): Error:', err);
            callback(err);
        } else {
            progress(100, 'we have all necessary datasets');
            callback();
        }
    });
}

// create a new LVM volume, updating progress
function createVolume(volume, progress, callback)
{
    var size;

    debug('createVolume() --', volume);

    if (volume.hasOwnProperty('image_size')) {
        size = volume.image_size;
    } else if (volume.hasOwnProperty('size')) {
        size = volume.size;
    } else {
        callback('FATAL: createVolume(' + sys.inspect(volume) +
            '): has no size or image_size');
    }

    async.series([
        function (cb)
        {
            var cmd;
            var trace_cmd;

            if (volume.hasOwnProperty('image_uuid')) {
                cmd = 'zfs snapshot ' + volume.zpool + '/' + volume.image_uuid +
                    '@' + volume.uuid + ' && zfs clone ' + volume.zpool + '/' +
                    volume.image_uuid + '@' + volume.uuid + ' ' +
                    volume.zpool + '/' + volume.uuid;
                volume.path = '/dev/zvol/rdsk/' + volume.zpool + '/' +
                    volume.uuid;
                trace_cmd = 'zfs-clone';
            } else {
                cmd = 'zfs create -o refreservation=none -V ' + size +
                   'M ' + volume.zpool + '/' + volume.uuid;
                volume.path = '/dev/zvol/rdsk/' + volume.zpool + '/' +
                    volume.uuid;
                trace_cmd = 'zfs-create';
            }

            debug('createVolume() running:', cmd);
            exec(cmd, function (err, stdout, stderr) {
                if (err) {
                    cb(trace_cmd + ' exited with code ' + err.code +
                        ' stdout: "' + stdout + '" stderr:"' + stderr + '"');
                } else {
                    cb();
                }
            });
        }
    ],
    function (err, results)
    {
        if (err) {
            callback(err);
        } else {
            callback();
        }
    });
}

// Create all the volumes for a given VM property set
function createVolumes(payload, progress, callback)
{
    var createme = [];
    var d, disk, disk_idx;

    debug('createVolumes() --', payload.disks);

    // generate list of volumes we need to create
    disk_idx = 0;
    for (disk in payload.disks) {
        if (payload.disks.hasOwnProperty(disk)) {
            d = payload.disks[disk];
            d.index = disk_idx
            d.uuid = payload.uuid + '-disk' + disk_idx;
            if (!d.hasOwnProperty('zpool')) {
                d.zpool = payload.zfs_storage_pool_name;
            }
            createme.push(d);
            disk_idx ++;
        }
    }

    // wrap in function since async.forEach doesn't take enough parameters
    // and we need to pass in the progress function.
    function create(item, callback)
    {
        return createVolume(item, progress, callback);
    }

    // create all the volumes we found that we need.
    async.forEach(createme, create, function (err) {
        if (err) {
            debug('createVolumes(): Unknown error:', err);
            callback(err);
        } else {
            callback();
        }
    });
}

// writes a Zone's metadata JSON to /zones/<uuid>/config/metadata.json
function saveMetadata(zone, progress, callback)
{
    var zonepath = zone.zone_path = '/' + zone.zfs_storage_pool_name + '/' +
        zone.zonename;
    var mdata_filename = zonepath + '/config/metadata.json';
    var mdata;


    if (zone.hasOwnProperty('customer_metadata')) {
        debug('saveMetadata() --', zone.customer_metadata);
        mdata = {"customer_metadata": zone.customer_metadata};
    } else {
        debug('saveMetadata() -- no metadata, using {}');
        mdata = {"customer_metadata": {}};
    }

    fs.writeFile(mdata_filename, JSON.stringify(mdata, null, 2),
        function (err)
        {
            if (err) {
                return callback(err);
            }
            debug('wrote metadata to', mdata_filename);
            callback();
        }
    );
}

//
// Can be called with as:
//
//   qfunc = quantize(min, max, func)
//   qfunc(val, message)
//
// and val will be quantized to the range min-max before being passed to the
// function passed in as 'func'.
//
function quantize(min, max, func) {
    return function (percent, message) {
        var range;
        var val;

        range = max - min;
        val = Math.floor(((percent / 100) * range) + min);

        if (val > max) {
            val = max;
        }
        if (val < min) {
            val = min;
        }
        func(val, message);
    };
}

function createVM(payload, callback)
{
    var d, disk;

    debug('createVM() --', payload);

    async.series([
        function (cb)
        {
            outputProgress(2, 'checking required datasets');
            checkDatasets(payload, quantize(3, 28, outputProgress), cb);
        },
        function (cb)
        {
            outputProgress(29, 'creating volumes');
            createVolumes(payload,  quantize(30, 50, outputProgress), cb);
        },
        function (cb)
        {
            outputProgress(51, 'creating zone container');
            createZone(payload,  quantize(51, 95, outputProgress), cb);
        }
    ],
    function (err, results)
    {
        if (err) {
            callback(err);
        } else {
            callback(null, results);
        }
        return callback();
    });
}

// XXX: lifted from vmadmd.js
function nicZonecfg(nic, idx, callback)
{
    var zonecfg = '';

    // TODO: check that we've got everything or return callback(error)

    zonecfg = zonecfg +
        'add net\n' +
        'set physical=net' + idx + '\n' +
        'set global-nic=' + nic.nic_tag + '\n' +
        'set mac-addr=' + nic.mac + '\n' +
        'add property (name=index, value="' + idx + '")\n' +
        'add property (name=netmask, value="' + nic.netmask + '")\n' +
        'add property (name=ip, value="' + nic.ip + '")\n' +
        'add property (name=gateway, value="' + nic.gateway + '")\n';

    if (nic.hasOwnProperty('model')) {
        zonecfg = zonecfg +
            'add property (name=model, value="' + nic.model + '")\n';
    }

    if (nic.hasOwnProperty('vlan_id') && (nic.vlan_id !== "0")) {
        zonecfg = zonecfg + 'set vlan-id=' + nic.vlan_id + '\n';
    }

    if (nic.hasOwnProperty('blocked_outgoing_ports')) {
        zonecfg = zonecfg +
            'add property (name=blocked-outgoing-ports, value="' +
            nic.blocked_outgoing_ports.join(',') + '");';
    }

    zonecfg = zonecfg + 'end\n';

    if (callback) {
        return callback(null, zonecfg);
    }

    return zonecfg;
}

function writeZoneconfig(payload, callback)
{
    var data;

    if (!payload.hasOwnProperty('hostname')) {
        payload.hostname = payload.zonename;
    }

    debug('writeZoneconfig() --', payload);

    data = 'TEMPLATE_VERSION=0.0.1\n' +
        'ZONENAME=' + payload.zonename + '\n' +
        'HOSTNAME=' + payload.hostname + '.' + payload.dns_domain + '\n' +
        'TMPFS=' + payload.tmpfs + 'm\n';

    if (payload.nics[0]) {
        data = data + 'PUBLIC_IP=' + payload.nics[0].ip + '\n';
    }
    if (payload.nics[1]) {
        data = data + 'PRIVATE_IP=' + payload.nics[1].ip + '\n';
    } else if (payload.nics[0]) {
        // zoneinit uses private_ip for /etc/hosts, we want to
        // make that same as public, if there's no actual private.
        data = data + 'PRIVATE_IP=' + payload.nics[0].ip + '\n';
    }
    if (payload.hasOwnProperty('resolvers')) {
        // zoneinit appends to resolv.conf rather than overwriting, so just
        // add to the zoneconfig and let zoneinit handle it
        data = data + 'RESOLVERS="' + payload.resolvers.join(' ') + '"\n';
    }

    nic_idx = 0;
    for (nic in payload.nics) {
        if (payload.nics.hasOwnProperty(nic)) {
            n = payload.nics[nic];

            fs.writeFileSync(payload.zone_path + '/root/etc/hostname.net' +
                nic_idx, n.ip + ' netmask ' + n.netmask + ' up' + '\n');

            if (n.hasOwnProperty('gateway')) {
                fs.writeFileSync(payload.zone_path + '/root/etc/defaultrouter',
                    n.gateway + '\n');
            }
            data = data + 'NET' + nic_idx + '_IP=' + n.ip + '\n'
                        + 'NET' + nic_idx + '_NETMASK=' + n.netmask + '\n'
                        + 'NET' + nic_idx + '_MAC=' + n.mac + '\n'
                        + 'NET' + nic_idx + '_INTERFACE=NET' + nic_idx + '\n';

            nic_idx++;
        }
    }

    if (payload.hasOwnProperty('default_gateway')) {
        fs.writeFileSync(payload.zone_path + '/root/etc/defaultrouter',
            payload.default_gateway + '\n');
    }

    debug('writing extra files to zone root');
    fs.writeFileSync(payload.zone_path + '/root/etc/nodename',
        payload.hostname);
    fs.writeFileSync(payload.zone_path +
        '/root/var/svc/log/system-zoneinit:default.log', '');

    debug('writing', data, 'to /' + payload.zfs_storage_pool_name + '/' +
        payload.zonename);
    fs.writeFile('/' + payload.zfs_storage_pool_name + '/' + payload.zonename +
        '/root/root/zoneconfig', data,
        function (err, result) {
            if (err) {
                return callback(err);
            }
            return callback();
        }
    );
}

// runs zonecfg to apply changes to a zone.
function zoneCfg(zonename, zonecfg, callback)
{
    var tmpfile = '/tmp/zonecfg.' + zonename + '.tmp';

    debug('zoneCfg() --', zonename);

    fs.writeFile(tmpfile, zonecfg, function (err, result) {
        if (err) {
            // On failure we don't delete the tmpfile so we can debug it.
            return callback(err);
        } else {
            execFile('zonecfg', ['-z', zonename, '-f', tmpfile],
                function (error, stdout, stderr) {

                    if (error) {
                        return callback({
                            'error': error,
                            'stdout': stdout,
                            'stderr': stderr
                        });
                    }

                    fs.unlink(tmpfile, function () {
                        return callback(null, stdout, stderr);
                    });
                }
            );
        }
    });
}

// Call the callback when joyent zone has rebooted.
function waitForJoyentZone(payload, callback)
{
    var chunks;
    var buffer = '';
    var watcher;
    var timeout;
    var timeout_secs = 5 * 60;
    var state = 'running';

    watcher = spawn('/usr/sbin/zonemon', ['-z', payload.zonename],
        {'customFds': [-1, -1, -1]});

    output('update', 'zonemon running with pid ' + watcher.pid +
        ' waiting for zoneinit to reboot zone');

    timeout = setTimeout(function () {
        timeout = null;
        watcher.kill();
        watcher = null;
        callback('Timed out waiting for zone to reboot');
    }, timeout_secs * 1000);

    watcher.stdout.on('data', function (data) {
        var chunk;
        var new_state;

        buffer += data.toString();
        chunks = buffer.split('\n');
        while (chunks.length > 1) {
            chunk = chunks.shift().replace(/^\s+/g, '');
            new_state = chunk.split(' ')[0];

            output('update', 'zonemon saw state change', {"line": chunk});

            if (new_state !== 'running') {
                state = new_state;
            } else {
                // State went from not running to running, we're back up
                if (state != 'running') {
                    clearTimeout(timeout);
                    watcher.kill();
                    callback();
                }
                state = 'running';
            }
        }
        buffer = chunks.pop();
    });

    watcher.on('exit', function (code) {
        // Shouldn't get here. We should callback when zonemon notices reboot.
        if (timeout) {
            // didn't timeout yet.
            clearTimeout(timeout);
            watcher = null;
            callback('zonemon exited prematurely with code: ' + code);
        }
    });
}

function failZone(zonename, callback)
{
    debug('failZone() --', zonename);

    zoneCfg(zonename, 'set autoboot=false\n',
        function (err, stdout, stderr) {
            if (err) {
                debug('failZone(' + zonename +
                    ') failed to set autoboot, ignoring [' +
                    JSON.stringify(err) + '][' +
                    JSON.stringify(stdout) + '][' +
                    JSON.stringify(stderr) + ']');
            }
            execFile('zoneadm', ['-z', zonename, 'halt'],
                function (err, stdout, stderr) {
                    if (err) {
                        debug('failZone(' + zonename +
                            ') failed to halt, ignoring [' +
                            JSON.stringify(err) + '][' +
                            JSON.stringify(stdout) + '][' +
                            JSON.stringify(stderr) + ']');
                    }
                    debug(err, stdout, stderr);
                    callback();
                }
            );
        }
    );
}

function bootZone(payload, callback)
{
    debug('bootZone(' + payload.brand + ') --', payload.zonename);

    if (payload.brand === 'joyent') {
        execFile('zoneadm', ['-z', payload.zonename, 'boot'],
            function (error, stdout, stderr)
            {
                if (error) {
                    return callback({
                        'error': error,
                        'stdout': stdout,
                        'stderr': stderr
                    });
                }

                // zoneinit runs in joyent branded zones and the zone is not
                // considered provisioned until it's rebooted once.
                waitForJoyentZone(payload, function(err, result) {
                    if (err) {
                        output('notice',
                            'WARNING: zoneinit failed, zone is being halted ' +
                            'for manual investigation.',
                            {'error': err});
                        failZone(payload.zonename, function () {
                            return callback({
                                'error': err,
                                'stdout': stdout,
                                'stderr': stderr
                            });
                        });
                    } else {
                        return callback(null, [stdout, stderr]);
                    }
                });
            }
        );
    } else if (payload.brand === 'kvm') {
        performVmadmdAction('init', {"uuid": payload.uuid},
            function (err, result) {
                if (err) {
                    /*
                     * If there's an error trying to init/boot the VM we'll set
                     * the 'never-booted' flag to true for the VM and vmadmd
                     * will boot it the next time it's loaded.
                     *
                     */
                    if (!payload.autoboot) {
                        debug('ignoring vmadmd err, but no autoboot: ', err);
                        return callback();
                    } else {
                        debug('ignoring vmadmd err, marking never-booted: ', err);
                        zoneCfg(payload.uuid, 'add attr; ' +
                            'set name="never-booted"; ' +
                            'set type=string; set value="true"; end\n',
                            function(error, stdout, stderr) {
                                if (error) {
                                    return callback(error);
                                }
                                debug('vmadmd is unavailable, set ' +
                                    'never-booted=true');
                                return callback();
                            }
                        );
                    }
                } else {
                    return callback();
                }
            }
        );
    } else {
        return callback("don't know how to boot zone with brand " + payload.brand);
    }
}

function ifZoneDoesNotExist(uuid, callback)
{
    exec('zoneadm -u ' + uuid + ' list | grep global >/dev/null',
        function (err, stdout, stderr) {
            debug('"zoneadm -u ' + uuid + ' list | grep global" exited with code ' +
                (err ? err.code : 0) + ' stdout: "' + stdout + '" stderr:"' +
                stderr + '"');

            if (err && err.code !== 0) {
                return callback("zone w/ uuid '" + uuid + "' already exists.");
            } else {
                // exit code 0 means zone doesn't exist (global was in list)
                return callback();
            }
        }
    );
}

// generate a new UUID if payload doesn't have one (also ensures that this uuid
// does not already belong to a zone).
function createZoneUUID(payload, callback)
{
    var uuid;

    debug('createZoneUUID()');

    if (payload.hasOwnProperty('uuid')) {
        ifZoneDoesNotExist(payload.uuid, function (err) {
            if (err) {
                return callback(err);
            }
            if (!payload.hasOwnProperty('zonename')) {
                payload.zonename = payload.uuid;
            }
            return callback(null, payload.uuid);
        });
    } else {
        exec('/usr/bin/uuid -v 4', function (err, stdout, stderr) {
            if (err) {
                return callback(err);
            }

            // chomp trailing spaces and newlines
            uuid = stdout.toString().replace(/\s+$/g, '');
            payload.uuid = uuid
            ifZoneDoesNotExist(payload.uuid, function (err) {
                if (err) {
                    return callback(err);
                }
                if (!payload.hasOwnProperty('zonename')) {
                    payload.zonename = payload.uuid;
                }
                return callback(null, uuid);
            });
        });
    }
}

function applyZoneDefaults(payload)
{
    var nic, n, disk, zvol;

    debug('applyZoneDefaults()');

    if (!payload.hasOwnProperty('owner_uuid')) {
        // We assume that this all-zero uuid can be treated as 'admin'
        payload.owner_uuid = '00000000-0000-0000-0000-000000000000';
    }

    if (!payload.hasOwnProperty('autoboot')) {
        payload.autoboot = 'true';
    }

    if (!payload.hasOwnProperty('brand')) {
        payload.brand = 'joyent';
    }

    if (!payload.hasOwnProperty('zfs_storage_pool_name')) {
        payload.zfs_storage_pool_name = 'zones';
    }

    if (!payload.hasOwnProperty('dns_domain')) {
        payload.dns_domain = 'local';
    }

    if (!payload.hasOwnProperty('cpu_shares')) {
        payload.cpu_shares = 100;
    }

    if (!payload.hasOwnProperty('zfs_io_priority')) {
        payload.zfs_io_priority = 100;
    }

    if (!payload.hasOwnProperty('max_lwps')) {
        payload.max_lwps = 2000;
    }

    // We need to set the RAM here because we use it as the default for
    // the max_physical_memory below.
    if (payload.brand === 'kvm' && !payload.hasOwnProperty('ram')) {
        payload.ram = 256;
    }

    // NOTE: We add 1024 to memory limits for 'kvm' brand zones below.
    if (!payload.hasOwnProperty('max_physical_memory')) {
        if (payload.brand === 'kvm') {
            payload.max_physical_memory = payload.ram;
        } else {
            payload.max_physical_memory = 256; // in MiB
        }
    }

    if (!payload.hasOwnProperty('max_locked_memory')) {
        payload.max_locked_memory = payload.max_physical_memory;
    }

    if (!payload.hasOwnProperty('max_swap')) {
        payload.max_swap = payload.max_physical_memory;
    }

    if (payload.brand === 'kvm') {
        // For now we add 1G to the memory caps for KVM zones, this overhead
        // is for the qemu process itself.  Since customers don't have direct
        // access to zone memory, this exists mostly to protect against bugs.
        payload.max_physical_memory = payload.max_physical_memory + 1024;
        payload.max_locked_memory = payload.max_locked_memory + 1024;
        payload.max_swap = payload.max_swap + 1024;

        if (!payload.hasOwnProperty('vcpus')) {
            payload.vcpus = 1;
        }
    } else if (payload.brand === 'joyent') {
        if (!payload.hasOwnProperty('tmpfs')) {
            payload.tmpfs = 256;
        }
    }

    if (!payload.hasOwnProperty('limit_priv')) {
        // note: the limit privs are going to be added to the brand and
        // shouldn't need to be set here by default when that's done.
        payload.limit_priv = 'default,dtrace_proc,dtrace_user';
    }

    if (!payload.hasOwnProperty('quota')) {
        payload.quota = '10'; // in GiB
    }

    if (!payload.hasOwnProperty('billing_id')) {
        if (payload.hasOwnProperty('dataset_uuid')) {
            payload.billing_id = payload.dataset_uuid;
        } else {
            payload.billing_id = '00000000-0000-0000-0000-000000000000';
        }
    }

    for (disk in payload.disks) {
        if (payload.disks.hasOwnProperty(disk)) {
            zvol = payload.disks[disk];
            if (!zvol.hasOwnProperty('model') &&
                payload.hasOwnProperty('disk_driver')) {

                zvol.model = payload.disk_driver;
            }
        }
    }

    for (nic in payload.nics) {
        if (payload.nics.hasOwnProperty(nic)) {
            n = payload.nics[nic];
            if (!n.hasOwnProperty('model') &&
                payload.hasOwnProperty('nic_driver')) {

                n.model = payload.nic_driver;
            }
        }
    }

    return;
}

function checkProperties(payload, callback)
{
    var disk, zvol, nic, n;

    // TODO check for missing keys and reused IP addresses

    if (payload.max_locked_memory > payload.max_physical_memory) {
        callback('max_locked_memory must be <= max_physical_memory');
    }
    if (payload.max_swap < payload.max_physical_memory) {
        callback('max_swap must be >= max_physical_memory');
    }

    for (disk in payload.disks) {
        if (payload.disks.hasOwnProperty(disk)) {
            zvol = payload.disks[disk];

            if (payload.brand === 'kvm' && (!zvol.hasOwnProperty('model') ||
                zvol.model === 'undefined')) {

                callback('missing .model option for disk: ' +
                    JSON.stringify(zvol));
            }
        }
    }

    for (nic in payload.nics) {
        if (payload.nics.hasOwnProperty(nic)) {
            n = payload.nics[nic];

            if (payload.brand === 'kvm' && (!n.hasOwnProperty('model') ||
                n.model === 'undefined')) {

                callback('missing .model option for NIC: ' +
                    JSON.stringify(n));
            }
        }
    }

    callback();
}

// create and install a 'joyent' or 'kvm' brand zone.
function createZone(payload, progress, callback)
{
    var zonecfg;
    var zone_path;

    debug('createZone() --', payload);

    if (payload.brand === 'joyent' && !payload.hasOwnProperty('dataset_uuid')) {
        return callback('createZone(): FAILED -- dataset_uuid is required.');
    }

    payload.zone_path = '/' + payload.zfs_storage_pool_name + '/' + payload.zonename;

    zonecfg = 'create -b\n' +
        'set zonepath=' + payload.zone_path + '\n' +
        'set brand=' + payload.brand + '\n' +
        'set ip-type=exclusive\n' +
        'set cpu-shares=' + payload.cpu_shares.toString() + '\n' +
        'set zfs-io-priority=' + payload.zfs_io_priority.toString() + '\n' +
        'set max-lwps=' + payload.max_lwps.toString() + '\n' +
        'add capped-memory; ' +
            'set physical=' + payload.max_physical_memory.toString() + 'm; ' +
            'set locked=' + payload.max_locked_memory.toString() + 'm;' +
            'set swap=' + payload.max_swap.toString() + 'm; end\n' +
        'add attr; set name="billing-id"; set type=string; set value="' +
            payload.billing_id + '"; end\n' +
        'add attr; set name="owner-uuid"; set type=string; set value="' +
            payload.owner_uuid + '"; end\n';

    if (payload.hasOwnProperty('limit_priv')) {
        zonecfg = zonecfg + 'set limitpriv="' + payload.limit_priv + '"\n';
    }

    if (payload.hasOwnProperty('package_name')) {
        zonecfg = zonecfg + 'add attr; set name="package-name"; ' +
            'set type=string; set value="' + payload.package_name + '"; end\n';
    }

    if (payload.hasOwnProperty('package_version')) {
        zonecfg = zonecfg + 'add attr; set name="package-version"; ' +
            'set type=string; set value="' + payload.package_version +
            '"; end\n';
    }

    if (payload.hasOwnProperty('cpu_cap')) {
        zonecfg = zonecfg + 'add capped-cpu; ' +
            'set ncpus=' +  (Number(payload.cpu_cap) * 0.01).toString() +
            '; end\n';
    }

    if (payload.hasOwnProperty('alias')) {
        zonecfg = zonecfg + 'add attr; set name="alias"; ' +
            'set type=string; set value="' +
            new Buffer(payload.alias).toString('base64') +
            '"; end\n';
    }

    if (payload.hasOwnProperty('tags')) {
        zonecfg = zonecfg + 'add attr; set name="tags"; ' +
            'set type=string; set value="' +
            new Buffer(JSON.stringify(payload.tags)).toString('base64') +
            '"; end\n';
    }

    if (payload.hasOwnProperty('tmpfs')) {
        zonecfg = zonecfg + 'add attr; set name="tmpfs"; ' +
            'set type=string; set value="' + payload.tmpfs.toString() + '"; end\n';
    }

    if (payload.hasOwnProperty('hostname')) {
        zonecfg = zonecfg + 'add attr; set name="hostname"; ' +
            'set type=string; set value="' + payload.hostname + '"; end\n';
    }

    if (payload.hasOwnProperty('dns_domain')) {
        zonecfg = zonecfg + 'add attr; set name="dns-domain"; ' +
            'set type=string; set value="' + payload.dns_domain + '"; end\n';
    }

    if (payload.hasOwnProperty('resolvers')) {
        zonecfg = zonecfg + 'add attr; set name="resolvers"; ' +
            'set type=string; set value="' + payload.resolvers.join(',') + '"; end\n';
    }

    if (payload.hasOwnProperty('default_gateway')) {
        zonecfg = zonecfg + 'add attr; set name="default-gateway"; ' +
            'set type=string; set value="' + payload.default_gateway + '"; end\n';
    }

    if (payload.brand === 'joyent') {
        zonecfg = zonecfg + 'set autoboot=' + payload.autoboot + '\n';
    } else if (payload.brand === 'kvm') {
        zonecfg = zonecfg + 'add attr; set name="vm-autoboot"; set type=string; ' +
            'set value="' + payload.autoboot + '"; end\n';
        zonecfg = zonecfg + 'add attr; set name="ram"; set type=string; ' +
            'set value="' + payload.ram.toString() + '"; end\n';
        zonecfg = zonecfg + 'add attr; set name="vcpus"; set type=string; ' +
            'set value="' + payload.vcpus.toString() + '"; end\n';
        // we always set autoboot=false for VM zones, since we want vmadmd to
        // boot them and not the zones tools.  Use vm-autoboot to control VMs
        zonecfg = zonecfg + 'set autoboot=false\n';

        if (payload.hasOwnProperty('boot')) {
            zonecfg = zonecfg + 'add attr; set name="boot"; ' +
                'set type=string; set value="' + payload.boot + '"; end\n';
        }

        if (payload.hasOwnProperty('cpu_type')) {
            zonecfg = zonecfg + 'add attr; set name="cpu-type"; ' +
                'set type=string; set value="' + payload.cpu_type + '"; end\n';
        }

        // we use base64 here for these next two options, since these can
        // contain characters zonecfg doesn't like.

        if (payload.hasOwnProperty('qemu_opts')) {
            zonecfg = zonecfg + 'add attr; set name="qemu-opts"; ' +
                'set type=string; set value="' +
                new Buffer(payload.qemu_opts).toString('base64') +
                '"; end\n';
        }

        if (payload.hasOwnProperty('qemu_extra_opts')) {
            zonecfg = zonecfg + 'add attr; set name="qemu-extra-opts"; ' +
                'set type=string; set value="' +
                new Buffer(payload.qemu_extra_opts).toString('base64') +
                '"; end\n';
        }

        // only VMs have 'disks'
        disk_idx = 0;
        for (disk in payload.disks) {
            if (payload.disks.hasOwnProperty(disk)) {
                zvol = payload.disks[disk];
                zonecfg = zonecfg + 'add device\n' +
                    'set match=' + zvol.path + '\n' +
                    'add property (name=index, value="' + disk_idx + '")\n' +
                    'add property (name=boot, value="' +
                        (zvol.boot ? 'true' : 'false') + '")\n' +
                    'add property (name=model, value="' + zvol.model + '")\n';
                if (zvol.hasOwnProperty('image_size')) {
                    zonecfg = zonecfg +
                        'add property (name=image-size, value="' +
                        zvol.image_size + '")\n';
                } else if (zvol.hasOwnProperty('size')) {
                    zonecfg = zonecfg + 'add property (name=size, value="' +
                        zvol.size + '")\n';
                }

                if (zvol.hasOwnProperty('image_uuid')) {
                    zonecfg = zonecfg +
                        'add property (name=image-uuid, value="' +
                        zvol.image_uuid + '")\n';
                }

                if (zvol.hasOwnProperty('image_name')) {
                    zonecfg = zonecfg +
                        'add property (name=image-name, value="' +
                        zvol.image_name + '")\n';
                }

                zonecfg = zonecfg + 'end\n';
                disk_idx ++;
            }
        }
    }

    nic_idx = 0;
    for (nic in payload.nics) {
        if (payload.nics.hasOwnProperty(nic)) {
            n = payload.nics[nic];
            nic_zcfg = nicZonecfg(n, nic_idx);
            if (nic_zcfg) {
                zonecfg = zonecfg + nic_zcfg;
                nic_idx ++;
            } else {
                // unable to build zonecfg entry for this NIC
                return callback('unable to create zonecfg entry for NIC with' +
                    ' data:', n);
            }
        }
    }

    zoneCfg(payload.zonename, zonecfg, function (error, stdout, stderr) {

        args = ['-z', payload.zonename, 'install', '-q',
            payload.quota.toString(), '-U', payload.uuid];

        if (payload.brand === 'joyent') {
            args.push('-t');
            args.push(payload.dataset_uuid);
            args.push('-x');
            args.push('nodataset');
        }

        if (error) {
            return callback(error);
        }
        execFile('zoneadm', args, function (error, stdout, stderr) {
            if (error) {
                return callback({'failure': 'zoneadm failed to install zone',
                    'error': error, 'stdout': stdout, 'stderr': stderr});
            }

            saveMetadata(payload, progress, function (err) {
                if (err) {
                    output('failure', 'unable to save metadata',
                        {'error': err});
                    process.exit(1);
                }
                if (payload.brand === 'joyent') {
                    writeZoneconfig(payload, function (err, result) {
                        if (payload.autoboot) {
                            bootZone(payload, function(e, res) {
                                if (e) {
                                    return callback(e);
                                }
                                return callback(null, [stdout, stderr]);
                            });
                        } else {
                            return callback(null, [stdout, stderr]);
                        }
                    });
                } else if (payload.brand === 'kvm') {
                    // bootZone will only boot kvm zones if autoboot === true, but
                    // will load them regardless so needs to be called each time.
                    bootZone(payload, function(e, res) {
                        if (e) {
                            return callback(e);
                        }
                        return callback(null, [stdout, stderr]);
                    });
                } else {
                    return callback('error, unhandled brand "' + payload.brand + '"');
                }
            });
        });
    });
}

function readFile(filename, callback)
{
    var data = new Buffer('');

    if (filename === '-') {
        filename = '/dev/stdin';
    }

    fs.readFile(filename, callback);
}

function assignMACs(payload)
{
    var n, nic;

    debug('assignMACs()');

    for (n in payload.nics) {
        if (payload.nics.hasOwnProperty(n)) {
            nic = payload.nics[n];
            if (!nic.hasOwnProperty('mac')) {
                nic.mac = generateMAC();
            }
        }
    }
}

function createMachine(payload, callback)
{
    if (payload.brand === "kvm") {
        createZoneUUID(payload, function (err, uuid) {
            if (err) {
                output('failure', 'unable to create UUID', {'error': err});
                process.exit(1);
            }

            createVM(payload, function (err, result) {
                if (err) {
                    output('failure', 'unable to create VM',
                        {'error': err});
                    process.exit(1);
                }
                output('success', 'created VM', {'uuid': payload.uuid,
                    'zonename': payload.zonename});
                process.exit(0);
            });
        });
    } else if (payload.brand === "joyent") {
        createZoneUUID(payload, function (err, uuid) {
            if (err) {
                output('failure', 'unable to create UUID', {'error': err});
                process.exit(1);
            }

            createZone(payload, outputProgress, function (err, result) {
                if (err) {
                    output('failure', 'unable to create VM',
                        {'error': err});
                    process.exit(1);
                }
                output('success', 'created Zone', {'uuid': payload.uuid,
                    'zonename': payload.zonename});
                process.exit(0);
            });
        });
    } else {
        output('failure', "Don't know how to create a '" + payload.brand + "'");
        process.exit(1);
    }
}

function main()
{
    var filename;
    var payload;

    if ((process.argv.length !== 4) || (process.argv[2] !== '-f')) {
        usage();
    }

    filename = process.argv[3];

    readFile(filename, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                // XXX: should we output JSON even in this case?
                process.stderr.write('FATAL file "' + filename +
                    '" does not exist.');
                usage();
            } else {
                output('failure', 'unable to read file', {'error': err});
                process.exit(1);
            }
        }

        payload = JSON.parse(data.toString());
        assignMACs(payload);
        applyZoneDefaults(payload);
        checkProperties(payload, function (err) {
            if (err) {
                output('failure', 'unable to validate properties',
                    {'error': err});
                process.exit(1);
            }
            createMachine(payload);
            // XXX: won't get here, createMachine() will call process.exit();
        });
    });
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        console.log('Fatal: cannot run because: ' + err);
        process.exit(1);
    }

    logfile = fs.createWriteStream('/var/log/create-machine.log',
        {"mode": 0644, "flags": "a"});

    main();
});
