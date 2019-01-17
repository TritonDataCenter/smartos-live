/*
 * Copyright (c) 2019, Joyent, Inc.
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

test('test with one zone, one bhyve VM, and four images', function (t) {
  var expected_dsobj = {
    "datasets": {
      "zones": {
        "compression": "off",
        "creation": 1545080564,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones",
        "name": "zones",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 540672,
        "zoned": "off"
      },
      "zones/0aa46416-2c8d-658d-cb21-eba504d46270": {
        "compression": "off",
        "creation": 1545085213,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/0aa46416-2c8d-658d-cb21-eba504d46270",
        "name": "zones/0aa46416-2c8d-658d-cb21-eba504d46270",
        "quota": 5368709120,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 13321216,
        "zoned": "off"
      },
      "zones/1f11188a-c71c-11e8-83d4-370e2a698b16": {
        "compression": "off",
        "creation": 1545080882,
        "filesystem_limit": "-",
        "mountpoint": "/dev/zvol/rdsk/zones/1f11188a-c71c-11e8-83d4-370e2a698b16",
        "name": "zones/1f11188a-c71c-11e8-83d4-370e2a698b16",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "volume",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": 8192,
        "volsize": 10737418240,
        "written": 0,
        "zoned": "-"
      },
      "zones/1f11188a-c71c-11e8-83d4-370e2a698b16@final": {
        "compression": "-",
        "creation": 1538578209,
        "filesystem_limit": "-",
        "mountpoint": "/zones/1f11188a-c71c-11e8-83d4-370e2a698b16@final",
        "name": "zones/1f11188a-c71c-11e8-83d4-370e2a698b16@final",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": "-",
        "snapshot_limit": "-",
        "type": "snapshot",
        "usedbysnapshots": "-",
        "userrefs": 0,
        "volblocksize": "-",
        "volsize": "-",
        "written": 1385337856,
        "zoned": "-"
      },
      "zones/2382d24e-c75a-11e8-992b-53577424bc1a": {
        "compression": "off",
        "creation": 1545081043,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/2382d24e-c75a-11e8-992b-53577424bc1a",
        "name": "zones/2382d24e-c75a-11e8-992b-53577424bc1a",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 77312,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 50176,
        "zoned": "off"
      },
      "zones/2382d24e-c75a-11e8-992b-53577424bc1a@final": {
        "compression": "-",
        "creation": 1538605005,
        "filesystem_limit": "-",
        "mountpoint": "/zones/2382d24e-c75a-11e8-992b-53577424bc1a@final",
        "name": "zones/2382d24e-c75a-11e8-992b-53577424bc1a@final",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": "-",
        "snapshot_limit": "-",
        "type": "snapshot",
        "usedbysnapshots": "-",
        "userrefs": 0,
        "volblocksize": "-",
        "volsize": "-",
        "written": 98426880,
        "zoned": "-"
      },
      "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d": {
        "compression": "off",
        "creation": 1545081081,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d",
        "name": "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 0,
        "zoned": "off"
      },
      "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d@final": {
        "compression": "-",
        "creation": 1522855572,
        "filesystem_limit": "-",
        "mountpoint": "/zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d@final",
        "name": "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d@final",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": "-",
        "snapshot_limit": "-",
        "type": "snapshot",
        "usedbysnapshots": "-",
        "userrefs": 0,
        "volblocksize": "-",
        "volsize": "-",
        "written": 441172480,
        "zoned": "-"
      },
      "zones/66116621-e669-4f81-d668-bee43fd3b720": {
        "compression": "off",
        "creation": 1545085052,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/66116621-e669-4f81-d668-bee43fd3b720",
        "name": "zones/66116621-e669-4f81-d668-bee43fd3b720",
        "quota": 12705071104,
        "recsize": 131072,
        "refquota": 1073741824,
        "refreservation": 1073741824,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 163840,
        "zoned": "off"
      },
      "zones/66116621-e669-4f81-d668-bee43fd3b720/disk0": {
        "compression": "off",
        "creation": 1545085052,
        "filesystem_limit": "-",
        "mountpoint": "/dev/zvol/rdsk/zones/66116621-e669-4f81-d668-bee43fd3b720/disk0",
        "name": "zones/66116621-e669-4f81-d668-bee43fd3b720/disk0",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": 11075584000,
        "snapshot_limit": 18446744073709552000,
        "type": "volume",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": 8192,
        "volsize": 10737418240,
        "written": 22599680,
        "zoned": "-"
      },
      "zones/66116621-e669-4f81-d668-bee43fd3b720/disk1": {
        "compression": "off",
        "creation": 1545085052,
        "filesystem_limit": "-",
        "mountpoint": "/dev/zvol/rdsk/zones/66116621-e669-4f81-d668-bee43fd3b720/disk1",
        "name": "zones/66116621-e669-4f81-d668-bee43fd3b720/disk1",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": 555745280,
        "snapshot_limit": 18446744073709552000,
        "type": "volume",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": 8192,
        "volsize": 536870912,
        "written": 12288,
        "zoned": "-"
      },
      "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec": {
        "compression": "off",
        "creation": 1545081027,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec",
        "name": "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 122880,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 99328,
        "zoned": "off"
      },
      "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec@final": {
        "compression": "-",
        "creation": 1538605331,
        "filesystem_limit": "-",
        "mountpoint": "/zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec@final",
        "name": "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec@final",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": "-",
        "snapshot_limit": "-",
        "type": "snapshot",
        "usedbysnapshots": "-",
        "userrefs": 0,
        "volblocksize": "-",
        "volsize": "-",
        "written": 641669120,
        "zoned": "-"
      },
      "zones/archive": {
        "compression": "lzjb",
        "creation": 1545080673,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/archive",
        "name": "zones/archive",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/config": {
        "compression": "off",
        "creation": 1545080570,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/config",
        "name": "zones/config",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 48640,
        "zoned": "off"
      },
      "zones/cores": {
        "compression": "gzip",
        "creation": 1545080638,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "none",
        "name": "zones/cores",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/cores/0aa46416-2c8d-658d-cb21-eba504d46270": {
        "compression": "gzip",
        "creation": 1545085213,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/0aa46416-2c8d-658d-cb21-eba504d46270/cores",
        "name": "zones/cores/0aa46416-2c8d-658d-cb21-eba504d46270",
        "quota": 107374182400,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/cores/66116621-e669-4f81-d668-bee43fd3b720": {
        "compression": "gzip",
        "creation": 1545085053,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/66116621-e669-4f81-d668-bee43fd3b720/cores",
        "name": "zones/cores/66116621-e669-4f81-d668-bee43fd3b720",
        "quota": 107374182400,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/cores/global": {
        "compression": "gzip",
        "creation": 1545080638,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/global/cores",
        "name": "zones/cores/global",
        "quota": 10737418240,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/dump": {
        "compression": "off",
        "creation": 1545080569,
        "filesystem_limit": "-",
        "mountpoint": "/dev/zvol/rdsk/zones/dump",
        "name": "zones/dump",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "volume",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": 131072,
        "volsize": 1073741824,
        "written": 1073847296,
        "zoned": "-"
      },
      "zones/opt": {
        "compression": "off",
        "creation": 1545080570,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/opt",
        "name": "zones/opt",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 23552,
        "zoned": "off"
      },
      "zones/swap": {
        "compression": "off",
        "creation": 1545080570,
        "filesystem_limit": "-",
        "mountpoint": "/dev/zvol/rdsk/zones/swap",
        "name": "zones/swap",
        "quota": "-",
        "recsize": "-",
        "refquota": "-",
        "refreservation": 17718312960,
        "snapshot_limit": 18446744073709552000,
        "type": "volume",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": 8192,
        "volsize": 17178820608,
        "written": 12288,
        "zoned": "-"
      },
      "zones/usbkey": {
        "compression": "off",
        "creation": 1545080570,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/usbkey",
        "name": "zones/usbkey",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 32256,
        "zoned": "off"
      },
      "zones/var": {
        "compression": "off",
        "creation": 1545080570,
        "filesystem_limit": 18446744073709552000,
        "mountpoint": "/zones/var",
        "name": "zones/var",
        "quota": 0,
        "recsize": 131072,
        "refquota": 0,
        "refreservation": 0,
        "snapshot_limit": 18446744073709552000,
        "type": "filesystem",
        "usedbysnapshots": 0,
        "userrefs": "-",
        "volblocksize": "-",
        "volsize": "-",
        "written": 1666048,
        "zoned": "off"
      }
    },
    "mountpoints": {
     '/zones': 'zones',
     '/zones/0aa46416-2c8d-658d-cb21-eba504d46270': 'zones/0aa46416-2c8d-658d-cb21-eba504d46270',
     '/dev/zvol/rdsk/zones/1f11188a-c71c-11e8-83d4-370e2a698b16': 'zones/1f11188a-c71c-11e8-83d4-370e2a698b16',
     '/zones/2382d24e-c75a-11e8-992b-53577424bc1a': 'zones/2382d24e-c75a-11e8-992b-53577424bc1a',
     '/zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d': 'zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d',
     '/zones/66116621-e669-4f81-d668-bee43fd3b720': 'zones/66116621-e669-4f81-d668-bee43fd3b720',
     '/dev/zvol/rdsk/zones/66116621-e669-4f81-d668-bee43fd3b720/disk0': 'zones/66116621-e669-4f81-d668-bee43fd3b720/disk0',
     '/dev/zvol/rdsk/zones/66116621-e669-4f81-d668-bee43fd3b720/disk1': 'zones/66116621-e669-4f81-d668-bee43fd3b720/disk1',
     '/zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec': 'zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec',
     '/zones/archive': 'zones/archive',
     '/zones/config': 'zones/config',
     '/zones/0aa46416-2c8d-658d-cb21-eba504d46270/cores': 'zones/cores/0aa46416-2c8d-658d-cb21-eba504d46270',
     '/zones/66116621-e669-4f81-d668-bee43fd3b720/cores': 'zones/cores/66116621-e669-4f81-d668-bee43fd3b720',
     '/zones/global/cores': 'zones/cores/global',
     '/dev/zvol/rdsk/zones/dump': 'zones/dump',
     '/zones/opt': 'zones/opt',
     '/dev/zvol/rdsk/zones/swap': 'zones/swap',
     '/zones/usbkey': 'zones/usbkey',
     '/zones/var': 'zones/var'
    },
      "snapshots": {
      "zones/1f11188a-c71c-11e8-83d4-370e2a698b16": [
      {
        "snapname": "final",
        "dataset": "zones/1f11188a-c71c-11e8-83d4-370e2a698b16",
        "created_at": 1538578209,
        "size": 1385337856
      }
      ],
      "zones/2382d24e-c75a-11e8-992b-53577424bc1a": [
      {
        "snapname": "final",
        "dataset": "zones/2382d24e-c75a-11e8-992b-53577424bc1a",
        "created_at": 1538605005,
        "size": 98426880
      }
      ],
      "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d": [
      {
        "snapname": "final",
        "dataset": "zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d",
        "created_at": 1522855572,
        "size": 441172480
      }
      ],
      "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec": [
      {
        "snapname": "final",
        "dataset": "zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec",
        "created_at": 1538605331,
        "size": 641669120
      }
      ]
    }
   };

    /*
     * this was taken from the output of:
     *
     * zfs list -H -p -t filesystem,snapshot,volume \
     *     -o compression,creation,filesystem_limit,mountpoint,name,quota,\
     *     recsize,refquota,refreservation,snapshot_limit,type,usedbynapshots\
     *     userrefs,volblocksize,volsize,written,zoned
     *
     * from a system with one smartos zone, one bhyve zone and 4 installed
     * images.
     */
    var lines = [
    'off	1545080564	18446744073709551615	/zones	zones	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	540672	off',
    'off	1545085213	18446744073709551615	/zones/0aa46416-2c8d-658d-cb21-eba504d46270	zones/0aa46416-2c8d-658d-cb21-eba504d46270	5368709120	131072	0	0	18446744073709551615	filesystem	0	-	-	-	13321216	off',
    'off	1545080882	-	-	zones/1f11188a-c71c-11e8-83d4-370e2a698b16	-	-	-	0	18446744073709551615	volume	0	-	8192	10737418240	0	-',
    '-	1538578209	-	-	zones/1f11188a-c71c-11e8-83d4-370e2a698b16@final	-	-	-	-	-	snapshot	-	0	-	-	1385337856	-',
    'off	1545081043	18446744073709551615	/zones/2382d24e-c75a-11e8-992b-53577424bc1a	zones/2382d24e-c75a-11e8-992b-53577424bc1a	0	131072	0	0	18446744073709551615	filesystem	77312	-	-	-	50176	off',
    '-	1538605005	-	-	zones/2382d24e-c75a-11e8-992b-53577424bc1a@final	-	-	-	-	-	snapshot	-	0	-	-	98426880	-',
    'off	1545081081	18446744073709551615	/zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d	zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	0	off',
    '-	1522855572	-	-	zones/63d6e664-3f1f-11e8-aef6-a3120cf8dd9d@final	-	-	-	-	-	snapshot	-	0	-	-	441172480	-',
    'off	1545085052	18446744073709551615	/zones/66116621-e669-4f81-d668-bee43fd3b720	zones/66116621-e669-4f81-d668-bee43fd3b720	12705071104	131072	1073741824	1073741824	18446744073709551615	filesystem	0	-	-	-	163840	off',
    'off	1545085052	-	-	zones/66116621-e669-4f81-d668-bee43fd3b720/disk0	-	-	-	11075584000	18446744073709551615	volume	0	-	8192	10737418240	22599680	-',
    'off	1545085052	-	-	zones/66116621-e669-4f81-d668-bee43fd3b720/disk1	-	-	-	555745280	18446744073709551615	volume	0	-	8192	536870912	12288	-',
    'off	1545081027	18446744073709551615	/zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec	zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec	0	131072	0	0	18446744073709551615	filesystem	122880	-	-	-	99328	off',
    '-	1538605331	-	-	zones/6a449f7c-c75b-11e8-a87d-6fac326c57ec@final	-	-	-	-	-	snapshot	-	0	-	-	641669120	-',
    'lzjb	1545080673	18446744073709551615	/zones/archive	zones/archive	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'off	1545080570	18446744073709551615	legacy	zones/config	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	48640	off',
    'gzip	1545080638	18446744073709551615	none	zones/cores	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'gzip	1545085213	18446744073709551615	/zones/0aa46416-2c8d-658d-cb21-eba504d46270/cores	zones/cores/0aa46416-2c8d-658d-cb21-eba504d46270	107374182400	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'gzip	1545085053	18446744073709551615	/zones/66116621-e669-4f81-d668-bee43fd3b720/cores	zones/cores/66116621-e669-4f81-d668-bee43fd3b720	107374182400	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'gzip	1545080638	18446744073709551615	/zones/global/cores	zones/cores/global	10737418240	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'off	1545080569	-	-	zones/dump	-	-	-	0	18446744073709551615	volume	0	-	131072	1073741824	1073847296	-',
    'off	1545080570	18446744073709551615	legacy	zones/opt	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	23552	off',
    'off	1545080570	-	-	zones/swap	-	-	-	17718312960	18446744073709551615	volume	0	-	8192	17178820608	12288	-',
    'off	1545080570	18446744073709551615	legacy	zones/usbkey	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	32256	off',
    'off	1545080570	18446744073709551615	legacy	zones/var	0	131072	0	0	18446744073709551615	filesystem	0	-	-	-	1666048	off'
    ];

    var expected_args = [
        'list',
        '-H',
        '-p',
        '-t',
        'filesystem,snapshot,volume',
        '-o',
        'compression,creation,filesystem_limit,mountpoint,name,quota,'
            + 'recsize,refquota,refreservation,snapshot_limit,type,'
            + 'usedbysnapshots,userrefs,volblocksize,volsize,written,zoned',
        '-r'
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
