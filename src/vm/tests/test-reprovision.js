// Copyright 2018 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var common = require('./common');
var cp = require('child_process');
var execFile = cp.execFile;
var f = require('util').format;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var docker_image_uuid = vmtest.CURRENT_DOCKER_IMAGE_UUID;
var smartos_image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var kvm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;
var vmobj;

var smartos_payload = {
    alias: 'test-reprovision-' + process.pid,
    brand: 'joyent-minimal',
    image_uuid: smartos_image_uuid,
    do_not_inventory: true,
    delegate_dataset: true,
    ram: 256,
    max_swap: 1024,
    customer_metadata: {hello: 'world'}
};

var lxdocker_payload = {
    alias: 'test-reprovision-' + process.pid,
    autoboot: true,
    brand: 'lx',
    do_not_inventory: true,
    docker: true,
    internal_metadata: {
        'docker:attach_stderr': true,
        'docker:attach_stdin': true,
        'docker:attach_stdout': true,
        'docker:cmd': '["/bin/sh"]',
        'docker:entrypoint': '[]',
        'docker:env': '[]',
        'docker:noipmgmtd': true,
        'docker:open_stdin': true,
        'docker:restartpolicy': 'always',
        'docker:tty': true
    },
    kernel_version: '3.13.0',
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024
};

var payload_test_zfs_on_reprovision = {
    alias: 'test-reprovision-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    image_uuid: vmtest.CURRENT_SMARTOS_UUID,
    do_not_inventory: true
};


function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {stdout: stdout, stderr: stderr});
        } else {
            callback(null, {stdout: stdout, stderr: stderr});
        }
    });
}

// trim functions also copied from VM.js
function ltrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('^[' + chars + ']+', 'g'), '');
}

function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function trim(str, chars)
{
    return ltrim(rtrim(str, chars), chars);
}

[['zone', smartos_payload, smartos_image_uuid]].forEach(function (d) {
    var thing_name = d[0];
    var thing_payload = d[1];
    var thing_image_uuid = d[2];

    test('create ' + thing_name, function (t) {
        VM.create(thing_payload, function (err, obj) {
            if (err) {
                t.ok(false, 'error creating VM: ' + err.message);
                t.end();
            } else {
                VM.load(obj.uuid, function (e, o) {
                    if (e) {
                        t.ok(false, 'unable to load VM after create');
                        abort = true;
                        t.end();
                        return;
                    }
                    vmobj = o;
                    t.ok(true, 'created VM: ' + vmobj.uuid);
                    t.end();
                });
            }
        });
    });

    // put some junk on both datasets, should stay in data dataset and be gone
    // from zoneroot
    test('write junk to both datasets', function (t) {
        var cmd = '/usr/sbin/zlogin';

        if (abort) {
            t.ok(false, 'skipping junk writing as test run is aborted.');
            t.end();
            return;
        }

        execFile(cmd, [vmobj.zonename, 'echo "hello world" > hello.txt '
            + '&& cp hello.txt /zones/$(zonename)/data/'],
            function (err, stdout, stderr) {

            if (err) {
                abort = true;
                err.stdout = stdout;
                err.stderr = stderr;
            }
            t.ok(!err, 'wrote files in zone: ' + (err ? err.message
                + '\n-stdout-\n' +  err.stdout + '\n-stderr-\n'
                + err.stderr : 'success'));
            t.end();
        });
    });

    // See OS-2270, we used to die when there were snapshots of the zoneroot.
    test('snapshot zoneroot of ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping snapshot as test run is aborted.');
            t.end();
            return;
        }

        zfs(['snapshot', vmobj.zfs_filesystem + '@breakme'],
            function (err, fds) {

                t.ok(!err, 'snapshotted' + vmobj.zfs_filesystem + ': '
                    + JSON.stringify(fds));
                t.end();
            }
        );

    });

    test('reprovision ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping reprovision as test run is aborted.');
            t.end();
            return;
        }

        VM.reprovision(vmobj.uuid, {'image_uuid': thing_image_uuid},
            function (err) {
                t.ok(!err, 'reprovision: ' + (err ? err.message : 'success'));
                if (err) {
                    abort = true;
                }
                t.end();
            }
        );
    });

    test('check junk files after reprovision', function (t) {
        if (abort) {
            t.ok(false, 'skipping file checks as test run is aborted.');
            t.end();
            return;
        }
        fs.exists(vmobj.zonepath + '/root/root/hello.txt', function (exists) {
            t.ok(!exists, vmobj.zonepath
                + '/root/root/hello.txt should not exist: ' + !exists);
            fs.readFile(vmobj.zonepath + '/root/zones/' + vmobj.zonename
                + '/data/hello.txt', function (err, data) {

                t.ok(!err, 'read ' + vmobj.zonepath + '/root/zones/'
                    + vmobj.zonename + '/data/hello.txt: '
                    + (err ? err.message : 'success'));
                t.ok(trim(data.toString()) === 'hello world', 'data is: "'
                    + trim(data.toString()) + '" expected: "hello world"');
                t.end();
            });
        });
    });

    test('check properties after reprovision', function (t) {
        if (abort) {
            t.ok(false, 'skipping property checks as test run is aborted.');
            t.end();
            return;
        }
        VM.load(vmobj.uuid, function (err, obj) {
            var new_vm;
            var old_vm;
            var prop;

            t.ok(!err, 'loaded VM after reprovision: '
                + (err ? err.message : 'success'));
            if (err) {
                abort = true;
                t.end();
                return;
            }

            for (prop in vmobj) {
                if (['boot_timestamp', 'last_modified', 'pid', 'zoneid']
                    .indexOf(prop) !== -1) {

                    // we expect these properties to be different.
                    continue;
                }
                t.ok(obj.hasOwnProperty(prop), 'new object still has property '
                    + prop);
                if (obj.hasOwnProperty(prop)) {
                    old_vm = JSON.stringify(vmobj[prop]);
                    new_vm = JSON.stringify(obj[prop]);
                    t.ok(new_vm == old_vm, 'matching properties ' + prop
                        + ': [' + old_vm + '][' + new_vm + ']');
                }
            }
            for (prop in obj) {
                if (!vmobj.hasOwnProperty(prop)) {
                    t.ok(false, 'new object has extra property '
                        + JSON.stringify(prop));
                }
            }
            t.end();
        });
    });

    test('delete ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping delete as test run is aborted.');
            t.end();
            return;
        }
        if (vmobj.uuid) {
            VM.delete(vmobj.uuid, function (err) {
                if (err) {
                    t.ok(false, 'error deleting VM: ' + err.message);
                } else {
                    t.ok(true, 'deleted VM: ' + vmobj.uuid);
                }
                t.end();
            });
        } else {
            t.ok(false, 'no VM to delete');
            t.end();
        }
    });
});


