// Copyright 2014 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var async = require('async');
var bunyan = require('bunyan');
var execFile = require('child_process').execFile;
var fs = require('fs');
var path = require('path');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var ZpoolWatcher = require('vmevent/zpoolwatcher').ZpoolWatcher;
var log = bunyan.createLogger({
        level: 'trace',
        name: 'zpoolwatcher-test-dummy',
        streams: [ { stream: process.stderr, level: 'trace' } ],
        serializers: bunyan.stdSerializers
});
var testdir = '/tmp/' + process.pid;

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    log.debug(cmd + ' ' + args.join(' '));
    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

test('watch pool and create dataset, set quota, snapshot it then delete -r',
    function (t) {
        var saw_ds_destroy = false;
        var saw_snap_destroy = false;
        var zpoolw = new ZpoolWatcher({log: log});

        function finish() {
            zpoolw.shutdown();
            t.end();
        }

        zpoolw.on('ready', function (evt) {
            t.equal(evt.message, 'dtrace is running', 'dtrace is running');
            zfs(['create', 'zones/this_is_a_test'], function (err, stdio) {
                t.ok(!err, (err ? err.message : 'created dataset'));
                if (err) {
                    finish();
                }
            });
        });

        zpoolw.on('create', function (evt) {
            t.ok(true, 'saw create event: ' + JSON.stringify(evt));
            zfs(['set', 'quota=50M', 'zones/this_is_a_test'],
                function (err, stdio) {
                    t.ok(!err, (err ? err.message : 'created snapshot'));
                }
            );
        });

        zpoolw.on('set', function (evt) {
            t.ok(true, 'saw set event: ' + JSON.stringify(evt));
            zfs(['snapshot', 'zones/this_is_a_test@foo'],
                function (err, stdio) {
                    t.ok(!err, (err ? err.message : 'created snapshot'));
                }
            );
        });

        zpoolw.on('snapshot', function (evt) {
            t.ok(true, 'saw snapshot event: ' + JSON.stringify(evt));
            zfs(['destroy', '-r', 'zones/this_is_a_test'],
                function (err, stdio) {
                    t.ok(!err, (err ? err.message : 'destroyed dataset'));
                }
            );
        });

        zpoolw.on('destroy', function (evt) {
            if (evt.dsname === 'zones/this_is_a_test') {
                saw_ds_destroy = true;
            } else if (evt.dsname === 'zones/this_is_a_test@foo') {
                saw_snap_destroy = true;
            } else {
                throw new Error('unexpected destroy of ' + evt.dsname);
            }

            // XXX check in interval instead?
            if (saw_ds_destroy && saw_snap_destroy) {
                finish();
            }
        });

        t.ok(true, 'created watcher');
    }
);
