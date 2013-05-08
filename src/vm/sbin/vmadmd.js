#!/usr/node/bin/node --abort_on_uncaught_exception
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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/node/node_modules/bunyan');
var cp = require('child_process');
var consts = require('constants');
var events = require('events');
var execFile = cp.execFile;
var fs = require('fs');
var net = require('net');
var VM = require('/usr/vm/node_modules/VM');
var onlyif = require('/usr/node/node_modules/onlyif');
var panic = require('/usr/node/node_modules/panic');
var path = require('path');
var spawn = cp.spawn;
var http = require('http');
var Qmp = require('/usr/vm/node_modules/qmp').Qmp;
var qs = require('querystring');
var url = require('url');
var util = require('util');

var VMADMD_PORT = 8080;
var VMADMD_AUTOBOOT_FILE = '/tmp/.autoboot_vmadmd';

var PROV_WAIT = {};
var SDC = {};
var SPICE = {};
var TIMER = {};
var VNC = {};


// Global bunyan logger object for use here in vmadmd
var log;

// Used to track which VMs we've seen so that we can update new ones the first
// time we see them regardless of which zone transition we see for them.  Also
// stores basic information so we don't have to VM.load() as often.
var seen_vms = {};


function sysinfo(callback)
{
    log.debug('/usr/bin/sysinfo');
    execFile('/usr/bin/sysinfo', [], function (error, stdout, stderr) {
        var obj;
        if (error) {
            callback(new Error(stderr.toString()));
        } else {
            obj = JSON.parse(stdout.toString());
            log.debug('sysinfo:\n' + JSON.stringify(obj, null, 2));
            callback(null, obj);
        }
    });
}

// vmobj needs:
//
// zonepath
//
function setRemoteDisplayPassword(vmobj, protocol, password)
{
    var q;
    var socket;

    q = new Qmp(log);

    socket = vmobj.zonepath + '/root/tmp/vm.qmp';

    log.debug('setting "' + protocol + '" password to "' + password
        + '"');

    q.connect(socket, function (err) {
        if (err) {
            log.warn(err, 'Warning: ' + protocol + ' password-set error: '
                + err.message);
        } else {
            q.command('set_password', {'protocol': protocol,
                'password': password}, function (e, result) {

                if (e) {
                    log.warn('failed to set password for ' + protocol, e);
                } else {
                    log.debug('result: '
                        + JSON.stringify(result));
                    q.disconnect();
                }
            });
        }
    });
}

