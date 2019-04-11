// Copyright 2019 Joyent, Inc.

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var vmobj;

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var vm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;

test('create zone with root_recsize 64k', function(t) {
    var payload = {
        alias: 'test-blocksizes-' + process.pid,
        brand: 'joyent-minimal',
        cpu_cap: 100,
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true,
        zfs_root_recsize: 65536,
        zfs_data_recsize: 1024
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!e, 'loading VM after create');
                if (!e) {
                    t.ok(o.zfs_root_recsize === 65536,
                        'root_recsize is correct after load [' + o.zfs_root_recsize
                        + ',65536]');
                    t.ok(o.zfs_data_recsize === 1024,
                        'data_recsize is correct after load [' + o.zfs_data_recsize
                        + ',1024]');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

function testInvalidRootRecsize(t, size, vmobj, callback)
{
    var payload = {
        zfs_root_recsize: size
    };
    var prev_size = vmobj.zfs_root_recsize;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        callback();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        // we expect this to fail
        if (e) {
            t.ok(true, 'failed to update VM: ' + e.message);

            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    t.ok(o.zfs_root_recsize === prev_size,
                        'failed update did not modify recsize');
                }
                callback();
            });
        } else {
            t.ok(false, 'succeeded in updating VM to illegal zfs_root_recsize value');
            abort = true;
            callback();
        }
    });
}

function testValidRootRecsize(t, size, vmobj, callback)
{
    var payload = {
        zfs_root_recsize: size
    };
    var prev_size = vmobj.zfs_root_recsize;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        callback();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        // we expect this to succeed
        if (e) {
            t.ok(false, 'failed to update VM: ' + e.message);
            abort = true;
            callback();
        } else {
            t.ok(true, 'succeeded in updating VM to new zfs_root_recsize value');
            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'update broke VM!');
                } else {
                    t.ok(o.zfs_root_recsize === size, 'update modified recsize ['
                        + o.zfs_root_recsize + ',' + size + ']');
                    t.ok(o.zfs_data_recsize === 1024, 'update did not break data_recsize['
                        + o.zfs_data_recsize + ',1024]');
                    if (o.zfs_root_recsize !== size) {
                        abort = true;
                    }
                }
                callback();
            });
        }
    });
}

// test too low
test('update zone with root_recsize 256', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidRootRecsize(t, 256, vmobj, function (e) {
        t.end();
    });
});

// test too high
test('update zone with root_recsize 132096', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidRootRecsize(t, 132096, vmobj, function (e) {
        t.end();
    });
});

// test not-a-power-of-2
test('update zone with root_recsize 31337', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidRootRecsize(t, 31337, vmobj, function (e) {
        t.end();
    });
});

test('update zone with root_recsize 512', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidRootRecsize(t, 512, vmobj, function (e) {
        t.end();
    });
});

test('update zone with root_recsize 131072', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidRootRecsize(t, 131072, vmobj, function (e) {
        t.end();
    });
});

test('update zone with root_recsize 32768', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidRootRecsize(t, 32768, vmobj, function (e) {
        t.end();
    });
});

test('delete root_recsize test zone', function(t) {
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

test('create zone with data_recsize 64k', function(t) {
    var payload = {
        alias: 'test-blocksizes-' + process.pid,
        brand: 'joyent-minimal',
        cpu_cap: 100,
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true,
        zfs_data_recsize: 65536
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!e, 'loading VM after create');
                if (!e) {
                    t.equal(o.zfs_data_recsize, 65536,
                        'recsize is correct after load [' + o.zfs_data_recsize
                        + ',65536]');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

function testInvalidDataRecsize(t, size, vmobj, callback)
{
    var payload = {
        zfs_data_recsize: size
    };
    var prev_size = vmobj.zfs_data_recsize;

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        callback();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        // we expect this to fail
        if (e) {
            t.ok(true, 'failed to update VM: ' + e.message);

            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    t.equal(o.zfs_data_recsize, prev_size,
                        'failed update did not modify recsize');
                }
                callback();
            });
        } else {
            t.ok(false, 'succeeded in updating VM to illegal zfs_data_recsize value');
            abort = true;
            callback();
        }
    });
}

function testValidDataRecsize(t, size, vmobj, callback)
{
    var payload = {
        zfs_data_recsize: size
    };
    var prev_size = vmobj.zfs_data_recsize;

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        callback();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        // we expect this to succeed
        if (e) {
            t.ok(false, 'failed to update VM: ' + e.message);
            abort = true;
            callback();

        } else {
            t.ok(true, 'succeeded in updating VM to new zfs_data_recsize value');
            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'update broke VM!');
                } else {
                    t.equal(o.zfs_data_recsize, size, 'update modified recsize');
                }
                callback();
            });
        }
    });
}

// test too low
test('update zone with data_recsize 256', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidDataRecsize(t, 256, vmobj, function (e) {
        t.end();
    });
});

// test too high
test('update zone with data_recsize 132096', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidDataRecsize(t, 132096, vmobj, function (e) {
        t.end();
    });
});

// test not-a-power-of-2
test('update zone with data_recsize 31337', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testInvalidDataRecsize(t, 31337, vmobj, function (e) {
        t.end();
    });
});

test('update zone with data_recsize 512', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidDataRecsize(t, 512, vmobj, function (e) {
        t.end();
    });
});

