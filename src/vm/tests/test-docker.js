// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that docker flag works as expected when setting/unsetting
// Also test that /etc/resolv.conf, /etc/hosts and /etc/hostname are set
// correctly.
//

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var path = require('path');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-docker-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    max_locked_memory: 512,
    max_physical_memory: 512,
    max_swap: 1024
};
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

var log_modes = [
    {zlog_mode: 'gt-', app_svc_dependent: undefined,
        payload: {'docker:tty': true, 'docker:logdriver': 'json-file'}},
    {zlog_mode: 'gt-', app_svc_dependent: undefined,
        payload: {'docker:tty': true}},
    {zlog_mode: 'g--', app_svc_dependent: undefined,
        payload: {'docker:tty': false, 'docker:logdriver': 'json-file'}},
    {zlog_mode: 'g--', app_svc_dependent: undefined,
        payload: {}},
    {zlog_mode: '-t-', app_svc_dependent: undefined,
        payload: {'docker:tty': true, 'docker:logdriver': 'none'}},
    {zlog_mode: '---', app_svc_dependent: undefined,
        payload: {'docker:tty': false, 'docker:logdriver': 'none'}},
    {zlog_mode: 'gtn', app_svc_dependent: true,
        payload: {'docker:tty': true, 'docker:logdriver': 'syslog'}},
    {zlog_mode: 'g-n', app_svc_dependent: true,
        payload: {'docker:tty': false, 'docker:logdriver': 'syslog'}}
];

function writeInit(uuid, contents, callback) {
    var filename = '/zones/' + uuid + '/root/root/init';

    fs.writeFile(filename, contents, function (err) {
        if (err) {
            callback(err);
            return;
        }

        /*jsl:ignore*/
        fs.chmodSync(filename, 0755);
        /*jsl:end*/
        callback();
    });
}

function getDockerFlags(t, state, cb) {
    VM.load(state.uuid, function (err, obj) {
        var results = {};

        t.ok(!err, 'loading obj for new VM');
        if (err) {
            cb(err);
            return;
        }

        results.docker = !!obj.docker;

        if (obj.restart_init === false) {
            results.restart_init = false;
        } else {
            results.restart_init = true;
        }

        if (obj.hasOwnProperty('internal_metadata')
            && obj.internal_metadata['docker:id']) {

            results.docker_id = obj.internal_metadata['docker:id'];
        } else {
            results.docker_id = false;
        }

        if (obj.hasOwnProperty('init_name')) {
            results.init_name = obj.init_name;
        } else {
            results.init_name = '';
        }

        if (obj.hasOwnProperty('internal_metadata_namespaces')
            && obj.internal_metadata_namespaces.indexOf('docker') !== -1) {

            results.docker_ns = true;
        } else {
            results.docker_ns = false;
        }

        results.namespaces = obj.internal_metadata_namespaces;

        cb(null, results);
    });
}

test('test docker=true on new VM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var prev_docker_id;
    var state = {brand: payload.brand};

    payload.docker = true;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.ok(flags.docker_id, 'docker:id set after create: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');
                t.ok(!flags.restart_init, 'restart_init is false after create');
                t.equal(flags.init_name, '/usr/vm/sbin/dockerinit',
                    'init_name correct after create');
                cb();
            });
        }, function (cb) {
            // ensure that resolv.conf / hosts / hostname mounted in
            VM.load(state.uuid, function (err, obj) {
                var found_hostname = false;
                var found_hosts = false;
                var found_resolv_conf = false;

                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                if (obj.filesystems.length > 0) {
                    obj.filesystems.forEach(function (f) {
                        if (f.source === obj.zonepath + '/config/resolv.conf') {
                            found_resolv_conf = true;
                        } else if (f.source === obj.zonepath
                            + '/config/hosts') {

                            found_hosts = true;
                        } else if (f.source === obj.zonepath
                            + '/config/hostname') {

                            found_hostname = true;
                        }
                    });

                    t.ok(found_hostname, 'found hostname file in vmobj');
                    t.ok(found_hosts, 'found hosts file in vmobj');
                    t.ok(found_resolv_conf, 'found resolv.conf file in vmobj');
                    cb();
                } else {
                    t.ok(false, 'no filesystems in vmobj');
                    cb(new Error('no filesystems in vmobj'));
                }
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: false}, function (err) {
                t.ok(!err, 'setting docker=false: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(!flags.docker, 'docker flag set false after update');
                t.ok(flags.docker_id, 'docker:id still set after update: '
                    + flags.docker_id);
                t.ok(flags.docker_ns,
                    'docker namespaces still set after update');

                prev_docker_id = flags.docker_id;
                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: true}, function (err) {
                t.ok(!err, 'setting docker=true again: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set true again');
                t.equal(flags.docker_id, prev_docker_id,
                    'docker:id matches previous: ' + flags.docker_id);
                t.ok(flags.docker_ns,
                    'docker namespaces still set after update');

                cb();
            });
        }
    ]);
});