// vmobj needs:
//
// spice_opts
// spice_password
// spice_port
// state
// uuid
// vnc_password
// vnc_port
// zone_state
// zonepath
//
function spawnRemoteDisplay(vmobj)
{
    var addr;
    var listen_ip;
    var port;
    var protocol;
    var server;
    var sockpath;
    var zonepath = vmobj.zonepath;

    if (!vmobj.zonepath) {
        zonepath = '/zones/' + vmobj.uuid;
    }

    // We need to work out which protocol to use since only one will work
    // (effectively) at any given time. If a spice_port is set then we will use
    // that, otherwise we default back to VNC.
    if (vmobj.hasOwnProperty('spice_port') && vmobj.spice_port > 0) {
        protocol = 'spice';
        port = vmobj.spice_port;
        sockpath = '/root/tmp/vm.spice';
    } else {
        protocol = 'vnc';
        if (vmobj.hasOwnProperty('vnc_port')) {
            port = vmobj.vnc_port;
        } else {
            port = 0;
        }
        sockpath = '/root/tmp/vm.vnc';
    }

    if (vmobj.state !== 'running' && vmobj.zone_state !== 'running') {
        log.debug('skipping ' + protocol + ' setup for non-running VM '
            + vmobj.uuid);
        return;
    }

    if (port === -1) {
        log.info(protocol + ' listener disabled (port === -1) for VM '
            + vmobj.uuid);
        return;
    }

    server = net.createServer(function (c) {
        var dpy = net.Stream();
        var remote_address = '';
        c.pipe(dpy);
        dpy.pipe(c);

        remote_address = '[' + c.remoteAddress + ']:' + c.remotePort;
        c.on('close', function (had_error) {
            log.info(protocol + ' connection ended from '
                + remote_address);
        });

        dpy.on('error', function () {
            log.warn('Warning: ' + protocol + ' socket error: '
                + JSON.stringify(arguments));
        });

        c.on('error', function () {
            log.warn('Warning: ' + protocol + ' net socket error: '
                + JSON.stringify(arguments));
        });

        dpy.connect(path.join(zonepath, sockpath));
    });

    log.info('spawning ' + protocol + ' listener for ' + vmobj.uuid
        + ' on ' + SDC.sysinfo.admin_ip);

    // Before we start the listener, set the password if needed.

    if (protocol === 'vnc') {
        if (vmobj.hasOwnProperty('vnc_password')
            && vmobj.vnc_password.length > 0) {

            setRemoteDisplayPassword(vmobj, 'vnc', vmobj.vnc_password);
        }
    } else if (protocol === 'spice') {
        if (vmobj.hasOwnProperty('spice_password')
            && vmobj.spice_password.length > 0) {

            setRemoteDisplayPassword(vmobj, 'spice', vmobj.spice_password);
        }
    }

    server.on('connection', function (sock) {
        log.info(protocol + ' connection started from ['
            + sock.remoteAddress + ']:' + sock.remotePort);
    });

    if (vmobj.hasOwnProperty('listen_ip')) {
        listen_ip = vmobj.listen_ip;
    } else {
        listen_ip = SDC.sysinfo.admin_ip;
    }
    server.listen(port, listen_ip, function () {
        addr = server.address();

        if (protocol == 'vnc') {
            VNC[vmobj.uuid] = {'host': listen_ip, 'port': addr.port,
                'server': server};
            if (addr.port >= 5900) {
                // only add the display number when it's non-negative
                VNC[vmobj.uuid].display = (addr.port - 5900);
            }
            if (vmobj.hasOwnProperty('vnc_password')
                && vmobj.vnc_password.length > 0) {

                VNC[vmobj.uuid].password = vmobj.vnc_password;
            }
            log.debug('VNC details for ' + vmobj.uuid + ': '
                + util.inspect(VNC[vmobj.uuid]));
        } else if (protocol == 'spice') {
            SPICE[vmobj.uuid] = {'host': listen_ip,
                'port': addr.port, 'server': server};
            if (vmobj.hasOwnProperty('spice_password')
                && vmobj.spice_password.length > 0) {

                SPICE[vmobj.uuid].password = vmobj.spice_password;
            }
            if (vmobj.hasOwnProperty('spice_opts')
                && vmobj.spice_opts.length > 0) {

                SPICE[vmobj.uuid].spice_opts = vmobj.spice_opts;
            }

            log.debug('SPICE details for ' + vmobj.uuid + ': '
                + util.inspect(SPICE[vmobj.uuid]));
        }
    });
}

function clearRemoteDisplay(uuid)
{
    // We want to clear anything we have active since we may
    // have changed settings on the fly...§jd

    // Spice...
    if (SPICE[uuid] && SPICE[uuid].server) {
        SPICE[uuid].server.close();
    }
    delete SPICE[uuid];

    // VNC...
    if (VNC[uuid] && VNC[uuid].server) {
        VNC[uuid].server.close();
    }
    delete VNC[uuid];
}

function reloadRemoteDisplay(vmobj)
{
    log.info('reloading remote display for ' + vmobj.uuid);
    clearRemoteDisplay(vmobj.uuid);
    spawnRemoteDisplay(vmobj);
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
    clearRemoteDisplay(uuid);
    clearTimer(uuid);
}

// loads the system configuration
function loadConfig(callback)
{
    log.debug('loadConfig()');

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
                        log.debug('found admin_ip: '
                            + SDC.sysinfo.admin_ip);
                    }
                }
            }

            callback();
        }
    });
}

/*
 * This calls cb when either the VM has finished provisioning or there was an
 * urecoverable error.
 *
 * cb() will be called with:
 *
 *  (err) -- an error object when we can't continue
 *  (null, 'success') -- when the provision succeeded
 *  (null, 'failure') -- when the provision failed or timed out
 *
 * NOTE:
 *  - when the provision succeeds for KVM: this will start the VNC
 *  - when the provision fails: calls VM.markVMFailure() to put it in 'failed'
 *
 * vmobj should have:
 *
 *  brand
 *  state
 *  transition_expire
 *  transition_to
 *  uuid
 *  zonename
 *  zonepath
 *
 */
