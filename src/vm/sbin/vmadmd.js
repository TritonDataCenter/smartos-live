#!/usr/bin/node
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
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 */

var async = require('async');
var cp = require('child_process');
var consts = require('constants');
var events = require('events');
var execFile = cp.execFile;
var fs = require('fs');
var net = require('net');
var VM = require('VM');
var onlyif = require('onlyif');
var path = require('path');
var spawn = cp.spawn;
var http = require('http');
var Qmp = require('qmp').Qmp;
var qs = require('querystring');
var url = require('url');
var util = require('util');

var VMADMD_SOCK = '/tmp/vmadmd.http';
var VMADMD_AUTOBOOT_FILE = '/tmp/.autoboot_vmadmd';

var VNC = {};
var TIMER = {};
var SDC = {};

function sysinfo(callback)
{
    VM.log('DEBUG', '/usr/bin/sysinfo');
    execFile('/usr/bin/sysinfo', [], function (error, stdout, stderr) {
        var obj;
        if (error) {
            callback(new Error(stderr.toString()));
        } else {
            obj = JSON.parse(stdout.toString());
            VM.log('DEBUG', 'sysinfo:\n' + JSON.stringify(obj, null, 2));
            callback(null, obj);
        }
    });
}

function setVNCPassword(vmobj, password)
{
    var q;
    var socket;

    q = new Qmp(VM.log);

    socket = vmobj.zonepath + '/root/tmp/vm.qmp';

    VM.log('DEBUG', 'setting password to "' + password + '"');

    q.connect(socket, function (err) {
        if (err) {
            VM.log('WARN', 'Warning: VNC password-set error: ' + err);
        } else {
            q.command('set_password', {'protocol': 'vnc',
                'password': vmobj.vnc_password}, function (e, result) {

                if (e) {
                    VM.log('WARN', 'failed to set password for VNC', e);
                } else {
                    VM.log('DEBUG', 'result: '
                        + JSON.stringify(result));
                    q.disconnect();
                }
            });
        }
    });
}

function spawnVNC(vmobj)
{
    var addr;
    var port;
    var server;
    var zonepath = vmobj.zonepath;

    if (!vmobj.zonepath) {
        zonepath = '/zones/' + vmobj.uuid;
    }

    if (vmobj.state !== 'running' && vmobj.zone_state !== 'running') {
        VM.log('DEBUG', 'skipping VNC setup for non-running VM ' + vmobj.uuid);
        return;
    }

    if (vmobj.hasOwnProperty('vnc_port')) {
        port = vmobj.vnc_port;
    } else {
        port = 0;
    }

    if (port === -1) {
        VM.log('INFO', 'VNC listener disabled (port === -1) for VM '
            + vmobj.uuid);
        return;
    }

    server = net.createServer(function (c) {
        var vnc = net.Stream();
        c.pipe(vnc, {end: false});
        vnc.pipe(c);

        vnc.on('close', function (had_error) {
            // XXX we need to be able to restart the vnc if this happens,
            //     but the only case should be when the VM is shutoff, so
            //     we wouldn't be able to reconnect anyway.
            VM.log('INFO', 'vnc closed for ' + vmobj.uuid);
            clearVNC(vmobj.uuid);
        });

        vnc.on('end', function (had_error) {
            // XXX we need to be able to restart the vnc if this happens,
            //     but the only case should be when the VM is shutoff, so
            //     we wouldn't be able to reconnect anyway.
            VM.log('INFO', 'vnc ended for ' + vmobj.uuid);
            clearVNC(vmobj.uuid);

            if (vmobj.hasOwnProperty('vnc_password')
                && vmobj.vnc_password.length > 0) {
                // if we are using VNC passwords then the connection ends for an
                // incorrect password, so we do need to respawn here, otherwise
                // we'll be unable to reconnect. We reload first so we skip
                // respawn if VM is not running.
                VM.load(vmobj.uuid, function (e, obj) {
                    if (e) {
                        VM.log('ERROR', 'Unable to reload VM ' + vmobj.uuid, e);
                    } else {
                        spawnVNC(obj);
                        VM.log('INFO', 'respawned VNC for VM ' + obj.uuid);
                    }
                });
            }
        });

        vnc.on('error', function () {
            VM.log('WARN', 'Warning: VNC socket error: '
                + JSON.stringify(arguments));
            clearVNC(vmobj.uuid);
        });

        vnc.connect(zonepath + '/root/tmp/vm.vnc');
    });

    VM.log('INFO', 'spawning VNC listener for ' + vmobj.uuid + ' on '
        + SDC.sysinfo.admin_ip);

    // Before we start the listener, set the password if needed.
    if (vmobj.hasOwnProperty('vnc_password') && vmobj.vnc_password.length > 0) {
        setVNCPassword(vmobj, vmobj.vnc_password);
    }

    server.listen(port, SDC.sysinfo.admin_ip, function () {
        addr = server.address();
        VNC[vmobj.uuid] = {'host': SDC.sysinfo.admin_ip, 'port': addr.port,
            'server': server};
        if (addr.port >= 5900) {
            // only add the display number when it's non-negative
            VNC[vmobj.uuid].display = (addr.port - 5900);
        }
        if (vmobj.hasOwnProperty('vnc_password')
            && vmobj.vnc_password.length > 0) {

            VNC[vmobj.uuid].password = vmobj.vnc_password;
        }
        VM.log('DEBUG', 'VNC details for ' + vmobj.uuid + ': '
            + util.inspect(VNC[vmobj.uuid]));
    });
}

