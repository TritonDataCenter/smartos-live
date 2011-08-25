#!/usr/bin/env node
/*
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 */

var async      = require('async');
var cp         = require('child_process');
var consts     = require('constants');
var events     = require('events');
var exec       = cp.exec;
var execFile   = cp.execFile;
var fs         = require('fs');
var net        = require('net');
var path       = require('path');
var spawn      = cp.spawn;
var sys        = require('sys');

if (process.env.DEBUG) {
    var DEBUG = true;
}

var SDC = {};
var VMS = {};
var WATCHERS = {};
var VMADMD_SOCK = '/tmp/vmadmd.sock';
var MIN_VRAM = 64;

var REQUIRED_FOR_CREATE = [
    'customer_uuid',
    'ram',
    'vcpus',
    'disks',
    'nics'
];

// Sends arguments to console.log with UTC datestamp prepended.
function log()
{
    var args = [];
    var now = new Date();

    // create new array of arguments from 'arguments' object, after timestamp
    args.push(now.toISOString());
    for (var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    console.log.apply(this, args);
}

function unregisterWatcher(fd)
{
    if (DEBUG) {
        log("Unregistering event handler for fd", fd);
    }
    delete WATCHERS[fd];
}

function registerEventWatcher(fd, func)
{
    if (DEBUG) {
        log("Registering event handler for fd", fd);
    }
    WATCHERS[fd] = func;
}

function outputEvent(data)
{
    var watchfds = [];

    function outputToWatcher(fd)
    {
        var func = WATCHERS[fd];
        func(null, data);
    }

    log("outputEvent:", WATCHERS);
    log("event data:", JSON.stringify(data));

    for (var k in WATCHERS) {
        if (WATCHERS.hasOwnProperty(k)) {
            watchfds.push(k);
        }
    }

    async.forEach(watchfds, outputToWatcher, function (err) {
        if (err) {
            log('outputEvent(): Unknown error -- ', err);
        }
    });
}

function watchEvents(properties, options, callback)
{
    var results = [];
    var vm;
    var update = options.update;
    var stream_fd = options.stream_fd;

    if (DEBUG) {
        log("fd", stream_fd, "asked to watch for events");
    }

    registerEventWatcher(stream_fd, function (err, evnt) {
        if (err) {
            callback(err);
        }
        update(evnt);
    });
}

// XXX BEGIN -- pulled from atropos/bin/amqp-config, pull out so we can include

function execFileParseJSON(bin, args, callback)
{
    if (DEBUG) {
        log('execFileParseJSON(', bin, args, ')');
    }

    execFile(bin, args, function (error, stdout, stderr) {
        var obj;
        if (error) {
            return callback(new Error(stderr.toString()));
        }
        obj = JSON.parse(stdout.toString());
        log(bin, args, '--', JSON.stringify(obj, null, 2));
        callback(null, obj);
    });
}

function sysinfo(callback)
{
    if (DEBUG) {
        log('sysinfo');
    }

    execFileParseJSON('/usr/bin/sysinfo', [], function (error, config) {
        if (error) {
            return callback(error);
        }
        callback(null, config);
    });
}

function sdcConfig(callback)
{
    if (DEBUG) {
        log('sdcConfig');
    }

    execFileParseJSON('/bin/bash', [ '/lib/sdc/config.sh', '-json' ],
        function (error, config)
        {
            if (error) {
                return callback(error);
            }
            callback(null, config);
        }
    );
}

// XXX END -- pulled from atropos/bin/amqp-config

// BEGIN -- qemu.js

function Qemu()
{
    this.connected = false;
    this.cmd_id = 0;
    this.in_transit = {};
    this.event_handler = null;
}

Qemu.prototype.on_event = function (callback)
{
    this.event_handler = callback;
};

Qemu.prototype.connect = function (uuid, socket, callback)
{
    var stream = new net.Stream();
    var connected = this.connected;
    var in_transit = this.in_transit;
    var event_handler = this.event_handler;
    var chunks, result, buffer = '', id, cb;

    stream.setEncoding('utf8');
    stream.on('data', function (chunk) {
        buffer += chunk.toString();
        chunks = buffer.split('\n');
        while (chunks.length > 1) {
            result = JSON.parse(chunks.shift());
            if (result.hasOwnProperty('QMP')) {
                log('QMP greeting:', JSON.stringify(result));
                stream.write(JSON.stringify({'execute': 'qmp_capabilities'}) +
                    '\n');
            } else if (result.hasOwnProperty('return')) {
                log('QMP result[', connected, ']:', JSON.stringify(result));
                if (connected === false) {
                    // this is the result from the initial qmp_capabilities cmd,
                    // we're ready now!
                    outputEvent({"timestamp": new Date().toISOString(),
                        "event": "QMP_CONNECTED", "uuid": uuid});
                    connected = true;
                } else {
                    if (result.hasOwnProperty('id')) {
                        id = result.id;
                        cb = in_transit[id].callback;
                        cb(null, result);
                        delete in_transit[id];
                    } else {
                        log('WARNING: no callback for [', result, ']');
                    }
                }
            } else if (result.hasOwnProperty('event')) {
                log('QMP event:', JSON.stringify(result.event));
                if (event_handler) {
                    event_handler(result);
                }
                result.uuid = uuid;
                result.timestamp = new Date((
                    result.timestamp.seconds * 1000000 +
                    result.timestamp.microseconds) / 1000).toISOString();
                outputEvent(result);
            } else {
                log('QMP error:', JSON.stringify(result));
            }
        }
        buffer = chunks.pop();
    });

    stream.on('close', function () {
        if (connected) {
            log('QMP close');
            if (event_handler) {
                event_handler({"event": "CLOSE"});
            }
            outputEvent({"timestamp": new Date().toISOString(),
                "event": "QMP_CLOSED", "uuid": uuid});
            connected = false;
            stream.end();
        }
    });

    setInterval(function () {
        var id;
        if (connected) {
            // send any commands that are in the queue.
            for (id in in_transit) {
                if (!in_transit[id].sent) {
                    log('sending[' + id + ']:', JSON.stringify(in_transit[id]));
                    stream.write(JSON.stringify(in_transit[id].packet) + '\n');
                    in_transit[id].sent = true;
                }
            }
        }
    }, 1000);

    this.socket = socket;

    stream.on('error', function (e) {
        callback(e);
    });

    stream.connect(this.socket, callback);
};

Qemu.prototype.command = function (command, args, callback)
{
    var cmd_id = this.cmd_id++;
    var packet = { 'execute': command, 'id': cmd_id };

    log('Qemu.command(', cmd_id, '):', command);

    if (args) {
        packet.arguments = args;
    }

    this.in_transit[cmd_id] = { 'packet': packet, 'sent': false,
        'callback': callback };
};

// END -- qemu.js

//
// Can be called with as:
//
//   qfunc = quantize(min, max, func)
//   qfunc(val, message)
//
// and val will be quantized to the range min-max before being passed to the
// function passed in as 'func'.
//
function quantize(min, max, func) {
    return function (percent, message) {
        var range;
        var val;

        range = max - min;
        val = Math.floor(((percent / 100) * range) + min);

        if (val > max) {
            val = max;
        }
        if (val < min) {
            val = min;
        }
        func(val, message);
    };
}

function forEachKVMZone(doer, callback)
{
    var fields, lines;
    var brand;

    exec('/usr/sbin/zoneadm list -pc', function (err, stdout, stderr) {
        var line;

        if (err) {
            return callback(err);
        }

        // Lines look like (without the breaks):
        //
        // 27:77ff1766-bab3-4b88-90de-e91d70029eff:running:\
        //     /zones/77ff1766-bab3-4b88-90de-e91d70029eff:\
        //     80cb4bbf-a805-4747-fe6a-cc0ae59bc7d4:kvm:excl:16
        //

        lines = stdout.split('\n');
        for (line in lines) {
            if (lines.hasOwnProperty(line)) {
                if (lines[line].length > 0) {
                    fields = lines[line].split(':');
                    brand = fields[5];

                    if (brand === "kvm") {
                        doer({
                            "name": fields[1],
                            "state": fields[2],
                            "zpath": fields[3],
                            "brand": brand
                        });
                    }
                }
            }
        }

        callback();
    });
}

function spawnVNC(uuid)
{
    var server;
    var addr;
    var zonepath;

    zonepath = VMS[uuid].data.zonepath;
    if (!zonepath) {
        zonepath = '/zones/' + uuid;
    }

    server = net.createServer(function (c) {
        var vnc = net.Stream();
        c.pipe(vnc);
        vnc.pipe(c);

        vnc.on('close', function (had_error) {
            // XXX we need to be able to restart the vnc if this happens,
            //     but the only case should be when the VM is shutoff, so
            //     we wouldn't be able to reconnect anyway.
            log('vnc closed for', uuid);
        });

        vnc.connect(zonepath + '/root/tmp/vm.vnc');
    });

    log('spawning VNC listener for' + uuid + 'on', SDC.sysinfo.admin_ip);
    // Listen on a random port on admin_ip
    server.listen(0, SDC.sysinfo.admin_ip);
    addr = server.address();

    VMS[uuid].vnc = {'host': SDC.sysinfo.admin_ip, 'port': addr.port,
        'display': (addr.port - 5900), 'server': server};

    log('VNC details for', uuid, ':', VMS[uuid].vnc);
}

function clearVNC(uuid)
{
    if (VMS[uuid].vnc && VMS[uuid].vnc.server) {
        VMS[uuid].vnc.server.close();
    }
    VMS[uuid].vnc = null;
}

function zoneCfg(uuid, zonecfg, callback)
{
    var tmpfile = '/tmp/zonecfg.' + uuid + '.tmp';

    fs.writeFile(tmpfile, zonecfg, function (err, result) {
        if (err) {
            // On failure we don't delete the tmpfile so we can debug it.
            return callback(err);
        } else {
            execFile('zonecfg', ['-z', uuid, '-f', tmpfile],
                function (error, stdout, stderr) {

                    if (error) {
                        log('failure', error, stdout, stderr);
                        return callback(error);
                    }

                    fs.unlink(tmpfile, function () {
                        return callback(null, stdout, stderr);
                    });
                }
            );
        }
    });
}

function setAutoboot(uuid, value, callback)
{
    log('setting vm-autoboot to ' + value + ' for ' + uuid);

    zoneCfg(uuid, 'select attr name=vm-autoboot; set value="' + value.toString() + '"; end\n',
        function (err, result) {
            if (err) {
                callback(err);
            } else {
                callback(null, result);
            }
        }
    );
}

function loadVM(uuid, callback)
{
    log('loadVM(', uuid, ')');

    exec('/usr/sbin/vmcfg ' + uuid, function (err, stdout, stderr) {
        log('ran vmcfg for:', uuid, 'data:', stdout.toString());
        if (err) {
            return callback(err);
        } else {
            if (VMS[uuid] && VMS[uuid].connected) {
                VMS[uuid].stream.end();
            }
            delete VMS[uuid];
            VMS[uuid] = {};
            VMS[uuid].action = null;
            VMS[uuid].data = JSON.parse(stdout);
            VMS[uuid].qmp = new Qemu();
            VMS[uuid].on_shutdown = [];
            VMS[uuid].emitter = new events.EventEmitter();
            VMS[uuid].qmp.on_event(function (e) {
                var func;
                log('handler got event: ', JSON.stringify(e));
                if (e.event === 'CLOSE') {
                    if (VMS[uuid].shutdown_timer) {
                        log('clearing shutdown timer');
                        clearTimeout(VMS[uuid].shutdown_timer);
                        VMS[uuid].shutdown_timer = null;
                    }
                    VMS[uuid].emitter.emit('qmp_close');
                    // VM shut down, set vm-autoboot to false so if we reboot
                    // now, VM won't come up.
                    if (VMS[uuid].state !== 'off') {
                        setAutoboot(uuid, false, function (err, result) {
                            if (err) {
                                log('Failed to update vm-autoboot to false after ' +
                                    uuid + ' socket was closed.');
                            }
                        });
                        VMS[uuid].state = 'off';
                    }
                    if (VMS[uuid].action && VMS[uuid].action === 'info') {
                        log('info still running when VM went off. Clearing.');
                        VMS[uuid].action = null;
                    }
                    clearVNC(uuid);
                    // XXX find other cases where this should be unset.
                    VMS[uuid].sock_open = false;
                    while (VMS[uuid].on_shutdown.length > 0) {
                        func = VMS[uuid].on_shutdown.shift();
                        func();
                    }
                }
            });
            VMS[uuid].state = 'unknown';
            VMS[uuid].sock_open = false;
            VMS[uuid].qmp.command('query-status', null, function (err, result) {
                if (err) {
                    log('query-status err [', err, ']');
                } else {
                    log('query-status result [', JSON.stringify(result), ']');
                    if (result['return'].running) {
                        VMS[uuid].state = 'running';
                        spawnVNC(uuid);
                        // the VM is running now, so make sure it's running if
                        // we reboot right now.
                        setAutoboot(uuid, true, function (err, result) {
                            if (err) {
                                log('error setting vm-autoboot to true for ' +
                                    uuid + ':', err);
                            }
                        });
                    }
                }
            });
            VMS[uuid].reconnector = setInterval(function () {
                if (VMS[uuid] && ! VMS[uuid].sock_open) {
                    if (DEBUG) {
                        log('attempting connect for ' + uuid);
                    }
                    VMS[uuid].qmp.connect(uuid, VMS[uuid].data.zonepath +
                       '/root/tmp/vm.qmp',
                        function (err, result) {
                            if (err) {
                                if (DEBUG) {
                                    log("FAILERR:", err);
                                }
                                switch (err.errno) {
                                case consts.ECONNREFUSED:
                                case consts.ECONNRESET:
                                case consts.ENOENT:
                                    if (VMS[uuid] &&
                                        VMS[uuid].state !== 'off') {

                                        VMS[uuid].state = 'off';
                                        // VM is not running, so don't bring it
                                        // up if we reboot now.
                                        setAutoboot(uuid, false,
                                            function (err, result) {
                                                if (err) {
                                                    log('Failed to update ' +
                                                    'vm-autoboot to false ' +
                                                    'for ' + uuid);
                                                }
                                            }
                                        );
                                        clearVNC(uuid);
                                    }
                                    break;
                                default:
                                    if (DEBUG) {
                                        log('connect failed:', err.message);
                                    }
                                    break;
                                }
                            } else {
                                VMS[uuid].sock_open = true;
                                log('QMP connected for', uuid);

                                // Tell the metadata API about this VM
                                //metadata_api.stdin.write(zone_prefix +
                                    //'/root/tmp/vm.ttyb ' + filename + '\n');
                            }
                        }
                    );
                }
            }, 1000);
            callback(null, VMS[uuid]);
            // TODO whenever connection closes, mark vm as unavailable
        }
    });
}

// load (or reload) the global VMS object from the json files in
// /zones/<uuid>/config/vm.json
function loadVMs(callback)
{
    var new_vms = [];
    var all_vms = [];

    if (DEBUG) {
        log('loadVMs');
    }

    forEachKVMZone(
        function (zonedata)
        {
            // Build two lists, one of all existing VMs (all_vms) and one of all
            // VMs that exist but we don't already know about (new_vms)
            if (!VMS.hasOwnProperty(zonedata.name)) {
                log('loadVMs(): found new VM:', zonedata.name);
                new_vms.push(zonedata.name);
            }
            all_vms.push(zonedata.name);
        },
        function (err) {
            var vm;

            if (err) {
                return (callback(err));
            }

            // remove VMs that no longer exist
            for (vm in VMS) {
                if (VMS.hasOwnProperty(vm)) {
                    if (all_vms.indexOf(vm) === -1) {
                        // doesn't exist
                        log('loadVMs(): removing', vm,
                            "which doesn't exist.");
                        delete VMS[vm];
                    }
                }
            }

            // load the new VMs
            async.forEach(new_vms, loadVM, function (err) {
                if (err) {
                    log('loadVMs(): Unknown error -- ', err);
                    callback(err);
                } else {
                    callback();
                }
            });
        }
    );
}

// delete a zvol
function deleteVolume(volume, options, callback)
{
    var cmd;
    var trace = options.trace;

    cmd = 'zfs destroy ' + volume.zfs_filesystem;
    log('deleteVolume() running:', cmd);
    exec(cmd, function (err, stdout, stderr) {
        // err will be non-null if something broke
        trace({'deleteVolume:zfs-destroy:command': cmd,
            'deleteVolume:zfs-destroy:stdout': stdout,
            'deleteVolume:zfs-destroy:stderr': stderr});
        callback(err);
    });
}

// deleteVolume() all the volumes for a given VM
function deleteVolumes(vm, options, callback)
{
    var cmd;
    var trace = options.trace;

    if (DEBUG) {
        log('deleteVolumes()');
    }

    function delVolume(volume, callback) {
        deleteVolume(volume, options, callback);
    }

    async.forEach(vm.disks, delVolume, function (err) {
        if (err) {
            log('deleteVolumes(): Unknown error -- ', err);
            callback(err);
        } else {
            trace({'deleteVolumes': 'done'});
            callback();
        }
    });
}

function destroyZone(uuid, options, callback)
{
    var trace = options.trace;

    if (DEBUG) {
        log('destroyZone');
    }

    // XXX sleep is here because zone is still shutting down, figure out
    // correct way to detect zone is down and then do uninstall.

    exec('sleep 5; zoneadm -z ' + uuid + ' uninstall -F',
        function (err, stdout, stderr)
        {
            if (err) {
                log('destroyZone(uninstall): Failed', err, stdout, stderr);
                return callback(err);
            }

            trace({'destroyZone(uninstall)': 'done'});
            exec('zonecfg -z ' + uuid + ' delete -F',
                function (err, stdout, stderr)
                {
                    if (err) {
                        log('destroyZone(delete): Failed', err, stdout, stderr);
                        return callback(err);
                    }

                    trace({'destroyZone(delete)': 'done'});
                    log('destroyZone(): destroyed zone', uuid);
                    return callback();
                }
            );
        }
    );
}

// delete the VM from the system and attempt to free all resources.
function deleteVM(vm, options, callback)
{
    var trace = options.trace;

    if (DEBUG) {
        log('deleteVM');
    }

    deleteVolumes(vm, options, function (err) {
        if (err) {
            // XXX: We don't treat volume deletion failure as fatal, since we
            // but we *will* need to clean this up manually in this case.
            log('WARNING: deleteVM(): unable to remove volumes, manual ' +
                'cleanup required! --', err);
        }

        // don't keep trying to reconnect to this socket, since it's gone.
        clearInterval(VMS[vm.uuid].reconnector);
        delete VMS[vm.uuid];

        destroyZone(vm.uuid, options, function (err) {
            if (err) {
                log('WARNING: deleteVM(): unable to remove zone ' + vm.uuid +
                    ', manual cleanup required! --', err);
            }
            trace({'deleteVM': 'done'});
            callback();
        });

    });
}

// 'kill' a VM process.  This is equivalent to pulling the power plug on a
// physical machine.
function killVM(payload, options, callback)
{
    var error, result;
    var trace = options.trace;

    // this gets run when the VM is actually shut down.
    VMS[payload.uuid].on_shutdown.push(function () {
        log('Finally finished killing');
        // these variables will be set by the callback from quit below.
        trace({'killVM': 'died'});
        callback(error, result);
    });

    // send the quit command
    VMS[payload.uuid].qmp.command('quit', null, function (err, res) {
        error = err;
        result = res;
        trace({'killVM:quit': 'sent'});
        log('QUIT RESULT:[', JSON.stringify(result), '] ERROR:[',
            JSON.stringify(error), ']');
    });
}

// Ensures that a VM is not running, then deletes it.
function destroyVM(payload, options, callback)
{
    var uuid = payload.uuid;
    var trace = options.trace;

    if (VMS[uuid] === undefined) {
        callback("VM doesn't exist on this machine", {});
    }

    var vm = VMS[uuid].data;

    if (DEBUG) {
        log('destroyVM');
    }

    if (VMS[uuid].sock_open) {
        // it's actually at least partially up
        log(uuid, 'is still running, killing then deleting');
        VMS[uuid].on_shutdown.push(function () {
            // XXX: We run the delete in 2 seconds, because we've got to wait
            // for the process to actually exit.  If we had PID, we could wait
            // 'til that is gone.
            setTimeout(deleteVM(vm, options, function (err, results) {
                if (err) {
                    // XXX: can't really do anything here because we've already
                    // responded to the client for the destroy.
                    trace({'destroyVM:deleteVM': 'failed',
                        'destroyVM:deleteVM:error': err});
                    log('delete of', uuid, 'failed with error:', err);
                } else {
                    trace({'destroyVM:deleteVM': 'done'});
                    log('Finished delete of', uuid);
                }
            }), 2000);
        });
        killVM(payload, options, function (err, results) {
            trace({'destroyVM:killVM': 'sent'});
            callback(err, results);
        });
    } else {
        log(uuid, 'already off, now deleting');
        deleteVM(vm, options, function (err, results) {
            trace({'destroyVM:deleteVM': 'done'});
            if (!err && !results) {
                results = 'success';
            }
            callback(err, results);
        });
    }
}

// writes a VM's metadata JSON to /zones/<uuid>/config/metadata.json
function saveMetadata(vm, callback)
{
    // TODO: handle vms created in different pools (not zones)

    var mdata_filename = '/zones/' + vm.uuid + '/config/metadata.json';
    var mdata;

    if (DEBUG) {
        log('saveMetadata');
    }

    if (vm.hasOwnProperty('customer_metadata')) {
        mdata = {"customer_metadata": vm.customer_metadata};
    } else {
        mdata = {"customer_metadata": {}};
    }

    fs.writeFile(mdata_filename, JSON.stringify(mdata, null, 2),
        function (err)
        {
            if (err) {
                return callback(err);
            }
            log('wrote to', mdata_filename);
            callback();
        }
    );
}

/*
 * Ensure nobody else is listening.
 *
 * XXX Note: yes there's a race here.  Ideally we'd be able to do an
 *     exclusive lock on /etc/vms or on a pid file or something.  But
 *     node currently lacks such ability, and I'd rather not write an
 *     extension yet.
 */
function onlyMe(socket, callback)
{
    exec("netstat -x | grep '" + socket + "' | wc -l",
        function (err, stdout, stderr)
        {
            if (err) {
                return callback(err);
            }

            if (parseInt(stdout.toString(), 10) === 0) {
                callback();
            } else {
                callback('Someone else already seems to be listening to ' +
                    socket);
            }
        }
    );
}

// validate parameters for VM creation
function checkProperties(properties, callback)
{
    var errors = [];
    var missing = [];
    var prop;
    var disk, d;
    var nic, n;

    if (DEBUG) {
        log('checkProperties');
    }

    for (prop in REQUIRED_FOR_CREATE) {
        if (REQUIRED_FOR_CREATE.hasOwnProperty(prop) &&
            !properties.hasOwnProperty(REQUIRED_FOR_CREATE[prop])) {

            missing.push(REQUIRED_FOR_CREATE[prop]);
        }
    }
    if (missing.length !== 0) {
        errors.push({'missing_keys': missing});
    }

    if (VMS.hasOwnProperty(properties.uuid)) {
        // This UUID already exists!?
        errors.push('Invalid UUID: already in use');
    }

    if (isNaN(parseInt(properties.ram, 10)) || properties.ram < MIN_VRAM) {
        errors.push('RAM must be an integer (virtual RAM in MiB, >= ' +
            MIN_VRAM + ')');
    }

    if (isNaN(parseInt(properties.vcpus, 10)) || properties.vcpus < 1) {
        errors.push('vcpus must be an integer (min 1)');
    }

    if (!properties.hasOwnProperty('cpu_shares') ||
        isNaN(parseInt(properties.cpu_shares, 10))) {
        log('Warning: no cpu_shares in create payload, using default.');
    }

    if (!properties.hasOwnProperty('zfs_io_priority') ||
        isNaN(parseInt(properties.zfs_io_priority, 10))) {
        log('Warning: no zfs_io_priority in create payload, using default.');
    }

    if (!properties.hasOwnProperty('max_lwps') ||
        isNaN(parseInt(properties.max_lwps, 10))) {
        log('Warning: no max_lwps in create payload, using default.');
    }

    for (disk in properties.disks) {
        if (properties.disks.hasOwnProperty(disk)) {
            d = properties.disks[disk];

            // XXX to boot, volume must be made available inside the zone!

            if (d.hasOwnProperty('media') &&
                ['disk', 'cdrom'].indexOf(d.media) === -1) {

                errors.push('When media specfied, must be one of [disk,cdrom]');
            }
            if (['virtio', 'ide', 'scsi'].indexOf(d.model) === -1) {
                errors.push('disk model must be one of [virtio,ide,scsi]');
            }
            if (d.image_uuid) {
                if (!d.image_name) {
                    errors.push('when image_uuid set, you must also set' +
                       'image_name');
                }
                if (!d.image_size || isNaN(parseInt(d.image_size, 10)) ||
                    d.image_size < 4 || (d.image_size % 4) !== 0) {

                    errors.push('when image_uuid is set, image_size must be ' +
                        'an integer multiple of 4 (disk in MiB)');
                }
            } else if (isNaN(parseInt(d.size, 10)) ||
                d.size < 4 || (d.size % 4) !== 0) {

                errors.push('when no image is specified, size must be an ' +
                    'integer multiple of 4 (disk in MiB)');
            }
        }
    }

    for (nic in properties.nics) {
        if (properties.nics.hasOwnProperty(nic)) {
            n = properties.nics[nic];
            if (!n.mac) {
                errors.push('All nics must have a mac address');
            }
            if (!n.model || ['virtio', 'ne2k_pci', 'rtl8139', 'e1000',
                'pcnet'].indexOf(n.model) === -1) {

                errors.push('All nics must have a model in [virtio,' +
                    'ne2k_pci,rtl8139,e1000,pcnet]');
            }
        }
    }

    if (errors.length === 0) {
        callback();
    } else {
        callback(errors);
    }
}

function setDefaultProperties(properties, callback)
{
    if (DEBUG) {
        log('setDefaultProperties');
    }

    // We'll have a UUID here because properties.uuid createVM does that before
    // calling setDefaultProperties()
    if (!properties.hasOwnProperty('hostname')) {
        properties.hostname = properties.uuid;
    }

    if (!properties.hasOwnProperty('autoboot')) {
        properties.autoboot = true;
    }

    if (!properties.hasOwnProperty('zfs_io_priority')) {
        properties.zfs_io_priority = 100;
    }

    if (!properties.hasOwnProperty('max_lwps')) {
        properties.max_lwps = 2000;
    }

    if (!properties.hasOwnProperty('cpu_shares')) {
        properties.cpu_shares = 1024;
    }

    callback();
}

// Ensure we've got all the datasets necessary to create this VM
//
// IMPORTANT:
//
// On SmartOS, we assume the the provisioner or some other external entity
// has called dataset_manager or otherwise loaded the dataset into the system.
// This function just checks that the dataset actually exists.
//
function checkDatasets(properties, progress, callback)
{
    var downloadme = [];
    var d;
    var disk;
    var get_progress;
    var min_progress;
    var max_progress;
    var inc_progress;
    var missing = 0;

    if (DEBUG) {
        log('checkDatasets');
    }

    // build list of datasets we need to download (downloadme)
    for (disk in properties.disks) {
        if (properties.disks.hasOwnProperty(disk)) {
            d = properties.disks[disk];
            log('disk: ', d);
            if (d.hasOwnProperty('image_uuid')) {
                log('XXX would ensure we have got dataset:', d.image_name);
            }
        }
    }

    if (missing > 0) {
        return callback('checkDatasets(): missing ' + missing + ' datasets');
    }

    progress(100, 'we have all necessary datasets');
    callback();
}

// generate a new UUID
function createUUID(callback)
{
    var uuid;

    if (DEBUG) {
        log('createUUID()');
    }

    exec('/usr/bin/uuid -v 4', function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        // chomp trailing spaces and newlines
        uuid = stdout.toString().replace(/\s+$/g, '');
        callback(null, uuid);
    });
}

