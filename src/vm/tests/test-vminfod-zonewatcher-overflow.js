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

var execFile = require('child_process').execFile;
var f = require('util').format;

var assert = require('/usr/node/node_modules/assert-plus');
var bunyan = require('/usr/node/node_modules/bunyan');
var vasync = require('/usr/vm/node_modules/vasync');

var common = require('./common');
var vmadm = common.vmadm;

var ZoneWatcher = require('vminfod/zonewatcher').ZoneWatcher;
var log = bunyan.createLogger({
    level: 'trace',
    name: 'zonewatcher-test-dummy',
    streams: [ { stream: process.stderr, level: 'error' } ],
    serializers: bunyan.stdSerializers
});
var zonew;

var vmEvents = {};
var createdVms = [];

/* CONFIG */
var NUM_VMS = 10;
var NUM_RESTARTS_PER_VM = 25;
var STRAGGLER_WAIT = 5 * 1000;
// HIGH_WATER_MARK sets the highWaterMark for the lstream in ZoneeventWatcher.
// default is 16k! takes too long to get there, so we set to a lower value to
// ensure that we're going to overrun it with events.
var HIGH_WATER_MARK = 32;

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

test('create a ZoneWatcher object', function (t) {
    zonew = new ZoneWatcher({
        log: log,
        highWaterMark: HIGH_WATER_MARK
    });
    t.ok(zonew, 'created ZoneWatcher');

    zonew.on('event', function (evt) {
        assert.object(evt, 'evt');
        assert.uuid(evt.zonename, 'evt.zonename');
        assert.string(evt.newstate, 'evt.newstate');

        // Happens when the VM is deleted - use a custom event name
        if (evt.newstate === '') {
            evt.newstate = '_deleted';
        }

        if (!vmEvents.hasOwnProperty(evt.zonename)) {
            vmEvents[evt.zonename] = {};
        }
        if (!vmEvents[evt.zonename].hasOwnProperty(evt.newstate)) {
            vmEvents[evt.zonename][evt.newstate] = 0;
        }
        vmEvents[evt.zonename][evt.newstate]++;
    });

    zonew.once('ready', function () {
        t.ok(true, 'ZoneWatcher ready');
        t.end();
    });
});

test('create VMs', function (t) {
    var i;
    var vmsToCreate = [];

    for (i = 0; i < NUM_VMS; i++) {
        vmsToCreate.push(i);
    }

    function _createVm(idx, cb) {
        assert.number(idx, 'idx');
        assert.func(cb, 'cb');

        var payload = {
            alias: 'test-vminfod-zonewatcher-overflow-' + idx,
            autoboot: true,
            brand: 'joyent-minimal',
            image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822',
            do_not_inventory: true,
            quota: 10
        };
        var opts = {
            log: log,
            stdin: JSON.stringify(payload)
        };

        vmadm(['create'], opts, function (err, stdio) {
            var match;
            var uuid;

            log.debug({err: err, stdio: stdio}, 'vmadm create');

            match = stdio.stderr /* JSSTYLED */
                .match(/Successfully created VM ([0-9a-f\-]*)/);
            if (match) {
                uuid = match[1];
                assert.uuid(uuid, 'uuid');
                createdVms.push(uuid);
            } else {
                t.ok(false, 'failed to get uuid from new VM');
            }

            common.ifError(t, err, f('create VM %s (%s)', uuid, payload.alias));
            cb(err);
        });
    }


    vasync.forEachParallel({
        inputs: vmsToCreate,
        func: _createVm
    }, function _afterForEachParallel(err) {
        common.ifError(t, err, 'VMs should have been created successfully');
        t.end();
    });
});

