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
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
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
var qmp = require('qmp');
var qs = require('querystring');
var url = require('url');

VM.loglevel = 'DEBUG';
//if (process.env.DEBUG) {
var DEBUG = true;
//}

var VMADMD_SOCK = '/tmp/vmadmd.http';
var VMADMD_AUTOBOOT_FILE = '/tmp/.autoboot_vmadmd';

var VNC = {};
var TIMER = {};
var SDC = {};

function sysinfo(callback)
{
    VM.logger('DEBUG', '/usr/bin/sysinfo');
    execFile('/usr/bin/sysinfo', [], function (error, stdout, stderr) {
        var obj;
        if (error) {
            return callback(new Error(stderr.toString()));
        }
        obj = JSON.parse(stdout.toString());
        VM.logger('DEBUG', 'sysinfo:\n' + JSON.stringify(obj, null, 2));
        callback(null, obj);
    });
}

function spawnVNC(vmobj)
{
    var server;
    var addr;
    var zonepath = vmobj.zonepath;

    if (!vmobj.zonepath) {
        zonepath = '/zones/' + vmobj.uuid;
    }

    if (vmobj.state !== 'running' && vmobj.real_state !== 'running') {
        VM.logger('DEBUG', 'skipping VNC setup for non-running VM ' + vmobj.uuid);
        return;
    }

    server = net.createServer(function (c) {
        var vnc = net.Stream();
        c.pipe(vnc);
        vnc.pipe(c);

        vnc.on('close', function (had_error) {
            // XXX we need to be able to restart the vnc if this happens,
            //     but the only case should be when the VM is shutoff, so
            //     we wouldn't be able to reconnect anyway.
            VM.logger('INFO', 'vnc closed for ' + vmobj.uuid);
            clearVNC(vmobj.uuid);
        });

        vnc.on('end', function (had_error) {
            // XXX we need to be able to restart the vnc if this happens,
            //     but the only case should be when the VM is shutoff, so
            //     we wouldn't be able to reconnect anyway.
            VM.logger('INFO', 'vnc ended for ' + vmobj.uuid);
            clearVNC(vmobj.uuid);
        });

        vnc.on('error', function () {
            VM.logger('WARN', 'Warning: VNC socket error: ' + JSON.stringify(arguments));
            clearVNC(vmobj.uuid);
        });

        vnc.connect(zonepath + '/root/tmp/vm.vnc');
    });

    VM.logger('INFO', 'spawning VNC listener for ' + vmobj.uuid + ' on ' +
        SDC.sysinfo.admin_ip);
    // Listen on a random port on admin_ip
    server.listen(0, SDC.sysinfo.admin_ip);
    addr = server.address();

    VNC[vmobj.uuid] = {'host': SDC.sysinfo.admin_ip, 'port': addr.port,
        'display': (addr.port - 5900), 'server': server};

    VM.logger('DEBUG', 'VNC details for ' + vmobj.uuid + ':' + VNC[vmobj.uuid]);
}

function clearVNC(uuid)
{
    if (VNC[uuid] && VNC[uuid].server) {
        VNC[uuid].server.close();
    }
    delete VNC[uuid];
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
    VM.logger('DEBUG', 'loadConfig()');

    sysinfo(function (error, s) {
        var nic, nics;

        if (error) {
            return callback(error);
        }

        SDC.sysinfo = s;
        // nic tags are in sysinfo but not readily available, we need admin_ip
        // to know where to listen for stuff like VNC.
        nics = SDC.sysinfo['Network Interfaces'];
        for (nic in nics) {
            if (nics.hasOwnProperty(nic)) {
                if (nics[nic]['NIC Names'].indexOf('admin') !== -1) {
                    SDC.sysinfo.admin_ip = nics[nic].ip4addr;
                    VM.logger('DEBUG', 'found admin_ip: ' + SDC.sysinfo.admin_ip);
                }
            }
        }

        return callback();
    });
}