// create a new LVM volume, updating progress
function createVolume(volume, options, progress, callback)
{
    var size;
    var trace = options.trace;
    var zpool = 'zones';

    if (DEBUG) {
        log('createVolume()');
    }

    if (volume.hasOwnProperty('image_size')) {
        size = volume.image_size;
    } else if (volume.hasOwnProperty('size')) {
        size = volume.size;
    } else {
        callback('FATAL: createVolume(' + sys.inspect(volume) +
            '): has no size or image_size');
    }

    if (volume.hasOwnProperty('zpool')) {
        zpool = volume.zpool;
    }

    async.series([
        function (cb)
        {
            createUUID(function (err, uuid) {
                if (err) {
                    return cb(err);
                }
                volume.uuid = uuid;
                trace({'createVolume:new_uuid': uuid});
                cb();
            });
        },
        function (cb)
        {
            var cmd;
            var trace_cmd;

            if (volume.hasOwnProperty('image_uuid')) {
                cmd = 'zfs snapshot ' + zpool + '/' + volume.image_uuid +
                    '@' + volume.uuid + ' && zfs clone ' + zpool + '/' +
                    volume.image_uuid + '@' + volume.uuid + ' ' +
                    zpool + '/' + volume.uuid;
                volume.path = '/dev/zvol/rdsk/' + zpool + '/' + volume.uuid;
                volume.zpool = zpool;
                trace_cmd = 'zfs-clone';
            } else {
                cmd = 'zfs create -V ' + size + 'M ' + zpool + '/' +
                    volume.uuid;
                volume.path = '/dev/zvol/rdsk/' + zpool + '/' + volume.uuid;
                volume.zpool = zpool;
                trace_cmd = 'zfs-create';
            }

            log('createVolume() running:', cmd);
            exec(cmd, function (err, stdout, stderr) {
                trace({'createVolume:cmd:stdout': stdout,
                    'createVolume:cmd:stderr': stderr});
                if (err) {
                    cb(trace_cmd + ' exited with code ' + err.code +
                        ' stdout: "' + stdout + '" stderr:"' + stderr + '"');
                } else {
                    cb();
                }
            });
        }
    ],
    function (err, results)
    {
        if (err) {
            trace({'createVolume:result': 'error',
                'createVolume:error': err});
            log('createVolume() error:', sys.inspect(err));
            callback(err);
        } else {
            trace({'createVolume:result': 'success'});
            log('createVolume() results:', sys.inspect(results));
            callback();
        }
    });
}