test('test docker=true + docker:id + docker namespace on new VM', function (t) {
    var new_dockerid;
    var new_uuid;
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.docker = true;

    new_uuid = libuuid.create();
    new_dockerid = (new_uuid + libuuid.create()).replace(/-/g, '');

    payload.uuid = new_uuid;
    payload.internal_metadata = {'docker:id': new_dockerid};
    payload.internal_metadata_namespaces = ['docker'];

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.equal(flags.docker_id, new_dockerid, 'docker:id set after '
                    + 'create: ' + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');

                // ensure we didn't add a duplicate value
                t.ok(flags.namespaces.length === 1,
                    'only one internal_metadata_namespace set');

                cb();
            });
        }
    ]);
});

test('test docker=true + non-docker namespace on new VM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.docker = true;
    payload.internal_metadata_namespaces = ['bacon'];

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after create');
                t.ok(flags.docker_id, 'docker:id set after create: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after create');
                t.deepEqual(flags.namespaces, ['bacon', 'docker'], 'did not '
                    + 'destroy existing internal_metadata_namespaces');

                cb();
            });
        }
    ]);
});

test('test adding docker=true on old VM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(!flags.docker, 'docker flag set false after create');
                t.ok(!flags.docker_id, 'docker:id not set after create');
                t.ok(!flags.docker_ns, 'docker namespace not set after create');
                t.ok(flags.restart_init, 'restart_init is true after create');
                t.equal(flags.init_name, '', 'init_name empty after create');

                cb();
            });
        }, function (cb) {
            VM.update(state.uuid, {docker: true}, function (err) {
                t.ok(!err, 'setting docker=true: '
                    + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            getDockerFlags(t, state, function (err, flags) {
                t.ok(!err, 'getting flags: ' + (err ? err.message : 'success'));
                if (err) {
                    cb(err);
                    return;
                }

                t.ok(flags.docker, 'docker flag set after update');
                t.ok(flags.docker_id, 'docker:id set after update: '
                    + flags.docker_id);
                t.ok(flags.docker_ns, 'docker namespaces set after update');
                t.ok(!flags.restart_init, 'restart_init is false after create');
                t.equal(flags.init_name, '/usr/vm/sbin/dockerinit',
                    'init_name correct after create');
                cb();
            });
        }
    ]);
});

test('test stop docker VM w/ init that exits on SIGTERM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var waited = 0;

    payload.uuid = libuuid.create();
    payload.docker = true;
    payload.autoboot = false;
    payload.init_name = '/root/init';
    payload.restart_init = false;

    function tryToRename() {
        var dirname = '/zones/' + payload.uuid + '/root/var/svc/';
        var filename = dirname + 'provisioning';
        var newname = dirname + 'provision_success';

        fs.exists(filename, function (exists) {
            if (exists) {
                t.ok(true, 'waited ' + (waited / 10) + 's for ' + filename);
                fs.renameSync(filename, newname);
                return;
            }
            waited++;
            setTimeout(tryToRename, 100);
        });
    }

    // pretend init moves /var/svc/provisioning
    tryToRename();

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            writeInit(payload.uuid, '#!/usr/bin/bash\nexec sleep 3600\n',
                function (err) {
                    t.ok(!err, 'wrote init replacement');
                    cb(err);
                }
            );
        }, function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'started VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.pid > 0, 'PID is > 0: ' + obj.pid);
                t.ok(obj.pid < 4294967295, 'PID is < 4294967295: ' + obj.pid);
                cb();
            });
        }, function (cb) {
            VM.stop(state.uuid, {}, function (err) {
                t.ok(!err, 'stopped VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'stopped', 'VM is stopped');
                cb();
            });
        }
    ]);
});

test('test stop docker VM w/ init that ignores SIGTERM', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var waited = 0;

    payload.uuid = libuuid.create();
    payload.docker = true;
    payload.autoboot = false;
    payload.init_name = '/root/init';
    payload.restart_init = false;

    function tryToRename() {
        var dirname = '/zones/' + payload.uuid + '/root/var/svc/';
        var filename = dirname + 'provisioning';
        var newname = dirname + 'provision_success';

        fs.exists(filename, function (exists) {
            if (exists) {
                t.ok(true, 'waited ' + (waited / 10) + 's for ' + filename);
                fs.renameSync(filename, newname);
                return;
            }
            waited++;
            setTimeout(tryToRename, 100);
        });
    }

    // pretend init moves /var/svc/provisioning
    tryToRename();

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            writeInit(payload.uuid, '#!/usr/bin/bash\n'
                + 'trap "sleep 1800" SIGTERM\n'
                + 'sleep 3600\n',
                function (err) {
                    t.ok(!err, 'wrote init replacement');
                    cb(err);
                }
            );
        }, function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'started VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.pid > 0, 'PID is > 0: ' + obj.pid);
                t.ok(obj.pid < 4294967295, 'PID is < 4294967295: ' + obj.pid);
                cb();
            });
        }, function (cb) {
            VM.stop(state.uuid, {}, function (err) {
                t.ok(!err, 'stopped VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'stopped', 'VM is stopped');
                cb();
            });
        }
    ]);
});