function updateZoneStatus(ev)
{
    if (ev.hasOwnProperty('zonename') && ev.hasOwnProperty('oldstate') &&
        ev.hasOwnProperty('newstate') && ev.hasOwnProperty('when')) {

        if (ev.newstate === 'running') {
            VM.logger('NOTICE', '"' + ev.zonename + '" went from ' + ev.oldstate + ' to running at ' + ev.when);
            VM.load(ev.zonename, function (err, obj) {
                var socket;
                var q = new Qmp(function () {return;});

                if (err) {
                    VM.logger('ERROR', "Unable to load vm", err);
                    return callback(err);
                }

                if (obj.brand !== 'kvm') {
                    // do nothing
                    VM.logger('DEBUG', 'Ignoring freshly started vm ' + obj.uuid + ' with brand=' + obj.brand);
                    return;
                }

                // clear any old timers or VNC since this vm just came up,
                // then spin up a new VNC.
                clearVM(obj.uuid);
                spawnVNC(obj);
            });
        } else if (ev.oldstate === 'running') {
            VM.logger('NOTICE', '"' + ev.zonename + '" went from running to ' + ev.newstate + ' at ' + ev.when);
            if (VNC.hasOwnProperty(ev.zonename)) {
                // VMs always have zonename === uuid, so we can remove this VNC session
                VM.logger('INFO', 'clearing state for disappearing VM ' + ev.zonename);
                clearVM(ev.zonename);
            }
        } else if (ev.newstate === 'uninitialized') { // this means 'installed'!?
            VM.logger('NOTICE', '"' + ev.zonename + '" went from running to ' + ev.newstate + ' at ' + ev.when);
            // XXX we're running stop so that it will clear the transition marker

            VM.load(ev.zonename, function (err, obj) {
                if (err) {
                    VM.logger('ERROR', "Unable to load vm", err);
                    return callback(err);
                }

                if (obj.brand !== 'kvm') {
                    // do nothing
                    VM.logger('DEBUG', 'Ignoring freshly stopped vm ' + obj.uuid + ' with brand=' + obj.brand);
                    return;
                }

                VM.stop(ev.zonename, {"force": true}, function (err) {
                    if (err) {
                        VM.logger('ERROR', 'stop failed', err);
                    }
                });
            });
        }
    } else {
        VM.logger('DEBUG', 'skip: ' + ev);
    }

    return;
}

function startZoneWatcher(callback)
{
    var chunks;
    var buffer = '';

    watcher = spawn('/usr/vm/sbin/zoneevent', [], {'customFds': [-1, -1, -1]});

    VM.logger('INFO', 'zoneevent running with pid ' + watcher.pid);

    watcher.stdout.on('data', function (data) {
        var chunk;
        var new_state;

        buffer += data.toString();
        chunks = buffer.split('\n');
        while (chunks.length > 1) {
            chunk = chunks.shift();
            obj = JSON.parse(chunk);

            //log('CHUNK: ' + JSON.stringify(obj));
            callback(obj);
        }
        buffer = chunks.pop();
    });

    watcher.stdin.end();

    watcher.on('exit', function (code) {
        VM.logger('INFO', 'zoneevent watcher exited.');
        watcher = null;
    });
}

