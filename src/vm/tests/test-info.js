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
var bunyan = require('/usr/node/node_modules/bunyan');
var jsprim = require('/usr/vm/node_modules/jsprim');
var properties = require('/usr/vm/node_modules/props');
var sprintf = require('/usr/node/node_modules/sprintf').sprintf;
var vasync = require('/usr/vm/node_modules/vasync');
var VM = require('/usr/vm/node_modules/VM');
var vmadm = require('./common').vmadm;
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var log = bunyan.createLogger({
    level: 'trace',
    name: 'test-info',
    streams: [ { stream: process.stderr, level: 'error' } ],
    serializers: bunyan.stdSerializers
});

/*
 * nodeuninit-plus executes the callback specified by before() before each test
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

function loadVM(t, next)
{
    VM.load(vmobj.uuid, function _load_cb(err, obj) {
        if (err) {
            t.ok(false, 'error loading VM: ' + err);
        } else {
            t.ok(true, 'VM loaded uuid ' + obj.uuid);
            vmobj = obj;
        }
        next(err, t);
    });
}

function checkRunning(t, next)
{
    t.equal(vmobj.state, 'running', 'VM is running');
    if (vmobj.state !== 'running') {
        next(new Error('VM is in state "%s", not "running"', vmobj.state));
        return;
    }
    next(null, t);
}

function checkInfoPos(t, why, types, expect, next)
{
    vmadm(['info', vmobj.uuid].concat(types), {log: log},
        function _check_info(err, fds) {

        if (err) {
            t.ok(false, sprintf('unable to get info for types %s: %s',
                types.join(', '), err.message));
            next(null, t);
            return;
        }
        var obj = JSON.parse(fds.stdout);
        t.deepEqual(Object.keys(obj).sort(), expect.sort(),
            why + ' returns expected keys: ' + expect.join(', '));
        next(null, t);
    });
}

function checkInfoNoType(t, types, next)
{
    var exp = 'unknown info type';

    VM.info(vmobj.uuid, types, function _check_info_neg(err, obj) {
        if (err) {
            t.ok(jsprim.startsWith(err.message, exp), types.join(', ')
                + ': expected error "' + exp + '", got error: ' + err.message);
            next(null, t);
            return;
        }
        t.ok(false, types.join(', ') + 'exected error "' + exp
            + '", got success: ' + JSON.stringify(obj));
        next(null, t);
    });
}

/*
 * Common tests for brands that support info.
 */
function testPos(t, brand, all, some, none) {
    var payload = {
        alias: sprintf('test-info-%s-%d', brand, process.pid),
        brand: brand,
        do_not_inventory: true,
        autoboot: true,
        ram: 256,
        vcpus: 1,
        disks: [
            {
                image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID,
                boot: true,
                model: 'virtio'
            }
        ]
    };
    var runtime_info = properties.BRAND_OPTIONS[brand].features.runtime_info;

    t.deepEqual(all.concat(['all']).sort(), runtime_info.sort(),
        'test matches BRAND_INFO runtime_info');

    vasync.waterfall([
        function _create(next) {
            createVM(t, payload, next);
        },
        loadVM,
        checkRunning,
        function _check_all1(_t, next) {
            checkInfoPos(_t, 'all1', ['all'], all, next);
        }, function _check_all2(_t, next) {
            checkInfoPos(_t, 'all2', all, all, next);
        }, function _check_all3(_t, next) {
            checkInfoPos(_t, 'all3', all.concat(['all']), all, next);
        }, function _check_some(_t, next) {
            checkInfoPos(_t, 'some', some, some, next);
        }, function _check_none(_t, next) {
            checkInfoNoType(_t, none, next);
        }, function _check_neg_bogus(_t, next) {
            checkInfoNoType(_t, ['bogus'], next);
        }], function _done() {
            t.end();
        });
}

/*
 * Tests, finally!
 *
 * Remember that the functions passed by before() and after() are called before
 * and after each test.
 */

test('bhyve info', function bhyve_info(t) {
    var all = ['vnc'];
    var some = ['vnc'];
    var none = ['spice'];

    testPos(t, 'bhyve', all, some, none);
});

test('kvm info', function kvm_info(t) {
    var all = ['block', 'blockstats', 'chardev', 'cpus', 'kvm', 'pci', 'spice',
        'status', 'version', 'vnc'];
    var some = ['block', 'blockstats', 'chardev'];
    var none = ['blurp'];

    testPos(t, 'kvm', all, some, none);
});