/*
 * Now test for docker
 */

test('create docker VM', function (t) {
    var payload = JSON.parse(JSON.stringify(lxdocker_payload));
    payload.image_uuid = vmtest.CURRENT_DOCKER_IMAGE_UUID;

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            VM.load(obj.uuid, function (e, o) {
                if (e) {
                    t.ok(false, 'unable to load VM after create');
                    abort = true;
                    t.end();
                    return;
                }
                vmobj = o;
                t.ok(true, 'created VM: ' + vmobj.uuid);
                t.end();
            });
        }
    });
});

// put some junk in the zone
test('write junk to docker /root', function (t) {
    var cmd = '/usr/sbin/zlogin';

    if (abort) {
        t.ok(false, 'skipping junk writing as test run is aborted.');
        t.end();
        return;
    }

    execFile(cmd, ['-Qi', vmobj.zonename, '/bin/sh', '-c',
        'echo "hello world" >/root/hello.txt'], function (err, stdout, stderr) {

        if (err) {
            abort = true;
            err.stdout = stdout;
            err.stderr = stderr;
        }
        t.ok(!err, 'wrote file in zone: ' + (err ? err.message
            + '\n-stdout-\n' +  err.stdout + '\n-stderr-\n'
            + err.stderr : 'success'));
        t.end();
    });
});

test('reprovision docker VM', function (t) {
    if (abort) {
        t.ok(false, 'skipping reprovision as test run is aborted.');
        t.end();
        return;
    }

    VM.reprovision(vmobj.uuid, {'image_uuid': vmobj.image_uuid},
        function (err) {
            t.ok(!err, 'reprovision: ' + (err ? err.message : 'success'));
            if (err) {
                abort = true;
            }
            t.end();
        }
    );
});

test('check docker VM junk files after reprovision', function (t) {
    if (abort) {
        t.ok(false, 'skipping file checks as test run is aborted.');
        t.end();
        return;
    }
    fs.exists(vmobj.zonepath + '/root/root/hello.txt', function (exists) {
        t.ok(!exists, 'junk file is gone');
        t.end();
    });
});

