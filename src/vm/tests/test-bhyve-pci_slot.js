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

var assert = require('/usr/node/node_modules/assert-plus');
var bunyan = require('/usr/vm/node_modules/bunyan');
var common = require('./common.js');
var execFile = require('child_process').execFile;
var fs = require('fs');
var sprintf = require('/usr/node/node_modules/sprintf').sprintf;
var vasync = require('/usr/vm/node_modules/vasync');
var VM = require('/usr/vm/node_modules/VM');
var vminfod = require('/usr/vm/node_modules/vminfod/client');
var vmtest = require('../common/vmtest.js');
var zonecfg = require('/usr/vm/node_modules/zonecfg');

var log = bunyan.createLogger({
    level: 'debug',
    name: 'test-bhyve-pci_slot',
    streams: [ { stream: process.stderr, level: 'error' } ],
    serializers: bunyan.stdSerializers
});

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

/*
 * This is the main driver for the happy path tests.  It does the following:
 *
 *  - creates a VM using the specified payload
 *  - optionally alters it with opts.damage (and verifies it is damaged)
 *  - optionally updates it with an update payload
 *  - optionally sets an operator script to collect PCI device info in guest
 *  - if damaged or collecting guest info, it is booted
 *  - PCI slot assignments are compared against expected
 *  - if collecting guest info, that is verified against config in host
 *  - if booted, it is stopped
 *  - VM deletion is handled by after(), which is called after t.end().
 *
 * opts.t           test object
 * opts.payload     VM.create payload. Most likely should have autoboot set to
 *                  false.
 * opts.update      Optional VM.update payload
 * opts.damage      Optional dict with fn and check_disks keys. If present,
 *                  `fn(opts, next)` will be called between create and update
 *                  phases.  opts.vmobj will be automatically filled. This can
 *                  be used to call zonecfg to alter the configuration in ways
 *                  that VM.js will no longer do - such as to remove pci_slot
 *                  from existing disks. If this is set, the VM will be started
 *                  so that VM.start() may repair it.
 * opts.disks       List of disks to compare to vmobj to ensure assignments are
 *                  correct. Each disk.path is used to match the disk to the
 *                  same in vmobj.disks. Set disk.mumble to undefined if wanting
 *                  to ensure that vmobj does not have mumble set on a
 *                  particular disk.
 * opts.expect_bsf  Optional list of 'b:s:f' (bus slot function) elements
 *                  (decimal) that should match up with virtio-blk devices the
 *                  guest sees. If this is present, the VM will be booted and
 *                  the root disk image must support bash scripts and lspci.
 */
