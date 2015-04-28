// Copyright 2015 Joyent, Inc.  All rights reserved.

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var execFile = require('child_process').execFile;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// TODO: logger that errors when message >= WARN
var log = bunyan.createLogger({
    level: 'error',
    name: 'test-indestructible',
    serializers: bunyan.stdSerializers
});

VM.loglevel = 'DEBUG';

var current_vm_aborted;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var vm_uuid;
var vm_vmobj;

var PAYLOADS = {
    zoneroot_only: {
        alias: 'test-indestructible-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        do_not_inventory: true
    }, zoneroot_indestructible: {
        alias: 'test-indestructible-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        do_not_inventory: true,
        indestructible_zoneroot: true
    }, delegated: {
        alias: 'test-indestructible-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true
    }, delegated_indestructible: {
        alias: 'test-indestructible-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true,
        indestructible_delegated: true
    }, totally_indestructible: {
        alias: 'test-indestructible-' + process.pid,
        brand: 'joyent-minimal',
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true,
        indestructible_delegated: true,
        indestructible_zoneroot: true
    }
};


function changeIndestructibility(t, uuid, flag, value, callback)
{
    var expected = {};
    var payload = {};

    payload[flag] = value;
    expected[flag] = value;

    if (expected[flag] === false) {
        expected[flag] = undefined;
    }

    VM.update(uuid, payload, function (err) {
        t.ok(!err, 'update VM: ' + (err ? err.message : 'success'));
        if (err) {
            current_vm_aborted = true;
            t.end();
            callback();
            return;
        }

        checkFlags(t, uuid, expected, callback);
    });
}

function checkFlags(t, uuid, expected, callback)
{
    VM.load(uuid, function (err, vmobj) {
        t.ok(!err, 'load VM: ' + (err ? err.message : 'success'));
        if (err) {
            current_vm_aborted = true;
            callback();
            return;
        }

        Object.keys(expected).forEach(function (key) {
            t.equal(vmobj[key], expected[key], key + ' is: [' + vmobj[key]
                + '] expected: [' + expected[key] + ']');
        });

        callback();
    });
}

function createTestVM(t, payload_name, callback)
{
    assert(PAYLOADS.hasOwnProperty(payload_name));

    VM.create(PAYLOADS[payload_name], function (err, vmobj) {
        if (err) {
            current_vm_aborted = true;
            t.ok(false, 'error creating VM: ' + err.message);
            callback(err);
            return;
        }
        vm_uuid = vmobj.uuid;
        t.ok(true, 'created VM: ' + vm_uuid);
        VM.load(vm_uuid, function (load_err, obj) {
            t.ok(!load_err, 'load VM: '
                + (load_err ? load_err.message : 'success'));
            if (load_err) {
                current_vm_aborted = true;
            } else {
                current_vm_aborted = false;
                vm_vmobj = obj;
            }
            callback(load_err);
        });
    });
}

function zfs(args, zlog, callback)
{
    var cmd = '/usr/sbin/zfs';

    assert(zlog, 'no logger passed to zfs()');

    zlog.debug(cmd + ' ' + args.join(' '));
    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}


/*
 * Test that we can create a standard zone with no delegated dataset and make
 * zoneroot indestructible. Prove that destruction fails with the appropriate
 * message and that destruction succeeds after removing the
 * indestructible_zoneroot flag.
 */

test('create zoneroot_only VM', function (t) {
    createTestVM(t, 'zoneroot_only', function (err) {
        t.end();
    });
});

test('make zoneroot_only VM indestructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_zoneroot', true,
        function () {
            t.end();
        }
    );
});

test('attempt to delete zoneroot_only VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    if (vm_uuid) {
        // should fail!
        VM.delete(vm_uuid, function (err) {
            t.ok(err && err.message.match(/indestructible_zoneroot is set/),
                'delete: ' + (err ? err.message : 'succeeded'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

// manually remove the hold, so zoneroot has snapshot but 0 holds
test('manually remove zoneroot_only VM @indestructible hold', function (t) {
    var snapshot = vm_vmobj.zfs_filesystem + '@indestructible';
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    zfs(['release', 'do_not_destroy', snapshot], log, function (err, res) {
        t.ok(!err, 'release snapshot: ' + (err ? err.message : 'success'));
        t.end();
    });
});

test('make zoneroot_only VM destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_zoneroot', false,
        function () {
            t.end();
        }
    );
});

test('delete zoneroot_only VM', function (t) {
    // on destroy we ignore current_vm_aborted because we want to destroy anyway
    // if it exists. If we don't future tests might fail because this is here.
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            t.ok(!err, 'delete VM: ' + (err ? err.message : 'success'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});


/*
 * Same test as above, but verifies we can create a VM with the
 * indestructible_zoneroot flag set on create.
 */

test('create zoneroot_indestructible VM', function (t) {
    createTestVM(t, 'zoneroot_indestructible', function (err) {
        if (err) {
            t.end();
            return;
        }
        checkFlags(t, vm_uuid, {indestructible_zoneroot: true},
            function () {
                t.end();
            }
        );
    });
});

test('attempt to delete zoneroot_indestructible VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    VM.delete(vm_uuid, function (err) {
        // should fail!
        t.ok(err && err.message.match(/indestructible_zoneroot is set/),
            'delete: ' + (err ? err.message : 'succeeded'));
        t.end();
    });
});

test('attempt to reprovision zoneroot_indestructible VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    VM.reprovision(vm_uuid, {image_uuid: vm_vmobj.image_uuid}, {log: log},
        function (err) {
            // should fail!
            t.ok(err && err.message.match(/indestructible_zoneroot is set/),
                'reprovision: ' + (err ? err.message : 'succeeded'));
            t.end();
        }
    );
});