test('update zone with data_recsize 131072', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidDataRecsize(t, 131072, vmobj, function (e) {
        t.end();
    });
});

test('update zone with data_recsize 32768', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testValidDataRecsize(t, 32768, vmobj, function (e) {
        t.end();
    });
});

test('delete data_recsize test zone', function(t) {
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

test('create zone with compression', function(t) {
    var payload = {
        alias: 'test-blocksizes-' + process.pid,
        brand: 'joyent-minimal',
        cpu_cap: 100,
        autoboot: false,
        image_uuid: image_uuid,
        do_not_inventory: true,
        delegate_dataset: true,
        zfs_root_compression: 'gzip'
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!e, 'loading VM after create');
                if (!e) {
                    t.equal(o.zfs_root_compression, 'gzip',
                        'compression is correct after load ['
                        + o.zfs_root_compression + ',gzip]');
                    t.ok(!o.hasOwnProperty('zfs_data_compression'),
                        'compression is off for delegated after load ['
                        + o.zfs_data_compression + ',<none>]');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

test('update zone with compression off', function(t) {
    var payload = {
        zfs_root_compression: 'off'
    };

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'updated with zfs_root_compression=off');
            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'update broke VM!');
                } else {
                    if (o.hasOwnProperty('zfs_root_compression')) {
                        t.ok(false, 'failed to remove zfs_root_compression');
                        abort = true;
                    } else {
                        t.ok(true, 'zfs_root_compression removed');
                    }
                }
                t.end();
            });
        }
    });
});

test('update zone with compression gzip-2 for data', function(t) {
    var payload = {
        zfs_data_compression: 'gzip-2'
    };

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'updated with zfs_data_compression=gzip-2');
            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'update broke VM!');
                } else {
                    if (!o.hasOwnProperty('zfs_data_compression')) {
                        t.ok(false, 'failed to set zfs_data_compression');
                        abort = true;
                    } else {
                        t.equal(o.zfs_data_compression, 'gzip-2',
                            'zfs_data_compression was set ['
                            + o.zfs_data_compression + ',gzip-2]');
                        t.ok(!o.hasOwnProperty('zfs_root_compression'),
                            'zfs_root_compression was not set');
                    }
                }
                t.end();
            });
        }
    });
});

test('delete compression test zone', function(t) {
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

test('create KVM with block_size 64k', function(t) {
    var payload = {
        alias: 'test-blocksizes-' + process.pid,
        brand: 'kvm',
        cpu_cap: 100,
        autoboot: false,
        do_not_inventory: true,
        ram: 128,
        disks: [{
            size: 5120,
            model: 'virtio',
            block_size: '65536'
        }]
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!e, 'loading VM after create');
                if (!e) {
                    t.ok(o.disks[0].block_size === 65536,
                        'block_size is correct after load [' + o.disks[0].block_size
                        + ',65536]');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

function testAddDiskInvalidBlockSize(t, size, vmobj, callback)
{
    var payload = {
        add_disks: [{
            size: size,
            model: 'virtio',
            block_size: size
        }]
    };
    var prev_count = vmobj.disks.length;

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        callback();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        // we expect this to fail
        if (e) {
            t.ok(true, 'failed to update VM: ' + e.message);

            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    t.equal(o.disks.length, prev_count,
                        'failed update did not modify disks');
                }
                callback();
            });
        } else {
            t.ok(false, 'succeeded in adding disk to VM with illegal block_size value');
            abort = true;
            callback();
        }
    });
}

// test too low
test('update kvm with block_size 256', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testAddDiskInvalidBlockSize(t, 256, vmobj, function (e) {
        t.end();
    });
});

// test too high
test('update kvm with block_size 132096', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testAddDiskInvalidBlockSize(t, 132096, vmobj, function (e) {
        t.end();
    });
});

// test not-a-power-of-2
test('update kvm with block_size 31337', function(t) {
    var payload;

    if (abort) {
        t.ok(false, 'skipping update as test run is aborted.');
        t.end();
        return;
    }

    testAddDiskInvalidBlockSize(t, 31337, vmobj, function (e) {
        t.end();
    });
});

test('delete kvm vm from blocksize test', function(t) {
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

test('create KVM with compression', function(t) {
    var payload = {
        alias: 'test-blocksizes-' + process.pid,
        brand: 'kvm',
        cpu_cap: 100,
        autoboot: false,
        do_not_inventory: true,
        ram: 128,
        disks: [{
            size: 5120,
            model: 'virtio',
            compression: 'gzip'
        }]
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                t.ok(!e, 'loading VM after create');
                if (!e) {
                    t.equal(o.disks[0].compression, 'gzip',
                        'compression is correct after load ['
                        + o.disks[0].compression + ',gzip]');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

test('update kvm with compression off', function(t) {
    var payload = {
        update_disks: [
            {path: vmobj.disks[0].path, compression: 'off'}
        ]
    };

    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'updated with compression=off');
            VM.load(vmobj.uuid, function (err, o) {
                if (err) {
                    t.ok(false, 'update broke VM!');
                } else {
                    if (!o.disks[0].hasOwnProperty('compression')) {
                        t.ok(false, 'failed to remove compression');
                        abort = true;
                    } else {
                        t.ok(true, 'compression removed');
                    }
                }
                t.end();
            });
        }
    });
});

test('delete kvm vm from compression test', function(t) {
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
