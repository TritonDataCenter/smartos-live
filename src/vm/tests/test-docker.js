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
 * Copyright 2019 Joyent, Inc.
 *
 */

/*
 * These tests ensure that docker flag works as expected when
 * setting/unsetting.  Also test that /etc/resolv.conf, /etc/hosts and
 * /etc/hostname are set correctly.
 */

var async = require('/usr/node/node_modules/async');
var EventEmitter = require('events').EventEmitter;
var exec = require('child_process').exec;
var fs = require('fs');
var libuuid = require('/usr/node/node_modules/uuid');
var path = require('path');
var util = require('util');
var VM = require('/usr/vm/node_modules/VM');
var vminfod = require('/usr/vm/node_modules/vminfod/client');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var common_payload = {
    alias: 'test-docker-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    cpu_cap: 100,
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

test('test docker VM with "docker:extraHosts"', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var vmobj = {};

    payload.docker = true;
    payload.autoboot = false;
    payload.internal_metadata = {
        'docker:extraHosts': '["foo:1.2.3.4"]',
        'docker:cmd': '["sleep","5"]'
    };

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'loading obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }

                vmobj = obj;
                cb();
            });
        }, function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'started VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            var hostsPath = path.resolve(
                vmobj.zonepath, 'root', 'etc', 'hosts');
            var hostsContent = fs.readFileSync(hostsPath, 'utf8');
            var foo = /^1.2.3.4\tfoo$/m;
            t.ok(foo.test(hostsContent),
                util.format('%s entry found in hosts path (%s): %j',
                    foo, hostsPath, hostsContent));
            cb();
        }, function (cb) {
            var update = {
                set_internal_metadata: {
                    'docker:extraHosts': '["bar:5.6.7.8"]'
                }
            };
            VM.update(state.uuid, update, function (err) {
                t.ok(!err, 'update ' + JSON.stringify(update) + ' succeeded');
                cb(err);
            });
        }, function (cb) {
            var hostsPath = path.resolve(
                vmobj.zonepath, 'root', 'etc', 'hosts');
            var hostsContent = fs.readFileSync(hostsPath, 'utf8');
            var foo = /^1.2.3.4\tfoo$/m;
            var bar = /^5.6.7.8\tbar$/m;
            t.notOk(foo.test(hostsContent),
                util.format('%s entry NOT found in hosts path (%s): %j',
                    foo, hostsPath, hostsContent));
            t.ok(bar.test(hostsContent),
                util.format('%s entry found in hosts path (%s): %j',
                    bar, hostsPath, hostsContent));
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

test('test log archiving', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.archive_on_delete = true;
    payload.brand = 'lx';
    payload.docker = true;
    payload.image_uuid = vmtest.CURRENT_DOCKER_IMAGE_UUID;
    payload.internal_metadata = {'docker:cmd': '[\"echo\",\"hello world\"]'};
    payload.kernel_version = '3.13.0';

    function _getState(vm_uuid, callback) {
        VM.load(vm_uuid, function (err, obj) {
            if (err) {
                callback(err);
                return;
            }
            callback(null, obj.state);
        });
    }

    function _waitForState(vm_uuid, wait_state, callback) {
        setTimeout(function () {
            _getState(vm_uuid, function (err, vm_state) {
                if (err) {
                    callback(err);
                    return;
                }

                if (wait_state === vm_state) {
                    callback(null, vm_state);
                } else {
                    process.nextTick(function () {
                        _waitForState(vm_uuid, wait_state, callback);
                    });
                }
            });
        }, 1000);
    }

    vmtest.on_new_vm(t, payload.image_uuid, payload, state, [
        function (cb) {
            var dirname = '/zones/' + state.uuid + '/logs';
            var filename;
            var hour_ago = new Date(new Date().getTime() - (60 * 60 * 1000));

            filename = dirname + '/stdio.log.'
                + hour_ago.toISOString().split('.')[0].replace(/[-:]/g, '')
                + 'Z';

            // create a fake rotated log
            fs.mkdir(dirname, function (mkdir_err) {
                t.ok(!mkdir_err, 'mkdir ' + dirname + ': '
                    + (mkdir_err ? mkdir_err.message : 'success'));
                if (mkdir_err) {
                    cb(mkdir_err);
                    return;
                }

                fs.writeFile(filename, 'old log\n', function (w_err) {
                    t.ok(!w_err, 'write file ' + filename + ': '
                        + (w_err ? w_err.message : 'success'));

                    cb(w_err);
                });
            });
        }, function (cb) {
            // start the VM
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'starting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            // wait for it to stop
            _waitForState(state.uuid, 'stopped', function (err, _state) {
                t.ok(!err, 'Waiting for stopped: '
                    + (err ? err.message : 'success'));
                if (!err) {
                    t.equal(_state, 'stopped', 'VM was stopped');
                }
                cb(err);
            });
        }, function (cb) {
            var log_dir = '/zones/' + state.uuid + '/logs';

            // Ensure we have 2 "stdio.log*" files now.
            fs.readdir(log_dir, function (err, files) {
                files = files.filter(
                    function (f) { return f.indexOf('stdio.log') === 0; });
                t.ok(files.length === 2, 'vm logs: ' + JSON.stringify(files));
                cb();
            });
        }, function (cb) {
            // delete the VM
            VM.delete(state.uuid, function (err) {
                t.ok(!err, 'deleting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            var archive_dir = '/zones/archive/' + state.uuid + '/docker';

            // and ensure the two log files are in /zones/archive
            fs.readdir(archive_dir, function (err, files) {
                t.ok(files.length === 2, 'archive logs: '
                    + JSON.stringify(files));
                cb();
            });
        }
    ]);
});

// Should fail to create when we have non-integer
test('test docker VM with non-integer zlog_max_size', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.zlog_max_size = 'abc123';

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

// Should fail to create when we have negative
test('test docker VM with negative zlog_max_size', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.zlog_max_size = -1000000;

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

// Should fail to create when we have > INT64_MAX
test('test docker VM with too large zlog_max_size', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand, expect_create_failure: true};

    payload.docker = true;
    payload.autoboot = false;
    payload.zlog_max_size = Math.pow(2, 64);

    vmtest.on_new_vm(t, image_uuid, payload, state, []);
});

test('test docker VM with good zlog_max_size', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.docker = true;
    payload.zlog_max_size = 1000000;

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {

        async.series([
            function (_cb) {
                VM.load(state.uuid, function (err, obj) {
                    if (err) {
                        _cb(err);
                        return;
                    }

                    t.equal(payload.zlog_max_size, obj.zlog_max_size,
                        'VM has correct zlog_max_size');

                    _cb();
                });
            }, function (_cb) {
                VM.update(state.uuid, {zlog_max_size: 1000}, function (err) {
                    t.ok(!err, 'Update zlog_max_size'
                        + (err ? ': ' + err.message : ''));

                    _cb(err);
                });
            }, function (_cb) {
                VM.load(state.uuid, function (err, obj) {
                    t.ok(!err, 'Load VM after update'
                        + (err ? ': ' + err.message : ''));

                    if (!err) {
                        t.equal(1000, obj.zlog_max_size,
                            'VM has correct zlog_max_size');
                    }

                    _cb(err);
                });
            }
        ], function _doneTest(err) {
            cb(err);
        });
    }]);
});