function testCreateAndCheckDisks(opts) {
    var t = opts.t;
    var payload = opts.payload;
    var expect_bsf = opts.expect_bsf;
    var disks = opts.disks;
    var update = opts.update;
    var damage = opts.damage;
    var need_start = (opts.hasOwnProperty('expect_bsf')
        || opts.hasOwnProperty('damage'));
    var lspci_md = 'lspci-output';
    var guest_lspci = '#! /bin/bash\n'
        + 'lspci -n -d 1af4:1001 | mdata-put ' + lspci_md + '\n'
        + 'poweroff\n';

    vasync.waterfall([
        function _create(next) {
            VM.create(payload, function _create_cb(err, obj) {
                if (err) {
                    t.ok(false, 'error creating VM: ' + err);
                } else {
                    t.ok(true, 'VM created with uuid ' + obj.uuid);
                }
                vmobj = obj;
                next(err);
            });
        },
        function _damage(next) {
            if (!damage) {
                t.ok(true, 'Skipping damage - nothing to do');
                next();
                return;
            }
            assert.func(damage.fn, 'damage.fn must be a function');
            assert.arrayOfObject(damage.check_disks,
                'damage.check_disks must be an array of disks');

            t.ok(true, 'damaging zone');
            vasync.waterfall([
                function _do_damage(dnext) {
                    damage.opts.vmobj = vmobj;
                    damage.fn(damage.opts, dnext);
                },
                function _load_damage(dnext) {
                    VM.load(vmobj.uuid, function _load_damage_cb(err, obj) {
                        if (err) {
                            t.ok(false, 'error creating VM: ' + err);
                        } else {
                            t.ok(true, 'damaged VM loaded');
                            vmobj = obj;
                        }
                        dnext(err);
                    });
                },
                function _check_damage(dnext) {
                    t.ok(true, 'Checking damage');
                    var err = checkDisks({
                        t: t,
                        haves: vmobj.disks,
                        wants: damage.check_disks,
                        uuid: vmobj.uuid
                    });
                    dnext(err);
                }
            ],
            function _damage_done(err) {
                if (err) {
                    t.ok(false, 'damage failed; aborting test');
                } else {
                    t.ok(true, 'damage done and verified');
                }
                next(err);
            });
        },
        function _update(next) {
            if (!update) {
                t.ok(true, 'Skipping update - nothing to do');
                next();
                return;
            }
            VM.update(vmobj.uuid, update, function _update_cb(err) {
                if (err) {
                    t.ok(false, 'error updating VM: ' + err);
                } else {
                    t.ok(true, 'VM updated');
                }
                next(err);
            });
        },
        function _add_operator_script(next) {
            if (!expect_bsf) {
                t.ok(true, 'Skipping guest PCI slot check');
                next();
                return;
            }
            var _payload = {
                set_internal_metadata: {
                    'operator-script': guest_lspci
                }
            };
            VM.update(vmobj.uuid, _payload, function _update_cb(err) {
                if (err) {
                    t.ok(false, 'error updating VM with operator script: '
                        + err);
                } else {
                    t.ok(true, 'VM updated with operator script');
                }
                next(err);
            });
        },
        function _start(next) {
            if (!need_start) {
                t.ok(true, 'Skipping guest start');
                next();
                return;
            }
            VM.start(vmobj.uuid, {}, function _start_cb(err) {
                if (err) {
                    t.ok(false, 'error starting VM: ' + err);
                } else {
                    t.ok(true, 'VM started');
                }
                next(err);
            });
        },
        function _wait_operator_script(next) {
            if (!expect_bsf) {
                next();
                return;
            }
            VM.waitForZoneState(payload, 'installed', function (err) {
                t.ok(!err, 'zone stopped after running operator script');
                next(err);
            });
        },
        function _load(next) {
            VM.load(vmobj.uuid, function _load_cb(err, obj) {
                if (err) {
                    t.ok(false, 'error creating VM: ' + err);
                } else {
                    t.ok(true, 'VM loaded uuid ' + obj.uuid);
                    vmobj = obj;
                }
                next(err);
            });
        },
        function _check(next) {
            next(checkDisks({
                t: t,
                haves: vmobj.disks,
                wants: disks,
                uuid: vmobj.uuid
            }));
        },
        function _check_lspci_md(next) {
            if (!expect_bsf) {
                next();
                return;
            }
            var cm = vmobj.customer_metadata;
            if (!cm.hasOwnProperty(lspci_md)) {
                t.ok(false, 'customer_metadata["' + lspci_md
                    + '"] not found');
                next();
                return;
            }
            var guest_bsf = [];
            var lines = cm[lspci_md].trim().split('\n');
            lines.forEach(function _gather_guest_pci(line) {
                /* lspci reports bb:ss.f, with each number in hex */
                var bsf = line.split(' ')[0].replace('.', ':').split(':');
                guest_bsf.push(sprintf('%d:%d:%d', parseInt(bsf[0], 16),
                    parseInt(bsf[1], 16), parseInt(bsf[2], 16)));
            });
            t.equal(guest_bsf.sort().join(' '), expect_bsf.sort().join(' '),
                'PCI slots occupied: ' + expect_bsf.sort().join(' '));
            next();
        }
    ], function _done(err) {
        t.end(err);
    });
}

