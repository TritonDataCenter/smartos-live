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
 * Copyright (c) 2019, Joyent, Inc.
 *
 */

var assert = require('/usr/node/node_modules/assert-plus');
var common = require('./common');
var jsprim = require('/usr/vm/node_modules/jsprim');
var libuuid = require('/usr/node/node_modules/uuid');
var sprintf = require('/usr/node/node_modules/sprintf').sprintf;
var utils = require('/usr/vm/node_modules/utils');
var vasync = require('/usr/vm/node_modules/vasync');
var VM = require('/usr/vm/node_modules/VM');
var vminfod = require('/usr/vm/node_modules/vminfod/client');
var vmtest = require('../common/vmtest.js');
var zonecfg = require('/usr/vm/node_modules/zonecfg');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var log = createLogger();

/*
 * nodeunit-plus executes the callback specified by before() before each test
 * is run and executes the callback specified by after() after each test is run.
 * These callbacks ensure that vmobj is initialized to undefined prior to each
 * test and that any VM that was created by the test is deleted after the test
 * completes.
 *
 * Tests that create a VM should be setting vmobj so that the after() hook can
 * clean up the VM when the test finishes or gives up.  If a test uses vmobj
 * then deletes the VM on its own, it should set vmobj to undefined.
 */
var vmobj;

before(function _before(cb) {
    assert.func(cb, 'cb');
    vmobj = undefined;
    cb();
});

after(function _after(cb) {
    assert.func(cb, 'cb');
    if (!vmobj) {
        cb();
        return;
    }
    VM.delete(vmobj.uuid, {}, function _delete_cb(err) {
        if (err) {
            console.log(sprintf('Could not delete vm %s: %s', vmobj.uuid,
                err.message));
        }
        vmobj = undefined;
        cb();
    });
});

/*
 * For use at the beginning of vasync.waterfall.  The next task (and presumably
 * remaining tasks) is expected to take args (t, next).
 *
 * Creates a VM with the specified payload and stores a skeleton vmobj that
 * contains at least vmobj.uuid.
 */
function createVM(t, payload, next)
{
    VM.create(payload, function _create_cb(err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err);
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
        }
        vmobj = obj;
        next(err, t);
    });
}

/*
 * For use in vasync.waterfall.
 *
 * Call VM.start() and wait for the zone_state to go to 'running'.  If it does
 * not go to running, the remaining tasks will be skipped.
 */
function startVM(t, next)
{
    VM.start(vmobj.uuid, {}, function _start_cb(err) {
        if (err) {
            t.ok(false, 'error starting VM: ' + err);
            next(err);
            return;
        }
        VM.waitForZoneState(vmobj, 'running', function waitRunning(_err) {
            common.ifError(t, _err, 'zone start');
            next(_err, t);
        });
    });
}

/*
 * For use in vasync.waterfall.
 *
 * Call VM.stop() and wait for the zone_state to be 'installed'.  If it does not
 * go to installed, the remaining tasks will be skipped.
 */
function stopVM(t, next)
{
    VM.stop(vmobj.uuid, {force: true}, function _stop_cb(err) {
        if (err) {
            t.ok(false, 'error stoping VM: ' + err);
            next(err);
            return;
        }
        VM.waitForZoneState(vmobj, 'installed', function waitInstalled(_err) {
            common.ifError(t, _err, 'zone stop');
            next(_err, t);
        });
    });
}

/*
 * For use in vasync.waterfall.
 *
 * Reload vmobj from vminfod.
 */
function loadVM(t, next)
{
    VM.load(vmobj.uuid, function _load_cb(err, obj) {
        if (err) {
            t.ok(false, 'error loading VM: ' + err);
        } else {
            t.ok(true, sprintf('VM loaded uuid %s state %s zone_state %s',
                obj.uuid, obj.state, obj.zone_state));
            vmobj = obj;
        }
        next(err, t);
    });
}

/*
 * For use in vasync.waterfall.
 */
function checkRunning(t, next)
{
    t.equal(vmobj.state, 'running', 'VM is running');
    next(null, t);
}

/*
 * For use in vasync.waterfall.
 */
function checkStopped(t, next)
{
    t.equal(vmobj.state, 'stopped', 'VM is stopped');
    next(null, t);
}

/*
 * For use in vasync.waterfall.
 *
 * Check that each disk has a uuid.  This also useful for times where a list of
 * the disks' uuids in test output would be nice - such as after adding or
 * removing disks so that you can have comfort that the test is really doing
 * what it says.
 */