function clearVNC(uuid)
{
    if (VNC[uuid] && VNC[uuid].server) {
        VNC[uuid].server.close();
    }
    delete VNC[uuid];
}

function reloadVNC(vmobj)
{
    VM.log('INFO', 'reloading VNC for ' + vmobj.uuid);
    clearVNC(vmobj.uuid);
    spawnVNC(vmobj);
}

function clearTimer(uuid)
{
    if (TIMER.hasOwnProperty(uuid)) {
        clearTimeout(TIMER[uuid]);
        delete TIMER[uuid];
    }
}

function clearVM(uuid)
{
    clearVNC(uuid);
    clearTimer(uuid);
}

// loads the system configuration
function loadConfig(callback)
{
    VM.log('DEBUG', 'loadConfig()');

    sysinfo(function (error, s) {
        var nic, nics;

        if (error) {
            callback(error);
        } else {
            SDC.sysinfo = s;
            // nic tags are in sysinfo but not readily available, we need
            // admin_ip to know where to listen for stuff like VNC.
            nics = SDC.sysinfo['Network Interfaces'];
            for (nic in nics) {
                if (nics.hasOwnProperty(nic)) {
                    if (nics[nic]['NIC Names'].indexOf('admin') !== -1) {
                        SDC.sysinfo.admin_ip = nics[nic].ip4addr;
                        VM.log('DEBUG', 'found admin_ip: '
                            + SDC.sysinfo.admin_ip);
                    }
                }
            }

            callback();
        }
    });
}

function updateZoneStatus(ev)
{
    if (ev.hasOwnProperty('zonename') && ev.hasOwnProperty('oldstate')
        && ev.hasOwnProperty('newstate') && ev.hasOwnProperty('when')) {

        if (ev.newstate === 'running') {
            VM.log('NOTICE', '"' + ev.zonename + '" went from ' + ev.oldstate
                + ' to running at ' + ev.when);
            VM.load(ev.zonename, function (err, obj) {
                if (err) {
                    VM.log('ERROR', 'Unable to load vm', err);
                } else if (obj.brand !== 'kvm') {
                    // do nothing
                    VM.log('DEBUG', 'Ignoring freshly started vm ' + obj.uuid
                        + ' with brand=' + obj.brand);
                } else {
                    // clear any old timers or VNC since this vm just came up,
                    // then spin up a new VNC.
                    clearVM(obj.uuid);
                    spawnVNC(obj);
                }
            });
        } else if (ev.oldstate === 'running') {
            VM.log('NOTICE', '"' + ev.zonename + '" went from running to '
                + ev.newstate + ' at ' + ev.when);
            if (VNC.hasOwnProperty(ev.zonename)) {
                // VMs always have zonename === uuid, so we can remove this
                VM.log('INFO', 'clearing state for disappearing VM '
                    + ev.zonename);
                clearVM(ev.zonename);
            }
        } else if (ev.newstate === 'uninitialized') { // this means installed!?
            VM.log('NOTICE', '"' + ev.zonename + '" went from running to '
                + ev.newstate + ' at ' + ev.when);
            // XXX we're running stop so it will clear the transition marker

            VM.load(ev.zonename, function (err, obj) {
                if (err) {
                    VM.log('ERROR', 'Unable to load vm', err);
                } else if (obj.brand !== 'kvm') {
                    // do nothing
                    VM.log('DEBUG', 'Ignoring freshly stopped vm ' + obj.uuid
                        + ' with brand=' + obj.brand);
                } else {
                    VM.stop(ev.zonename, {'force': true}, function (e) {
                        if (e) {
                            VM.log('ERROR', 'stop failed', e);
                        }
                    });
                }
            });
        }
    } else {
        VM.log('DEBUG', 'skip: ' + ev);
    }
}