function dup(thing) {
    return JSON.parse(JSON.stringify(thing));
}

/*
 * Runs zonecfg and waits for vminfod to pick up the changes. If you are having
 * troubles figuring out what should go into the changes array, set log.level to
 * debug and observe the bunyan logs that appear in test output.  There are
 * hints, but not answers, in that output.
 */
function zonecfgSync(uuid, args, opts, changes, cb)
{
    var vs = new vminfod.VminfodEventStream({
        name: sprintf('test-bhyve-pci_slot (%s)', uuid),
        log: log
    });
    var cancelFn;

    vs.once('ready', function () {
        vasync.parallel({funcs: [
            function _watcher(cb2) {
                var obj = {
                    uuid: uuid
                };
                var _opts = {
                    timeout: 5000,
                    catchErrors: true,
                    teardown: true
                };
                cancelFn = vs.watchForChanges(obj, changes, _opts, cb2);
            },
            function _zonecfg(cb2) {
                zonecfg(uuid, args, opts, function (err, fds) {
                    if (err) {
                        cancelFn();
                        cb2(err);
                        return;
                    }
                    cb2();
                });
            }
        ]}, function _done(err, results) {
            cb(err);
        });
    });
}

function checkDisks(opts) {
    var t = opts.t;
    var haves = opts.haves;
    var uuid = opts.uuid;
    var wants = opts.wants;
    var errors = 0;

    wants.forEach(function _check_disk(want) {
        var found = false;
        var path = sprintf(want.path, uuid);

        t.ok(true, 'Checking disk ' + path);

        haves.forEach(function _select_disk(have) {
            if (path !== have.path) {
                return;
            }
            found = true;
            Object.keys(want).forEach(function _check_prop(prop) {
                if (prop === 'path') {
                    return;
                }
                t.equal(have[prop], want[prop], 'matching prop: ' + prop
                    + '=' + have[prop]);
                if (have[prop] !== want[prop]) {
                    errors++;
                }
            });
        });
        t.ok(found, 'disk ' + path + ' found');
        if (!found) {
            errors++;
        }
    });
    if (errors !== 0) {
        return new Error('checkDisks encountered ' + errors + 'error(s)');
    }
    return null;
}

/*
 * VM.create() is expected to fail with an Error message that starts with
 * opts.expect.
 */
function testFailCreate(opts) {
    assert.object(opts.t, 't must be test object');
    assert.object(opts.payload, 'payload must be an object');
    assert.string(opts.expect, 'expect must be a string');
    assert.notEqual(opts.expect.length, 0, 'expect must not be empty');

    var t = opts.t;
    var payload = opts.payload;
    var expect = opts.expect;

    vasync.waterfall([
        function _create(next) {
            VM.create(payload, function _create_cb(err, obj) {
                if (err) {
                    t.equal(err.message.substring(0, expect.length), expect,
                        'error detected');
                } else {
                    t.ok(false, 'No error detected');
                }
                // This is just a stub right now. We need to try a load to
                // see if it was really created.
                vmobj = obj;

                next();
            });
        },
        function _load(next) {
            VM.load(vmobj.uuid, function _load_cb(err, obj) {
                vmobj = obj;
                t.ok(err, 'VM load should fail');
                if (err) {
                    err = next();
                    return;
                }
                next(new Error('VM ' + vmobj.uuid
                    + '  unexpectedly exists'));
            });
        }
        ], function _done(err) {
            t.end(err);
        });
}

/*
 * Tests that create a VM should be setting vmobj so that the after hook can
 * clean up the VM when the test finishes or gives up.  If a test uses vmobj
 * then deletes the VM on its own, it should set vmobj to undefined.
 */
var vmobj;

before(function (cb) {
    vmobj = undefined;
    cb();
});

