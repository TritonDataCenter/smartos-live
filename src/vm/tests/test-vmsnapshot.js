/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var execFile = require('child_process').execFile;
var fs = require('fs');
var log = bunyan.createLogger({level: 'debug', name: 'test-vmsnapshot', serializers: bunyan.stdSerializers});
var path = require('path');
var vmsnapshot = require('/usr/vm/node_modules/vmsnapshot');

// save some typing
var createSnapshot = vmsnapshot.createSnapshot;

var created_datasets = [];
var uuid_A;
var uuid_B;
var uuid_C;
var vmobj_A;
var vmobj_B;
var vmobj_C;

require('nodeunit-plus');

function zfs(args, log, callback)
{
    var cmd = '/usr/sbin/zfs';

    assert(log, 'no logger passed to zfs()');

    log.debug(cmd + ' ' + args.join(' '));
    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

function genUUID(callback)
{
    execFile('/usr/bin/uuid', ['-v', '4'], function (err, stdout, stderr) {
        var uuid;

        if (err) {
            callback(err);
            return;
        }

        // chomp trailing spaces and newlines
        uuid = stdout.toString().replace(/\s+$/g, '');
        callback(null, uuid);
    });
}

function createDataset(t, dataset, options, callback)
{
    var opts = ['create'];

    // this has us end up with:
    // zfs create [<options>] <dataset>
    opts = opts.concat(options).concat(dataset);

    zfs(opts, log, function (err) {
        t.ok(!err, 'created ' + dataset + ': ' + (err ? err.message : dataset));
        created_datasets.push(dataset);
        callback(err);
    });
}

test('create zfs datasets for fake zones', function (t) {
    async.waterfall([
        function (cb) {
            genUUID(function (err, uuid) {
                t.ok(!err, 'generated uuid_A: ' + (err ? err.message : uuid));
                uuid_A = uuid;
                cb(err);
            });
        }, function (cb) {
            genUUID(function (err, uuid) {
                t.ok(!err, 'generated uuid_B: ' + (err ? err.message : uuid));
                uuid_B = uuid;
                cb(err);
            });
        }, function (cb) {
            genUUID(function (err, uuid) {
                t.ok(!err, 'generated uuid_C: ' + (err ? err.message : uuid));
                uuid_C = uuid;
                cb(err);
            });
        }, function (cb) {
            // create zones/<uuid-A> (fake zoneroot)
            createDataset(t, 'zones/' + uuid_A, [], cb);
        }, function (cb) {
            // create zones/<uuid-B> (fake zoneroot)
            createDataset(t, 'zones/' + uuid_B, [], cb);
        }, function (cb) {
            // create zones/<uuid-B>/data (fake delegated)
            createDataset(t, 'zones/' + uuid_B + '/data', ['-o', 'zoned=on'], cb);
        }, function (cb) {
            // create zones/<uuid-C> (fake zoneroot)
            createDataset(t, 'zones/' + uuid_C, ['-o', 'quota=10G'], cb);
        }, function (cb) {
            // create zones/<uuid-C>-disk0 (fake OS disk)
            createDataset(t, 'zones/' + uuid_C + '-disk0',
                ['-o', 'refreservation=1024M', '-V', '1024M'], cb);
        }, function (cb) {
            // create zones/<uuid-C>-disk1 (fake data disk)
            createDataset(t, 'zones/' + uuid_C + '-disk1',
                ['-V', '1024M'], cb);
        }
    ], function (err) {
        t.end();
    });
});

test('create snapshot of zone A', function (t) {
    vmobj_A = {
        brand: 'joyent',
        datasets: [],
        snapshots: [],
        uuid: uuid_A,
        zfs_filesystem: 'zones/' + uuid_A,
        zone_state: 'running',
        zonename: uuid_A,
        zonepath: '/zones/' + uuid_A
    };

    createSnapshot(vmobj_A, 'foo', {log: log}, function (err) {
        t.ok(!err, 'expected snapshot success: '
            + (err ? err.message : 'success'));
        t.end();
    });
});

test('create duplicate snapshot of zone A', function (t) {
    vmobj_A.snapshots = [
        {
          "name": "foo",
          "created_at": "2014-03-09T21:40:45.000Z"
        }
    ];

    createSnapshot(vmobj_A, 'foo', {log: log}, function (err) {
        // this is expected to fail as snapshot 'foo' already exists
        t.ok(err, 'expected failure creating duplicate snapshot: '
            + (err ? err.message : 'succeeded (should have failed)'));
        t.end();
    });
});

test('create snapshot of zone B', function (t) {
    vmobj_B = {
        brand: 'joyent',
        datasets: [
            'zones/' + uuid_B + '/data'
        ],
        snapshots: [],
        uuid: uuid_B,
        zfs_filesystem: 'zones/' + uuid_B,
        zone_state: 'running',
        zonename: uuid_B,
        zonepath: '/zones/' + uuid_B
    };

    createSnapshot(vmobj_B, 'foo', {log: log}, function (err) {
        t.ok(!err, 'expected snapshot success: '
            + (err ? err.message : 'success'));
        t.end();
    });
});

test('create snapshot of zone C', function (t) {
    vmobj_C = {
        brand: 'kvm',
        disks: [
            {zfs_filesystem: 'zones/' + uuid_C + '-disk0'},
            {zfs_filesystem: 'zones/' + uuid_C + '-disk1'}
        ],
        snapshots: [],
        uuid: uuid_C,
        zfs_filesystem: 'zones/' + uuid_C,
        zone_state: 'running',
        zonename: uuid_C,
        zonepath: '/zones/' + uuid_C
    };

    createSnapshot(vmobj_C, 'foo', {log: log}, function (err) {
        t.ok(!err, 'expected snapshot success: '
            + (err ? err.message : 'success'));
        t.end();
    });
});

test('destroy created zfs datasets', function (t) {
    async.eachSeries(created_datasets.reverse(), function (ds, cb) {
        zfs(['destroy', '-f', '-r', ds], log, function (err) {
            t.ok(!err, 'destroyed ' + ds + ': ' + (err ? err.message : ds));
            cb(err);
        });
    }, function (err) {
        t.ok(!err, 'destroy all datasets: ' + (err ? err.message : 'success'));
        t.end();
    });
});