/*
 * Tries to determine if the array of (Number) values is generally going up or
 * down. Returns -1 if more downs than ups, 1 if more ups than downs and 0 if
 * there are the same number of ups and downs or the values are all equal.
 */
function trend(values)
{
    var downs = 0;
    var prev_value = values[0];
    var ups = 0;

    values.forEach(function (val) {
        if (val > prev_value) {
            ups++;
        } else if (val < prev_value) {
            downs++;
        }
        prev_value = val;
    });

    if (ups === downs) {
        return (0);
    } else if (ups > downs) {
        return (1);
    } else {
        return (-1);
    }
}

/*
 * This tests that OS-4740 is still fixed. Specifically if a docker container
 * has trouble restarting the delay should be increasing, but if it stays up for
 * at least 10 seconds the delay should get reset.
 *
 * This relies on vmadmd being running (since that's what handles restarts)
 */
test('test restart delay reset', function (t) {
    /*
     * cycles_fail here defines how many times we want to exit quickly (avoiding
     * the delay reset) before we sleep and allow the delay to reset.
     *
     * The actual boot delay is pretty variable because of all the steps
     * involved when booting the zone. As such, the small delays are often
     * hidden in the noise. That's why we allow it to double 7 times, to ensure
     * that it's actually growing.
     */
    var cycles_fail = 7;
    var cycle_reset_delay = 15; // seconds, should be >= 10
    var emitter = new EventEmitter();
    var events = [];
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};
    var num_cycles = (cycles_fail * 2) + 1;
    var vs;

    payload.autoboot = false;
    payload.brand = 'lx';
    payload.docker = true;
    payload.image_uuid = vmtest.CURRENT_DOCKER_IMAGE_UUID;

    // This cmd will 'exit 1' cycles_fail times, then sleep cycle_reset_delay
    // seconds and exit 0, then repeat that pattern. The repeat happens because
    // we delete the /var/tmp files so the $(ls -1 /var/tmp | wc) goes back to
    // 0.
    payload.internal_metadata = {
        'docker:cmd': '[\"/bin/sh\",\"-c\",'
            + '\"mkdir -p /var/tmp; '
            + '[[ $(ls -1 /var/tmp | wc -l) == ' + cycles_fail + ' ]] '
            + '&& (sleep ' + cycle_reset_delay + '; rm -f /var/tmp/*; exit 0) '
            + '|| (touch /var/tmp/$(/native/usr/bin/uuid); sleep 2; exit 1)\"]',
        'docker:restartpolicy': 'always'
    };
    payload.kernel_version = '3.13.0';

    vmtest.on_new_vm(t, payload.image_uuid, payload, state, [
        function (cb) {
            var restartKeys = [
                'internal_metadata.docker:restartcount',
                'internal_metadata.docker:restartdelay'
            ];
            var running = false;
            var starts = 0;
            var stops = 0;

            vs = new vminfod.VminfodEventStream('test-docker.js');
            vs.on('readable', function () {
                var dockerRestartKeysHaveChanged;
                var ev;
                var im;

                // for each start/stop, if it's for the VM we just created we'll
                // push an event on the events array.
                while ((ev = vs.read()) !== null) {
                    if (ev.zonename !== state.uuid)
                        return;

                    dockerRestartKeysHaveChanged = (ev.changes || []).map(
                        function (change) {

                        return (change.prettyPath);
                    }).filter(function (p) {
                        return (restartKeys.indexOf(p) > -1);
                    }).length > 0;

                    if (running && ev.vm.state === 'stopped') {
                        // VM went to state === 'stopped'
                        running = false;
                        stops++;
                        events.push({
                            action: 'stop',
                            time: ev.date
                        });
                    } else if (!running && ev.vm.state === 'running') {
                        // VM went to state === 'running'
                        running = true;
                        starts++;
                        events.push({
                            action: 'start',
                            time: ev.date
                        });
                    }

                    if (dockerRestartKeysHaveChanged) {
                        im = ev.vm.internal_metadata;
                        events.push({
                            action: 'docker-keys-changed',
                            time: ev.date,
                            restartcount: im['docker:restartcount'],
                            restartdelay: im['docker:restartdelay']
                        });
                    }
                }

                if (starts >= num_cycles && stops >= num_cycles) {
                    // stop the zoneevent watcher
                    vs.stop();
                    vs = null;
                    emitter.emit('done');
                }
            });

            vs.once('ready', function () {
                cb();
            });
        }, function (cb) {
            // start the VM
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'starting VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            // wait for our num_cycles to finish
            emitter.once('done', function () {
                var deltas = [];
                var expected_counts = [];
                var expected_delays = [];
                var i;
                var last_stop = 0;
                var restartcounts = [];
                var restartdelays = [];

                // generate an array of deltas (in ms) between a stop and the
                // next start (this will be the restart delay + the time it
                // actually takes to start).
                events.forEach(function (evt) {
                    switch (evt.action) {
                    case 'start':
                        if (last_stop > 0) {
                            deltas.push(evt.time - last_stop);
                        }
                        break;
                    case 'stop':
                        last_stop = evt.time;
                        break;
                    case 'docker-keys-changed':
                        break;
                    default:
                        throw (new Error('Unexpected action: ' + evt.action));
                    }
                });

                // Create an array just of the restart counts.
                restartcounts = events.filter(function (evt) {
                    return (evt.action === 'docker-keys-changed');
                }).map(function (evt) {
                    return (evt.restartcount);
                });

                // Create an array just of the restart delays.
                restartdelays = events.filter(function (evt) {
                    return (evt.action === 'docker-keys-changed');
                }).map(function (evt) {
                    return (evt.restartdelay);
                });

                /*
                 * vmadmd restarts a zone that has a restartpolicy that requires
                 * it, when it sees that the VM exited. The delay should be
                 * increasing between each restart unless the VM was running
                 * more than 10 seconds. If it was running more than 10 seconds,
                 * the delay should be reset.
                 *
                 * Since we should exit quickly the first cycles_fail times, the
                 * delay between each of those attempts should go up. We should
                 * then see the delay go *down* for the next attempt (back to
                 * the initial delay) because at that point we'll sleep 15 in
                 * the zone and it will have been running more than 10 seconds.
                 * After that, we go back to fast-exiting for another
                 * cycles_fail cycles, so it should be increasing again.
                 *
                 */
                t.equal(trend(deltas.slice(0, cycles_fail - 1)), 1, 'first '
                    + (cycles_fail - 1) + ' should go up');
                t.equal(trend(deltas.slice(cycles_fail, deltas.length)), 1,
                    ' last ' + (deltas.length - cycles_fail) + ' should go up');
                t.ok((deltas[cycles_fail - 1] > deltas[cycles_fail]),
                    deltas[cycles_fail - 1] + ' > ' + deltas[cycles_fail]);

                /*
                 * should be [0, 1, 2, ... 14] because the restart count always
                 * only increases, regardless of how long the zone was running.
                 */
                for (i = 0; i < num_cycles; i++) {
                    expected_counts.push(i);
                }

                /*
                 * delays should be: [null, 200, 400 ... 12800, 200, ... 12800]
                 * because of the:
                 *
                 *  restart number |  command
                 *  ---------------+-------------------
                 *              0  |  exit 1
                 *              1  |  exit 1
                 *            ...
                 *     num_cycles  |  sleep 15 ; exit 0
                 * num_cycles + 1  |  exit 1
                 * num_cycles + 2  |  exit 1
                 *            ...
                 *
                 * pattern, which we stop after the second run through to
                 * num_cycles.
                 */
                for (i = 0; i < cycles_fail; i++) {
                    expected_delays.push(100 * Math.pow(2, i + 1));
                }
                for (i = 0; i < cycles_fail; i++) {
                    expected_delays.push(100 * Math.pow(2, i + 1));
                }

                t.deepEqual(restartcounts, expected_counts,
                    'check docker:restartcount');

                // slice(1) here is to skip the null
                t.deepEqual(restartdelays.slice(1), expected_delays,
                    'check docker:restartdelay');

                cb();
            });
        }
    ], function () {
        // stop the vminfod watcher
        if (vs !== null) {
            vs.stop();
            vs = null;
        }

        t.end();
    });
});

