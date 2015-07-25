// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var smartos_image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var test_case;

//
// NOTES:
// - the expected results are quota in GiB
// - the payload should have quota in GiB
// - the kvm is created with smartos_image_uuid to test the SPICE case, we don't actually use that zoneroot.
//
var test_cases = [
    [{brand: 'joyent-minimal', quota: 0, image_uuid: smartos_image_uuid}, 0],
    [{brand: 'joyent-minimal', quota: 1024, image_uuid: smartos_image_uuid}, 1024],
    [{brand: 'joyent', quota: 0, image_uuid: smartos_image_uuid}, 0],
    [{brand: 'joyent', quota: 1048576, image_uuid: smartos_image_uuid}, 1048576],
    [{brand: 'kvm', quota: 0}, 0],
    [{brand: 'kvm', quota: 102400}, 102400],
    [{brand: 'kvm', quota: 0, image_uuid: smartos_image_uuid}, 0],
    [{brand: 'kvm', quota: 10, image_uuid: smartos_image_uuid}, 10],
];

function do_test(payload, expected_result)
{
    var vmobj = {};
    var abort = false;

    // some common properties
    payload.alias = 'test-quota-' + process.pid;
    payload.autoboot = false;
    payload.do_not_inventory = true;

    test('create ' + payload.brand + ' zone with ' + payload.quota + ' quota',
        function(t) {

        VM.create(payload, function (err, obj) {
            if (err) {
                t.ok(false, 'error creating VM: ' + err.message);
                t.end();
            } else {
                t.ok(true, 'VM created with uuid ' + obj.uuid);
                vmobj = obj;
                VM.load(obj.uuid, function (e, o) {
                    var allowed = [];

                    t.ok(!err, 'loading VM after create');
                    if (!err) {
                        t.ok(o.quota === expected_result,
                            'correct quota on zoneroot [' + o.quota + ','
                            + expected_result + ']');
                    } else {
                        abort = true;
                    }
                    t.end();
                });
            }
        });
    });

    test('delete ' + payload.brand + ' zone with ' + payload.quota + ' quota', function(t) {
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

for (test_case in test_cases) {
    test_case = test_cases[test_case];
    test_case.alias = 'test-quota-' + process.pid;

    do_test(test_case[0], test_case[1]);
}

test('create joyent-minimal zone with invalid type of quota',
    function(t) {

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
            VM.delete(vmobj.uuid, function (err) {
                // try to delete, can't do anything if it fails.
                t.end();
            });
        } else {
            t.end();
        }
    });
});