// Create all the volumes for a given VM property set
function createVolumes(properties, options, progress, callback)
{
    var createme = [];
    var d, disk;
    var trace = options.trace;

    if (DEBUG) {
        log('createVolumes()');
    }

    // generate list of volumes we need to create
    for (disk in properties.disks) {
        if (properties.disks.hasOwnProperty(disk)) {
            d = properties.disks[disk];
            log('create disk:', d);
            createme.push(d);
        }
    }

    // wrap in function since async.forEach doesn't take enough parameters
    // and we need to pass in the progress function.
    function create(item, callback)
    {
        return createVolume(item, options, progress, callback);
    }

    // create all the volumes we found that we need.
    async.forEach(createme, create, function (err) {
        if (err) {
            trace({'createVolumes:result': 'error',
                'createVolume:error': err});
            log('createVolumes(): Unknown error:', err);
            callback(err);
        } else {
            trace({'createVolumes:result': 'success'});
            callback();
        }
    });
}

// Send the poweroff command to the VM
//
// NOTE: VMs can ignore this command, so we support a timer which kills the VM
// when it expires (using killVM)
function haltVM(payload, options, callback)
{
    var uuid = payload.uuid;
    var timeout = options.timeout;
    var trace = options.trace;

    // some actions are not supported while we're 'halting'
    VMS[uuid].state = 'halting';
    VMS[uuid].qmp.command('system_powerdown', null, function (err, result) {
        trace({'haltVM:system_powerdown': 'sent'});
        if (err) {
            trace({'haltVM:system_powerdown': 'failed',
                'haltVM:system_powerdown:error': err});
            return callback(err);
        }
        trace({'haltVM:system_powerdown': 'sent'});

        // if timeout is non-zero, send kill when it expires.
        if (timeout > 0) {
            VMS[uuid].shutdown_timer = setTimeout(function () {
                killVM(payload, options, function (e, res) {
                    // we set err and res here since they're also available in
                    // the on_shutdown function we pass below.
                    err = e;
                    result = res;
                    log('Killed after shutdown timeout ... Result:[',
                        result, '] Error:[', err, ']');
                });
                trace({'haltVM:timed_out:killVM': 'sent'});
            }, timeout);
        } else {
            // XXX: should we just require a non-zero timeout?
            log('WARNING: no timeout value set for halt, may hang forever!');
        }
        VMS[uuid].on_shutdown.push(function () {
            log('POWERDOWN RESULT:[', result, '] ERROR:[', err, ']');
            trace({'haltVM:system_powerdown': 'done'});
            callback(err, result);
        });
    });
}