test('check docker VM properties after reprovision', function (t) {
    if (abort) {
        t.ok(false, 'skipping property checks as test run is aborted.');
        t.end();
        return;
    }
    VM.load(vmobj.uuid, function (err, obj) {
        var new_vm;
        var old_vm;
        var prop;

        t.ok(!err, 'loaded VM after reprovision: '
            + (err ? err.message : 'success'));
        if (err) {
            abort = true;
            t.end();
            return;
        }

        for (prop in vmobj) {
            if (['boot_timestamp', 'last_modified', 'pid', 'zoneid']
                .indexOf(prop) !== -1) {

                // we expect these properties to be different.
                continue;
            }
            t.ok(obj.hasOwnProperty(prop), 'new object still has property '
                + prop);
            if (obj.hasOwnProperty(prop)) {
                old_vm = JSON.stringify(vmobj[prop]);
                new_vm = JSON.stringify(obj[prop]);
                t.ok(new_vm == old_vm, 'matching properties ' + prop
                    + ': [' + old_vm + '][' + new_vm + ']');
            }
        }
        for (prop in obj) {
            if (!vmobj.hasOwnProperty(prop)) {
                t.ok(false, 'new object has extra property '
                    + JSON.stringify(prop));
            }
        }
        t.end();
    });
});

test('delete docker VM', function (t) {
    if (vmobj.uuid) {
        VM.delete(vmobj.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + vmobj.uuid);
            }
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});

test('test zfs reprovision default properties', function (t) {
    var p = JSON.parse(JSON.stringify(payload_test_zfs_on_reprovision));
    var state = {brand: p.brand};
    var _vmobj;

    vmtest.on_new_vm(t, p.image_uuid, p, state, [
        function (cb) {
            VM.load(state.uuid, {}, function (err, obj) {
                t.ok(!err, 'reloaded VM after create: '
                    + (err ? err.message : 'no error'));
                cb(err);
            });
        }, function (cb) {
            VM.reprovision(state.uuid, {'image_uuid': p.image_uuid},
                function (err) {
                    t.ok(!err,
                        'reprovision: ' + (err ? err.message : 'success'));
                    cb(err);
                }
            );
        }, function (cb) {
            VM.load(state.uuid, {}, function (err, obj) {
                t.ok(!err, 'reloaded VM after reprovision: '
                    + (err ? err.message : 'no error'));
                _vmobj = obj;
                cb(err);
            });
        }, function (cb) {
            vmtest.checkDefaultZfsProperties(t, _vmobj.zfs_filesystem,
                'default zoneroot properties match defaults after reprovision',
                cb);
        }
    ]);
});

test('test zfs reprovision custom properties', function (t) {
    var p = JSON.parse(JSON.stringify(payload_test_zfs_on_reprovision));
    var state = {
        brand: p.brand
    };
    var zfsArgs = [
        'get',
        '-Hpo',
        'value',
        'compression',
        'zones'
    ];
    var algorithmToUse;

    // Figure out the current compression algorithm set for 'zones'
    common.zfs(zfsArgs, function (zfsErr, out) {
        common.ifError(t, zfsErr, 'zfs get compression');
        if (zfsErr) {
            t.done();
            return;
        }

        /*
         * We want to use an algorithm here that is different than what 'zones'
         * (the parent dataset) is currently set to use.  The algorithm we use
         * here doesn't really matter, we just want something other than what
         * will be inherited by default.
         *
         * ZFS also has the notion of a "default compression algorithm" if the
         * property is set to 'on'.  The VM JSON payload however, does not know
         * this and will still consider "on" to be a different property than
         * whatever the default algorithm according to ZFS happens to be (could
         * be "lzib", or even "lz4").
         *
         * To make things even more confusing, `proptable.js` has a default
         * value set for `zfs_root_compression` (currently set to "off").  This
         * means setting the property to "off" will result in the property being
         * removed from the VM JSON payload.
         *
         * With all of this knowledge, we avoid manually setting the
         * `zfs_root_compression` property on the JSON payload to "off", and we
         * also ensure it is set to something that is different than what the
         * 'zones' dataset is currently set to.
         */
        var alg = out.trim();
        switch (alg) {
        case 'gzip':
            algorithmToUse = 'lz4';
            break;
        default:
            algorithmToUse = 'gzip';
            break;
        }

        t.ok(true, f('zones compression: %j, using for vm: %j',
            alg, algorithmToUse));

        p.zfs_root_compression = algorithmToUse;

        vmtest.on_new_vm(t, p.image_uuid, p, state, [
            function (cb) {
                VM.load(state.uuid, {}, function (err, obj) {
                    common.ifError(t, err, 'reload VM after create');

                    cb(err);
                });
            }, function (cb) {
                VM.reprovision(state.uuid, {image_uuid: p.image_uuid},
                    function (err) {
                        common.ifError(t, err, 'reprovision VM');

                        cb(err);
                    }
                );
            }, function (cb) {
                VM.load(state.uuid, {}, function (err, obj) {
                    common.ifError(t, err, 'reload VM after reprovision');

                    t.equal(obj.zfs_root_compression, algorithmToUse,
                        'zfs_root_compression set properly');

                    cb(err);
                });
            }
        ]);
    });
});