function handleProvisioning(vmobj, cb)
{
    var provision_fail_fn;
    var provision_ok_fn;
    var provisioning_fn;

    // assert vmobj.state === 'provisioning'

    function success() {
        var load_fields = [
            'spice_opts',
            'spice_password',
            'spice_port',
            'state',
            'uuid',
            'vnc_password',
            'vnc_port',
            'zone_state',
            'zonepath'
        ];

        if (vmobj.brand === 'kvm') {
            // reload the VM to see if we should setup VNC, etc.
            VM.load(vmobj.uuid, {fields: load_fields},
                function (load_err, obj) {

                if (load_err) {
                    log.error(load_err, 'unable to load VM after '
                        + 'waiting for provision: ' + load_err.message);
                    cb(load_err);
                    return;
                }
                log.debug('VM state is ' + obj.state + ' after provisioning');
                if (obj.state === 'running') {
                    // clear any old timers or VNC/SPICE since this vm just came
                    // up (state was provisioning), then spin up a new VNC.
                    clearVM(obj.uuid);
                    spawnRemoteDisplay(obj);
                }
                cb(null, 'success');
            });
        } else {
            cb(null, 'success');
        }
    }

    function failure() {
        VM.markVMFailure(vmobj, function (mark_err) {
            VM.log.warn(mark_err, 'provisioning failed, zone is being stopped '
                + 'for manual investigation.');
            cb(null, 'failure');
        });
    }

    provision_fail_fn = path.join(vmobj.zonepath,
        'root/var/svc/provision_failure');
    provision_ok_fn = path.join(vmobj.zonepath,
        'root/var/svc/provision_success');
    provisioning_fn = path.join(vmobj.zonepath,
        'root/var/svc/provisioning');

    if (fs.existsSync(provisioning_fn)) {
        // wait for /var/svc/provisioning to disappear
        VM.waitForProvisioning(vmobj, function (wait_err) {
            VM.log.debug(wait_err, 'waited for provisioning');
            if (wait_err) {
                cb(wait_err);
                return;
            }
            VM.unsetTransition(vmobj, function (unset_err) {
                if (unset_err) {
                    VM.log.debug(unset_err, 'failed to unset transition');
                    failure();
                } else {
                    VM.log.debug('unset provision transition for '
                        + vmobj.uuid);
                    success();
                }
            });
        });
    } else if (fs.existsSync(provision_ok_fn)) {
        // no /var/svc/provisioning file, but we have success file
        VM.unsetTransition(vmobj, function (unset_err) {
            if (unset_err) {
                cb(unset_err);
                return;
            }
            log.info(unset_err, 'unset "provisioning" because we saw '
                + 'provision_success for ' + vmobj.uuid);
            success();
        });
    } else if (fs.existsSync(provision_fail_fn)) {
        // we failed but someone forgot to set the flag (state==provisioning)
        VM.log.warn('Marking VM ' + vmobj.uuid + ' as a "failure" because '
            + provision_fail_fn + ' exists.');
        failure();
    } else {
        // none of the provisioning files exist and we only support zones which
        // are going to handle these, so we must have succeeded and just missed
        // clearing the provisioning state.
        log.warn('all provisioning files missing, assuming provision success.');
        VM.unsetTransition(vmobj, function (unset_err) {
            if (unset_err) {
                cb(unset_err);
                return;
            }
            success();
        });
    }
}