// XXX createVM should just call this when it's done creating?
function initVM(payload, options, callback)
{
    var trace = options.trace;

    if (!payload.hasOwnProperty('uuid')) {
        return callback('Payload missing "uuid" field');
    }

    if (VMS.hasOwnProperty(payload.uuid)) {
        return callback('VM with UUID ' + payload.uuid + ' is already loaded.');
    }

    loadVM(payload.uuid, function (err, vm) {
        var passthrough_payload = {};
        vm = vm.data;

        if (err) {
            trace({'initVM:loadVM': 'failed'});
            return cb(err);
        }
        trace({'initVM:loadVM': 'done'});

        if (vm.autoboot) {
            VMS[vm.uuid].action = 'boot';
            passthrough_payload.uuid = vm.uuid;
            if (payload.hasOwnProperty('boot')) {
                // boot order
                passthrough_payload.boot = payload.boot;
            }
            bootVM(passthrough_payload, options, callback);
            trace({'initVM:bootVM': 'sent'});
        } else {
            trace({'initVM:bootVM': 'skipped'});
            callback();
        }
    });
}

// just output the data for the VM
function dumpVM(payload, options, callback)
{
    if (!payload.hasOwnProperty('uuid')) {
        return callback('Payload missing "uuid" field');
    }

    if (!VMS.hasOwnProperty(payload.uuid)) {
        return callback('Cannot find VM with UUID ' + payload.uuid);
    }

    if (VMS[payload.uuid].hasOwnProperty('data')) {
        callback(null, VMS[payload.uuid].data);
    } else {
        callback('Cannot find data for VM with UUID ' + payload.uuid);
    }
}