test('test restart docker VM', function (t) {
    var boot_timestamps = [];
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var waited = 0;

    payload.uuid = libuuid.create();
    payload.docker = true;
    payload.autoboot = false;
    payload.init_name = '/root/init';
    payload.restart_init = false;

    function tryToRename() {
        var dirname = '/zones/' + payload.uuid + '/root/var/svc/';
        var filename = dirname + 'provisioning';
        var newname = dirname + 'provision_success';

        fs.exists(filename, function (exists) {
            if (exists) {
                t.ok(true, 'waited ' + (waited / 10) + 's for ' + filename);
                fs.renameSync(filename, newname);
                return;
            }
            waited++;
            setTimeout(tryToRename, 100);
        });
    }

    // pretend init moves /var/svc/provisioning
    tryToRename();

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            writeInit(payload.uuid, '#!/usr/bin/bash\n'
                + 'sleep 3600\n',
                function (err) {
                    t.ok(!err, 'wrote init replacement');
                    cb(err);
                }
            );
        }, function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'started VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.pid > 0, 'PID is > 0: ' + obj.pid);
                t.ok(obj.pid < 4294967295, 'PID is < 4294967295: ' + obj.pid);
                t.ok(obj.boot_timestamp, 'VM booted at ' + obj.boot_timestamp);
                boot_timestamps.push(obj.boot_timestamp);
                cb();
            });
        }, function (cb) {
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp > boot_timestamps[0], 'VM booted at '
                    + obj.boot_timestamp);
                boot_timestamps.push(obj.boot_timestamp);
                cb();
            });
        }, function (cb) {
            VM.stop(state.uuid, {}, function (err) {
                t.ok(!err, 'stopped VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'stopped', 'VM is stopped');
                cb();
            });
        }, function (cb) {
            // Ensure we can 'reboot' from stopped which results in 'running'
            // since docker supports that.
            VM.reboot(state.uuid, {}, function (err) {
                t.ok(!err, 'rebooted VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                t.equal(obj.state, 'running', 'VM is running');
                t.ok(obj.boot_timestamp
                    > boot_timestamps[boot_timestamps.length - 1],
                    'VM booted at ' + obj.boot_timestamp);
                boot_timestamps.push(obj.boot_timestamp);
                cb();
            });
        }
    ]);
});

/*
 * This test should fail because we're trying to create resolv.conf as
 * /etc which is a directory and not a file we could mount on.
 */
test('test docker VM with bad resolv.conf path', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.internal_metadata = {
        'docker:resolvConfFile': '/etc'
    };

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

/*
 * This test should fail because we're trying to create hosts as
 * /etc which is a directory and not a file we could mount on.
 */
test('test docker VM with bad hosts path', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.internal_metadata = {
        'docker:hostsFile': '/etc'
    };

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

/*
 * This test should fail because we're trying to create hostname as
 * /etc which is a directory and not a file we could mount on.
 */
test('test docker VM with bad hostname path', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.internal_metadata = {
        'docker:hostnameFile': '/etc'
    };

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

/*
 * This test should create all conf files in /tmp
 */
test('test docker VM with paths in /tmp', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var vmobj = {};

    payload.docker = true;
    payload.autoboot = false;
    payload.internal_metadata = {
        'docker:hostnameFile': '/tmp/hostname',
        'docker:hostsFile': '/tmp/hosts',
        'docker:resolvConfFile': '/tmp/resolv.conf'
    };

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                var found_hostname = false;
                var found_hosts = false;
                var found_resolv_conf = false;

                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                vmobj = obj;

                t.equal(vmobj.filesystems.length, 3, 'have filesystems');

                vmobj.filesystems.forEach(function (f) {
                    if (f.source === obj.zonepath + '/config/resolv.conf') {
                        found_resolv_conf = true;
                    } else if (f.source === obj.zonepath + '/config/hosts') {
                        found_hosts = true;
                    } else if (f.source === obj.zonepath + '/config/hostname') {
                        found_hostname = true;
                    }
                });

                t.ok(found_hostname, 'found hostname file in vmobj');
                t.ok(found_hosts, 'found hosts file in vmobj');
                t.ok(found_resolv_conf, 'found resolv.conf file in vmobj');

                cb();
            });
        }, function (cb) {
            [
                '/tmp/hostname',
                '/tmp/hosts',
                '/tmp/resolv.conf'
            ].forEach(function (k) {
                t.ok(fs.existsSync(path.normalize(vmobj.zonepath + '/root/'
                    + k)), k + ' exists');
            });
            cb();
        }
    ]);
});