// NOTE: nobody's paying attention to whether this completes or not.
function updateZoneStatus(ev)
{
    var load_fields;
    var reprovisioning = false;

    if (! ev.hasOwnProperty('zonename') || ! ev.hasOwnProperty('oldstate')
        || ! ev.hasOwnProperty('newstate') || ! ev.hasOwnProperty('when')) {

        log.debug('skipping unknown event: ' + JSON.stringify(ev, null, 2));
        return;
    }

    /*
     * State changes we care about:
     *
     * running -> <anystate> (KVM ONLY)
     *   - zone is stopping, stop VNC
     *   - remove stop timer/timeout
     *
     * <anystate> -> uninitialized (KVM ONLY)
     *   - zone stopped
     *   - clear the 'stopping' transition
     *
     * <anystate> -> running (KVM ONLY)
     *    - setup VNC / SPICE
     *
     * <any transitions>
     *    - first time we see a VM (any brand), we'll wait for it to go
     *      provisioning -> X
     *    - if <zonepath>/root/var/svc/provisioning shows up check for
     *      reprovisioning
     */

    // if we've never seen this VM before, we always load once.
    if (!seen_vms.hasOwnProperty(ev.zonename)) {
        log.debug(ev.zonename + ' is a VM we haven\'t seen before and went '
            + 'from ' + ev.oldstate + ' to ' + ev.newstate + ' at ' + ev.when);
        seen_vms[ev.zonename] = {};
        // We'll continue on to load this VM below with VM.load()
    } else if (!seen_vms[ev.zonename].hasOwnProperty('uuid')) {
        // We just saw this machine and haven't finished loading it the first
        // time.
        log.debug('Already loading VM ' + ev.zonename + ' ignoring transition'
            + ' from ' + ev.oldstate + ' to ' + ev.newstate + ' at ' + ev.when);
        return;
    } else if (PROV_WAIT[seen_vms[ev.zonename].uuid]) {
        // We're already waiting for this machine to provision, other
        // transitions are ignored in this state because we don't start VNC
        // until after provisioning anyway.
        log.debug('still waiting for ' + seen_vms[ev.zonename].uuid
            + ' to complete provisioning, ignoring additional transition.');
        return;
    } else if (!(seen_vms[ev.zonename].provisioned)) {
        log.debug('VM ' + seen_vms[ev.zonename].uuid + ' is not provisioned'
            + ' and not provisioning, doing VM.load().');
        // Continue on to VM.load()
    } else if (seen_vms[ev.zonename].brand === 'kvm'
        && (ev.newstate === 'running'
        || ev.oldstate === 'running'
        || ev.newstate === 'uninitialized')) {

        log.info('' + ev.zonename + ' (kvm) went from ' + ev.oldstate
            + ' to ' + ev.newstate + ' at ' + ev.when);
        // Continue on to VM.load()
    } else {
        try {
            if (fs.existsSync(seen_vms[ev.zonename].zonepath
                + '/root/var/svc/provisioning')) {

                log.info('/var/svc/provisioning exists for VM '
                    + seen_vms[ev.zonename].uuid + ' assuming reprovisioning');
                reprovisioning = true;
            }
        } catch (e) {
            if (e.code !== 'ENOENT') {
                log.warn(e, 'Unable to check for /var/svc/provisioning for '
                    + 'VM ' + seen_vms[ev.zonename].uuid);
            }
        }
        if (!reprovisioning) {
            log.trace('ignoring transition for ' + ev.zonename + ' ('
                + seen_vms[ev.zonename].brand + ') from ' + ev.oldstate + ' to '
                + ev.newstate + ' at ' + ev.when);
            return;
        }
    }

    load_fields = [
        'brand',
        'failed',
        'spice_opts',
        'spice_password',
        'spice_port',
        'state',
        'transition_expire',
        'transition_to',
        'uuid',
        'vnc_password',
        'vnc_port',
        'zone_state',
        'zonename',
        'zonepath'
    ];

    // XXX won't work if ev.zonename != uuid, use lookup instead?
    VM.load(ev.zonename, {fields: load_fields}, function (err, vmobj) {

        if (err) {
            log.warn(err, 'unable to load zone: ' + err.message);
            return;
        }

        if (vmobj.failed) {
            // never do anything to failed zones
            log.info('doing nothing for ' + ev.zonename + ' transition because '
                + ' VM is marked "failed".');
            return;
        }

        // keep track of a few things about this zone that won't change so that
        // we don't have to VM.load() every time.
        if (!seen_vms.hasOwnProperty(ev.zonename)) {
            seen_vms[ev.zonename] = {};
        }
        if (!seen_vms[ev.zonename].hasOwnProperty('uuid')) {
            seen_vms[ev.zonename].uuid = vmobj.uuid;
            seen_vms[ev.zonename].brand = vmobj.brand;
            seen_vms[ev.zonename].zonepath = vmobj.zonepath;
        }

        if (vmobj.state === 'provisioning') {
            // check that we're not already waiting.
            if (PROV_WAIT.hasOwnProperty(vmobj.uuid)) {
                log.trace('already waiting for ' + vmobj.uuid
                    + ' to leave "provisioning"');
                return;
            }

            if (reprovisioning && seen_vms[ev.zonename].provisioned) {
                // we're reprovisioning so consider ! provisioned
                seen_vms[ev.zonename].provisioned = false;
            }

            PROV_WAIT[vmobj.uuid] = true;
            handleProvisioning(vmobj, function (prov_err, result) {
                delete PROV_WAIT[vmobj.uuid]; // this waiter finished

                // We assume that by getting here we've either succeeded or
                // failed at provisioning, but either way we're done.
                seen_vms[ev.zonename].provisioned = true;

                if (prov_err) {
                    log.error(prov_err, 'error handling provisioning state for'
                        + ' ' + vmobj.uuid + ': ' + prov_err.message);
                    return;
                }
                log.debug('handleProvision() for ' + vmobj.uuid + ' returned: '
                    +  result);
                return;
            });
        } else {
            // This zone finished provisioning some time in the past
            seen_vms[ev.zonename].provisioned = true;
        }

        // don't handle transitions other than provisioning for non-kvm
        if (vmobj.brand !== 'kvm') {
            log.trace('doing nothing for ' + ev.zonename + ' transition '
                + 'because brand != "kvm"');
            return;
        }

        if (ev.newstate === 'running') {
            // clear any old timers or VNC/SPICE since this vm just came
            // up, then spin up a new VNC.
            clearVM(vmobj.uuid);
            spawnRemoteDisplay(vmobj);
        } else if (ev.oldstate === 'running') {
            if (VNC.hasOwnProperty(ev.zonename)) {
                // VMs always have zonename === uuid, so we can remove this
                log.info('clearing state for disappearing VM ' + ev.zonename);
                clearVM(ev.zonename);
            }
        } else if (ev.newstate === 'uninitialized') { // this means installed!?
            // XXX we're running stop so it will clear the transition marker

            VM.stop(ev.zonename, {'force': true}, function (e) {
                if (e && e.code !== 'ENOTRUNNING') {
                    log.error(e, 'stop failed');
                }
            });
        }
    });
}