function handlePost(c, args, response)
{
    VM.logger('DEBUG', 'POST len: ' + c + args);

    if (c.length !== 2 || c[0] !== 'vm') {
        VM.logger('DEBUG', '404 - handlePost ' + c.length + c);
        response.writeHead(404);
        response.end();
        return;
    }

    if (!args.hasOwnProperty('action') ||
        ['stop', 'sysrq', 'reset'].indexOf(args.action) === -1 ||
        (args.action === 'sysrq' && ['nmi', 'screenshot'].indexOf(args.request) === -1) ||
        (args.action === 'stop' && !args.hasOwnProperty('timeout'))) {

        // Bad request
        response.writeHead(400, { 'Content-Type': 'application/json'});
        response.end();
        return;
    }

    switch (args.action) {
    case 'stop':
        stopVM(c[1], args.timeout, function (err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Stopped ' + c[1]);
                response.end();
            }
        });
        break;
    case 'sysrq':
        sysrqVM(c[1], args.request, function(err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Sent sysrq to ' + c[1]);
                response.end();
            }
        });
        break;
    case 'reset':
        resetVM(c[1], function (err, res) {
            if (err) {
                response.writeHead(500, { 'Content-Type': 'application/json'});
                response.write(err.message);
                response.end();
            } else {
                response.writeHead(202, { 'Content-Type': 'application/json'});
                response.write('Sent reset to ' + c[1]);
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
    var types = [];

    VM.logger('DEBUG', 'GET (' + JSON.stringify(c) + ') len: ' + c.length);

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

    VM.logger('DEBUG', 'TYPES: ' + JSON.stringify(types));

    infoVM(c[1], types, function (err, res) {
        if (err) {
            VM.logger('ERROR', err.message, err);
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
        var url_parts;
        var c;

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
            VM.logger('DEBUG', 'url ' + request.url);
            VM.logger('DEBUG', 'args ' + args);
        } else {
            args = {};
        }

        if (request.method === 'POST') {
            var body='';
            request.on('data', function (data) {
                body +=data;
            });
            request.on('end',function(){
                var POST =  qs.parse(body);
                VM.logger('DEBUG', 'POST: ' + POST);
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
 * POST /vm/:id?action=sysrq&request=[nmi|screenshot]
 *
 */

function stopVM(uuid, timeout, callback)
{
    VM.logger('DEBUG', 'DEBUG stop(' + uuid + ')');

    if (!timeout) {
        return callback(new Error('stopVM() requires timeout to be set.'));
    }

    /* We load here to get the zonepath and ensure it exists. */
    VM.load(uuid, function (err, obj) {
        var socket;
        var q = new Qmp(function () {return;});

        if (err) {
            VM.logger('DEBUG', 'Unable to load vm: ' + err.message, err);
            return callback(err);
        }

        if (obj.brand !== 'kvm') {
            return callback(new Error('vmadmd only handles "stop" for kvm (' +
                'your brand is: ' + obj.brand + ')'));
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function(err) {
            if (err) {
                return callback(err);
            }
            q.command('system_powerdown', null, function (err, result) {
                VM.logger('DEBUG', 'result: ' + JSON.stringify(result));
                q.disconnect();

                // Setup to send kill when timeout expires
                setStopTimer(uuid, timeout * 1000);

                return callback(null);
            });
        });
    });
};

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
        'query-kvm',
    ];

    VM.logger('DEBUG', 'LOADING: ' + uuid);

    VM.load(uuid, function (err, obj) {
        var socket;
        //var q = new Qmp(console.log);
        var q = new Qmp(function () {return;});

        if (err) {
            return callback('Unable to load vm: ' + JSON.stringify(err));
        }

        if (obj.brand !== 'kvm') {
            return callback(new Error('vmadmd only handles "info" for kvm (' +
                'your brand is: ' + obj.brand + ')'));
        }

        if (obj.state !== 'running' && obj.state !== 'stopping') {
            return callback(new Error('Unable to get info for vm from ' +
                'state "' + obj.state + '", must be "running" or "stopping".'));
        }

        if (!types) {
            types = ['all'];
        }

        for (type in types) {
            type = types[type];
            if (VM.INFO_TYPES.indexOf(type) === -1) {
                return callback(new Error('unknown info type: ' + type));
            }
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';

        q.connect(socket, function(err) {
            if (err) {
                return callback(err);
            }
            // run each command in commands
            async.map(commands,
                function (command, cb)
                {
                    var base = command.replace(/^query-/, '');

                    if ((types.indexOf('all') !== -1) || (types.indexOf(base) !== -1)) {
                        q.command(command, null, function (err, result) {
                            cb(null, [base, result]);
                        });
                    } else {
                        cb(null, null);
                    }
                },
                function (err, results)
                {
                    var i;
                    q.disconnect();
                    if (err) {
                        VM.logger('ERROR', 'getVMInfo(): Unknown Error', err);
                        callback(err);
                    } else {
                        // key is in results[i][0], value in results[i][1]
                        for (i = 0; i < results.length; i++) {
                            if (results[i]) {
                                res[results[i][0]] = results[i][1];
                            }
                        }
                        if ((types.indexOf('all') !== -1) ||
                            (types.indexOf('vnc') !== -1)) {

                            res.vnc = {};
                            if (VNC.hasOwnProperty(obj.uuid)) {
                                res.vnc.host = VNC[obj.uuid].host;
                                res.vnc.port = VNC[obj.uuid].port;
                                res.vnc.display = VNC[obj.uuid].display;
                            }
                            callback(null, res);
                        } else {
                            callback(null, res);
                        }
                    }
                }
            );
        });
    });
}

function resetVM(uuid, callback)
{
    VM.logger('DEBUG', 'reset(' + uuid + ')');

    /* We load here to get the zonepath and ensure the vm exists. */
    VM.load(uuid, function (err, obj) {
        var socket;
        //var q = new Qmp(function () {console.log.apply(this, arguments);});
        var q = new Qmp(function () {return;});

        if (err) {
            VM.logger('DEBUG', "Unable to load vm: " + err.message, err);
            return callback(err);
        }

        if (obj.brand !== 'kvm') {
            return callback(new Error('vmadmd only handles "reset" for kvm (' +
                'your brand is: ' + obj.brand + ')'));
        }

        if (obj.state !== 'running') {
            return callback(new Error('Unable to reset vm from state "' +
                obj.state + '", must be "running".'));
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function(err) {
            if (err) {
                return callback(err);
            }
            q.command('system_reset', null, function (err, result) {
                //cb(null, result);
                VM.logger('DEBUG', 'result: ' + JSON.stringify(result));
                q.disconnect();
                return callback(null);
            });
        });
    });
};

function sysrqVM(uuid, req, callback)
{
    var SUPPORTED_REQS = ['screenshot', 'nmi'];
    VM.logger('DEBUG', 'sysrq(' + uuid + ',' + req + ')');

    /* We load here to ensure this vm exists. */
    VM.load(uuid, function (err, obj) {
        var socket;
        //var q = new Qmp(function () {console.log.apply(this, arguments);});
        var q = new Qmp(function () {return;});

        if (err) {
            VM.logger('ERROR', 'unable to load vm: ' + err.message, err);
            return callback(err);
        }

        if (obj.brand !== 'kvm') {
            return callback(new Error('vmadmd only handles "reset" for kvm (' +
                'your brand is: ' + obj.brand + ')'));
        }

        if (obj.state !== 'running' && obj.state !== 'stopping') {
            return callback(new Error('Unable to send request to vm from "'
                + 'state "' + obj.state + '", must be "running" or "stopping".'));
        }

        if (SUPPORTED_REQS.indexOf(req) === -1) {
            return callback(new Error('Invalid sysrq "' + req + '" valid values: '
                + '"' + SUPPORTED_REQS.join('","') + '".'));
        }

        socket = obj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function(err) {

            if (err) {
                return callback(err);
            }

            if (req === 'screenshot') {
                q.command('screendump', {'filename': '/tmp/vm.ppm'},
                    function (err, result) {
                        // XXX handle failuer
                        q.disconnect();
                        return callback(null);
                    }
                );
            } else if (req === 'nmi') {
                q.command('human-monitor-command', {'command-line': "nmi 0"},
                    function (err, result) {
                        // XXX handle failuer
                        q.disconnect();
                        return callback(null);
                    }
                );
            }
        });
    });
};

function setStopTimer(uuid, expire)
{
    VM.logger('DEBUG', 'clearing existing timer');
    clearTimer(uuid);
    VM.logger('DEBUG', 'SEtting STOP TIMER FOR ' + expire);
    TIMER[uuid] = setTimeout(function () {
        VM.logger('INFO', 'TIMEOUT');
        // reload and make sure we still need to kill.
        VM.load(uuid, function (e, obj) {
            if (e) {
                VM.logger('ERROR', "expire(): Unable to load vm: " + e.message, e);
                return;
            }
            // ensure we've not started and started stopping
            // again since we checked.
            VM.logger('DEBUG', 'times two: ' + Date.now() + ' ' + obj.transition_expire);
            if (obj.state === 'stopping' && obj.transition_expire &&
                (Date.now() >= obj.transition_expire)) {

                // We assume kill will clear the transition even if the
                // vm is already stopped.
                VM.stop(obj.uuid, {'force': true}, function (err) {
                    VM.logger('DEBUG', 'timeout vm.kill() = ' + JSON.stringify(err));
                });
            }
        });
    }, expire);
}

function loadVM(vmobj, do_autoboot)
{
    var expire;

    VM.logger('DEBUG', 'LOADING ' + JSON.stringify(vmobj));

    if (vmobj.never_booted || (vmobj.autoboot && do_autoboot)) {
        VM.start(vmobj.uuid, {}, function (err) {
            // XXX: this ignores errors!
            VM.logger('INFO', 'Autobooted ' + vmobj.uuid + ': [' + err + ']');
        });
    }

    if (vmobj.state === 'stopping' && vmobj.transition_expire) {
        VM.logger('DEBUG', 'times: ' + Date.now() + ' ' +  vmobj.transition_expire);
        if (Date.now() >= vmobj.transition_expire ||
            (vmobj.transition_to === 'stopped' && vmobj.real_state === 'installed')) {

            VM.logger('INFO', 'killing VM with expired running stop: ' + vmobj.uuid);
            // We assume kill will clear the transition even if the
            // vm is already stopped.
            VM.stop(vmobj.uuid, {'force': true}, function (err) {
                VM.logger('DEBUG', 'vm.kill() = ' + err.message, err);
            });
        } else {
            expire = ((Number(vmobj.transition_expire) + 1000) - Date.now());
            setStopTimer(vmobj.uuid, expire);
       }
    } else {
        VM.logger('DEBUG', 'state: ' + vmobj.state + ' expire: ' + vmobj.transition_expire);
    }

    // Start VNC
    spawnVNC(vmobj);
}

// kicks everything off
function main()
{
    if (DEBUG) {
        VM.logger('INFO', 'DEBUG is enabled');
    }

    // SIGUSR1 will toggle DEBUG on/off
    process.on('SIGUSR1', function () {
        if (DEBUG) {
            VM.logger('INFO', 'got USR1, setting DEBUG *off*');
            DEBUG = false;
        } else {
            VM.logger('INFO', 'got USR1, setting DEBUG *on*');
            DEBUG = true;
        }
    });

    // XXX TODO: load fs-ext so we can flock a pid file to be exclusive

    startZoneWatcher(updateZoneStatus);
    startHTTPHandler();

    loadConfig(function (err) {
        var do_autoboot = false;

        if (err) {
            VM.logger('ERROR', 'Unable to load config', err);
            process.exit(2);
        }

        path.exists(VMADMD_AUTOBOOT_FILE, function (exists) {
            var autobootLog;
            var uuid;

            if (!exists) {
                do_autoboot = true;
                // boot all autoboot vms because this vm just booted, now
                // create file so on restart we know they system wasn't just booted.
                fs.writeFileSync(VMADMD_AUTOBOOT_FILE, "booted");
            }

            VM.lookup({}, {"full": true}, function (err, vmobjs) {
                if (err) {
                    //return callback(err);
                }

                for (vmobj in vmobjs) {
                    vmobj = vmobjs[vmobj];
                    if (vmobj.brand === 'kvm') {
                        loadVM(vmobj, do_autoboot);
                    } else {
                        VM.logger('DEBUG', 'ignoring non-kvm VM ' + vmobj.uuid);
                    }

                    //return callback();
                }
            });
        });
    });
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        VM.logger('ERROR', 'Fatal: cannot run because: ' + err);
        process.exit(1);
    }
    main();
});
