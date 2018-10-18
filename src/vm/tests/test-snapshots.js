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

var common = require('./common');
var cp = require('child_process');
var execFile = cp.execFile;
var fs = require('fs');
var net = require('net');
var path = require('path');
var VM = require('/usr/vm/node_modules/VM');
var vasync = require('/usr/vm/node_modules/vasync');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var vmobj;

var MAGIC_STRING1 = 'snapshots are so much fun for everyone!';
var MAGIC_STRING2 = 'snapshots get more fun the more you do!';
var MAGIC_STRING3 = 'the third snapshot is yet even more fun!';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var vm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;

// TODO: test that order is correct on resulting .snapshots member

function hasSnapshot(snapshots, snapname)
{
    var snap;

    for (snap in snapshots) {
        if (snapshots[snap].name === snapname) {
            return true;
        }
    }

    return false;
}

// create VM try to snapshot, should fail

test('create joyent-minimal VM with delegated dataset', function (t) {
    var payload = {
        alias: 'test-snapshots-' + process.pid,
        brand: 'joyent-minimal',
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                common.ifError(t, e, 'loading VM after create');
                if (!e) {
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

test('create joyent-minimal snapshot that should fail with delegated dataset',
function (t) {
    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, 'snapshot1', {}, function (err) {
        t.ok(err, 'error creating snapshot1 of ' + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (!e) {
                t.ok(o.snapshots.length === 0, '0 snapshots after create');
            } else {
                abort = true;
            }
            t.end();
        });
    });
});

test('delete joyent-minimal VM w/ delegated dataset', function (t) {
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

// create zone with delegated dataset try to snapshot, should fail

test('create KVM VM', function (t) {
    var payload = {
        alias: 'test-snapshots-' + process.pid,
        brand: 'kvm',
        autoboot: false,
        do_not_inventory: true,
        ram: 128,
        disks: [ {
            size: 5120,
            model: 'virtio'
        } ]
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                common.ifError(t, err, 'loading VM after create');
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

test('create snapshot that should fail on KVM VM', function (t) {
    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, 'snapshot1', {}, function (err) {
        t.ok(err, 'error creating snapshot1 of ' + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (!e) {
                t.ok(o.snapshots.length === 0, '0 snapshots after create');
            } else {
                abort = true;
            }
            t.end();
        });
    });
});

test('delete KVM VM', function (t) {
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

//    create snapshot
//    snapshot count == 1
//    replace data
//    create second snapshot
//    snapshot count == 2
//    rollback to snapshot1
//    read data
//    rollback to snapshot2
//    read data
//    delete snapshot1
//    snapshot count == 1
//    delete snapshot2
//    snapshot count == 0
//    create 100 snapshots
//    delete 100 snapshots


test('create joyent-minimal VM w/o delegated', function (t) {
    var payload = {
        alias: 'test-snapshots-' + process.pid,
        brand: 'joyent-minimal',
        autoboot: true,
        image_uuid: image_uuid,
        do_not_inventory: true
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                common.ifError(t, err, 'loading VM after create');
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

test('create snapshot without vmsnap name and it should not show up',
function (t) {
    var dataset = vmobj.zfs_filesystem;
    var snapshot = dataset + '@manual-snapshot';

    execFile('/usr/sbin/zfs', ['snapshot', snapshot], function (error) {
        common.ifError(t, error, 'created manual snapshot');
        if (!error) {
            execFile('/usr/sbin/zfs',
                ['list', '-t', 'snapshot', snapshot], function (err) {
                common.ifError(t, err, 'manual snapshot exists');
                if (!err) {
                    VM.load(vmobj.uuid, function (e, o) {
                        t.ok(!e, 'reload VM after snap'
                            + (e ? ': ' + e.message : ''));
                        if (!e) {
                            t.ok(o.snapshots.length === 0, 'have '
                                + o.snapshots.length
                                + ' snapshots, expected: 0');
                        }
                        t.end();
                    });
                } else {
                    t.end();
                }
            });
        } else {
            t.end();
        }
    });
});

// try to create bad snapshot names

function createBadSnapshot(t, uuid, name, callback)
{
    VM.create_snapshot(uuid, name, {}, function (err) {
        t.ok(err, 'error creating snapshot "' + name + '" of ' + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (!e) {
                t.ok(o.snapshots.length === 0, '0 snapshots after create');
            } else {
                abort = true;
            }
            callback();
        });
    });
}

test('create snapshot with bad name', function (t) {

    /* BEGIN JSSTYLED */
    var bad_names = [
        'thisisareallylongsnapshotnamethatshouldbreakthingsbecauseitiswaytoolongforthemaxsnapshotnamevalue',
        '01234567890123456789012345678901234567890123456789012345678901234567890123456789',
        '!@#)!%*#^@)^#%$@U^@#)$*#@$!@#!@#',
        '\n',
        'bacon & eggs & ham',
        'one fish two fish red fish blue fish',
        'this,string,has,commas'
    ];
    /* END JSSTYLED */

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    function caller(name, cb) {
        createBadSnapshot(t, vmobj.uuid, name, cb);
    }

    vasync.forEachParallel({
        inputs: bad_names,
        func: caller
    }, function (err) {
        common.ifError(t, err,
            'no extra errors from creating all the bad snapshots');
        t.end();
    });
});

test('write file to joyent-minimal zoneroot then snapshot1', function (t) {

    var filename;

    if (abort) {
        t.ok(false, 'skipping writing as test run is aborted.');
        t.end();
        return;
    }

    filename = path.join(vmobj.zonepath, 'root', '/root/hello.txt');

    fs.writeFile(filename, MAGIC_STRING1, function (err) {
        common.ifError(t, err, 'writing file to zoneroot');
        if (err) {
            abort = true;
            t.end();
        } else {
            VM.create_snapshot(vmobj.uuid, 'snapshot1', {}, function (snaperr) {
                common.ifError(t, snaperr, 'creating snapshot of '
                    + vmobj.uuid);
                VM.load(vmobj.uuid, function (e, o) {
                    t.ok(!e, 'loading VM after create');
                    if (!e) {
                        t.ok(o.snapshots.length === 1,
                            '1 snapshot after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot1'),
                            'snapshot1 after create');
                    } else {
                        abort = true;
                    }
                    t.end();
                });
            });
        }
    });
});

test('write file to joyent-minimal zoneroot again then snapshot2',
function (t) {
    var filename;

    if (abort) {
        t.ok(false, 'skipping writing as test run is aborted.');
        t.end();
        return;
    }

    filename = path.join(vmobj.zonepath, 'root', '/root/hello.txt');

    fs.writeFile(filename, MAGIC_STRING2, function (err) {
        common.ifError(t, err, 'writing file to zoneroot');
        if (err) {
            abort = true;
            t.end();
        } else {
            VM.create_snapshot(vmobj.uuid, 'snapshot2', {}, function (snaperr) {
                t.ok(!snaperr, 'creating snapshot of ' + vmobj.uuid);
                VM.load(vmobj.uuid, function (e, o) {
                    t.ok(!e, 'loading VM after create');
                    if (!e) {
                        t.ok(o.snapshots.length === 2,
                            '2 snapshots after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot1'),
                            'snapshot1 after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot2'),
                            'snapshot2 after create');
                    } else {
                        abort = true;
                    }
                    t.end();
                });
            });
        }
    });
});

test('try joyent-minimal snapshot2 again', function (t) {

    if (abort) {
        t.ok(false, 'skipping writing as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, 'snapshot2', {}, function (err) {
        t.ok(err, 'error creating duplicate snapshot2 of ' + vmobj.uuid
            + ': ' + (err ? ' ' + err.message : ''));
        t.end();
    });
});

test('write file to joyent-minimal zoneroot one last time, then snapshot3',
function (t) {
    var filename;

    if (abort) {
        t.ok(false, 'skipping writing as test run is aborted.');
        t.end();
        return;
    }

    filename = path.join(vmobj.zonepath, 'root', '/root/hello.txt');

    fs.writeFile(filename, MAGIC_STRING3, function (err) {
        common.ifError(t, err, 'writing file to zoneroot');
        if (err) {
            abort = true;
            t.end();
        } else {
            VM.create_snapshot(vmobj.uuid, 'snapshot3', {}, function (snaperr) {
                t.ok(!snaperr, 'creating snapshot of ' + vmobj.uuid);
                VM.load(vmobj.uuid, function (e, o) {
                    t.ok(!e, 'loading VM after create');
                    if (!e) {
                        t.ok(o.snapshots.length === 3,
                            '3 snapshots after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot1'),
                            'snapshot1 after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot2'),
                            'snapshot2 after create');
                        t.ok(hasSnapshot(o.snapshots, 'snapshot3'),
                            'snapshot3 after create');
                    } else {
                        abort = true;
                    }
                    t.end();
                });
            });
        }
    });
});

test('rollback joyent-minimal to snapshot2 and test data', function (t) {
    if (abort) {
        t.ok(false, 'skipping rollback as test run is aborted.');
        t.end();
        return;
    }

    var filename = path.join(vmobj.zonepath, 'root', '/root/hello.txt');

    VM.rollback_snapshot(vmobj.uuid, 'snapshot2', {}, function (err) {
        common.ifError(t, err, 'rolling back snapshot2 of ' + vmobj.uuid);

        fs.readFile(filename, function (error, data) {
            common.ifError(t, error, 'reading file from ' + filename);
            if (error) {
                abort = true;
                t.end();
                return;
            } else {
                t.ok(data == MAGIC_STRING2, 'string in file is MAGIC_STRING2 ['
                    + data + ',' + MAGIC_STRING2 + ']');
                VM.load(vmobj.uuid, function (e, o) {
                    t.ok(!e, 'loading VM after rollback to snapshot2');
                    if (e) {
                        abort = true;
                        t.end();
                        return;
                    }
                    // snapshot3 should have been deleted since it's newer
                    t.ok(o.snapshots.length === 2,
                        '2 snapshots remain after rollback');
                    t.ok(hasSnapshot(o.snapshots, 'snapshot1'),
                        'snapshot1 after create');
                    t.ok(hasSnapshot(o.snapshots, 'snapshot2'),
                        'snapshot2 after create');
                    t.end();
                });
            }
        });
    });
});

test('rollback joyent-minimal to snapshot1 and test data', function (t) {
    if (abort) {
        t.ok(false, 'skipping rollback as test run is aborted.');
        t.end();
        return;
    }

    var filename = path.join(vmobj.zonepath, 'root', '/root/hello.txt');

    VM.rollback_snapshot(vmobj.uuid, 'snapshot1', {}, function (err) {
        common.ifError(t, err, 'rolling back snapshot1 of '
            + vmobj.uuid);

        fs.readFile(filename, function (error, data) {
            common.ifError(t, error, 'reading file from ' + filename);
            if (error) {
                abort = true;
                t.end();
                return;
            } else {
                t.ok(data == MAGIC_STRING1, 'string in file is MAGIC_STRING1 ['
                    + data + ',' + MAGIC_STRING1 + ']');
                VM.load(vmobj.uuid, function (e, o) {
                    t.ok(!e, 'loading VM after rollback to snapshot1');
                    if (e) {
                        abort = true;
                        t.end();
                        return;
                    }
                    // snapshot3 should have been deleted since it's newer
                    t.ok(o.snapshots.length === 1,
                        '1 snapshot remains after rollback');
                    t.ok(hasSnapshot(o.snapshots, 'snapshot1'),
                        'snapshot1 after create');
                    t.end();
                });
            }
        });
    });
});

test('delete snapshot1 from joyent-minimal', function (t) {

    if (abort) {
        t.ok(false, 'skipping deletion as test run is aborted.');
        t.end();
        return;
    }

    deleteSnapshot(t, vmobj.uuid, 'snapshot1', 0, function (err) {
        common.ifError(t, err, 'deleting snapshot1 of ' + vmobj.uuid);
        if (err) {
            abort = true;
        }
        t.end();
    });
});

test('create snapshot on joyent-minimal with numeric name that should succeed',
function (t) {
    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, '20130131180505', {}, function (err) {
        common.ifError(t, err, 'creating 20130131180505 snapshot of '
            + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (e) {
                abort = true;
                t.end();
                return;
            }
            t.ok(hasSnapshot(o.snapshots, '20130131180505'),
                '20130131180505 after create');
            deleteSnapshot(t, vmobj.uuid, '20130131180505', 0,
                function (delerr) {
                    common.ifError(t, delerr, 'deleting 20130131180505 of '
                        + vmobj.uuid);
                    if (err) {
                        abort = true;
                    }
                    t.end();
                }
            );
        });
    });
});

function createSnapshot(t, uuid, snapname, expected_count, cb) {
    if (abort) {
        t.ok(false, 'skipping create as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, snapname, {}, function (err) {
        common.ifError(t, err, 'creating snapshot ' + snapname + ' of '
            + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (!e) {
                t.ok(o.snapshots.length === expected_count, expected_count
                    + ' snapshot(s) after create');
            } else {
                abort = true;
            }
            cb(e);
        });
    });
}

function deleteSnapshot(t, uuid, snapname, expected_remaining, cb) {
    if (abort) {
        t.ok(false, 'skipping delete as test run is aborted.');
        cb();
        return;
    }

    VM.delete_snapshot(vmobj.uuid, snapname, {}, function (err) {
        common.ifError(t, err, 'deleting ' + snapname + ' of ' + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after delete of ' + snapname);
            if (e) {
                cb(e);
                return;
            }
            // snapshot3 should have been deleted since it's newer
            t.ok(o.snapshots.length === expected_remaining, o.snapshots.length
                + ' snapshots remain after rollback: [expected: '
                + expected_remaining + ']');
            cb();
        });
    });
}