function startZoneWatcher(callback)
{
    var chunks;
    var buffer = '';
    var watcher;

    watcher = spawn('/usr/vm/sbin/zoneevent', [], {'customFds': [-1, -1, -1]});

    log.info('zoneevent running with pid ' + watcher.pid);

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
        log.info('zoneevent watcher exited.');
        watcher = null;
    });
}

function handlePost(c, args, response)
{
    var load_fields;
    var uuid;

    log.debug('POST len: ' + c + args);

    if (c.length !== 2 || c[0] !== 'vm') {
        log.debug('404 - handlePost ' + c.length + c);
        response.writeHead(404);
        response.end();
        return;
    }

    uuid = c[1];

    if (!args.hasOwnProperty('action')
        || ['stop', 'sysrq',
            'reset', 'reload_display'].indexOf(args.action) === -1
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
    case 'reload_display':
        load_fields = [
            'spice_opts',
            'spice_password',
            'spice_port',
            'state',
            'uuid',
            'vnc_password',
            'vnc_port',
            'zone_state',
            'zonepath'
        ];

        VM.load(uuid, {fields: load_fields}, function (err, obj) {
            if (err) {
                response.writeHead(404);
                response.write('Unable to load VM ' + uuid);
                response.end();
                return;
            }
            reloadRemoteDisplay(obj);
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

function getInfo(uuid, args, response)
{
    var t;
    var type;
    var types = [];

    if (args.hasOwnProperty('types')) {
        t = args.types.split(',');
        for (type in t) {
            types.push(t[type]);
        }
    }

    if (types.length === 0) {
        types.push('all');
    }

    log.debug('TYPES: ' + JSON.stringify(types));

    infoVM(uuid, types, function (err, res) {
        if (err) {
            log.error(err.message, err);
            response.writeHead(500, { 'Content-Type': 'application/json'});
            response.end();
        } else {
            response.writeHead(200, { 'Content-Type': 'application/json'});
            response.end(JSON.stringify(res, null, 2), 'utf-8');
        }
        return;
    });
}

function handleGet(c, args, response)
{
    var uuid = c[1];

    log.debug('GET (' + JSON.stringify(c) + ') len: ' + c.length);

    if (c.length === 3 && c[0] === 'vm' && c[2] === 'info') {
        getInfo(uuid, args, response);
    } else {
        response.writeHead(404);
        response.end();
    }
}

function startHTTPHandler()
{
    var ip;
    var ips = ['127.0.0.1'];

    var handler = function (request, response) {
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
            log.debug('url ' + request.url);
            log.debug('args ' + JSON.stringify(args));
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

                log.debug('POST: ' + JSON.stringify(POST));
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
    };

    for (ip in ips) {
        ip = ips[ip];
        log.debug('LISTENING ON ' + ip + ':' + VMADMD_PORT);
        http.createServer(handler).listen(VMADMD_PORT, ip);
    }
}

/*
 * GET /vm/:id[?type=vnc,xxx]
 * POST /vm/:id?action=stop
 * POST /vm/:id?action=reset
 * POST /vm/:id?action=reload_display
 * POST /vm/:id?action=sysrq&request=[nmi|screenshot]
 *
 */

function stopVM(uuid, timeout, callback)
{
    log.debug('DEBUG stop(' + uuid + ')');

    if (!timeout) {
        callback(new Error('stopVM() requires timeout to be set.'));
        return;
    }

    /* We load here to get the zonepath and ensure it exists. */
    VM.load(uuid, {fields: ['brand', 'zonepath']}, function (err, vmobj) {
        var socket;
        var q;

        if (err) {
            log.debug('Unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        q = new Qmp(log);

        if (vmobj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "stop" for kvm ('
                + 'your brand is: ' + vmobj.brand + ')'));
            return;
        }

        socket = vmobj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function (error) {
            if (error) {
                callback(error);
                return;
            }
            q.command('system_powerdown', null, function (e, result) {
                log.debug('result: ' + JSON.stringify(result));
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
    var load_fields;
    var res = {};
    var commands = [
        'query-status',
        'query-version',
        'query-chardev',
        'query-block',
        'query-blockstats',
        'query-cpus',
        'query-pci',
        'query-kvm'
    ];

    log.debug('LOADING: ' + uuid);

    load_fields = [
        'brand',
        'state',
        'uuid',
        'zonepath'
    ];

    VM.load(uuid, {fields: load_fields}, function (err, vmobj) {
        var q;
        var socket;
        var type;

        if (err) {
            callback('Unable to load vm: ' + JSON.stringify(err));
            return;
        }

        if (vmobj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "info" for kvm ('
                + 'your brand is: ' + vmobj.brand + ')'));
            return;
        }

        if (vmobj.state !== 'running' && vmobj.state !== 'stopping') {
            callback(new Error('Unable to get info for vm from state "'
                + vmobj.state + '", must be "running" or "stopping".'));
            return;
        }

        q = new Qmp(log);

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

        socket = vmobj.zonepath + '/root/tmp/vm.qmp';

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
                    log.error('getVMInfo(): Unknown Error', e);
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
                        if (VNC.hasOwnProperty(vmobj.uuid)) {
                            res.vnc.host = VNC[vmobj.uuid].host;
                            res.vnc.port = VNC[vmobj.uuid].port;
                            if (VNC[vmobj.uuid].hasOwnProperty('display')) {
                                res.vnc.display = VNC[vmobj.uuid].display;
                            }
                            if (VNC[vmobj.uuid].hasOwnProperty('password')
                                && VNC[vmobj.uuid].password.length > 0) {

                                res.vnc.password = VNC[vmobj.uuid].password;
                            }
                        }
                    }
                    if ((types.indexOf('all') !== -1)
                        || (types.indexOf('spice') !== -1)) {

                        res.spice = {};
                        if (SPICE.hasOwnProperty(vmobj.uuid)) {
                            res.spice.host = SPICE[vmobj.uuid].host;
                            res.spice.port = SPICE[vmobj.uuid].port;
                            if (SPICE[vmobj.uuid].hasOwnProperty('password')
                                && SPICE[vmobj.uuid].password.length > 0) {

                                res.spice.password = SPICE[vmobj.uuid].password;
                            }
                            if (SPICE[vmobj.uuid].hasOwnProperty('spice_opts')
                                && SPICE[vmobj.uuid].spice_opts.length > 0) {

                                res.spice.spice_opts =
                                    SPICE[vmobj.uuid].spice_opts;
                            }
                        }
                    }
                    callback(null, res);
                }
            });
        });
    });
}

function resetVM(uuid, callback)
{
    var load_fields = [
        'brand',
        'state',
        'zonepath'
    ];

    log.debug('reset(' + uuid + ')');

    /* We load here to get the zonepath and ensure the vm exists. */
    VM.load(uuid, {fields: load_fields}, function (err, vmobj) {
        var q;
        var socket;

        if (err) {
            log.debug('Unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        if (vmobj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "reset" for kvm ('
                + 'your brand is: ' + vmobj.brand + ')'));
            return;
        }

        if (vmobj.state !== 'running') {
            callback(new Error('Unable to reset vm from state "'
                + vmobj.state + '", must be "running".'));
            return;
        }

        q = new Qmp(log);

        socket = vmobj.zonepath + '/root/tmp/vm.qmp';
        q.connect(socket, function (error) {
            if (error) {
                callback(error);
            } else {
                q.command('system_reset', null, function (e, result) {
                    log.debug('result: ' + JSON.stringify(result));
                    q.disconnect();
                    callback();
                });
            }
        });
    });
}

function sysrqVM(uuid, req, callback)
{
    var load_fields = ['brand', 'state', 'zonepath'];
    var SUPPORTED_REQS = ['screenshot', 'nmi'];

    log.debug('sysrq(' + uuid + ',' + req + ')');

    /* We load here to ensure this vm exists. */
    VM.load(uuid, {fields: load_fields}, function (err, vmobj) {
        var q;
        var socket;

        if (err) {
            log.error('unable to load vm: ' + err.message, err);
            callback(err);
            return;
        }

        if (vmobj.brand !== 'kvm') {
            callback(new Error('vmadmd only handles "reset" for kvm ('
                + 'your brand is: ' + vmobj.brand + ')'));
            return;
        }

        if (vmobj.state !== 'running' && vmobj.state !== 'stopping') {
            callback(new Error('Unable to send request to vm from "'
                + 'state "' + vmobj.state + '", must be "running" or '
                + '"stopping".'));
            return;
        }

        if (SUPPORTED_REQS.indexOf(req) === -1) {
            callback(new Error('Invalid sysrq "' + req
                + '" valid values: "' + SUPPORTED_REQS.join('","') + '".'));
            return;
        }

        q = new Qmp(log);

        socket = vmobj.zonepath + '/root/tmp/vm.qmp';
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
                            log.debug('sendkey err: '
                                + JSON.stringify(e) + ' result: '
                                + JSON.stringify(result));
                            cb(e);
                        });
                    }, function (cb) {
                        q.command('screendump', {'filename': '/tmp/vm.ppm'},
                            function (e, result) {

                            // XXX check result?
                            log.debug('sendkey err: '
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
    var load_fields = [
        'state',
        'transition_expire',
        'uuid'
    ];

    log.debug('Clearing existing timer');
    clearTimer(uuid);
    log.debug('Setting stop timer for ' + expire);
    TIMER[uuid] = setTimeout(function () {
        log.info('Timed out for ' + uuid + ' forcing stop.');
        // reload and make sure we still need to kill.
        VM.load(uuid, {fields: load_fields}, function (e, vmobj) {
            if (e) {
                log.error('expire(): Unable to load vm: ' + e.message, e);
                return;
            }
            log.debug('now ' + Date.now() + ' expire '
                + vmobj.transition_expire);
            // ensure we've not started and started stopping again since we
            // checked.
            if (vmobj.state === 'stopping' && vmobj.transition_expire
                && (Date.now() >= vmobj.transition_expire)) {

                // We assume kill will clear the transition even if the
                // vm is already stopped.
                VM.stop(vmobj.uuid, {'force': true}, function (err) {
                    if (err) {
                        log.debug(err, 'timeout VM.stop(force): '
                            + err.message);
                    } else {
                        log.debug('stopped VM ' + uuid + ' after timeout');
                    }
                });
            }
        });
    }, expire);
}

// vmobj should have:
//
// never_booted
// autoboot
// uuid
// state
// transition_expire
// transition_to
function loadVM(vmobj, do_autoboot)
{
    var expire;

    log.debug('LOADING ' + JSON.stringify(vmobj));

    if (vmobj.never_booted || (vmobj.autoboot && do_autoboot)) {
        VM.start(vmobj.uuid, {}, function (err) {
            // XXX: this ignores errors!
            log.info(err, 'Autobooted ' + vmobj.uuid);
        });
    }

    if (vmobj.state === 'stopping' && vmobj.transition_expire) {
        log.debug('times: ' + Date.now() + ' ' + vmobj.transition_expire);
        if (Date.now() >= vmobj.transition_expire
            || (vmobj.transition_to === 'stopped'
                && vmobj.zone_state === 'installed')) {

            log.info('killing VM with expired running stop: '
                + vmobj.uuid);
            // We assume kill will clear the transition even if the
            // vm is already stopped.
            VM.stop(vmobj.uuid, {'force': true}, function (err) {
                log.debug(err, 'VM.stop(force): ' + err.message);
            });
        } else {
            expire = ((Number(vmobj.transition_expire) + 1000) - Date.now());
            setStopTimer(vmobj.uuid, expire);
        }
    } else {
        log.debug('VM ' + vmobj.uuid + ' state: ' + vmobj.state);
        if (vmobj.transition_expire) {
            log.debug('VM ' + vmobj.uuid + ' expire: '
                + vmobj.transition_expire);
        }
    }

    // Start Remote Display
    spawnRemoteDisplay(vmobj);
}

// To help diagnose problems we write the keys we're watching to the TRACE log
// which can be viewed using dtrace.
function startTraceLoop() {
    setInterval(function () {
        var prov_wait_keys = Object.keys(PROV_WAIT);
        var timer_keys = Object.keys(TIMER);

        if (prov_wait_keys.length > 0) {
            log.trace('PROV_WAIT keys: ' + JSON.stringify(prov_wait_keys));
        }
        if (timer_keys.length > 0) {
            log.trace('TIMER keys: ' + JSON.stringify(timer_keys));
        }
    }, 5000);
}

// This checks zoneadm periodically to ensure that zones in 'seen_vms' all
// still exist, if not: collect garbage.
function startSeenCleaner() {
    setInterval(function () {
        execFile('/usr/sbin/zoneadm', ['list', '-c'],
            function (error, stdout, stderr) {
                var current_vms = {};

                if (error) {
                    log.error(error);
                    return;
                }

                stdout.split('\n').forEach(function (vm) {
                    if (vm.length > 0 && vm !== 'global') {
                        current_vms[vm] = true;
                    }
                });

                Object.keys(seen_vms).forEach(function (vm) {
                    if (current_vms.hasOwnProperty(vm)) {
                        log.trace('VM ' + vm + ' still exists, leaving "seen"');
                    } else {
                        // no longer exists
                        log.info('VM ' + vm + ' is gone, removing from "seen"');
                        delete seen_vms[vm];
                    }
                });
            }
        );
    }, (5 * 60) * 1000);
}

// kicks everything off
function main()
{
    // XXX TODO: load fs-ext so we can flock a pid file to be exclusive

    startZoneWatcher(updateZoneStatus);
    startHTTPHandler();
    startTraceLoop();
    startSeenCleaner();

    loadConfig(function (err) {
        var do_autoboot = false;

        if (err) {
            log.error(err, 'Unable to load config');
            process.exit(2);
        }

        fs.exists(VMADMD_AUTOBOOT_FILE, function (exists) {
            var lookup_fields;
            var vmobj;

            if (!exists) {
                do_autoboot = true;
                // boot all autoboot vms because this vm just booted, now
                // create file so on restart we know they system wasn't just
                // booted.
                fs.writeFileSync(VMADMD_AUTOBOOT_FILE, 'booted');
            }

            lookup_fields = [
                'brand',
                'spice_opts',
                'spice_password',
                'spice_port',
                'state',
                'transition_expire',
                'transition_to',
                'uuid',
                'vnc_password',
                'vnc_port',
                'zone_state',
                'zonename',
                'zonepath'
            ];

            VM.lookup({}, {fields: lookup_fields}, function (e, vmobjs) {
                for (vmobj in vmobjs) {
                    vmobj = vmobjs[vmobj];

                    if (!seen_vms.hasOwnProperty(vmobj.zonename)) {
                        seen_vms[vmobj.zonename] = {
                            brand: vmobj.brand,
                            uuid: vmobj.uuid,
                            zonepath: vmobj.zonepath
                        };
                    }
                    if (vmobj.state !== 'provisioning') {
                        seen_vms[vmobj.zonename].provisioned = true;
                    }

                    if (vmobj.state === 'failed') {
                        log.debug('skipping failed VM ' + vmobj.uuid);
                    } else if (vmobj.state === 'provisioning') {
                        log.debug('at vmadmd startup, VM ' + vmobj.uuid + ' is '
                            + 'in state "provisioning"');

                        if (PROV_WAIT.hasOwnProperty(vmobj.uuid)) {
                            log.warn('at vmadmd startup, already waiting for '
                                + '"provisioning" for ' + vmobj.uuid);
                            return;
                        }

                        PROV_WAIT[vmobj.uuid] = true;
                        // this calls the callback when we go out of
                        // provisioning one way or another.
                        handleProvisioning(vmobj, function (prov_err, result) {
                            delete PROV_WAIT[vmobj.uuid];
                            seen_vms[vmobj.zonename].provisioned = true;
                            if (prov_err) {
                                log.error(prov_err, 'error handling '
                                    + 'provisioning state for ' + vmobj.uuid
                                    + ': ' + prov_err.message);
                                return;
                            }
                            log.debug('at vmadmd startup, handleProvision() for'
                                + ' ' + vmobj.uuid + ' returned: ' +  result);
                        });
                    } else if (vmobj.brand === 'kvm') {
                        log.debug('calling loadVM(' + vmobj.uuid + ')');
                        loadVM(vmobj, do_autoboot);
                    } else {
                        log.debug('ignoring non-kvm VM ' + vmobj.uuid);
                    }
                }
            });
        });
    });
}

onlyif.rootInSmartosGlobal(function (err) {
    var log_stream = {
        stream: process.stderr,
        level: 'debug'
    };

    // have VM.js logs tagged with correct name and also output them in *our*
    // smf service log (stderr)
    VM.logname = 'vmadmd';
    VM.logger = log_stream;

    // setup vmadmd logger
    log = new bunyan({
        name: VM.logname,
        streams: [log_stream],
        serializers: bunyan.stdSerializers
    });

    if (err) {
        log.error(err, 'Fatal: cannot run because: ' + err.message);
        process.exit(1);
    }

    panic.enablePanicOnCrash({
        'skipDump': true,
        'abortOnPanic': true
    });

    log.info('Starting vmadmd');
    main();
});