function startZoneWatcher(callback)
{
    var chunks;
    var buffer = '';
    var watcher;

    watcher = spawn('/usr/vm/sbin/zoneevent', [], {'customFds': [-1, -1, -1]});

    VM.log('INFO', 'zoneevent running with pid ' + watcher.pid);

    watcher.stdout.on('data', function (data) {
        var chunk;
        var obj;

        buffer += data.toString();
        chunks = buffer.split('\n');
        while (chunks.length > 1) {
            chunk = chunks.shift();
            obj = JSON.parse(chunk);
            callback(obj);
        }
        buffer = chunks.pop();
    });

    watcher.stdin.end();

    watcher.on('exit', function (code) {
        VM.log('INFO', 'zoneevent watcher exited.');
        watcher = null;
    });
}

function handlePost(c, args, response)
{
    var uuid;

    VM.log('DEBUG', 'POST len: ' + c + args);

    if (c.length !== 2 || c[0] !== 'vm') {
        VM.log('DEBUG', '404 - handlePost ' + c.length + c);
        response.writeHead(404);
        response.end();
        return;
    }

    uuid = c[1];

    if (!args.hasOwnProperty('action')
        || ['stop', 'sysrq', 'reset', 'reload_vnc'].indexOf(args.action) === -1
        || (args.action === 'sysrq'
            && ['nmi', 'screenshot'].indexOf(args.request) === -1)
        || (args.action === 'stop' && !args.hasOwnProperty('timeout'))) {

        // Bad request
        response.writeHead(400, { 'Content-Type': 'application/json'});
        response.end();
        return;
    }

    switch (args.action) {
    case 'stop':
        stopVM(uuid, args.timeout, function (err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Stopped ' + uuid);
                response.end();
            }
        });
        break;
    case 'sysrq':
        sysrqVM(uuid, args.request, function (err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Sent sysrq to ' + uuid);
                response.end();
            }
        });
        break;
    case 'reload_vnc':
        VM.load(uuid, function (err, obj) {
            if (err) {
                response.writeHead(404);
                response.write('Unable to load VM ' + uuid);
                response.end();
                return;
            }
            reloadVNC(obj);
            response.writeHead(202, { 'Content-Type': 'application/json'});
            response.write('Sent request to reload VNC for ' + uuid);
            response.end();
        });
        break;
    case 'reset':
        resetVM(uuid, function (err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Sent reset to ' + uuid);
                response.end();
            }
        });
        break;
    default:
        response.writeHead(500, { 'Content-Type': 'application/json'});
        response.write('Unknown Command');
        response.end();
        break;
    }

}

