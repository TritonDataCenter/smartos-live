// Copyright 2012 Joyent, Inc.  All rights reserved.

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var vmobj;

var image_uuid = vmtest.CURRENT_SMARTOS;
var vm_image_uuid = vmtest.CURRENT_UBUNTU;

test('import joyent image', {'timeout': 360000}, function(t) {
    vmtest.ensureImage(t, '/zones/' + image_uuid, image_uuid, function (err) {
        t.ok(!err, "joyent image exists");
        t.end();
    });
});

test('import ubuntu image', {'timeout': 360000}, function(t) {
    vmtest.ensureImage(t, '/dev/zvol/rdsk/zones/' + vm_image_uuid, vm_image_uuid, function (err) {
        t.ok(!err, "ubuntu image exists");
        t.end();
    });
});

function createSnapshot(dataset, name, callback)
{
    execFile('/usr/sbin/zfs', ['snapshot', dataset + '@' + name],
        function (error, stdout, stderr) {
            var res;

            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
            }

            callback(error);
        }
    );
}

test('create zone with delegated dataset', {'timeout': 240000}, function(t) {
    var payload = {
        'brand': 'joyent-minimal',
        'autoboot': false,
        'image_uuid': image_uuid,
        'alias': 'test-snapshot-' + process.pid,
        'do_not_inventory': true,
        'delegate_dataset': true
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!err, 'loading VM after create');
                if (!err) {
                    t.ok(o.snapshots.length === 0, 'no snapshots after create');
                    t.ok(o.hasOwnProperty('zfs_filesystem'),
                        'has zfs_filesystem');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

function testCreateSnapshot(t, dataset, name, numExpected, callback)
{
    var found = false;

    createSnapshot(dataset, name, function (err) {
        if (err) {
            t.ok(false, 'Failed to create ' + name + ': ' + JSON.stringify({
                'message': err.mesage,
                'stdout': err.stdout,
                'stderr': err.stderr
            }));
            abort = true;
            callback(err);
        } else {
            // worked!
            t.ok(true, 'Created ' + dataset + '@' + name);

            VM.load(vmobj.uuid, function (e, o) {
                t.ok(!err, 'loading VM after snapshot');
                if (!err) {
                    t.ok(o.snapshots.length === numExpected,
                        'correct number of snapshots after create ['
                        + numExpected + ',' + o.snapshots.length + ']');
                    for (snap in o.snapshots) {
                        snap = o.snapshots[snap];
                        if (snap.name === (dataset + '@' + name)) {
                            found = true;
                        }
                    }
                    t.ok(found, 'found newly created snapshot');
                    if (!found) {
                        abort = true;
                    }
                } else {
                    abort = true;
                }
                callback();
            });
        }
    });
}


// create snapshot2 of root
// create snapshots of data

test('create snapshot 1 of zoneroot', {'timeout': 240000}, function(t) {

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, vmobj.zfs_filesystem, 'snapshot1', 1, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('create snapshot 2 of zoneroot', {'timeout': 240000}, function(t) {

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, vmobj.zfs_filesystem, 'snapshot2', 2, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('create snapshot 3 of delegated', {'timeout': 240000}, function(t) {

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, vmobj.zfs_filesystem + '/data', 'snapshot1', 3, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('create snapshot 4 of delegated', {'timeout': 240000}, function(t) {

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, vmobj.zfs_filesystem + '/data', 'snapshot2', 4, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('delete zone', function(t) {
    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
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

test('create KVM VM', {'timeout': 240000}, function(t) {
    var payload = {
        'brand': 'kvm',
        'autoboot': false,
        'alias': 'test-snapshot-' + process.pid,
        'do_not_inventory': true,
        'ram': 128,
        'disks': [{
            'size': 5120,
            'model': 'virtio'
        }]
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!err, 'loading VM after create');
                if (!err) {
                    t.ok(o.snapshots.length === 0, 'VM has no snapshots');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

test('create snapshot 1 of disk0', {'timeout': 240000}, function(t) {

    var disk = vmobj.disks[0].zfs_filesystem;

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, disk, 'snapshot1', 1, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('create snapshot 2 of disk0', {'timeout': 240000}, function(t) {

    var disk = vmobj.disks[0].zfs_filesystem;

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    testCreateSnapshot(t, disk, 'snapshot2', 2, function (err) {
        if (err) {
            t.ok(false, 'failed to create snapshot: ' + err.message);
            if (err.hasOwnProperty('stdout')) {
                t.ok(false, 'fail stdout: ' + err.stdout);
            }
            if (err.hasOwnProperty('stderr')) {
                t.ok(false, 'fail stderr: ' + err.stderr);
            }
            abort = true;
        }
        t.end();
    });
});

test('delete vm', function(t) {
    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
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
        });
    } else {
        t.ok(false, 'no VM to delete');
        abort = true;
        t.end();
    }
});