// send hard-reset to the VM.  This is equivalent to the reset switch on a
// physical server.
function resetVM(payload, options, callback)
{
    var trace = options.trace;

    if (!payload.hasOwnProperty('uuid')) {
        return callback('Payload missing "uuid" field');
    }

    if (!VMS.hasOwnProperty(payload.uuid)) {
        return callback('Cannot find VM with UUID ' + payload.uuid);
    }

    VMS[payload.uuid].qmp.command('system_reset', null, function (err, result) {
        log('reset RESULT[', result, '] ERROR:[', err, ']');
        if (err) {
            trace({'system_reset': 'error',
                'system_reset:error': err});
        } else {
            trace({'system_reset': 'sent'});
        }
        callback(err, result);
    });
}

function nmiVM(payload, options, callback)
{
    var trace = options.trace;

    if (!payload.hasOwnProperty('uuid')) {
        return callback('Payload missing "uuid" field');
    }

    if (!VMS.hasOwnProperty(payload.uuid)) {
        return callback('Cannot find VM with UUID ' + payload.uuid);
    }

    VMS[payload.uuid].qmp.command('human-monitor-command',
        {'command-line': "nmi 0"}, function (err, result) {

        log('reset RESULT[', result, '] ERROR:[', err, ']');
        if (err) {
            trace({'nmiVM': 'error',
                'nmiVM:error': err});
        } else {
            trace({'nmiVM': 'sent'});
        }
        callback(err, result);
    });
}

function nicZonecfg(nic, idx, callback)
{
    var zonecfg = '';

    // TODO: check that we've got everything or return callback(error)

    zonecfg = zonecfg +
        'add net\n' +
        'set physical=net' + idx + '\n' +
        'set global-nic=' + nic.nic_tag + '\n' +
        'set mac-addr=' + nic.mac + '\n' +
        'add property (name=index, value="' + idx + '")\n' +
        'add property (name=netmask, value="' + nic.netmask + '")\n' +
        'add property (name=model, value="' + nic.model + '")\n' +
        'add property (name=ip, value="' + nic.ip + '")\n' +
        'add property (name=gateway, value="' + nic.gateway + '")\n';

    if (nic.hasOwnProperty('vlan') && (nic.vlan !== "0")) {
        zonecfg = zonecfg + 'set vlan-id=' + nic.vlan + '\n';
    }

    zonecfg = zonecfg + 'end\n';

    if (callback) {
        return callback(null, zonecfg);
    }

    return zonecfg;
}

// Adds a nic to the VM
function addNicToVM(payload, options, callback)
{
    var trace = options.trace;
    var uuid = payload.uuid;
    var idx = 0, n, n_idx, nic;
    var nics = VMS[uuid].data.nics;

    // No need to duplicate this in all of the nics
    delete(payload.uuid);

    // find next idx value
    for (n in nics) {
        if (nics.hasOwnProperty(n)) {
            n_idx = parseInt(nics[n].index, 10);
            if (n_idx >= idx) {
                idx = n_idx + 1;
            }
        }
    }

    nic = payload;

    nicZonecfg(nic, idx, function (err, zonecfg) {
        if (err) {
            trace({'addNicToVM:nicZonecfg': 'failed'});
            return callback(err);
        }

        if (DEBUG) {
            log('addNicToVM(', uuid, '): zonecfg:', zonecfg);
        }

        zoneCfg(uuid, zonecfg, function (err, stdout, stderr) {
            if (err) {
                trace({'addNicToVM:zoneCfg': 'failed'});
                log('error running zoneCfg:', err, stdout, stderr);
                callback(err);
            }

            loadVM(uuid, function (err, result) {
                if (err) {
                    trace({'addNicToVM:loadVM': 'failed'});
                    return callback(err);
                }
                trace({'addNicToVM:loadVM': 'done'});
                return callback();
            });
        });
    });
}

// Removes a nic from the VM
function removeNicFromVM(payload, options, callback)
{
    var trace = options.trace;
    var uuid = payload.uuid;
    var zonecfg;

    if (!payload.hasOwnProperty('mac')) {
        return callback('Payload missing "mac" field');
    }
    var mac = payload.mac;

    zonecfg = 'remove net mac-addr="' + mac + '";\n';

    if (DEBUG) {
        log('removeNicFromVM(', uuid, '): zonecfg:', zonecfg);
    }

    zoneCfg(uuid, zonecfg, function (err, stdout, stderr) {
        if (err) {
            trace({'removeNicFromVM:zoneCfg': 'failed'});
            log('error running zoneCfg:', zonecfg, err, stdout, stderr);
            callback(err);
        }
        loadVM(uuid, function (err, result) {
            if (err) {
                trace({'removeNicFromVM:loadVM': 'failed'});
                return callback(err);
            }
            trace({'removeNicFromVM:loadVM': 'done'});
            return callback();
        });
    });
}

// sends several query-* commands to QMP to get details for a VM
function getVMInfo(payload, options, responder)
{
    var res = {};
    var uuid = payload.uuid;
    var types = payload.types;
    var qmp = VMS[uuid].qmp;
    var emitter = VMS[uuid].emitter;
    var commands = [
        'query-version',
        'query-chardev',
        'query-block',
        'query-blockstats',
        'query-cpus',
        'query-pci',
        'query-kvm',
    ];

    // if VM is shutdown or crashes while we're running info, we want the info
    // command to fail cleanly. So we add a handler for the qmp_close event, and
    // remove it when we do a callback.

    function close_handler() {
        return responder('VM shutdown while running info');
    }

    function callback() {
        emitter.removeListener('qmp_close', close_handler);
        return responder.apply(this, arguments);
    }

    emitter.once('qmp_close', close_handler);

    if (!types) {
        types = ["all"];
    }

    if ((types.indexOf('all') !== -1) || (types.indexOf('vnc') !== -1)) {
        res.vnc = {};
        if (VMS[uuid].vnc && VMS[uuid].vnc.port) {
            res.vnc.display = VMS[uuid].vnc.display;
            res.vnc.port = VMS[uuid].vnc.port;
            res.vnc.host = VMS[uuid].vnc.host;
        }
    }

    if (!payload.hasOwnProperty('uuid')) {
        return callback('Payload missing "uuid" field');
    }

    if (!VMS.hasOwnProperty(payload.uuid)) {
        return callback('Cannot find VM with UUID ' + payload.uuid);
    }

    // run each command in commands
    async.map(commands,
        function (command, cb)
        {
            var base = command.replace(/^query-/, '');

            if ((types.indexOf('all') !== -1) || (types.indexOf(base) !== -1)) {
                VMS[uuid].qmp.command(command, null, function (err, result) {
                    cb(null, [base, result['return']]);
                });
            } else {
                cb(null, null);
            }
        },
        function (err, results)
        {
            var i;
            if (err) {
                log('getVMInfo(): Unknown Error:', err);
                callback(err);
            } else {
                // key is in results[i][0], value in results[i][1]
                for (i = 0; i < results.length; i++) {
                    if (results[i]) {
                        res[results[i][0]] = results[i][1];
                    }
                }
                callback(null, res);
            }
        }
    );
}

