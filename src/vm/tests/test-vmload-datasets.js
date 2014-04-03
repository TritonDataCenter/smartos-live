/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var log;
var vmload_datasets = require('/usr/vm/node_modules/vmload/vmload-datasets');

// save some typing
var getDatasets = vmload_datasets.getDatasets;

// this puts test stuff in global
require('nodeunit-plus');

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

    getDatasets(options, callback);
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
            "creation": 1392846460,
            "mountpoint": "/zones",
            "userrefs" : "-",
            "name": "zones",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/01b2c898-945f-11e1-a523-af1afbe22822": {
            "compression": "off",
            "creation": 1392846722,
            "mountpoint": "/zones/01b2c898-945f-11e1-a523-af1afbe22822",
            "userrefs" : "-",
            "name": "zones/01b2c898-945f-11e1-a523-af1afbe22822",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/01b2c898-945f-11e1-a523-af1afbe22822@final": {
            "compression": "-",
            "creation": 1335967116,
            "mountpoint": "/zones/01b2c898-945f-11e1-a523-af1afbe22822@final",
            "userrefs" : "-",
            "name": "zones/01b2c898-945f-11e1-a523-af1afbe22822@final",
            "quota": "-",
            "recsize": "-",
            "refreservation": "-",
            "type": "snapshot",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "-"
          },
          "zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25": {
            "compression": "off",
            "creation": 1392939536,
            "mountpoint": "/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25",
            "userrefs" : "-",
            "name": "zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25",
            "quota": 10737418240,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/data": {
            "compression": "off",
            "creation": 1392939536,
            "mountpoint": "/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/data",
            "userrefs" : "-",
            "name": "zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/data",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "on"
          },
          "zones/archive": {
            "compression": "lzjb",
            "creation": 1392849677,
            "mountpoint": "/zones/archive",
            "userrefs" : "-",
            "name": "zones/archive",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/config": {
            "compression": "off",
            "creation": 1392846460,
            "mountpoint": "/zones/config",
            "userrefs" : "-",
            "name": "zones/config",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/cores": {
            "compression": "lz4",
            "creation": 1392846460,
            "mountpoint": "none",
            "userrefs" : "-",
            "name": "zones/cores",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/cores/8be21e2a-ce25-4eb2-b796-b36b274b5a25": {
            "compression": "lz4",
            "creation": 1392939536,
            "mountpoint": "/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/cores",
            "userrefs" : "-",
            "name": "zones/cores/8be21e2a-ce25-4eb2-b796-b36b274b5a25",
            "quota": 107374182400,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/cores/global": {
            "compression": "lz4",
            "creation": 1392846460,
            "mountpoint": "/zones/global/cores",
            "userrefs" : "-",
            "name": "zones/cores/global",
            "quota": 10737418240,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/dump": {
            "compression": "off",
            "creation": 1392846460,
            "mountpoint": "/dev/zvol/rdsk/zones/dump",
            "userrefs" : "-",
            "name": "zones/dump",
            "quota": "-",
            "recsize": "-",
            "refreservation": 0,
            "type": "volume",
            "volblocksize": 131072,
            "volsize": 2146435072,
            "zoned": "-"
          },
          "zones/opt": {
            "compression": "off",
            "creation": 1392846460,
            "mountpoint": "/zones/opt",
            "userrefs" : "-",
            "name": "zones/opt",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/swap": {
            "compression": "off",
            "creation": 1392846461,
            "mountpoint": "/dev/zvol/rdsk/zones/swap",
            "userrefs" : "-",
            "name": "zones/swap",
            "quota": "-",
            "recsize": "-",
            "refreservation": 2147483648,
            "type": "volume",
            "volblocksize": 8192,
            "volsize": 4294967296,
            "zoned": "-"
          },
          "zones/usbkey": {
            "compression": "off",
            "creation": 1392846460,
            "mountpoint": "/zones/usbkey",
            "userrefs" : "-",
            "name": "zones/usbkey",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          },
          "zones/var": {
            "compression": "off",
            "creation": 1392846460,
            "mountpoint": "/zones/var",
            "userrefs" : "-",
            "name": "zones/var",
            "quota": 0,
            "recsize": 131072,
            "refreservation": 0,
            "type": "filesystem",
            "volblocksize": "-",
            "volsize": "-",
            "zoned": "off"
          }
        },
        "mountpoints": {
          "/zones": "zones",
          "/zones/01b2c898-945f-11e1-a523-af1afbe22822":
              "zones/01b2c898-945f-11e1-a523-af1afbe22822",
          "/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25":
              "zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25",
          "/zones/archive": "zones/archive",
          "/zones/config": "zones/config",
          "/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/cores":
              "zones/cores/8be21e2a-ce25-4eb2-b796-b36b274b5a25",
          "/zones/global/cores": "zones/cores/global",
          "/dev/zvol/rdsk/zones/dump": "zones/dump",
          "/zones/opt": "zones/opt",
          "/dev/zvol/rdsk/zones/swap": "zones/swap",
          "/zones/usbkey": "zones/usbkey",
          "/zones/var": "zones/var"
        },
        "snapshots": {
          "zones/01b2c898-945f-11e1-a523-af1afbe22822": [
            {
              "snapname": "final",
              "dataset": "zones/01b2c898-945f-11e1-a523-af1afbe22822",
              "created_at": 1335967116
            }
          ]
        }
    };

    /*
     * this was taken from the output of:
     *
     * zfs list -H -p -t filesystem,snapshot,volume \
     *     -o compression,creation,mountpoint,name,quota,recsize,refreservation\
     *     ,type,userrefs,volblocksize,volsize,zoned
     *
     * from a system with only one zone and one image.
     */
    var lines = [
        'off	1392846460	/zones	zones	0	131072	0	'
            + 'filesystem	-	-	-	off',
        'off	1392846722	/zones/01b2c898-945f-11e1-a523-af1afbe22822	zones/'
            + '01b2c898-945f-11e1-a523-af1afbe22822	0	131072	0	'
            + 'filesystem	-	-	-	off',
        '-	1335967116	-	zones/01b2c898-945f-11e1-a523-af1afbe22822@'
            + 'final	-	-	-	snapshot	-	-	-	-',
        'off	1392939536	/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25	zones/'
            + '8be21e2a-ce25-4eb2-b796-b36b274b5a25	10737418240	131072	0	'
            + 'filesystem	-	-	-	off',
        'off	1392939536	/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/'
            + 'data	zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/data	0	'
            + '131072	0	filesystem	-	-	-	on',
        'lzjb	1392849677	/zones/archive	zones/archive	0	131072	0	'
            + 'filesystem	-	-	-	off',
        'off	1392846460	legacy	zones/config	0	131072	0	filesystem	'
            + '-	-	-	off',
        'lz4	1392846460	none	zones/cores	0	131072	0	filesystem	'
            + '-	-	-	off',
        'lz4	1392939536	/zones/8be21e2a-ce25-4eb2-b796-b36b274b5a25/'
            + 'cores	zones/cores/8be21e2a-ce25-4eb2-b796-b36b274b5a25	'
            + '107374182400	131072	0	filesystem	-	-	-	off',
        'lz4	1392846460	/zones/global/cores	zones/cores/global	'
            + '10737418240	131072	0	filesystem	-	-	-	off',
        'off	1392846460	-	zones/dump	-	-	0	volume	-	131072	'
            + '2146435072	-',
        'off	1392846460	legacy	zones/opt	0	131072	0	filesystem	'
            + '-	-	-	off',
        'off	1392846461	-	zones/swap	-	-	2147483648	volume	'
            + '-	8192	4294967296	-',
        'off	1392846460	legacy	zones/usbkey	0	131072	0	'
            + 'filesystem	-	-	-	off',
        'off	1392846460	legacy	zones/var	0	131072	0	filesystem	'
            + '-	-	-	off'
    ];

    var expected_args = [
        'list',
        '-H',
        '-p',
        '-t',
        'filesystem,snapshot,volume',
        '-o',
        'compression,creation,mountpoint,name,quota,recsize,refreservation,'
            + 'type,userrefs,volblocksize,volsize,zoned',
    ];

    var out = {};

    getDatasetsWrapper([], lines, out, function (err, dsobj) {
        t.equal(out.cmd, '/usr/sbin/zfs', 'zfs cmd is as expected');
        t.deepEqual(out.args, expected_args, 'zfs args are as expected');
        t.deepEqual(dsobj, expected_dsobj, 'dsobj parsed as expected');
        t.end();
    });
});
