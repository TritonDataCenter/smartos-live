#!/usr/node/bin/node --abort_on_uncaught_exception
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * WARNING: This tool is experimental and not yet assumed to work.
 *
 * SUMMARY:
 *
 * This tool is designed to give you the disk/pool usage by zone instead of by
 * dataset. It treats all storage not used by VMs as being used by the GZ.
 *
 */

/*
 * TODO:
 *   - add -H, -o field,field,field and -s field,field options
 *   - add -p option (raw values, no toGiB)
 *   - add option to just dump all fields for a given VM
 *   - add -j (json output)
 *   - add used-by-disks field(s)
 *   - separate usedby* fields?
 *   - are we handling used/refer/reserv properly?
 *   - do GZ numbers add up?
 */

var child_process = require('child_process');
var execFile = child_process.execFile;
var sysinfo = require('/tmp/.sysinfo.json');
var tabula = require('/usr/img/node_modules/tabula');
var VM = require('/usr/vm/node_modules/VM');

var lookup_fields = [
    'alias',
    'brand',
    'datasets',
    'disks',
    'uuid',
    'zfs_filesystem',
    'zonename'
];
var zfs_fields = [
    'avail',
    'name',
    'quota',
    'refer',
    'refreserv',
    'reserv',
    'used',
    'usedbychildren',
    'usedbydataset',
    'usedbyrefreservation',
    'usedbysnapshots',
    'volsize'
];

function getPoolSize(callback) {
    var args = [
        'get',
        '-Hpo', 'value',
        'size',
        'zones'
    ];
    var cmd = '/usr/sbin/zpool';

    console.log(cmd + ' ' + args.join(' '));

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            console.error('error: ' + error.message);
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, Number(stdout));
        }
    });
}

function zfsData(callback) {
    var args = [
        'list',
        '-Hpo',
        zfs_fields.join(','),
        '-t', 'filesystem,volume'
    ];
    var cmd = '/usr/sbin/zfs';
    var fields;
    var zfs_data = {};

    console.log(cmd + ' ' + args.join(' '));

    execFile(cmd, args, function (error, stdout, stderr) {
        var name;

        if (error) {
            console.error('error: ' + error.message);
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            stdout.split('\n').forEach(function (line) {
                fields = line.split('\t');
                if (fields.length !== zfs_fields.length) {
                    return;
                }
                name = fields[zfs_fields.indexOf('name')];
                if (!zfs_data[name]) {
                    zfs_data[name] = {};
                }
                for (var i = 0; i < fields.length; i++) {
                    if (isNaN(Number(fields[i]))) {
                        zfs_data[name][zfs_fields[i]] = fields[i];
                    } else {
                        zfs_data[name][zfs_fields[i]] = Number(fields[i]);
                    }
                }
            });
            callback(null, zfs_data);
        }
    });
}

function toGiB(bytes) {
    return Math.floor((bytes * 10) / (1024 * 1024 * 1024)) / 10;
}

VM.lookup({}, {fields: lookup_fields}, function (error, vmobjs) {
    var total_used_by_zones = 0;

    if (error) {
        console.error('ERROR: ' + error.message);
    } else {
        getPoolSize(function (err, pool_size) {
            if (err) {
                console.error('ERROR: ' + err.message);
                return;
            }
            zfsData(function (e, data) {
                var results = [];

                vmobjs.forEach(function (vm) {
                    var avail = 0;
                    var cores;
                    var size = 0;
                    var used = 0;
                    var vm_usage = {
                        alias: vm.alias,
                        zone: vm.uuid
                    };

                    // Amount used by zoneroot dataset
                    avail += data[vm.zfs_filesystem].avail;
                    size += data[vm.zfs_filesystem].quota;
                    used += data[vm.zfs_filesystem].used;

                    cores = data['zones/cores/' + vm.zonename].used;

                    if (vm.brand === 'kvm') {
                        vm_usage.virt = 'KVM';
                        vm_usage.disks_volsize = 0;
                        vm.disks.forEach(function (d) {
                            vm_usage.disks_volsize
                                += data[d.zfs_filesystem].volsize;
                            vm_usage.disks_refer
                                += data[d.zfs_filesystem].refer;
                            vm_usage.disks_refreserv
                                += data[d.zfs_filesystem].refreserv;

                            avail += (data[d.zfs_filesystem].volsize
                                - data[d.zfs_filesystem].used);
                            size += data[d.zfs_filesystem].volsize;
                            used += data[d.zfs_filesystem].used;
                        });
                    } else {
                        vm_usage.virt = 'OS';
                        vm_usage.disks_refer = 0;
                        vm_usage.disks_refreserv = 0;
                        vm_usage.disks_volsize = 0;
                    }

                    vm_usage.avail = toGiB(avail);
                    vm_usage.cores = toGiB(cores);
                    vm_usage.size = toGiB(size);
                    vm_usage.used = toGiB(used);

                    results.push(vm_usage);

                    total_used_by_zones += used;
                });

                // global usage = total - (sum of zones)
                results.push({
                    alias: 'global',
                    avail: toGiB(data['zones'].avail),
                    cores: toGiB(data['zones/cores/global'].used),
                    size: toGiB(pool_size),
                    used: toGiB(data['zones'].used - total_used_by_zones),
                    zone: sysinfo.UUID
                });

                tabula(results, {
                    columns: [
                        'zone',
                        'alias',
                        'virt',
                        'size',
                        'avail',
                        'used',
                        'cores'
                    ],
                    sort: ['-size']
                });
            });
        });
    }
});