function verifyDisksHaveUuids(t, next)
{
    var i, disk;
    for (i = 0; i < vmobj.disks.length; i++) {
        disk = vmobj.disks[i];
        if (!disk.hasOwnProperty('uuid')) {
            t.ok(false, 'disk missing uuid: ' + JSON.stringify(disk));
        } else {
            t.ok(utils.isUUID(disk.uuid), 'disk has valid uuid: ' + disk.uuid);
        }
    }
    next(null, t);
}

/*
 * For use with vasync.waterfall.
 *
 * Verify that disk.*.uuid is not set.
 */
function verifyDisksHaveNoUuids(t, next)
{
    var i, disk;
    for (i = 0; i < vmobj.disks.length; i++) {
        disk = vmobj.disks[i];
        t.equal(disk.uuid, undefined,
            'disk ' + disk.path + ' should not have uuid');
    }
    next(null, t);
}

/*
 * For use with vasync.waterfall.
 *
 * Use zonecfg to remove disk.*.uuid.
 */
function removeDiskUuids(t, next)
{
    var vs = new vminfod.VminfodEventStream({
        name: 'test-disk-uuid',
        log: log
    });
    var cancelFn;
    var zcfg = '';
    var changes = [];
    var i;

    assert.notEqual(vmobj.disks.length, 0, 'must have disks');
    for (i = 0; i < vmobj.disks.length; i++) {
        var disk = vmobj.disks[i];
        assert.uuid(disk.uuid, 'disk.uuid for ' + disk.path);
        zcfg += sprintf('select device match=%s;'
            + 'remove property (name=uuid,value="%s"); end;\n',
            disk.path, disk.uuid);
        changes.push({
            path: ['disks', null, 'uuid'],
            action: 'removed',
            oldValue: disk.uuid
        });
    }

    vs.once('ready', function () {
        vasync.parallel({funcs: [
            function _watcher(cb) {
                var obj = {
                    uuid: vmobj.uuid
                };
                var _opts = {
                    timeout: 5000,
                    catchErrors: true,
                    teardown: true
                };
                cancelFn = vs.watchForChanges(obj, changes, _opts, cb);
            },
            function _zonecfg(cb) {
                zonecfg(vmobj.uuid, [], {log: log, stdin: zcfg},
                    function (err, fds) {

                    common.ifError(t, err, 'remmove disk uuids');
                    if (err) {
                        cancelFn();
                        cb(err);
                        return;
                    }
                    cb();
                });
            }
        ]}, function _done(err, results) {
            vs.stop();
            next(null, t);
        });
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Before addDisk* is successful vmobj.disks should have two items.  This is
 * called frequently to ensure that expected failures really failed.
 *
 * vmobj is reloaded on success.
 */
function haveTwoDisks(t, next)
{
    t.equal(vmobj.disks.length, 2, 'should have two disks');
    next(null, t);
}

/*
 * For use with vasync.waterfall.
 *
 * Add a disk with the expectation that VM.js will automatically assign a uuid.
 *
 * vmobj is reloaded on success.
 */
function addDiskWithoutUuid(t, next)
{
    addDisks(t, [null], function _addDiskWithoutUuid(err) {
        t.equal(err, null, 'added one disk without uuid');
        next(null, t);
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Add a disk with a random uuid.
 *
 * vmobj is reloaded on success.
 */
function addDiskWithUuid(t, next)
{
    addDisks(t, [libuuid.create()], function _addDiskWithoutUuid(err) {
        t.equal(err, null, 'added one disk with uuid');
        next(null, t);
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Verify that adding disks with various bogus uuids fails.
 */
function addDisksWithBogusUuid(t, next)
{
    vasync.forEachPipeline({
        inputs: ['', 'not-a-uuid', 0, ['also', 'not', 'a', 'uuid']],
        func: function eachBogusUuid(uuid, callback) {
            addDisks(t, [uuid], function _addDisksWithBogusUuid(err) {
                checkError(t, err, 'Invalid value(s) for: disks.*.uuid',
                    'bogus uuid ' + JSON.stringify(uuid) + ' not allowed');
                callback();
            });
        }
    }, function done() {
        next(null, t);
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Add two disks at once, each with a unique uuid.
 *
 * vmobj is reloaded on success.
 */
function addTwoDisksWithUniqueUuids(t, next)
{
    var uuids = [libuuid.create(), libuuid.create()];

    addDisks(t, uuids, function _addTwoDisksWithUniqueUuids(err) {
        t.equal(err, null, 'add two disks with unique uuids');
        next(null, t);
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Verify that when duplicate uuids in the payload are detected.
 */
function addTwoDisksWithDuplicateUuids(t, next)
{
    var uuids = [libuuid.create()];
    uuids.push(uuids[0]);

    addDisks(t, uuids, function _addTwoDisksWithDuplicateUuids(err) {
        checkError(t, err, 'duplicate disk uuid',
            'error expected when adding multiple disks with same uuid');
        next(null, t);
    });
}

/*
 * For use with vasync.waterfall.
 *
 * Verify failure to add a new disk that has the same uuid as an existing disk.
 */
function addDiskWithExistingUuid(t, next)
{
    var uuids = [vmobj.disks[0].uuid];

    addDisks(t, uuids, function _addDiskWithExistingUuid(err) {
        checkError(t, err, 'duplicate disk uuid',
            'error expected when adding disks with in-use uuid');
        next(null, t);
    });
}

/*
 * Verify that err looks like an Error with err.message starting with err.  msg
 * is the message logged by assertplus.
 */
function checkError(t, err, errmsg, msg) {
    if (!err || !err.hasOwnProperty('message')) {
        t.ok(false, msg + ': expected an Error with message "' + errmsg
            + '", got ' + err);

        return;
    }
    t.equal(err.message.slice(0, errmsg.length), errmsg, msg);
}

/*
 * Adds a small disk for each uuid passed in uuids.  If an element of the uuids
 * array is null, the corresponding disk has no uuid.
 *
 * On successful add, vmobj is reloaded and the presence of disks with the new
 * uuids is verified.
 */
function addDisks(t, uuids, callback)
{
    var disks = uuids.map(function uuidToDisk(uuid) {
        var disk = {
            size: 10,
            model: 'virtio'
        };
        if (uuid !== null) {
            disk.uuid = uuid;
        }
        return disk;
    });

    vasync.waterfall([
        function doUpdate(next) {
            VM.update(vmobj.uuid, {add_disks: disks}, next);
        },
        function doLoad(next) {
            VM.load(vmobj.uuid, next);
        },
        function checkUuids(obj, next) {
            assert.object(obj);
            assert.object(obj.disks);
            vmobj = obj;

            var newuuids = obj.disks.map(function mapDisk(disk) {
                return disk.uuid;
            });
            var i, uuid;
            for (i = 0; i < uuids.length; i++) {
                uuid = uuids[i];
                if (uuid != null) {
                    t.ok(newuuids.indexOf(uuid) !== -1,
                        'new disk with uuid ' + uuid + ' found in config');
                }
            }
            next();
        }],
        function _done(err) {
            callback(err);
        });
}

var base_payload = {
    alias: 'test-disk-uuid-' + process.pid,
    brand: 'bhyve',
    do_not_inventory: true,
    autoboot: false,
    ram: 256,
    vcpus: 1,
    disks: [
        {
            image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
            boot: true,
            model: 'virtio'
        },
        {
            size: 100,
            model: 'virtio'
        }
    ],
    flexible_disk_size: 15 * 1024
};

function diskUuidTest(name, steps)
{
    var payload = jsprim.deepCopy(base_payload);

    test(name, function doTest(t) {
        vasync.waterfall([
            function _create(next) {
                createVM(t, payload, next);
            },
            loadVM,
            checkStopped,
            verifyDisksHaveUuids,
            haveTwoDisks
        ].concat(steps),
        function _done() {
            t.end();
        });
    });
}

diskUuidTest(
    'uuid is optional in the add_disk payload and uuids are assigned', [

    addDiskWithoutUuid,
    verifyDisksHaveUuids
]);

diskUuidTest('add one disk with a uuid', [
    addDiskWithUuid,
    verifyDisksHaveUuids
]);

diskUuidTest('add multiple disks with uuids', [
    addTwoDisksWithUniqueUuids,
    verifyDisksHaveUuids
]);

diskUuidTest('duplicate disks.*.uuids in payload are detected', [
    addTwoDisksWithDuplicateUuids,
    loadVM,
    haveTwoDisks,
    verifyDisksHaveUuids
]);

diskUuidTest('collision with existing disks are detected', [
    addDiskWithExistingUuid,
    loadVM,
    haveTwoDisks,
    verifyDisksHaveUuids
]);

diskUuidTest('bogus uuids are not allowed', [
    addDisksWithBogusUuid,
    loadVM,
    haveTwoDisks,
    verifyDisksHaveUuids
]);

diskUuidTest('starting and stopping the VM does not lose uuids', [
    startVM,
    loadVM,
    checkRunning,
    verifyDisksHaveUuids,
    haveTwoDisks,
    stopVM,
    loadVM,
    checkStopped,
    verifyDisksHaveUuids,
    haveTwoDisks
]);

diskUuidTest('disks without uuids have uuids assigned at next boot', [
    removeDiskUuids,
    loadVM,
    verifyDisksHaveNoUuids,
    haveTwoDisks,
    startVM,
    loadVM,
    verifyDisksHaveUuids,
    haveTwoDisks
]);
