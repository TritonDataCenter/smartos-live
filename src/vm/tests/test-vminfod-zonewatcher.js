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
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

var bunyan = require('/usr/node/node_modules/bunyan');

var common = require('./common');
var vmadm = common.vmadm;

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
var zonew;

test('create a ZoneWatcher object', function (t) {
    zonew = new ZoneWatcher({log: log});
    t.ok(zonew, 'created ZoneWatcher');
    zonew.once('ready', function () {
        t.ok(true, 'ZoneWatcher ready');
        t.end();
    });
});

test('create zone (autoboot=true) and stop and destroy',
    function (t) {
        var payload;
        var running = [];
        var saw_running = false;
        var vm_uuid = null;

        payload = {
            autoboot: true,
            brand: 'joyent-minimal',
            do_not_inventory: true,
            image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822'
        };

        function finish() {
            zonew.stop();
            t.end();
        }

        function onRunning() {
            vmadm(['stop', vm_uuid, '-F'], {log: log}, function (err, stdio) {
                t.ok(!err, (err ? err.message : 'stopped VM'));
                log.debug({err: err, stdio: stdio}, 'vmadm stop');
            });
        }

        zonew.on('event', function (evt) {
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

                vmadm(['delete', vm_uuid], {log: log}, function (err, stdio) {
                    t.ok(!err, (err ? err.message : 'deleted VM'));
                    log.debug({err: err, stdio: stdio}, 'vmadm delete');
                    finish();
                });
            }
        });

        /* start the ball rolling by creating a VM */
        vmadm(['create'], {log: log, stdin: JSON.stringify(payload)},
            function (err, stdio) {

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