after(function (cb) {
    if (vmobj) {
        VM.delete(vmobj.uuid, {}, function _delete_cb(err) {
            if (err) {
                console.log(sprintf('Could not delete vm %s: %s', vmobj.uuid,
                    err.message));
            }
            vmobj = undefined;
            cb();
        });
    } else {
        cb();
    }
});

/*
 * Common payload elements
 */
var image_uuid = vmtest.CURRENT_BHYVE_CENTOS_UUID;

var base_payload = {
    alias: 'test-bhyve-pci_slot-' + process.pid,
    brand: 'bhyve',
    do_not_inventory: true,
    autoboot: false,
    ram: 1024,
    vcpus: 1,
    disks: [
        {
            image_uuid: image_uuid,
            boot: true,
            model: 'virtio'
        },
        {
            size: 512,
            model: 'virtio'
        }
    ]
};

/*
 * Tests, finally!
 */

/*
 * VM.configure() should put the boot disk in 0:4:0 and the data disk in 0:4:1.
 */
test('Verify disk.*.pci_slot are populated by VM.configure',
    function _verify_populate_on_boot(t) {
        var payload = dup(base_payload);
        var check_disks = [
            {
                path: '/dev/zvol/rdsk/zones/%s/disk0',
                image_uuid: image_uuid,
                boot: true,
                model: 'virtio',
                pci_slot: '0:4:0'
            }, {
                path: '/dev/zvol/rdsk/zones/%s/disk1',
                image_uuid: undefined,
                model: 'virtio',
                pci_slot: '0:4:1'
            }
        ];

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            disks: check_disks,
            expect_bsf: ['0:4:0', '0:4:1']
        });
    });

test('Verify cdrom is in PCI slot 3:0',
    function _verify_cdrom_on_boot(t) {
        var payload = dup(base_payload);

        payload.disks.pop();
        payload.disks.push({
            // cdrom media is not created. Choose a file that exists.
            path: '/usr/share/bhyve/uefi-rom.bin',
            model: 'ahci',
            media: 'cdrom'
        });

        var check_disks = [
            {
                path: '/dev/zvol/rdsk/zones/%s/disk0',
                image_uuid: image_uuid,
                boot: true,
                model: 'virtio',
                pci_slot: '0:4:0'
            }, {
                path: '/usr/share/bhyve/uefi-rom.bin',
                image_uuid: undefined,
                model: 'ahci',
                pci_slot: '0:3:0',
                media: 'cdrom'
            }
        ];

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            disks: check_disks
        });
    });

test('Verify 8 disks automatically assigned properly',
    function _verify_8_disks(t) {
        var payload = dup(base_payload);
        var check_disks = [
            {
                path: '/dev/zvol/rdsk/zones/%s/disk0',
                image_uuid: image_uuid,
                boot: true,
                model: 'virtio',
                pci_slot: '0:4:0'
            }
        ];
        var i;

        payload.disks.pop();
        for (i = 1; i < 8; i++) {
            payload.disks.push({
                size: 256,
                model: 'virtio'
            });
            check_disks.push({
                path: '/dev/zvol/rdsk/zones/%s/disk' + i,
                pci_slot: '0:4:' + i
            });
        }

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            disks: check_disks,
            expect_bsf: [
                '0:4:0', '0:4:1', '0:4:2', '0:4:3',
                '0:4:4', '0:4:5', '0:4:6', '0:4:7'
            ]});
    });

test('Verify create time assignments are sticky',
    function _verify_create_sticky_disks(t) {
        var payload = dup(base_payload);
        var check_disks = [
            {
                path: '/dev/zvol/rdsk/zones/%s/disk0',
                image_uuid: image_uuid,
                boot: true,
                model: 'virtio',
                pci_slot: '0:4:0'
            }
        ];
        var i;

        payload.disks.pop();
        for (i = 1; i < 4; i++) {
            payload.disks.push({
                size: 256,
                model: 'virtio',
                pci_slot: '0:4:' + (i + 4)
            });
            check_disks.push({
                path: '/dev/zvol/rdsk/zones/%s/disk' + i,
                pci_slot: '0:4:' + (i + 4)
            });
        }

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            disks: check_disks,
            expect_bsf: [ '0:4:0', '0:4:5', '0:4:6', '0:4:7' ]
        });
    });

