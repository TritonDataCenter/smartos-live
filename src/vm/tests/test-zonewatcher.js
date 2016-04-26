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
 * Copyright 2015, Joyent, Inc.
 */

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/node/node_modules/bunyan');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var ZoneWatcher = require('vminfod/zonewatcher').ZoneWatcher;
var log = bunyan.createLogger({
        level: 'trace',
        name: 'zonewatcher-test-dummy',
        streams: [ { stream: process.stderr, level: 'error' } ],
        serializers: bunyan.stdSerializers
});
var testdir = '/tmp/' + process.pid;

function vmadm(args, stdin, callback)
{
    var buffers = {stdout: '', stderr: ''};
    var child;
    var stderr = [];
    var stdout = [];

    child = spawn('/usr/vm/sbin/vmadm', args, {stdio: 'pipe'});
    log.debug('vmadm running with pid ' + child.pid);

    if (stdin) {
        child.stdin.write(stdin);
    }

    child.stdin.end();

    child.stdout.on('data', function (data) {
        lineChunk(data, 'stdout', function (chunk) {
            stdout.push(chunk);
        });
    });

    child.stderr.on('data', function (data) {
        lineChunk(data, 'stderr', function (chunk) {
            stderr.push(chunk);
        });
    });

    child.on('close', function (code, signal) {
        var err = null;
        var msg;

        msg = 'vmadm ' + child.pid + ' exited. code: ' + code
            + ' signal: ' + signal;

        log.warn(msg);

        if (code !== 0) {
            err = new Error(msg);
        }

        callback(err, {stdout: stdout.join('\n'), stderr: stderr.join('\n')});
    });

    function lineChunk(data, buffer, handler) {
        var chunk;
        var chunks;

        buffers[buffer] += data.toString();
        chunks = buffers[buffer].split('\n');

        while (chunks.length > 1) {
            chunk = chunks.shift();
            handler(chunk);
        }
        buffers[buffer] = chunks.pop(); // remainder
    }
}

test('create zone (autoboot=true) and stop and destroy',
    function (t) {
        var payload;
        var running = [];
        var saw_running = false;
        var vm_uuid = null;
        var zonew = new ZoneWatcher({log: log});

        payload = {
            autoboot: true,
            brand: 'joyent-minimal',
            do_not_inventory: true,
            image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822'
        };

        function finish() {
            zonew.shutdown();
            t.end();
        }

        function onRunning() {
            vmadm(['stop', vm_uuid, '-F'], null, function (err, stdio) {
                t.ok(!err, (err ? err.message : 'stopped VM'));
                log.debug({err: err, stdio: stdio}, 'vmadm stop');
            });
        }

        zonew.on('change', function (evt) {
            log.debug('saw change (looking for ' + vm_uuid + '): '
                + JSON.stringify(evt));
            if (evt.newstate === 'running') {
                saw_running = true;
                running.push(evt.zonename);
                if (vm_uuid) {
                    onRunning();
                }
            } else if (evt.newstate == 'uninitialized'
                && vm_uuid && saw_running) {

                vmadm(['delete', vm_uuid], null, function (err, stdio) {
                    t.ok(!err, (err ? err.message : 'deleted VM'));
                    log.debug({err: err, stdio: stdio}, 'vmadm delete');
                    finish();
                });
            }
        });

        /* start the ball rolling by creating a VM */
        vmadm(['create'], JSON.stringify(payload), function (err, stdio) {
            var match;
            t.ok(!err, (err ? err.message : 'created VM'));
            log.debug({err: err, stdio: stdio}, 'vmadm create');

            match = stdio.stderr /* JSSTYLED */
                .match(/Successfully created VM ([0-9a-f\-]*)/);
            if (match) {
                vm_uuid = match[1];
            } else {
                t.ok(false, 'failed to get uuid from new VM');
                finish();
                return;
            }

            if (running.indexOf(vm_uuid) !== -1) {
                onRunning();
            }
        });
    }
);