/* BEGIN JSSTYLED */
/*
 * This test creates a docker VM, reprovisions it, and then stops it so we can
 * check that the resolv.conf created is *not* a directory but instead a file.
 *
 * If it's a directory it was created by zoneadmd:
 *
 * https://github.com/joyent/illumos-joyent/blob/release-20160707/usr/src/cmd/zoneadmd/vplat.c#L1239-L1245
 *
 * which will only happen if VM.js failed to create it.
 */
/* END JSSTYLED */
test('test reprovision resolv.conf', function (t) {
    var payload = JSON.parse(JSON.stringify(common_payload));
    var state = {brand: payload.brand};

    payload.archive_on_delete = false;
    payload.autoboot = false;
    payload.brand = 'lx';
    payload.docker = true;
    payload.image_uuid = vmtest.CURRENT_DOCKER_IMAGE_UUID;
    payload.internal_metadata = {'docker:cmd': '[\"sleep\",\"3600\"]'};
    payload.kernel_version = '3.13.0';
    payload.resolvers = ['8.8.8.8', '8.8.4.4'];

    vmtest.on_new_vm(t, payload.image_uuid, payload, state, [
        function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'started VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            /*
             * reprovision with the same image we're already using
             */
            VM.reprovision(state.uuid, {'image_uuid': payload.image_uuid},
                function (err) {
                    t.ok(!err, 'reprovision: '
                        + (err ? err.message : 'success'));
                    cb(err);
                }
            );
        }, function (cb) {
            /*
             * Now stop the zone so we unmount everything. Otherwise we might
             * have a file mounted on top of a directory which would be hidden
             * if the zone's running.
             */
            VM.stop(state.uuid, {}, function (err) {
                t.ok(!err, 'stopped VM: ' + (err ? err.message : 'success'));
                cb(err);
            });
        }, function (cb) {
            var resolv_conf = path.join('/zones', state.uuid,
                '/root/etc/resolv.conf');

            fs.stat(resolv_conf, function (err, st) {
                t.ok(!err, 'stat resolv.conf: '
                    + (err ? err.message : 'success'));
                t.ok(st.isFile(), 'resolv.conf is a file: ' + st.isFile());
                cb(err);
            });
        }
    ]);
});