function handleGet(c, args, response)
{
    var t;
    var type;
    var types = [];
    var uuid = c[1];

    VM.log('DEBUG', 'GET (' + JSON.stringify(c) + ') len: ' + c.length);

    if (c.length !== 2 || c[0] !== 'vm') {
        response.writeHead(404);
        response.end();
        return;
    }

    if (args.hasOwnProperty('types')) {
        t = args.types.split(',');
        for (type in t) {
            types.push(t[type]);
        }
    }

    if (types.length === 0) {
        types.push('all');
    }

    VM.log('DEBUG', 'TYPES: ' + JSON.stringify(types));

    infoVM(uuid, types, function (err, res) {
        if (err) {
            VM.log('ERROR', err.message, err);
            response.writeHead(500, { 'Content-Type': 'application/json'});
            response.end();
            return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json'});
        response.end(JSON.stringify(res, null, 2), 'utf-8');
    });
}

function startHTTPHandler()
{
    http.createServer(function (request, response) {
        var args;
        var c;
        var url_parts;

        url_parts = url.parse(request.url, true);
        c = url_parts.pathname.split('/');

        // remove empty /'s from front/back
        while (c.length > 0 && c[0].length === 0) {
            c.shift();
        }
        while (c.length > 0 && c[c.length - 1].length === 0) {
            c.pop();
        }

        if (url_parts.hasOwnProperty('query')) {
            args = url_parts.query;
            VM.log('DEBUG', 'url ' + request.url);
            VM.log('DEBUG', 'args ' + JSON.stringify(args));
        } else {
            args = {};
        }

        if (request.method === 'POST') {
            var body = '';

            request.on('data', function (data) {
                body += data;
            });
            request.on('end', function () {
                var k;
                var POST = qs.parse(body);

                VM.log('DEBUG', 'POST: ' + JSON.stringify(POST));
                for (k in POST) {
                    if (POST.hasOwnProperty(k)) {
                        args[k] = POST[k];
                    }
                }
                handlePost(c, args, response);
            });
        } else {
            handleGet(c, args, response);
        }
    }).listen(VMADMD_SOCK);
}

/*
 * GET /vm/:id[?type=vnc,xxx]
 * POST /vm/:id?action=stop
 * POST /vm/:id?action=reset
 * POST /vm/:id?action=reload_vnc
 * POST /vm/:id?action=sysrq&request=[nmi|screenshot]
 *
 */

function stopVM(uuid, timeout, callback)
{
    VM.log('DEBUG', 'DEBUG stop(' + uuid + ')');

    if (!timeout) {
        callback(new Error('stopVM() requires timeout to be set.'));
        return;
    }

    /* We load here to get the zonepath and ensure it exists. */
    VM.load(uuid, function (err, obj) {
        var socket;
        var q;

        if (err) {
            VM.log('DEBUG', 'Unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        q = new Qmp(VM.log);

        if (obj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "stop" for kvm ('
                + 'your brand is: ' + obj.brand + ')'));
            return;
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function (error) {
            if (error) {
                callback(error);
                return;
            }
            q.command('system_powerdown', null, function (e, result) {
                VM.log('DEBUG', 'result: ' + JSON.stringify(result));
                q.disconnect();

                // Setup to send kill when timeout expires
                setStopTimer(uuid, timeout * 1000);

                callback(null);
                return;
            });
        });
    });
}

// sends several query-* commands to QMP to get details for a VM
function infoVM(uuid, types, callback)
{
    var res = {};
    var commands = [
        'query-version',
        'query-chardev',
        'query-block',
        'query-blockstats',
        'query-cpus',
        'query-pci',
        'query-kvm'
    ];

    VM.log('DEBUG', 'LOADING: ' + uuid);

    VM.load(uuid, function (err, obj) {
        var q;
        var socket;
        var type;

        if (err) {
            callback('Unable to load vm: ' + JSON.stringify(err));
            return;
        }

        if (obj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "info" for kvm ('
                + 'your brand is: ' + obj.brand + ')'));
            return;
        }

        if (obj.state !== 'running' && obj.state !== 'stopping') {
            callback(new Error('Unable to get info for vm from state "'
                + obj.state + '", must be "running" or "stopping".'));
            return;
        }

        q = new Qmp(VM.log);

        if (!types) {
            types = ['all'];
        }

        for (type in types) {
            type = types[type];
            if (VM.INFO_TYPES.indexOf(type) === -1) {
                callback(new Error('unknown info type: ' + type));
                return;
            }
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';

        q.connect(socket, function (error) {
            if (error) {
                callback(error);
                return;
            }
            // run each command in commands
            async.map(commands, function (command, cb) {
                var base = command.replace(/^query-/, '');

                if ((types.indexOf('all') !== -1)
                    || (types.indexOf(base) !== -1)) {

                    q.command(command, null, function (e, result) {
                        cb(null, [base, result]);
                    });
                } else {
                    cb(null, null);
                }
            }, function (e, results) {
                var i;

                q.disconnect();
                if (e) {
                    VM.log('ERROR', 'getVMInfo(): Unknown Error', e);
                    callback(e);
                } else {
                    // key is in results[i][0], value in results[i][1]
                    for (i = 0; i < results.length; i++) {
                        if (results[i]) {
                            res[results[i][0]] = results[i][1];
                        }
                    }
                    if ((types.indexOf('all') !== -1)
                        || (types.indexOf('vnc') !== -1)) {

                        res.vnc = {};
                        if (VNC.hasOwnProperty(obj.uuid)) {
                            res.vnc.host = VNC[obj.uuid].host;
                            res.vnc.port = VNC[obj.uuid].port;
                            if (VNC[obj.uuid].hasOwnProperty('display')) {
                                res.vnc.display = VNC[obj.uuid].display;
                            }
                            if (VNC[obj.uuid].hasOwnProperty('password')
                                && VNC[obj.uuid].password.length > 0) {

                                res.vnc.password = VNC[obj.uuid].password;
                            }
                        }
                        callback(null, res);
                    } else {
                        callback(null, res);
                    }
                }
            });
        });
    });
}

function resetVM(uuid, callback)
{
    VM.log('DEBUG', 'reset(' + uuid + ')');

    /* We load here to get the zonepath and ensure the vm exists. */
    VM.load(uuid, function (err, obj) {
        var q;
        var socket;

        if (err) {
            VM.log('DEBUG', 'Unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        if (obj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "reset" for kvm ('
                + 'your brand is: ' + obj.brand + ')'));
            return;
        }

        if (obj.state !== 'running') {
            callback(new Error('Unable to reset vm from state "'
                + obj.state + '", must be "running".'));
            return;
        }

        q = new Qmp(VM.log);

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function (error) {
            if (error) {
                callback(error);
            } else {
                q.command('system_reset', null, function (e, result) {
                    VM.log('DEBUG', 'result: ' + JSON.stringify(result));
                    q.disconnect();
                    callback();
                });
            }
        });
    });
}