/*
 * Verifies that "slot:fn" and "slot" are accepted and placed in the right
 * places.
 */
test('Verify alternate slot schemes are allowed',
    function _verify_partial_bsf_disks(t) {
        var check_disks = [
            {path: '/dev/zvol/rdsk/zones/%s/disk0', pci_slot: '0:4:0'},
            {path: '/dev/zvol/rdsk/zones/%s/disk1', pci_slot: '4:1'},
            {path: '/dev/zvol/rdsk/zones/%s/disk2', pci_slot: '5'}
        ];
        var payload = dup(base_payload);
        payload.disks.pop();
        payload.disks.push({size: 256, model: 'virtio', pci_slot: '4:1'});
        payload.disks.push({size: 256, model: 'virtio', pci_slot: '5'});

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            disks: check_disks,
            expect_bsf: [ '0:4:0', '0:4:1', '0:5:0' ]
        });
    });

test('Verify holes are filled',
    function _verify_holes_filled(t) {
        var check_disks = [
            {path: '/dev/zvol/rdsk/zones/%s/disk0', pci_slot: '0:4:0'},
            {path: '/dev/zvol/rdsk/zones/%s/disk1', pci_slot: '0:4:2'},
            {path: '/dev/zvol/rdsk/zones/%s/disk2', pci_slot: '0:4:1'}
        ];
        var payload = dup(base_payload);
        payload.flexible_disk_size = 13 * 1024;
        payload.disks.pop();
        payload.disks.push({size: 256, model: 'virtio', pci_slot: '0:4:2'});

        var update_payload = {
            add_disks: [ {
                size: 512,
                model: 'virtio'
            } ]
        };

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            update: update_payload,
            disks: check_disks,
            expect_bsf: [ '0:4:0', '0:4:1', '0:4:2' ]
        });
    });

/*
 * When coming from an old PI, disks.*.pci_slot is probably not set.
 * `vmadm start` should fix that, putting them into the legacy slots.
 */
test('Verify VM.start performs static assignment',
    function _start_static_assignment(t) {
        var disks = [ {
            path: '/dev/zvol/rdsk/zones/%s/disk0',
            legacy_pci_slot: '0:4:0',
            new_pci_slot: '0:4:0'
        }, {
            path: '/dev/zvol/rdsk/zones/%s/disk1',
            legacy_pci_slot: '0:5:0',
            new_pci_slot: '0:4:1'
        } ];
        var check_disks = [];
        var payload = dup(base_payload);

        var damage_fn = function (opts, cb) {
            var uuid = opts.vmobj.uuid;
            var zcfg = '';
            var changes = [];
            var i;

            for (i in disks) {
                var disk = disks[i];
                // We are testing legacy assignments.  After booting, the legacy
                // slot assignment should be present.
                check_disks.push({
                    path: disk.path,
                    pci_slot: disk.legacy_pci_slot
                });
                // In order to ensure legacy assignments, we have to remove the
                // new assignments from the config.
                zcfg += 'select device match=' + sprintf(disk.path, uuid)
                    + ';\nremove property(name=pci-slot,value="'
                    + disk.new_pci_slot + '");\nend;\n';
                changes.push({
                    path: [ 'disks', null, 'pci_slot' ],
                    action: 'removed',
                    oldValue: disk.new_pci_slot
                });
            }
            zonecfgSync(opts.vmobj.uuid, [], {log: log, stdin: zcfg},
                changes, function _zonecfg_cb(zcfg_err, fds) {
                    if (zcfg_err) {
                        t.ok(false, 'zonecfg failed: ' + zcfg_err);
                    } else {
                        t.ok(true, 'zone config succeeded');
                    }
                    cb(zcfg_err);
                });
        };

        // After damaging the config, no disk should have a pci_slot set.
        var damage_check = dup(check_disks);
        damage_check.forEach(function (disk) {
            disk.pci_slot = undefined;
        });

        testCreateAndCheckDisks({
            t: t,
            payload: payload,
            damage: {
                fn: damage_fn,
                check_disks: damage_check,
                opts: {}
            },
            disks: check_disks,
            expect_bsf: [ '0:4:0', '0:5:0' ]
        });
    });

