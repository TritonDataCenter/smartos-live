// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var docker_image_uuid = vmtest.CURRENT_DOCKER_ALPINE_UUID;
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
    payload.image_uuid = vmtest.CURRENT_DOCKER_ALPINE_UUID;

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