function sysrqVM(uuid, req, callback)
{
    var SUPPORTED_REQS = ['screenshot', 'nmi'];

    VM.log('DEBUG', 'sysrq(' + uuid + ',' + req + ')');

    /* We load here to ensure this vm exists. */
    VM.load(uuid, function (err, obj) {
        var q;
        var socket;

        if (err) {
            VM.log('ERROR', 'unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        if (obj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "reset" for kvm ('
                + 'your brand is: ' + obj.brand + ')'));
            return;
        }

        if (obj.state !== 'running' && obj.state !== 'stopping') {
            callback(new Error('Unable to send request to vm from "'
                + 'state "' + obj.state + '", must be "running" or '
                + '"stopping".'));
            return;
        }

        if (SUPPORTED_REQS.indexOf(req) === -1) {
            callback(new Error('Invalid sysrq "' + req
                + '" valid values: "' + SUPPORTED_REQS.join('","') + '".'));
            return;
        }

        q = new Qmp(VM.log);

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function (error) {

            if (error) {
                callback(error);
                return;
            }

            if (req === 'screenshot') {
                // We send a 'shift' character before showing the screen to wake
                // up from any screen blanking that may have happened.
                async.series([
                    function (cb) {
                        q.command('human-monitor-command',
                            {'command-line': 'sendkey shift'},
                            function (e, result) {

                            // XXX check result?
                            VM.log('DEBUG', 'sendkey err: '
                                + JSON.stringify(e) + ' result: '
                                + JSON.stringify(result));
                            cb(e);
                        });
                    }, function (cb) {
                        q.command('screendump', {'filename': '/tmp/vm.ppm'},
                            function (e, result) {

                            // XXX check result?
                            VM.log('DEBUG', 'sendkey err: '
                                + JSON.stringify(e) + ' result: '
                                + JSON.stringify(result));
                            q.disconnect();
                            cb(e);
                        });
                    }
                ], function (e) {
                    callback(e);
                });
            } else if (req === 'nmi') {
                q.command('human-monitor-command', {'command-line': 'nmi 0'},
                    function (e, result) {

                    // XXX handle failure
                    q.disconnect();
                    callback();
                });
            } else {
                callback();
            }
        });
    });
}