function createXSnapshots(t, x, callback)
{
    if (abort) {
        t.ok(false, 'skipping create-delete as test run is aborted.');
        callback();
        return;
    }

    var creates = 0;

    vasync.whilst(
    function () { return (!abort && creates < x); },
    function (cb) {
        var snapname;

        snapname = 'snapshot' + creates;

        createSnapshot(t, vmobj.uuid, snapname, (creates + 1),
            function (create_err) {
                if (create_err) {
                    common.ifError(t, create_err,
                        'creating snapshot "' + snapname + '"');
                }
                creates++;
                cb(create_err);
            }
        );
    },
    function (err) {
        common.ifError(t, err, 'creating ' + x + ' snapshots');
        if (err) {
            abort = true;
        }
        callback(err);
    });
}

test('create 50 snapshots on joyent-minimal', function (t) {

    createXSnapshots(t, 50, function (err) {
        t.end();
    });

});

test('delete 50 snapshots on joyent-minimal', function (t) {

    if (abort) {
        t.ok(false, 'skipping create-delete as test run is aborted.');
        t.end();
        return;
    }

    var deletes = 49;

    vasync.whilst(
    function () { return (!abort && deletes >= 0); },
    function (callback) {
        var snapname;

        snapname = 'snapshot' + deletes;
        deleteSnapshot(t, vmobj.uuid, snapname, deletes, function (delete_err) {
            if (delete_err) {
                common.ifError(t, delete_err, 'deleting snapshot "'
                    + snapname + '"');
            }
            deletes--;
            callback(delete_err);
        });
    },
    function (err) {
        common.ifError(t, err, 'deleting 50 snapshots');
        if (err) {
            abort = true;
        }
        t.end();
    });
});