// search through all the VMs for a VM with a given MAC address and return the
// NIC information for that NIC.
function netInfoByMac(payload)
{
    var uuid, nics, nic, idx;
    var mac = payload.mac;
    if (!mac) {
        return ('No MAC given!');
    }

    // XXX TODO check parameters

    for (uuid in VMS) {
        if (VMS.hasOwnProperty(uuid)) {
            nics = VMS[uuid].data.nics;
            for (idx in nics) {
                if (nics.hasOwnProperty(idx)) {
                    nic = nics[idx];
                    if (nic.hasOwnProperty('mac') && nic.mac === mac) {
                        // Make a copy of the nic so as not to disturb the
                        // original
                        var toReturn = {};
                        for (var p in nic) {
                            if (nic.hasOwnProperty(p)) {
                                toReturn[p] = nic[p];
                            }
                        }
                        toReturn.vm_uuid = uuid;
                        toReturn.hostname = VMS[uuid].data.hostname;
                        if (!toReturn.hostname) {
                            toReturn.hostname = uuid;
                        }
                        return ([null, toReturn]);
                    }
                }
            }
        }
    }

    return ('No net info for mac "' + mac + '"');
}

// search through all the VMs for a VM with a given MAC address and return the
// NIC information for that NIC.
function macInfo(payload, options, callback)
{
    var res = netInfoByMac(payload);
    callback.apply(this, res);
}

// build the qemu cmdline and start up a VM
function bootVM(payload, options, callback)
{
    var cmd;
    var cmdargs = [];
    var diskargs = '';
    var uuid = payload.uuid;
    var trace = options.trace;

    if (DEBUG) {
        log('bootVM(', uuid, ')');
    }

    // XXX TODO: validate payload is ok to boot

    loadVM(uuid, function (err, vm) {
        var disk, disk_idx = 0;
        var nic, nic_idx = 0;
        var proc;
        var working_dir;
        var script;

        if (err) {
            callback(err);
        }

        vm = vm.data;
        working_dir = '/zones/' + vm.uuid + '/root';

        cmdargs.push('-m', vm.ram);
        cmdargs.push('-uuid', vm.uuid);

        if (vm.hasOwnProperty('cpu_type')) {
            cmdargs.push('-cpu', vm.cpu_type);
        } else {
            cmdargs.push('-cpu', 'qemu64');
        }

        if (vm.vcpus > 1) {
            cmdargs.push('-smp', vm.vcpus);
        }

        for (disk in vm.disks) {
            if (vm.disks.hasOwnProperty(disk)) {
                disk = vm.disks[disk];
                if (!disk.media) {
                    disk.media = "disk";
                }
                diskargs = 'file=' + disk.path + ',if=' + disk.model +
                    ',index=' + disk_idx + ',media=' + disk.media;
                if (disk.boot) {
                    diskargs = diskargs + ',boot=on';
                }
                cmdargs.push('-drive', diskargs);
                disk_idx++;
            }
        }

        // payload can include additional disks that we want to include only on
        // this one boot.  It can also contain a boot parameter to control boot
        // device.  See qemu http://qemu.weilnetz.de/qemu-doc.html for info on
        // -boot options.
        if (payload.hasOwnProperty('disks')) {
            for (disk in payload.disks) {
                if (payload.disks.hasOwnProperty(disk)) {

                    // TODO: make sure disk exists in zonecfg so that it's
                    // available in the zone.

                    disk = payload.disks[disk];
                    if (!disk.media) {
                        disk.media = "disk";
                    }
                    diskargs = 'file=' + disk.path + ',if=' + disk.model +
                        ',index=' + disk_idx + ',media=' + disk.media;
                    if (disk.boot) {
                        diskargs = diskargs + ',boot=on';
                    }
                    cmdargs.push('-drive', diskargs);
                    disk_idx++;
                }
            }
        }

        // helpful values:
        // order=nc (network boot, then fallback to disk)
        // once=d (boot on disk once and the fallback to default)
        // order=c,once=d (boot on CDROM this time, but not subsequent boots)
        if (payload.hasOwnProperty('boot')) {
            cmdargs.push('-boot', payload.boot);
        } else if (vm.hasOwnProperty('boot')) {
            cmdargs.push('-boot', vm.boot);
        } else {
            // order=cd means try harddisk first (c) and cdrom if that fails (d)
            cmdargs.push('-boot', 'order=cd');
        }

        for (nic in vm.nics) {
            if (vm.nics.hasOwnProperty(nic)) {
                nic = vm.nics[nic];
                log('nic:', nic);
                cmdargs.push('-net',
                    'nic,macaddr=' + nic.mac +
                    ',vlan=' + nic_idx +
                    ',name=net' + nic_idx +
                    ',model=' + nic.model);
                cmdargs.push('-net', 'vnic,name=net' + nic_idx +
                    ',vlan=' + nic_idx +
                    ',ifname=net' + nic_idx +
                    ',ip=' + nic.ip +
                    ',netmask=' + nic.netmask +
                    ',gateway_ip=' + nic.gateway);
                nic_idx++;
            }
        }

        cmdargs.push('-pidfile', '/tmp/vm.pid');
        cmdargs.push('-chardev',
            'socket,id=qmp,path=/tmp/vm.qmp,server,nowait');
        cmdargs.push('-qmp', 'chardev:qmp');

        // serial0 is for serial console
        cmdargs.push('-chardev',
            'socket,id=serial0,path=/tmp/vm.console,server,nowait');
        cmdargs.push('-serial', 'chardev:serial0');

        // serial1 is used for metadata API
        cmdargs.push('-chardev',
            'socket,id=serial1,path=/tmp/vm.ttyb,server,nowait');
        cmdargs.push('-serial', 'chardev:serial1');

        cmdargs.push('-vnc', 'unix:/tmp/vm.vnc');
        cmdargs.push('-parallel', 'none');
        cmdargs.push('-usb');
        cmdargs.push('-usbdevice', 'tablet');
        cmdargs.push('-k', 'en-us');
        cmdargs.push('-vga', 'cirrus');
        cmdargs.push('-smbios', 'type=1,manufacturer=Joyent,' +
            'product=SmartDC HVM,version=6.1,' +
            'serial=' + vm.uuid + ',uuid=' + vm.uuid + ',' +
            'sku=001,family=Virtual Machine');

        // This actually creates the qemu process
        script = "#!/usr/bin/bash\n\n" +
            "exec >/tmp/vm.log 2>&1\n\n" +
            "set -o xtrace\n\n" +
            'exec /smartdc/bin/qemu-system-x86_64 "' + cmdargs.join('" "') +
                '"\n\n' +
            "exit 1\n";

        // TODO: get real zone root (might not be in /zones!)

        fs.writeFileSync('/zones/' + vm.uuid + '/root/startvm', script);
        fs.chmodSync('/zones/' + vm.uuid + '/root/startvm', "0755");

        cmd = '/usr/sbin/zoneadm';
        cmdargs = ['-z', vm.uuid, 'boot'];

        proc = spawn(cmd, cmdargs,
            { cwd: working_dir, customFds: [-1, -1, -1], setsid: true });

        trace({'bootVM:qemu:cmd': cmd, 'bootVM:qemu:cmd_args': cmdargs});

        // log any output from qemu (will include network script output too)
        proc.stdout.on('data', function (data) {
            data = data.toString().replace(/\s+$/g, '');
            log('qemu[', proc.pid, '] stdout:', data);
        });
        proc.stderr.on('data', function (data) {
            data = data.toString().replace(/\s+$/g, '');
            log('qemu[', proc.pid, '] stderr:', data);
        });

        trace({'bootVM:qemu:pid': proc.pid});
        log('cmd[' + proc.pid + ']:', cmd, cmdargs.join(' '));
        callback(null, proc.pid);
    });
}