function setStopTimer(uuid, expire)
{
    VM.log('DEBUG', 'clearing existing timer');
    clearTimer(uuid);
    VM.log('DEBUG', 'SEtting STOP TIMER FOR ' + expire);
    TIMER[uuid] = setTimeout(function () {
        VM.log('INFO', 'TIMEOUT');
        // reload and make sure we still need to kill.
        VM.load(uuid, function (e, obj) {
            if (e) {
                VM.log('ERROR', 'expire(): Unable to load vm: ' + e.message, e);
                return;
            }
            // ensure we've not started and started stopping
            // again since we checked.
            VM.log('DEBUG', 'times two: ' + Date.now() + ' '
                + obj.transition_expire);
            if (obj.state === 'stopping' && obj.transition_expire
                && (Date.now() >= obj.transition_expire)) {

                // We assume kill will clear the transition even if the
                // vm is already stopped.
                VM.stop(obj.uuid, {'force': true}, function (err) {
                    VM.log('DEBUG', 'timeout vm.kill() = '
                        + JSON.stringify(err));
                });
            }
        });
    }, expire);
}

function loadVM(vmobj, do_autoboot)
{
    var expire;

    VM.log('DEBUG', 'LOADING ' + JSON.stringify(vmobj));

    if (vmobj.never_booted || (vmobj.autoboot && do_autoboot)) {
        VM.start(vmobj.uuid, {}, function (err) {
            // XXX: this ignores errors!
            VM.log('INFO', 'Autobooted ' + vmobj.uuid + ': [' + err + ']');
        });
    }

    if (vmobj.state === 'stopping' && vmobj.transition_expire) {
        VM.log('DEBUG', 'times: ' + Date.now() + ' ' + vmobj.transition_expire);
        if (Date.now() >= vmobj.transition_expire
            || (vmobj.transition_to === 'stopped'
                && vmobj.zone_state === 'installed')) {

            VM.log('INFO', 'killing VM with expired running stop: '
                + vmobj.uuid);
            // We assume kill will clear the transition even if the
            // vm is already stopped.
            VM.stop(vmobj.uuid, {'force': true}, function (err) {
                VM.log('DEBUG', 'vm.kill() = ' + err.message, err);
            });
        } else {
            expire = ((Number(vmobj.transition_expire) + 1000) - Date.now());
            setStopTimer(vmobj.uuid, expire);
        }
    } else {
        VM.log('DEBUG', 'state: ' + vmobj.state + ' expire: '
            + vmobj.transition_expire);
    }

    // Start VNC
    spawnVNC(vmobj);
}

// kicks everything off
function main()
{
    // XXX TODO: load fs-ext so we can flock a pid file to be exclusive

    startZoneWatcher(updateZoneStatus);
    startHTTPHandler();

    loadConfig(function (err) {
        var do_autoboot = false;

        if (err) {
            VM.log('ERROR', 'Unable to load config', err);
            process.exit(2);
        }

        path.exists(VMADMD_AUTOBOOT_FILE, function (exists) {
            var vmobj;

            if (!exists) {
                do_autoboot = true;
                // boot all autoboot vms because this vm just booted, now
                // create file so on restart we know they system wasn't just
                // booted.
                fs.writeFileSync(VMADMD_AUTOBOOT_FILE, 'booted');
            }

            VM.lookup({}, {'full': true}, function (e, vmobjs) {
                for (vmobj in vmobjs) {
                    vmobj = vmobjs[vmobj];
                    if (vmobj.brand === 'kvm') {
                        loadVM(vmobj, do_autoboot);
                    } else {
                        VM.log('DEBUG', 'ignoring non-kvm VM ' + vmobj.uuid);
                    }
                }
            });
        });
    });
}

onlyif.rootInSmartosGlobal(function (err) {
    VM.resetLog('vmadmd');
    if (err) {
        VM.log('ERROR', 'Fatal: cannot run because: ' + err);
        process.exit(1);
    }
    VM.log('NOTICE', 'Starting vmadmd');
    main();
});