test('create/delete snapshot on joyent-minimal should update last_modified',
function (t) {

    var pre_snap_timestamp;
    var post_snap_timestamp;
    var post_delete_timestamp;

    if (abort) {
        t.ok(false, 'skipping create-delete last_modified test as test run is '
            + 'aborted.');
        t.end();
        return;
    }

    vasync.pipeline({funcs: [
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, obj) {
                common.ifError(t, err,
                    'loading VM before last_modified snapshot');
                if (!err) {
                    pre_snap_timestamp = obj.last_modified;
                }
                cb(err);
            });
        }, function (_, cb) {
            setTimeout(function () {
                createSnapshot(t, vmobj.uuid, 'modifyme', 1, function (err) {
                    common.ifError(t, err,
                        'created snapshot for last_modified test');
                    cb(err);
                });
            }, 1000);
        }, function (_, cb) {
            VM.load(vmobj.uuid, function (err, obj) {
                common.ifError(t, err, 'loaded VM after snapshot');
                if (!err) {
                    post_snap_timestamp = obj.last_modified;
                }
                cb(err);
            });
        }, function (_, cb) {
            setTimeout(function () {
                deleteSnapshot(t, vmobj.uuid, 'modifyme', 0, function (err) {
                    common.ifError(t, err,
                        'deleted snapshot for last_modified test');
                    cb(err);
                });
            }, 1000);
        }, function (_, cb) {
            VM.load(vmobj.uuid, function (err, obj) {
                common.ifError(t, err, 'loaded VM after delete snapshot');
                if (!err) {
                    post_delete_timestamp = obj.last_modified;
                }
                cb(err);
            });
        }
    ]}, function (err) {
        if (!err) {
            t.ok((Date.parse(pre_snap_timestamp)
                < Date.parse(post_snap_timestamp)),
                'create snapshot should have bumped last modified ['
                + pre_snap_timestamp  + ' < ' + post_snap_timestamp + ']');
            t.ok((Date.parse(post_snap_timestamp)
                < Date.parse(post_delete_timestamp)),
                'delete snapshot should have bumped last modified ['
                + post_snap_timestamp  + ' < ' + post_delete_timestamp + ']');
        }
        t.end();
    });
});