// add additional hold to ensure that making destructible really does
test('add additional hold to zoneroot_indestructible VM', function (t) {
    var snapshot = vm_vmobj.zfs_filesystem + '@indestructible';
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    zfs(['hold', 'vm_tests_want_to_break_things', snapshot], log,
        function (err, res) {
            t.ok(!err, 'hold snapshot: ' + (err ? err.message : 'success'));
            t.end();
        }
    );
});

test('make zoneroot_indestructible VM destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_zoneroot', false,
        function () {
            t.end();
        }
    );
});

test('delete zoneroot_indestructible VM', function (t) {
    // on destroy we ignore current_vm_aborted because we want to destroy anyway
    // if it exists. If we don't future tests might fail because this is here.
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            t.ok(!err, 'delete VM: ' + (err ? err.message : 'success'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});


/*
 * Test that a VM created with a delegated dataset can have that delegated
 * dataset made indestructible with indestructible_delegated flag and that doing
 * so in fact prevents destruction.
 */

test('create delegated VM', function (t) {
    createTestVM(t, 'delegated', function (err) {
        t.end();
    });
});

test('make delegated VM indestructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_delegated', true,
        function () {
            t.end();
        }
    );
});

test('attempt to delete delegated VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            // should fail!
            t.ok(err && err.message.match(/indestructible_delegated is set/),
                'delete: ' + (err ? err.message : 'succeeded'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('attempt to reprovision delegated VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    VM.reprovision(vm_uuid, {image_uuid: vm_vmobj.image_uuid}, {log: log},
        function (err) {
            /*
             * should succeed, since we have indestructible_delegated but not
             * indestructible_zoneroot
             */
            t.ok(!err, 'reprovision: ' + (err ? err.message : 'succeeded'));
            t.end();
        }
    );
});

test('make delegated VM destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_delegated', false,
        function () {
            t.end();
        }
    );
});

test('delete delegated VM', function (t) {
    // on destroy we ignore current_vm_aborted because we want to destroy anyway
    // if it exists. If we don't future tests might fail because this is here.
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            t.ok(!err, 'delete VM: ' + (err ? err.message : 'success'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});


/*
 * Same test as above except in this case the delegated dataset is made
 * indestructible on creation rather than after-the-fact.
 */

test('create delegated_indestructible VM', function (t) {
    createTestVM(t, 'delegated_indestructible', function (err) {
        if (err) {
            t.end();
            return;
        }

        checkFlags(t, vm_uuid, {indestructible_delegated: true},
            function () {
                t.end();
            }
        );
    });
});

test('attempt to delete delegated_indestructible VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            // should fail!
            t.ok(err && err.message.match(/indestructible_delegated is set/),
                'delete: ' + (err ? err.message : 'succeeded'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('make delegated_indestructible VM destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_delegated', false,
        function () {
            t.end();
        }
    );
});

test('delete delegated_indestructible VM', function (t) {
    // on destroy we ignore current_vm_aborted because we want to destroy anyway
    // if it exists. If we don't future tests might fail because this is here.
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            t.ok(!err, 'delete VM: ' + (err ? err.message : 'success'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});


/*
 * Test that zone created with delegated dataset and both zoneroot and delegated
 * marked as indestructible, cannot be deleted until both flags are removed.
 */

test('create totally_indestructible VM', function (t) {
    createTestVM(t, 'totally_indestructible', function (err) {
        if (err) {
            t.end();
            return;
        }
        checkFlags(t, vm_uuid, {
            indestructible_delegated: true,
            indestructible_zoneroot: true
        }, function () {
            t.end();
        });
    });
});

test('attempt #1 to delete totally_indestructible VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            // should fail!
            t.ok(err && err.message.match(/indestructible_zoneroot is set/),
                'delete: ' + (err ? err.message : 'succeeded'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('make totally_indestructible VM\'s zoneroot destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_zoneroot', false,
        function () {
            t.end();
        }
    );
});

test('attempt #2 to delete totally_indestructible VM', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }

    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            // should fail!
            t.ok(err && err.message.match(/indestructible_delegated is set/),
                'delete: ' + (err ? err.message : 'succeeded'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('make totally_indestructible VM\'s delegated destructible', function (t) {
    if (current_vm_aborted) {
        t.ok(false, 'current VM aborted, skipping');
        t.end();
        return;
    }
    changeIndestructibility(t, vm_uuid, 'indestructible_delegated', false,
        function () {
            t.end();
        }
    );
});

test('delete totally_indestructible VM', function (t) {
    // on destroy we ignore current_vm_aborted because we want to destroy anyway
    // if it exists. If we don't future tests might fail because this is here.
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            t.ok(!err, 'delete VM: ' + (err ? err.message : 'success'));
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});
