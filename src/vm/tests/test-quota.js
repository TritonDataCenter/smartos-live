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

 /*
  * These tests ensure that we can set and modify the quota of VMs of different
  * brands.
  */

var async = require('/usr/node/node_modules/async');
var assert = require('/usr/node/node_modules/assert-plus');

var cp = require('child_process');
var execFile = cp.execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var common = require('./common.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var smartos_image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var test_case;
var abort;
var vmobj = {};


// NOTES:
// - the expected results are quota in GiB
// - the payload should have quota in GiB
// - the kvm is created with smartos_image_uuid to test the SPICE case, we
//   don't actually use that zoneroot.

var test_cases = [
    {
        payload: {brand: 'joyent-minimal', quota: 0,
            image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'joyent-minimal', quota: 1024,
            image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'joyent', quota: 0, image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'joyent', quota: 1048576,
            image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'kvm', quota: 0}
    }, {
        payload: {brand: 'kvm', quota: 0, image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'kvm', quota: 10, image_uuid: smartos_image_uuid}
    }, {
        payload: {brand: 'bhyve', quota: 1,
            disks: [ {boot: true, model: 'virtio',
                image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID} ]
        }
    }, {
        payload: {brand: 'bhyve', quota: 1, flexible_disk_size: 15 * 1024,
            disks: [ {boot: true, model: 'virtio',
                image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID} ]
        }
    }, {
        payload: {brand: 'bhyve', quota: 10,
            disks: [ {boot: true, model: 'virtio',
                image_uuid: vmtest.CURRENT_BHYVE_CENTOS_UUID} ]
        }
    },

    /*
     * For better or worse, VM.create() allows payloads with invalid properties,
     * logging "bad property $prop because: missing from allowed_properties".
     * The following test cases ensure that flexible_disk_size does not make it
     * into non-bhyve instances' configuration or affect the quota.
     */
    {
        payload: {brand: 'joyent-minimal', quota: 10,
            flexible_disk_size: 12 * 1024, image_uuid: smartos_image_uuid},
        expected: {quota: 10, flexible_disk_size: undefined}
    }, {
        payload: {brand: 'joyent', quota: 10,
            flexible_disk_size: 12 * 1024, image_uuid: smartos_image_uuid},
        expected: {quota: 10, flexible_disk_size: undefined}
    }, {
        payload: {brand: 'kvm', quota: 1,
            flexible_disk_size: 12 * 1024, image_uuid: smartos_image_uuid},
        expected: {quota: 1, flexible_disk_size: undefined}
    }, {
        payload: {brand: 'lx', quota: 10,
            flexible_disk_size: 12 * 1024, kernel_version: '3.13.0',
            image_uuid: vmtest.CURRENT_UBUNTU_LX_IMAGE_UUID},
        expected: {quota: 10, flexible_disk_size: undefined}
    }
];

function do_test(testcase)
{
    var desc = [];
    var payload = testcase.payload;
    var expected = testcase.expected || JSON.parse(JSON.stringify(payload));

    Object.keys(payload).forEach(
        function (key) {
            if (['string', 'number'].indexOf(typeof (payload[key])) !== -1) {
                desc.push(key + '=' + payload[key]);
            }
        });
    desc = desc.join(' ');

    abort = false;

    // some common properties
    payload.alias = 'test-quota-' + process.pid;
    payload.autoboot = false;
    payload.do_not_inventory = true;

    test('create ' + desc,
        function (t) {
            doCreateTest({
                t: t,
                payload: payload,
                expected: expected
            });
        });

    test('update ' + desc,
        function (t) {
            doUpdateTest({
                t: t,
                payload: payload,
                expected: expected
            });
        });

    test('delete ' + desc,
        function (t) {
            if (abort) {
                t.ok(false, 'skipping delete as test run is aborted.');
                t.end();

                // we don't skip the next test though, that's independent
                abort = false;
                return;
            }
            if (vmobj.uuid) {
                VM.delete(vmobj.uuid, function (err) {
                    if (err) {
                        t.ok(false, 'error deleting VM: ' + err.message);
                        abort = true;
                    } else {
                        t.ok(true, 'deleted VM: ' + vmobj.uuid);
                    }
                    t.end();
                    vmobj = {};
                });
            } else {
                t.ok(false, 'no VM to delete');
                abort = true;
                t.end();
            }
        });
}

function doCreateTest(opts) {
    var t = opts.t;
    var payload = opts.payload;
    var expected = opts.expected;

    async.waterfall([
        function _create(next) {
            VM.create(payload, function (err, obj) {
                if (err) {
                    t.ok(false, 'error creating VM: ' + err.message);
                } else {
                    t.ok(true, 'VM created with uuid ' + obj.uuid);
                    vmobj = obj;
                }
                next(err);
            });
        },
        function _load(next) {
            checkProps({
                expected: expected,
                uuid: vmobj.uuid,
                t: t
            }, next);
        },
        function _checkZfsProperties(next) {
            checkZfs({
                payload: payload,
                expected: expected,
                uuid: vmobj.uuid,
                t: t
            }, next);
        }
    ],
    function (err) {
        t.end();
    });
}

function doUpdateTest(opts) {
    var t = opts.t;
    var payload = opts.payload;
    var expected = opts.expected;
    var updatePayload = {quota: payload.quota * 2 };

    async.waterfall([
        // Double the quota
        function _updateQuotaUp(next) {
            VM.update(vmobj.uuid, updatePayload, {}, function (err) {
                common.ifError(t, err, 'updating quota up');
                if (err) {
                    next(err);
                    return;
                }
                next(err);
            });
        },
        function _checkQuotaUp(next) {
            checkProps({
                expected: updatePayload,
                uuid: vmobj.uuid,
                t: t
            }, next);
        },
        function _checkZfsProperties(next) {
            checkZfs({
                payload: payload,
                expected: expected,
                expected: updatePayload,
                uuid: vmobj.uuid,
                t: t
            }, next);
        },
        function _updateQuotaDown(next) {
            // Reset the quota to what it started out as
            updatePayload = {quota: payload.quota };

            VM.update(vmobj.uuid, updatePayload, {}, function (err) {
                common.ifError(t, err, 'updating quota down');

                if (err) {
                    next(err);
                    return;
                }
                next(err);
            });
        },
        function _checkQuotaDown(next) {
            checkProps({
                expected: expected,
                uuid: vmobj.uuid,
                t: t
            }, next);
        },
        function _checkZfsPropertiesAgain(next) {
            checkZfs({
                payload: payload,
                expected: expected,
                uuid: vmobj.uuid,
                t: t
            }, next);
        }
    ],
    function (err) {
        t.end();
    });
}

/*
 * Checks most (see skipProps) opts.exected.* against corresponding vmobj.*.
 * Ignores vmobj properties that are not present in opts.expected. To verify
 * that vmobj.foo is undefined, set opts.expected.foo to undefined.
 *
 * Updates vmobj global as a side effect.
 */
function checkProps(opts, callback) {
    var t = opts.t;
    var uuid = opts.uuid;
    var expected = opts.expected;
    /*
     * There are required in some payloads but are not present and/or of
     * interest in vmobj.
     */
    var skipProps = ['disks', 'ram', 'zonename'];

    VM.load(uuid, function (err, o) {
        common.ifError(t, err, 'loading vm');
        if (err) {
            callback(err);
            return;
        }
        vmobj = o;

        Object.keys(expected).forEach(function (prop) {
            if (skipProps.indexOf(prop) === -1) {
                t.ok(expected[prop] === o[prop],
                    'correct ' + prop + ' [' + o[prop] + ','
                    + expected[prop] + ']');
            }
        });
        callback();
    });
}

function checkZfs(opts, callback) {
    var t = opts.t;
    var expected = opts.expected;
    var props = [
        'used', 'refquota', 'quota', 'refreservation', 'copies',
        'volsize', 'volblocksize'
    ];

    datasetProperties(vmobj.uuid, props, function (err, datasetValues) {
        common.ifError(t, err, 'loading zfs properties');
        if (err) {
            callback(err);
            return;
        }

        var zoneroot = 'zones/' + vmobj.uuid;
        var zvol;

        var zrQuota = datasetValues[zoneroot].quota;
        var zrRefquota = datasetValues[zoneroot].refquota;
        var zrRefreservation =
            datasetValues[zoneroot].refreservation;

        t.ok(vmobj.brand, 'brand is ' + vmobj.brand);
        switch (vmobj.brand) {
            case 'bhyve':
                zvol = zoneroot + '/disk0';

                var expReservationsSize =
                    vmtest.zvol_volsize_to_reservation(
                        datasetValues[zvol].volsize,
                        datasetValues[zvol].volblocksize,
                        datasetValues[zvol].copies);

                var zvRefreservation =
                    datasetValues[zvol].refreservation;

                var expQuota;
                if (opts.payload.hasOwnProperty('flexible_disk_size')) {
                    var flexsize = opts.payload.flexible_disk_size;
                    t.ok(vmobj.flexible_disk_size === flexsize,
                        'vmobj.flexible_disk_size is ' + flexsize);
                    expQuota = flexsize * 1024 * 1024 + zrRefreservation
                        + datasetValues[zvol].refreservation
                        - datasetValues[zvol].volsize;
                } else {
                    t.ok(!vmobj.hasOwnProperty('flexible_disk_size'),
                        'vmobj does not have flexible_disk_size');
                    expQuota = zvRefreservation + zrRefquota;
                }

                t.equal(
                    zrRefquota / 1024 / 1024 / 1024,
                    expected.quota, 'bhyve quota uses refquota');

                t.equal(
                    zrRefreservation / 1024 / 1024 / 1024,
                    expected.quota, 'no refreservation set');

                t.equal(
                    zvRefreservation,
                    expReservationsSize,
                    'zvol refreseration matches expected');

                t.equal(zrQuota, expQuota, 'bhyve zone root quota value');
                break;

            default:
                t.equal(
                    zrQuota / 1024 / 1024 / 1024,
                    expected.quota, 'quota should match');
                break;
        }
        callback();
    });
}

function datasetProperties(uuid, props,  callback) {
    assert.uuid(uuid, 'uuid');
    assert.func(callback, 'callback');
    assert.arrayOfString(props, 'props');

    var zfsArgs = [
        'get', '-Hpr',
        '-o', 'name,property,value',
        props.join(','),
        'zones/' + uuid];

    common.zfs(zfsArgs, function (err, stdout) {
        if (err) {
            callback(err);
            return;
        }
        var valuesByDataset = {};

        stdout.toString().trim().split('\n').forEach(function (line) {
            var values = line.split('\t');
            if (!valuesByDataset.hasOwnProperty(values[0])) {
                valuesByDataset[values[0]] = {};
            }
            valuesByDataset[values[0]][values[1]] =
                values[2] !== '-' ? parseInt(values[2], 10) : values[2];
        });
        callback(null, valuesByDataset);
    });
}

for (test_case in test_cases) {
    test_case = test_cases[test_case];
    test_case.alias = 'test-quota-' + process.pid;

    do_test(test_case);
}

test('create joyent-minimal zone with invalid type of quota', function (t) {
    var payload = {
        alias: 'test-invalid-quota-' + process.pid,
        brand: 'joyent-minimal',
        quota: 'none',
        image_uuid: smartos_image_uuid,
        autoboot: false,
        do_not_inventory: true
    };

    VM.create(payload, function (err, obj) {
        t.ok(err, 'failed to create VM with invalid quota');
        if (!err) {
            // SUCCEEDED!?
            VM.delete(vmobj.uuid, function (delErr) {
                // try to delete, can't do anything if it fails.
                t.end();
            });
        } else {
            t.end();
        }
    });
});