test('create/delete joyent-minimal snapshot should handle mounting '
    + '/checkpoints', function (t) {
    var snapname = 'mountie';
    var checkpoint_dir
        = path.join(vmobj.zonepath, 'root', 'checkpoints', snapname);

    if (abort) {
        t.ok(false, 'skipping checkpoints tests');
        t.end();
        return;
    }

    vasync.pipeline({funcs: [
        function (_, cb) {
            createSnapshot(t, vmobj.uuid, snapname, vmobj.snapshots.length + 1,
                function (err) {
                    common.ifError(t, err,
                        'created snapshot for last_modified test');
                    cb(err);
                }
            );
        }, function (_, cb) {
            var passwd_file = path.join(checkpoint_dir + '/etc/passwd');

            fs.exists(passwd_file, function (exists) {
                var err;
                t.ok(exists, passwd_file + ' exists? ' + exists);
                if (!exists) {
                    err = new Error('unable to find /etc/passwd in '
                        + checkpoint_dir);
                }
                cb(err);
            });
        }, function (_, cb) {
            deleteSnapshot(t, vmobj.uuid, snapname, 0, function (err) {
                common.ifError(t, err, 'deleted ' + snapname + ' snapshot for '
                    + vmobj.uuid);
                cb(err);
            });
        }, function (_, cb) {

            fs.exists(checkpoint_dir, function (exists) {
                var err;
                t.ok(!exists, checkpoint_dir + ' exists? ' + exists);
                if (exists) {
                    err = new Error(checkpoint_dir
                        + ' still exists after snapshot deletion');
                }
                cb(err);
            });
        }
    ]}, function (err) {
        common.ifError(t, err, 'testing /checkpoints');
        t.end();
    });
});