/*
 * If two disks try to share the same slot during create, the create should
 * fail.
 */
test('Conflict during create',
    function _conflict_during_create(t) {
        var payload = dup(base_payload);
        payload.disks[0].pci_slot = '0:4:0';
        payload.disks[1].pci_slot = '0:4:0';

        testFailCreate({
            t: t,
            payload: payload,
            expect: 'VM has multiple disks in pci_slot "0:4:0"'
        });
    });

/*
 * Two boot disks are not supported.
 */
test('Multiple boot disks',
    function _multiple_boot_disks(t) {
        var payload = dup(base_payload);
        payload.disks[1].boot = true;

        testFailCreate({
            t: t,
            payload: payload,
            expect: 'multiple boot disks:'
        });
    });

/*
 * If an update tries to put a disk into an occupied slot, it should fail.
 */
test('Conflict during update',
    function _conflict_during_update(t) {
        var payload = dup(base_payload);
        payload.flexible_disk_size = 13 * 1024;

        var disk0 = payload.disks[0];
        var disk1 = payload.disks[1];
        disk0.pci_slot = '0:4:0';
        disk1.pci_slot = '0:4:0';

        payload.disks = [ disk0 ];
        var update = {add_disks: [ disk1 ]};
        t.expect(3);

        vasync.waterfall([
            function _create(next) {
                VM.create(payload, function _create_cb(err, obj) {
                    if (err) {
                        t.ok(false, 'VM create failed: ' + err);
                        next(err);
                        return;
                    }
                    t.ok(true, 'VM created with uuid ' + obj.uuid);
                    vmobj = obj;
                    next();
                });
            },
            function _update(next) {
                VM.update(vmobj.uuid, update, function _update_cb(err) {
                    var expect = 'VM has multiple disks in pci_slot "0:4:0"';
                    t.ok(err, 'update should not succeed');
                    if (!err) {
                        next(new Error('update unexpectedly succeeded'));
                        return;
                    }
                    t.equal(err.message.substring(0, expect.length), expect,
                        'conflict detected');
                    if (err.message.substring(0, expect.length) !== expect) {
                        next(err);
                        return;
                    }
                    next();
                });
            }
            ], function _done(err) {
                t.end(err);
            }
        );
    });

/*
 * Ensure that functions of the reseved devices are not valid for disks.
 */
[
    {name: 'hostbridge', pcidev: 0},
    {name: 'nics', pcidev: 6},
    {name: 'fbuf', pcidev: 30},
    {name: 'lpc', pcidev: 31}
].forEach(function _squat(squatter) {
    var fn = 0;
    // We could check 0 - 7, but 0 and 1 should exercise all relevant paths.
    while (fn < 2) {
        var pcislot = sprintf('0:%d:%d', squatter.pcidev, fn);
        var desc = sprintf('No squatters on %s: %s', pcislot, squatter.name);

        test(desc, function _test_squatter(t) {
            var payload = dup(base_payload);
            payload.disks[0].pci_slot = pcislot;
            testFailCreate({
                t: t,
                payload: payload,
                expect: sprintf(
                    'pci_slot "%s" invalid: PCI device %d is reserved',
                    pcislot, squatter.pcidev)
            });
        });
        fn++;
    }
});