log_modes.forEach(function (mode) {
    test('test docker VM with log mode ' + JSON.stringify(mode), function (t) {
        var payload = JSON.parse(JSON.stringify(common_payload));
        var state = {brand: payload.brand};

        payload.docker = true;
        payload.internal_metadata = JSON.parse(JSON.stringify(mode.payload));

        vmtest.on_new_vm(t, image_uuid, payload, state, [
            function (cb) {
                VM.load(state.uuid, function (err, obj) {

                    t.ok(!err, 'loading obj for new VM');
                    if (err) {
                        cb(err);
                        return;
                    }

                    t.equal(obj.zlog_mode, mode.zlog_mode,
                        'zlog_mode set correctly for ' + JSON.stringify(mode));
                    t.equal(obj.app_svc_dependent, mode.app_svc_dependent,
                        'app_svc_dependent set correctly for '
                        + JSON.stringify(mode));
                    cb();
                });
            }
        ]);
    });
});

test('test updates to zlog_mode', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.docker = true;

    function expectLogstate(expected, cb) {
        VM.load(state.uuid, function (err, obj) {
            t.ok(!err, 'loading obj for new VM');
            if (err) {
                cb(err);
                return;
            }
            t.equal(obj.zlog_mode, expected.zlog_mode, 'correct zlog_mode ('
                + obj.zlog_mode + ')');
            t.equal(obj.app_svc_dependent, expected.app_svc_dependent,
                'correct app_svc_dependent (' + obj.app_svc_dependent + ')');
            t.equal(obj.internal_metadata['docker:tty'], expected.tty,
                'correct tty value (' + obj.internal_metadata['docker:tty']
                + ')');
            t.equal(obj.internal_metadata['docker:logdriver'],
                expected.logdriver, 'correct logdriver value ('
                + obj.internal_metadata['docker:logdriver'] + ')');
            cb();
        });
    }

    function applyUpdate(update, cb) {
        var update_payload = {
            remove_internal_metadata: [],
            set_internal_metadata: {}
        };

        if (update.hasOwnProperty('tty')) {
            if (update.tty === undefined) {
                update_payload.remove_internal_metadata.push('docker:tty');
            } else {
                update_payload.set_internal_metadata['docker:tty']
                    = update.tty;
            }
        }

        if (update.hasOwnProperty('logdriver')) {
            if (update.logdriver === undefined) {
                update_payload.remove_internal_metadata
                    .push('docker:logdriver');
            } else {
                update_payload.set_internal_metadata['docker:logdriver']
                    = update.logdriver;
            }
        }

        if (Object.keys(update_payload.set_internal_metadata).length === 0) {
            delete update_payload.set_internal_metadata;
        }
        if (update_payload.remove_internal_metadata.length === 0) {
            delete update_payload.remove_internal_metadata;
        }

        VM.update(state.uuid, update_payload, function (err) {
            t.ok(!err, 'update ' + JSON.stringify(update_payload)
                + ' succeeded');
            cb(err);
        });
    }

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            expectLogstate({
                zlog_mode: 'g--',
                app_svc_dependent: undefined,
                tty: undefined,
                logdriver: undefined
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: true
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: 'gt-',
                app_svc_dependent: undefined,
                tty: true,
                logdriver: undefined
            }, cb);
        }, function (cb) {
            applyUpdate({}, cb);
        }, function (cb) {
            // empty update should not have changed anything
            expectLogstate({
                zlog_mode: 'gt-',
                app_svc_dependent: undefined,
                tty: true,
                logdriver: undefined
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: true,
                logdriver: 'none'
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: '-t-',
                app_svc_dependent: undefined,
                tty: true,
                logdriver: 'none'
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: false,
                logdriver: 'none'
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: '---',
                app_svc_dependent: undefined,
                tty: false,
                logdriver: 'none'
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: false,
                logdriver: 'json-file'
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: 'g--',
                app_svc_dependent: undefined,
                tty: false,
                logdriver: 'json-file'
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: undefined,
                logdriver: undefined
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: 'g--',
                app_svc_dependent: undefined,
                tty: undefined,
                logdriver: undefined
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: undefined,
                logdriver: 'syslog'
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: 'g-n',
                app_svc_dependent: true,
                tty: undefined,
                logdriver: 'syslog'
            }, cb);
        }, function (cb) {
            applyUpdate({
                tty: true,
                logdriver: 'syslog'
            }, cb);
        }, function (cb) {
            expectLogstate({
                zlog_mode: 'gtn',
                app_svc_dependent: true,
                tty: true,
                logdriver: 'syslog'
            }, cb);
        }
    ]);
});