// create 10 snapshots (to test that deleting a VM with snapshots works)
test('create 10 more snapshots of joyent-minimal VM', function (t) {

    createXSnapshots(t, 10, function (err) {
        t.end();
    });

});

test('delete joyent-minimal VM', function (t) {

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

test('create stopped joyent-minimal VM', function (t) {
    var payload = {
        alias: 'test-snapshots-' + process.pid,
        brand: 'joyent-minimal',
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                common.ifError(t, err, 'loading VM after create');
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

test('take snapshot of stopped joyent-minimal VM (should not mount)',
function (t) {

    if (abort) {
        t.ok(false, 'skipping snapshot as test run is aborted.');
        t.end();
        return;
    }

    VM.create_snapshot(vmobj.uuid, 'shouldntmount', {}, function (err) {
        common.ifError(t, err, 'creating snapshot of ' + vmobj.uuid);
        VM.load(vmobj.uuid, function (e, o) {
            t.ok(!e, 'loading VM after create');
            if (!e) {
                t.ok(o.snapshots.length === 1, '1 snapshot after create');
                t.ok(hasSnapshot(o.snapshots, 'shouldntmount'),
                    'have snapshot "shouldntmount" after create');
                fs.exists(o.zonepath + '/root/checkpoints/shouldntmount/root',
                    function (exists) {
                        t.ok(!exists, o.zonepath
                            + '/root/checkpoints/shouldntmount wasn\'t mounted:'
                            + ' ' + !exists);
                        t.end();
                    }
                );
            } else {
                abort = true;
                t.end();
            }
        });
    });
});

test('delete stopped joyent-minimal VM', function (t) {

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

test('create joyent-minimal VM to test metadata through rollback',
function (t) {
    var payload = {
        alias: 'test-snapshots-' + process.pid,
        brand: 'joyent-minimal',
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true
    };
    vmobj = undefined;

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                common.ifError(t, err, 'loading VM after create');
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

test('create garbage /.zonecontrol/metadata.sock', function (t) {
    var server;
    var zonecontrol;

    t.ok(vmobj, 'have vmobj');
    if (!vmobj) {
        t.end();
        return;
    }

    zonecontrol = vmobj.zonepath + '/root/.zonecontrol/metadata.sock';
    try {
        fs.mkdirSync(path.dirname(zonecontrol));
    } catch (e) {
        t.equal(e.code, 'EEXIST', 'mkdir error is EEXIST');
    }
    try {
        fs.unlinkSync(zonecontrol);
    } catch (e) {
        t.equal(e.code, 'ENOENT', 'unlink error is ENOENT');
    }
    server = new net.Server();
    server.listen(zonecontrol, function () {
        server.unref();
        t.ok(fs.existsSync(zonecontrol), zonecontrol + ' exists');
        t.end();
    });
});

test('snapshot zone with garbage metadata.sock', function (t) {
    t.ok(vmobj, 'have vmobj');

    if (!vmobj) {
        t.end();
        return;
    }

    execFile('/usr/sbin/zfs',
        ['snapshot', vmobj.zfs_filesystem + '@garbage_mdata'], function (err) {
        common.ifError(t, err, 'create garbage_mdata snapshot');
        t.end();
    });
});

test('boot zone with garbage metadata.sock, try mdata-get', function (t) {
    t.ok(vmobj, 'have vmobj');

    if (!vmobj) {
        t.end();
        return;
    }

    // we boot with zoneadm to mimic marlin-agent
    execFile('/usr/sbin/zoneadm', ['-z', vmobj.uuid, 'boot'], function (err) {
        common.ifError(t, err, 'boot zone');
        // Try to load our own uuid from metadata. Should work because this
        // will be first boot and metadata agent will create its socket the
        // first time replacing our garbage one.
        execFile('/usr/sbin/zlogin', [vmobj.uuid, 'mdata-get', 'sdc:uuid'],
            function (e, stdout) {

            t.ok(!e, 'zlogin mdata-get: ' + (e ? ' ' + e.message : 'success'));
            t.equal(stdout.trim(), vmobj.uuid, 'load uuid from mdata-get');
            t.end();
        });
    });
});

test('rollback to garbage snapshot, try mdata-get again', function (t) {
    t.ok(vmobj, 'have vmobj');

    if (!vmobj) {
        t.end();
        return;
    }

    // we halt with zoneadm to mimic marlin-agent
    execFile('/usr/sbin/zoneadm', ['-z', vmobj.uuid, 'halt'], function (err) {
        common.ifError(t, err, 'halt zone');
        execFile('/usr/sbin/zfs',
            ['rollback', vmobj.zfs_filesystem + '@garbage_mdata'],
            function (e) {

            t.ok(!e, 'rollback garbage_mdata snapshot: '
                + (e ? ' ' + e.message : 'success'));
            // Try to load our own uuid from metadata. Should work because
            // metadata agent will see that the socket is stale and recreate
            // with a working one.
            execFile('/usr/sbin/zoneadm',
                ['-z', vmobj.uuid, 'boot'], function (be) {

                t.ok(!be, 'boot zone: ' + (be ? be.message : 'success'));
                execFile('/usr/sbin/zlogin',
                    [vmobj.uuid, 'mdata-get', 'sdc:uuid'],
                    {timeout: 30 * 1000}, function (ze, stdout) {

                    t.ok(!ze, 'zlogin mdata-get: '
                        + (ze ? ' ' + ze.message : 'success'));
                    t.equal(stdout.trim(), vmobj.uuid,
                        'load uuid from mdata-get');
                    t.end();
                });
            });
        });
    });
});

test('modify tags and rollback', function (t) {
    t.ok(vmobj, 'have vmobj');

    if (!vmobj) {
        t.end();
        return;
    }

    var firstTags = {
        foo: 1
    };
    var secondTags = {
        foo: 2
    };

    vasync.pipeline({funcs: [
        // Set the initial tags
        function (_, cb) {
            VM.update(vmobj.uuid, {set_tags: firstTags}, function (err) {
                common.ifError(t, err, 'VM.update first tags');
                cb(err);
            });
        },

        // Ensure the first set worked
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, o) {
                common.ifError(t, err, 'loading VM after update first tags');
                t.deepEqual(o.tags, firstTags, 'first tags are correct');
                cb(err);
            });
        },

        // Create a snapshot
        function (_, cb) {
            VM.create_snapshot(vmobj.uuid, 'initial-tags-snap', {},
                function (err) {

                common.ifError(t, err, 'VM.create_snapshot initial-tags-snap');
                cb(err);
            });
        },

        // Set the second set of tags
        function (_, cb) {
            VM.update(vmobj.uuid, {set_tags: secondTags}, function (err) {
                common.ifError(t, err, 'VM.update second tags');
                cb(err);
            });
        },

        // Ensure the second tags set worked
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, o) {
                common.ifError(t, err, 'loading VM after update second tags');
                t.deepEqual(o.tags, secondTags, 'second tags are correct');
                cb(err);
            });
        },

        // Rollback the VM
        function (_, cb) {
            VM.rollback_snapshot(vmobj.uuid, 'initial-tags-snap', {},
                function (err) {

                common.ifError(t, err, 'VM.rollback initial-tags-snap');
                cb(err);
            });
        },

        // Ensure the tags have now reverted to the first set
        function (_, cb) {
            VM.load(vmobj.uuid, function (err, o) {
                common.ifError(t, err, 'loading VM after rollback');
                t.deepEqual(o.tags, firstTags, 'rollback tags are correct');
                cb(err);
            });
        }
    ]}, function (err) {
        common.ifError(t, err, 'test modify tags and rollback');
        t.end();
    });
});

test('delete VM with garbage snapshot', function (t) {
    t.ok(vmobj, 'have vmobj');

    if (!vmobj) {
        t.end();
        return;
    }

    VM.delete(vmobj.uuid, function (err) {
        common.ifError(t, err, 'delete VM');
        t.end();
        vmobj = {};
    });
});