// return a list of VM objects we're currently aware of along with their state
function listVMs(properties, options, callback)
{
    var results = [];
    var vm;
    var disk, zvol;

    for (vm in VMS) {
        if (VMS.hasOwnProperty(vm)) {
            results.push({'uuid': vm, 'state': VMS[vm].state});
        }
    }

    callback(null, results);
}

function createZone(properties, callback)
{
    var uuid = properties.uuid;
    var zonecfg;
    var disk, disk_idx, zvol;
    var nic, nic_idx, n, nic_zcfg;
    var cpu_shares;
    var max_lwps;
    var max_ram;
    var zfs_io_priority;

    // TODO: this is just a temporary hack, figure out the correct memory caps
    max_ram = properties.ram + 1024;

    // TODO: use zone root instead of /zones

    zonecfg = 'create -b\n' +
        'set zonepath=/zones/' + uuid + '\n' +
        'set brand=kvm\n' +
        'set autoboot=false\n' +
        'set ip-type=exclusive\n' +
        'set cpu-shares=' + properties.cpu_shares.toString() + '\n' +
        'set zfs-io-priority=' + properties.zfs_io_priority.toString() + '\n' +
        'set max-lwps=' + properties.max_lwps.toString() + '\n' +
        'add capped-memory; set physical=' +  max_ram.toString() + 'm; end\n' +
        'add attr; set name="owner-uuid"; set type=string; set value="' +
            properties.customer_uuid + '"; end\n' +
        'add attr; set name="hostname"; set type=string; set value="' +
            properties.hostname + '"; end\n' +
        'add attr; set name="vm-autoboot"; set type=string; set value="' +
            properties.autoboot + '"; end\n' +
        'add attr; set name="ram"; set type=string; set value="' +
            properties.ram.toString() + '"; end\n' +
        'add attr; set name="vcpus"; set type=string; set value="' +
            properties.vcpus.toString() + '"; end\n';

    if (properties.hasOwnProperty('boot')) {
        zonecfg = zonecfg + 'add attr; set name="boot"; set type=string;' +
            'set value="' + properties.boot + '"; end\n';
    }

    if (properties.hasOwnProperty('cpu_type')) {
        zonecfg = zonecfg + 'add attr; set name="cpu-type"; set type=string;' +
            'set value="' + properties.cpu_type + '"; end\n';
    }

    nic_idx = 0;
    for (nic in properties.nics) {
        if (properties.nics.hasOwnProperty(nic)) {
            n = properties.nics[nic];
            nic_zcfg = nicZonecfg(n, nic_idx);
            if (nic_zcfg) {
                zonecfg = zonecfg + nic_zcfg;
                nic_idx ++;
            } else {
                // unable to build zonecfg entry for this NIC
                return callback('unable to create zonecfg entry for NIC with' +
                    ' data:', n);
            }
        }
    }

    disk_idx = 0;
    for (disk in properties.disks) {
        if (properties.disks.hasOwnProperty(disk)) {
            zvol = properties.disks[disk];
            zonecfg = zonecfg + 'add device\n' +
                'set match=' + zvol.path + '\n' +
                'add property (name=index, value="' + disk_idx + '")\n' +
                'add property (name=boot, value="' +
                    (zvol.boot ? 'true' : 'false') + '")\n' +
                'add property (name=model, value="' + zvol.model + '")\n' +
                'end\n';

            disk_idx ++;
        }
    }

    // TODO: check that zone doesn't already exist

    zoneCfg(uuid, zonecfg, function (error, stdout, stderr) {
        execFile('zoneadm', ['-z', uuid, 'install', '-q', '10'],
            function (error, stdout, stderr) {
                if (error) {
                    // TODO log better
                    log('failure', error, stdout, stderr);
                    return callback(error);
                }

                return callback(null, [stdout, stderr]);
            }
        );
    });
}

// put together all the bits required to actually create the VM
function createVM(properties, options, callback)
{
    var progress = options.progress;
    var trace = options.trace;

    if (DEBUG) {
        log('createVM()');
    }

    function trace_cb(tracemsg, func) {
        return function (err, results) {
            trace(tracemsg);
            func(err, results);
        };
    }

    async.series([
        function (cb)
        {
            progress(1, 'checking payload');
            checkProperties(properties,
                trace_cb({'createVM:checkProperties': 'done'}, cb));
        },
        function (cb)
        {
            progress(2, 'checking required datasets');
            checkDatasets(properties, quantize(3, 28, progress),
                trace_cb({'createVM:checkDatasets': 'done'}, cb));
        },
        function (cb)
        {
            progress(29, 'creating volumes');
            createVolumes(properties, options, quantize(30, 93, progress),
                trace_cb({'createVM:createVolumes': 'done'}, cb));
        },
        function (cb)
        {
            progress(94, 'ensuring we have a UUID');
            if (properties.uuid) {
                trace({'createVM:uuid': 'supplied'});
                cb();
            } else {
                createUUID(function (err, uuid) {
                    if (err) {
                        return cb(err);
                    }
                    properties.uuid = uuid;
                    trace({'createVM:createUUID:uuid': uuid});
                    cb();
                });
            }
        },
        function (cb)
        {
            progress(95, 'setting defaults');
            setDefaultProperties(properties,
                trace_cb({'createVM:setDefaultProperties': 'done'}, cb));
        },
        function (cb)
        {
            progress(96, 'creating zone');
            createZone(properties, function (err, result) {
                if (err) {
                    trace({'createVM:createZone': 'failed'});
                    return cb(err);
                }
                trace({'createVM:createZone': 'done'});
                cb();
            });
        },
        function (cb)
        {
            progress(97, 'saving vm data');
            saveMetadata(properties, function (err, result) {
                if (err) {
                    trace({'createVM:saveMetadata': 'failed'});
                    return cb(err);
                }
                trace({'createVM:saveMetadata': 'done'});
                loadVM(properties.uuid, function (err, result) {
                    if (err) {
                        trace({'createVM:loadVM': 'failed'});
                        return cb(err);
                    }
                    trace({'createVM:save': 'done'});
                    cb();
                });
            });
        },
        function (cb)
        {
            var passthrough_payload = {};

            // if the VM has the autoboot option set, boot it now too.
            if (properties.autoboot) {
                progress(98, 'booting VM');
                VMS[properties.uuid].action = 'boot';
                passthrough_payload.uuid = properties.uuid;
                if (properties.hasOwnProperty('boot')) {
                    // boot order
                    passthrough_payload.boot = properties.boot;
                }
                bootVM(passthrough_payload, options, cb);
                trace({'createVM:bootVM': 'sent'});
            } else {
                trace({'createVM:bootVM': 'skipped'});
                cb();
            }
        }
    ],
    function (err, results)
    {
        if (err) {
            trace({'createVM': 'failed', 'createVM:error': err});
            log('createVM(): error:', err);
            callback(err);
        } else {
            trace({'createVM': 'success'});
            log('createVM(): results:', results);
            callback(null, results);
        }
    });
}

// loads the system configuration
function loadConfig(callback)
{
    if (DEBUG) {
        log('loadConfig()');
    }

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
                    log('found admin_ip:', SDC.sysinfo.admin_ip);
                }
            }
        }
        sdcConfig(function (error, c) {
            SDC.config = c;
            if (error) {
                callback(error);
            } else {
                callback();
            }
        });
    });
}

// table associating 'action': keywords with functions and options
var VM_ACTIONS = {
    'create':  { 'func': createVM,  'nowait': true },
    'destroy': { 'func': destroyVM, 'nowait': true, 'needs_uuid': true },
    'list':    { 'func': listVMs,   'nowait': true },
    'dump':    { 'func': dumpVM,    'nowait': true, 'needs_uuid': true },
    'init':    { 'func': initVM,    'nowait': true},
    'events':  { 'func': watchEvents, 'nowait': true },
    'mac':     { 'func': macInfo,   'nowait': true },
    'boot':    { 'func': bootVM,   'okstates': ['off'],     'needs_uuid': true},
    'halt':    { 'func': haltVM,   'okstates': ['running'], 'needs_uuid': true},
    'reset':   { 'func': resetVM,  'okstates': ['running'], 'needs_uuid': true},
    'nmi':     { 'func': nmiVM,    'okstates': ['running'], 'needs_uuid': true},
    'add_nic': { 'func': addNicToVM, 'okstates': ['off'],   'needs_uuid': true},
    'remove_nic': {
        'func': removeNicFromVM,
        'okstates': ['off'],
        'needs_uuid': true
    },
    'kill':    {
        'func': killVM,
        'okstates': ['running', 'halting'],
        'needs_uuid': true
    },
    'info':    {
        'func': getVMInfo,
        'okstates': ['running', 'halting'],
        'nowait': true,
        'needs_uuid': true
    }
};