test('restart VMs', function (t) {
    /*
     * restart with zoneadm because we're doing this fast and want to test
     * sysevents and not vminfod.
     */
    function _restartVm(o, cb) {
        assert.object(o, 'o');
        assert.number(o.idx, 'o.idx');
        assert.uuid(o.uuid, 'o.uuid');
        assert.func(cb, 'cb');

        var idx = o.idx;
        var uuid = o.uuid;
        var args = ['-z', uuid, 'reboot', '-X'];
        var cmd = '/usr/sbin/zoneadm';

        execFile(cmd, args, function _onExecFile(err, stdout, stderr) {
            common.ifError(t, err, f('reboot VM %s (%d)',
                uuid, idx));

            cb(err);
        });
    }

    function _multiRestartVm(uuid, cb) {
        assert.uuid(uuid, 'uuid');
        assert.func(cb, 'cb');

        var i = 0;

        vasync.whilst(
            function _whilstTest() {
                return (i++ < NUM_RESTARTS_PER_VM);
            },
            function _whilstIterate(next) {
                var opts = {
                    uuid: uuid,
                    idx: i
                };
                _restartVm(opts, next);
            },
            function _whilstDone(err) {
                cb(err);
            }
        );
    }

    vasync.forEachParallel({
        inputs: createdVms,
        func: _multiRestartVm
    }, function _afterForEachParallel(err) {
        common.ifError(t, err, 'done restarting');
        t.end();
    });
});

test('delete VMs', function (t) {
    function _deleteVm(uuid, cb) {
        assert.uuid(uuid, 'uuid');
        assert.func(cb, 'cb');

        vmadm(['delete', uuid], {log: log}, function _vmadmDeleteCb(err) {
            common.ifError(t, err, f('delete VM %s', uuid));
            cb(err);
        });
    }

    vasync.forEachParallel({
        inputs: createdVms,
        func: _deleteVm
    }, function _afterForEachParallel(err) {
        common.ifError(t, err, 'done deleting');
        t.end();
    });
});

test('stop zone watcher', function (t) {
    setTimeout(function () {
        zonew.stop();
        t.ok(true, 'ZoneWatcher stopped');
        t.end();
    }, STRAGGLER_WAIT);
});

test('check final state', function (t) {
    var statesSeen = {};
    var statesExpected;

    /*
     * At this point, the vmEvents object will look something like this:
     * {
     *   "<uuid>": {
     *     "initialized": 1,
     *     "running": 4,
     *     "configured": 2,
     *     ...
     *  },
     *  "<uuid>": {
     *    ...
     *  }
     * };
     */

    /*
     * Loop each key in the vmEvents object and ensure that the same number of
     * events were seen for each vm created as a port of this test.  Then,
     * store the values in a new object at the root.
     */
    t.ok(true, f('ensuring events seen for %d VMs are the same',
        createdVms.length));
    createdVms.forEach(function (uuid) {
        var events = vmEvents[uuid];

        assert.object(events, f('events (%s)', uuid));

        Object.keys(events).forEach(function (state) {
            if (!statesSeen.hasOwnProperty(state)) {
                statesSeen[state] = events[state];
                return;
            }

            if (statesSeen[state] !== events[state]) {
                t.ok(false, f('VM %s had %d %s events, expectd %d',
                    uuid, events[state], state, statesSeen[state]));
            }
        });
    });

    /*
     * Because we know the number of VMs created and how many times each was
     * restarted, we know which states to expect and how many.  This is meant
     * to a low estimate, or a minimum - there should be at least this many but
     * possibly more.
     */
    statesExpected = {
        configured: 2,
        incomplete: 2,
        installed: 1,
        initialized: 1 + NUM_RESTARTS_PER_VM,
        uninitialized: 1 + NUM_RESTARTS_PER_VM,
        running: 1 + NUM_RESTARTS_PER_VM,
        ready: 2 + NUM_RESTARTS_PER_VM,
        shutting_down: 2 + NUM_RESTARTS_PER_VM,
        _deleted: 1
    };

    /*
     * Ensure that we have seen at least as many state events as we expected
     * per VM
     */
    t.ok(true, 'ensuring eventsSeen >= eventsExpected');
    Object.keys(statesExpected).forEach(function (state) {
        t.ok(statesSeen[state] >= statesExpected[state],
            f('statesSeen[%s] %d >= statesExpected[%s] %d',
            state, statesSeen[state], state, statesExpected[state]));
    });

    t.end();
});
