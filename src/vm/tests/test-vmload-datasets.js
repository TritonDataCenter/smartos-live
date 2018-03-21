/*
 * Copyright (c) 2018, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var log;
var vmload_datasets = require('/usr/vm/node_modules/vmload/vmload-datasets');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// save some typing
var getDatasets = vmload_datasets.getDatasets;

// TODO: logger that errors when message >= WARN
log = bunyan.createLogger({
    level: 'debug',
    name: 'test-vmload-datasets',
    serializers: bunyan.stdSerializers
});

function getDatasetsWrapper(fields, lines, out, callback)
{
    var options = {};

    function spawnZfs(options, cmd, args, lineHandler, callbackHandler) {
        async.eachSeries(lines, function (line, cb) {
            lineHandler(line);
            cb();
        }, function (err) {
            out.cmd = cmd;
            out.args = args;
            callbackHandler(err);
        });
    }

    options = {
        fields: fields,
        log: log,
        spawnZfs: spawnZfs
    };

    getDatasets({}, options, callback);
}

test('test with no datasets', function (t) {
    var fields = [];
    var lines = [];
    var out = {};

    getDatasetsWrapper(fields, lines, out, function (err, dsobj) {
        t.deepEqual(dsobj, {datasets: {}, mountpoints: {}, snapshots: {}},
            'without any datasets, we don\'t get empty object');
        t.end();
    });
});

test('test with one zone and one image', function (t) {
    var expected_dsobj = {
      "datasets": {
        "zones": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones",
          "name": "zones",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f": {
          "compression": "off",
          "creation": 1521075695,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f",
          "name": "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f@final": {
          "compression": "-",
          "creation": 1494367539,
          "filesystem_limit": "-",
          "mountpoint": "/zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f@final",
          "name": "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f@final",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": "-",
          "snapshot_limit": "-",
          "type": "snapshot",
          "userrefs": 0,
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "-"
        },
        "zones/2b21e6d4-af12-4966-9f42-41051949d5ba": {
          "compression": "off",
          "creation": 1521075876,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/2b21e6d4-af12-4966-9f42-41051949d5ba",
          "name": "zones/2b21e6d4-af12-4966-9f42-41051949d5ba",
          "quota": 26843545600,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/38396fc7-2472-416b-e61b-d833b32bd088": {
          "compression": "off",
          "creation": 1521351753,
          "filesystem_limit": "-",
          "mountpoint": "/dev/zvol/rdsk/zones/38396fc7-2472-416b-e61b-d833b32bd088",
          "name": "zones/38396fc7-2472-416b-e61b-d833b32bd088",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "volume",
          "userrefs": "-",
          "volblocksize": 4096,
          "volsize": 10737418240,
          "zoned": "-"
        },
        "zones/38396fc7-2472-416b-e61b-d833b32bd088@final": {
          "compression": "-",
          "creation": 1518028564,
          "filesystem_limit": "-",
          "mountpoint": "/zones/38396fc7-2472-416b-e61b-d833b32bd088@final",
          "name": "zones/38396fc7-2472-416b-e61b-d833b32bd088@final",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": "-",
          "snapshot_limit": "-",
          "type": "snapshot",
          "userrefs": 0,
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "-"
        },
        "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c": {
          "compression": "off",
          "creation": 1521075784,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/48a81798-183f-11e8-ad9c-b7b41cb4059c",
          "name": "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c@final": {
          "compression": "-",
          "creation": 1519352017,
          "filesystem_limit": "-",
          "mountpoint": "/zones/48a81798-183f-11e8-ad9c-b7b41cb4059c@final",
          "name": "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c@final",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": "-",
          "snapshot_limit": "-",
          "type": "snapshot",
          "userrefs": 0,
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "-"
        },
        "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3": {
          "compression": "off",
          "creation": 1521563092,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3",
          "name": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3",
          "quota": 0,
          "recsize": 131072,
          "refquota": 10737418240,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0": {
          "compression": "off",
          "creation": 1521563092,
          "filesystem_limit": "-",
          "mountpoint": "/dev/zvol/rdsk/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0",
          "name": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": 10737418240,
          "snapshot_limit": 18446744073709552000,
          "type": "volume",
          "userrefs": "-",
          "volblocksize": 4096,
          "volsize": 10737418240,
          "zoned": "-"
        },
        "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1": {
          "compression": "off",
          "creation": 1521563092,
          "filesystem_limit": "-",
          "mountpoint": "/dev/zvol/rdsk/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1",
          "name": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": 27685552128,
          "snapshot_limit": 18446744073709552000,
          "type": "volume",
          "userrefs": "-",
          "volblocksize": 8192,
          "volsize": 26843545600,
          "zoned": "-"
        },
        "zones/archive": {
          "compression": "lzjb",
          "creation": 1521076431,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/archive",
          "name": "zones/archive",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/config": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/config",
          "name": "zones/config",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/cores": {
          "compression": "lz4",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "none",
          "name": "zones/cores",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/cores/2b21e6d4-af12-4966-9f42-41051949d5ba": {
          "compression": "lz4",
          "creation": 1521075876,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/2b21e6d4-af12-4966-9f42-41051949d5ba/cores",
          "name": "zones/cores/2b21e6d4-af12-4966-9f42-41051949d5ba",
          "quota": 107374182400,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/cores/56441053-fc6d-eb86-e1b4-b94ca8e133d3": {
          "compression": "lz4",
          "creation": 1521563094,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/cores",
          "name": "zones/cores/56441053-fc6d-eb86-e1b4-b94ca8e133d3",
          "quota": 107374182400,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/cores/global": {
          "compression": "lz4",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/global/cores",
          "name": "zones/cores/global",
          "quota": 10737418240,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/dump": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": "-",
          "mountpoint": "/dev/zvol/rdsk/zones/dump",
          "name": "zones/dump",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "volume",
          "userrefs": "-",
          "volblocksize": 131072,
          "volsize": 3220176896,
          "zoned": "-"
        },
        "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce": {
          "compression": "off",
          "creation": 1521075685,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce",
          "name": "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce@final": {
          "compression": "-",
          "creation": 1457049758,
          "filesystem_limit": "-",
          "mountpoint": "/zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce@final",
          "name": "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce@final",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": "-",
          "snapshot_limit": "-",
          "type": "snapshot",
          "userrefs": 0,
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "-"
        },
        "zones/opt": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/opt",
          "name": "zones/opt",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/swap": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": "-",
          "mountpoint": "/dev/zvol/rdsk/zones/swap",
          "name": "zones/swap",
          "quota": "-",
          "recsize": "-",
          "refquota": "-",
          "refreservation": 2147483648,
          "snapshot_limit": 18446744073709552000,
          "type": "volume",
          "userrefs": "-",
          "volblocksize": 8192,
          "volsize": 6442450944,
          "zoned": "-"
        },
        "zones/usbkey": {
          "compression": "off",
          "creation": 1521075395,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/usbkey",
          "name": "zones/usbkey",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        },
        "zones/var": {
          "compression": "off",
          "creation": 1521050188,
          "filesystem_limit": 18446744073709552000,
          "mountpoint": "/zones/var",
          "name": "zones/var",
          "quota": 0,
          "recsize": 131072,
          "refquota": 0,
          "refreservation": 0,
          "snapshot_limit": 18446744073709552000,
          "type": "filesystem",
          "userrefs": "-",
          "volblocksize": "-",
          "volsize": "-",
          "zoned": "off"
        }
      },
      "mountpoints": {
        "/zones": "zones",
        "/zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f": "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f",
        "/zones/2b21e6d4-af12-4966-9f42-41051949d5ba": "zones/2b21e6d4-af12-4966-9f42-41051949d5ba",
        "/dev/zvol/rdsk/zones/38396fc7-2472-416b-e61b-d833b32bd088": "zones/38396fc7-2472-416b-e61b-d833b32bd088",
        "/zones/48a81798-183f-11e8-ad9c-b7b41cb4059c": "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c",
        "/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3",
        "/dev/zvol/rdsk/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0",
        "/dev/zvol/rdsk/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1": "zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1",
        "/zones/archive": "zones/archive",
        "/zones/config": "zones/config",
        "/zones/2b21e6d4-af12-4966-9f42-41051949d5ba/cores": "zones/cores/2b21e6d4-af12-4966-9f42-41051949d5ba",
        "/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/cores": "zones/cores/56441053-fc6d-eb86-e1b4-b94ca8e133d3",
        "/zones/global/cores": "zones/cores/global",
        "/dev/zvol/rdsk/zones/dump": "zones/dump",
        "/zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce": "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce",
        "/zones/opt": "zones/opt",
        "/dev/zvol/rdsk/zones/swap": "zones/swap",
        "/zones/usbkey": "zones/usbkey",
        "/zones/var": "zones/var"
      },
      "snapshots": {
        "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f": [
          {
            "snapname": "final",
            "dataset": "zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f",
            "created_at": 1494367539
          }
        ],
        "zones/38396fc7-2472-416b-e61b-d833b32bd088": [
          {
            "snapname": "final",
            "dataset": "zones/38396fc7-2472-416b-e61b-d833b32bd088",
            "created_at": 1518028564
          }
        ],
        "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c": [
          {
            "snapname": "final",
            "dataset": "zones/48a81798-183f-11e8-ad9c-b7b41cb4059c",
            "created_at": 1519352017
          }
        ],
        "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce": [
          {
            "snapname": "final",
            "dataset": "zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce",
            "created_at": 1457049758
          }
        ]
      }
    };

    /*
     * this was taken from the output of:
     *
     * zfs list -H -p -t filesystem,snapshot,volume \
     *     -o compression,creation,filesystem_limit,mountpoint,name,quota,\
     *     recsize,refquota,refreservation,snapshot_limit,type,userrefs,volblocksize,\
     *     volsize,zoned
     *
     * from a system with one smartos zone, one bhyve zone and 4 installed
     * images.
     */
    var lines = [
        'off	1521050188	18446744073709551615	/zones	zones	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521075695	18446744073709551615	/zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f	zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        '-	1494367539	-	-	zones/04a48d7d-6bb5-4e83-8c3b-e60a99e0f48f@final	-	-	-	-	-	snapshot	0	-	-	-',
        'off	1521075876	18446744073709551615	/zones/2b21e6d4-af12-4966-9f42-41051949d5ba	zones/2b21e6d4-af12-4966-9f42-41051949d5ba	26843545600	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521351753	-	-	zones/38396fc7-2472-416b-e61b-d833b32bd088	-	-	-	0	18446744073709551615	volume	-	4096	10737418240	-',
        '-	1518028564	-	-	zones/38396fc7-2472-416b-e61b-d833b32bd088@final	-	-	-	-	-	snapshot	0	-	-	-',
        'off	1521075784	18446744073709551615	/zones/48a81798-183f-11e8-ad9c-b7b41cb4059c	zones/48a81798-183f-11e8-ad9c-b7b41cb4059c	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        '-	1519352017	-	-	zones/48a81798-183f-11e8-ad9c-b7b41cb4059c@final	-	-	-	-	-	snapshot	0	-	-	-',
        'off	1521563092	18446744073709551615	/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3	zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3	0	131072	10737418240	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521563092	-	-	zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk0	-	-	-	10737418240	18446744073709551615	volume	-	4096	10737418240	-',
        'off	1521563092	-	-	zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/disk1	-	-	-	27685552128	18446744073709551615	volume	-	8192	26843545600	-',
        'lzjb	1521076431	18446744073709551615	/zones/archive	zones/archive	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521050188	18446744073709551615	legacy	zones/config	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'lz4	1521050188	18446744073709551615	none	zones/cores	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'lz4	1521075876	18446744073709551615	/zones/2b21e6d4-af12-4966-9f42-41051949d5ba/cores	zones/cores/2b21e6d4-af12-4966-9f42-41051949d5ba	107374182400	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'lz4	1521563094	18446744073709551615	/zones/56441053-fc6d-eb86-e1b4-b94ca8e133d3/cores	zones/cores/56441053-fc6d-eb86-e1b4-b94ca8e133d3	107374182400	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'lz4	1521050188	18446744073709551615	/zones/global/cores	zones/cores/global	10737418240	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521050188	-	-	zones/dump	-	-	-	0	18446744073709551615	volume	-	131072	3220176896	-',
        'off	1521075685	18446744073709551615	/zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce	zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        '-	1457049758	-	-	zones/ede31770-e19c-11e5-bb6e-3b7de3cca9ce@final	-	-	-	-	-	snapshot	0	-	-	-',
        'off	1521050188	18446744073709551615	legacy	zones/opt	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521050188	-	-	zones/swap	-	-	-	2147483648	18446744073709551615	volume	-	8192	6442450944	-',
        'off	1521075395	18446744073709551615	legacy	zones/usbkey	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off',
        'off	1521050188	18446744073709551615	legacy	zones/var	0	131072	0	0	18446744073709551615	filesystem	-	-	-	off'
    ];

    var expected_args = [
        'list',
        '-H',
        '-p',
        '-t',
        'filesystem,snapshot,volume',
        '-o',
        'compression,creation,filesystem_limit,mountpoint,name,quota,'
            + 'recsize,refquota,refreservation,snapshot_limit,type,userrefs,'
            + 'volblocksize,volsize,zoned'
    ];

    var out = {};

    getDatasetsWrapper([], lines, out, function (err, dsobj) {
        t.ifError(err, 'getDatasetsWrapper should have no error');
        t.equal(out.cmd, '/usr/sbin/zfs', 'zfs cmd is as expected');
        t.deepEqual(out.args, expected_args, 'zfs args are as expected');
        t.deepEqual(dsobj, expected_dsobj, 'dsobj parsed as expected');
        t.end();
    });
});