// Try to do the action right now.  If we can't do now, fail.  This allows the
// client to have their own retry and throttling code.
function doNow(uuid, action, callback)
{
    // if 'okstates' is defined, those in that list are the only states from
    // which this action can be performed.
    if ((VM_ACTIONS[action].hasOwnProperty('okstates')) &&
        (VM_ACTIONS[action].okstates.indexOf(VMS[uuid].state)) === -1) {

        return callback('Cannot perform ' + action + ' for ' + uuid +
            ' while it is in state: ' + VMS[uuid].state);
    }

    // some actions we never need to block
    if (VM_ACTIONS[action].nowait) {
        return callback();
    }

    if (! VMS.hasOwnProperty(uuid)) {
        return callback('Cannot perform ' + action +
            ' for non-existent VM ' + uuid);
    }

    // VM's not doing something else, go ahead.
    if (VMS[uuid].action) {
        // Special case: can kill durring halt even though normally this would
        // wait until *after* the halt was complete.
        if (VMS[uuid].action === 'halt' &&
            (action === 'kill' || action === 'destroy')) {

            return callback();
        }

        return callback('Not running ' + action +
            " because we're still running " + VMS[uuid].action);
    }

    return callback();
}

// every message from a vmadm client goes through this function.  This
// dispatches the messages to the correct handler.
function handleMessage(stream_fd, obj, responder, trace)
{
    var result = {};
    var options = {};
    var cur_action;
    var uuid;

    if (! obj.hasOwnProperty('payload')) {
        obj.payload = {};
    }
    if (obj.payload.hasOwnProperty('uuid')) {
        uuid = obj.payload.uuid;
    }

    log('handleMessage(', JSON.stringify(obj), ')');

    // convenience so we can send things like events
    function update(data)
    {
        responder(null, null, data);
    }

    // convenience so we can update progress from actions.
    function progress(percent, message)
    {
        responder(null, null, {"percent": percent, "message": message});
    }

    // Don't know how to do this sort of action
    if (! VM_ACTIONS.hasOwnProperty(obj.action)) {
        return responder('Unknown Command');
    }

    // Ensure those commands that need a UUID have a valid UUID
    if (VM_ACTIONS[obj.action].needs_uuid && !VMS.hasOwnProperty(uuid)) {
        return responder('Invalid UUID');
    }

    switch (obj.action) {
    case 'create':
        options.progress = progress;
        break;
    case 'halt':
        options.timeout = obj.payload.timeout || 180000;
        break;
    }
    options.trace = trace;
    options.update = update;
    options.stream_fd = stream_fd;

    // If we can do it, do it!
    doNow(uuid, obj.action, function (err) {
        if (err) {
            return responder(err);
        }

        if (VMS.hasOwnProperty(uuid)) {
            VMS[uuid].action = obj.action;
        }
        VM_ACTIONS[obj.action].func(obj.payload, options, responder);
    });
}

// Start the unix socket listener and pass messages inbound to the handleMessage
// dispatcher.
function startDaemon()
{
    if (DEBUG) {
        log('startDaemon()');
    }

    net.createServer(function (stream) {
        var chunks, buffer = '';
        var cleanup_fd;
        stream.setEncoding('utf8');
        stream.on('connect', function () {
            if (DEBUG) {
                log('connection on fd', stream.fd);
            }
            cleanup_fd = stream.fd;
        });
        stream.on('data', function (chunk) {
            var request;
            var string_response;
            var trace_messages = [];

            function trace(msg)
            {
                if (!msg.hasOwnProperty('timestamp')) {
                    msg.timestamp = new Date().toISOString();
                }
                trace_messages.push(msg);
            }

            function responder(err, results, update)
            {
                var res = {};

                // if the request included an id, use the same id in responses
                if (request.hasOwnProperty('id')) {
                    res.id = request.id;
                }

                // the result will have a .type of one of the following:
                //
                //   {'failure','update','success'}
                //
                // it will also have a 'data' member with more details.
                if (err) {
                    res.type = 'failure';
                    res.data = err;
                    res.trace = trace_messages;

                    // done with this job now.
                    if (request.hasOwnProperty('payload') &&
                        request.payload.hasOwnProperty('uuid') &&
                        VMS.hasOwnProperty(request.payload.uuid)) {

                        VMS[request.payload.uuid].action = null;
                    }
                } else {
                    if (update) {
                        res.type = 'update';
                        res.data = update;
                    } else {
                        res.type = 'success';
                        if (results) {
                            res.data = results;
                            res.trace = trace_messages;

                            // done with this job now.
                            if (request.hasOwnProperty('payload') &&
                                request.payload.hasOwnProperty('uuid') &&
                                VMS.hasOwnProperty(request.payload.uuid)) {

                                VMS[request.payload.uuid].action = null;
                            }
                        }
                    }
                }

                // Send the string form of the JSON to the client
                if (stream.writable) {
                    string_response = JSON.stringify(res);
                    log('response:', string_response);
                    stream.write(string_response + '\n');
                }
            }

            // we need to handle messages that may be broken up into multiple
            // buffers, basically just keep reading and split results on '\n\n'
            buffer += chunk.toString();
            chunks = buffer.split('\n\n');
            while (chunks.length > 1) {
                try {
                    request = JSON.parse(chunks.shift());
                } catch (err) {
                    log('FAIL: Unable to parse input:', err);
                    if (stream.writable) {
                        string_response = JSON.stringify({'type': 'failure',
                            'data': 'Invalid Input'});
                        log('SENDING:', string_response);
                        stream.write(string_response + '\n');
                    }
                    continue;
                }
                handleMessage(stream.fd, request, responder, trace);
            }
            buffer = chunks.pop();
        });
        stream.on('end', function () {
            if (cleanup_fd) {
                unregisterWatcher(cleanup_fd);
                if (DEBUG) {
                    log('disconnection on fd', cleanup_fd);
                }
            }
            stream.end();
        });
    }).listen(VMADMD_SOCK);
}

// boot a VM if the autoboot flag is enabled
function autobootVM(vm)
{
    var trace;

    if (vm.autoboot) {
        log('autoboot as requested for:', vm.uuid);

        trace = function (msg)
        {
            log(msg);
        };

        bootVM({"uuid": vm.uuid}, {"trace": trace}, function (e, res) {
            // XXX: this ignores errors!
            log('Autobooted ', vm.uuid, ': [', res, ']/[', e, ']');
        });
    } else {
        log('Skipping autoboot as requested for:', vm.uuid);
    }
}

//
// Run on system startup to boot all the VMs that are marked for autoboot
// it determines that the system was just booted based on the file
// /tmp/.autoboot_vms which is created the first time autoboot runs.  Since
// /tmp is tmpfs, it will be gone on next boot.
//
function autobootVMs()
{
    path.exists('/tmp/.autoboot_vms', function (exists) {
        var autobootLog;
        var uuid;

        if (!exists) {
            // boot all autoboot vms because this machine just booted, now
            // create file so on restart we know they system wasn't just booted.
            fs.writeFileSync('/tmp/.autoboot_vms', "booted");
            for (uuid in VMS) {
                if (VMS.hasOwnProperty(uuid)) {
                    autobootVM(VMS[uuid].data);
                }
            }
        }
    });
}

// kicks everything off
function main()
{
    if (DEBUG) {
        log('DEBUG is enabled');
    }

    process.on('SIGUSR1', function () {
        if (DEBUG) {
            log('got USR1, setting DEBUG *off*');
            DEBUG = false;
        } else {
            log('got USR1, setting DEBUG *on*');
            DEBUG = true;
        }
    });

    loadConfig(function (err, callback) {
        if (err) {
            log('Unable to load config:', err);
            process.exit(2);
        }

        loadVMs(function (err) {
            if (err) {
                log('FATAL: unable to load VMs:', err);
                process.exit(3);
            }
            autobootVMs();
            onlyMe(VMADMD_SOCK, function (err) {
                if (err) {
                    log('FATAL: unable to become exclusive:', err);
                    process.exit(4);
                }
                startDaemon();
            });
        });
    });
}

main();
