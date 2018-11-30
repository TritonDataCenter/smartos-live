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
 *
 * # OVERVIEW
 *
 * This module includes the logic that makes up the metadata agent. The
 * /usr/vm/sbin/metadata script creates a new MetadataAgent object 'agent' and
 * then calls: 'agent.start()' to kick things off.
 *
 * This agent then:
 *
 *   - starts a VminfodWatcher that handles VM creation, VM deletion, and VM
 *     state changes.
 *
 * We attempt to create the appropriate socket for any VM that doesn't already
 * have one:
 *
 *  1. At agent startup
 *  2. When a zone state change event is seen (vminfod)
 *  3. Periodically (every PERIODIC_CONNECTION_RETRY, 1 minute)
 *
 * # CREATING SOCKETS
 *
 * If the VM is a KVM or bhyve VM, the qemu or bhyve process running in the zone
 * will be running with a "ttyb" virtual serial port for the KVM guest. From the
 * host we can connect to connect to /root/tmp/vm.ttyb in the zoneroot on which
 * Qemu or bhyve is listening for connections. We connect to this as a client
 * but run a metadata server on the resulting connection. Inside the guest the
 * mdata-client tools connect to the serial device and are then talking to our
 * metadata handler.
 *
 * For all OS VMs we create a unix domain socket in /var/zonecontrol/<zonename>
 * named metadata.sock. We mount the zonecontrol directory into the zone
 * (read-only) via the brand.
 *
 * In non-LX zones, the zonecontrol is mounted such that the socket is at:
 *
 *   <zoneroot>/.zonecontrol/metadata.sock
 *
 * and for LX zones:
 *
 *   <zoneroot>/native/.zonecontrol/metadata.sock
 *
 * With a socket created and the server listening, the client in the zone can
 * make queries using the metadata protocol described at:
 *
 *    https://eng.joyent.com/mdata/protocol.html
 *
 *
 * # CLEANUP AND ERRORS
 *
 * If a recoverable error occurs during operation or during server creation and
 * the zone still exists, the agent should remove the connection from the
 * zoneConnections object such that on the next periodic check where we see the
 * VM running, the socket will be (re)created.
 *
 * The rules for zoneConnections are:
 *
 *   * if there's any truthy value for a zone's zoneConnections[uuid], we'll not
 *     try to create a new socket.
 *
 *   * if there's no zoneConnections[uuid] when we're doing our periodic check,
 *     we should try to create a socket.
 *
 *   * whenever we fail to create a socket or there's an error on a socket,
 *     we should delete the zoneConnections[uuid] entry so a retry will create
 *     one.
 *
 *
 * When a zone is deleted, (no longer shows up in the list we're loading every 5
 * minutes, or we see a message from vminfod) the global state objects for the
 * VM are cleared.
 *
 *
 * # DEBUGGING
 *
 * For debugging, there are several useful properties attached to the
 * MetadataAgent object. These can be pulled out of metadata agent cores to
 * provide visibility into the state. You can see these properties with:
 *
 * ::findjsobjects -p zonesDebug | ::jsprint -d1
 *
 * using mdb_v8.
 *
 *
 * # SPECIAL "GET" BEHAVIORS
 *
 * For some properties:
 *
 *   sdc:nics
 *   sdc:resolvers
 *   sdc:tmpfs
 *   sdc:routes
 *
 * we do an updateZone() to update our cached zone object for every lookup. For
 * sdc:operator-script, we always load the config/metadata.json file for the
 * zone. For all other sdc:* prefixed GET requests, we update the set of tags
 * directly from config/tags.json to ensure these are up-to-date.
 *
 * For all other requests (without the sdc: prefix) we will load the latest
 * config/metadata.json for the zone before processing. Then:
 *
 * Requests without an SDC prefix can still be prefixed with a special
 * "internal_namespace" which is set via the internal_metadata_namespaces
 * property on the VM. When this is set any request that includes a namespace
 * prefix will be served from internal_metadata instead of customer_metadata.
 * This is used for docker for example to serve special docker:* variables.
 *
 * Requests that have no namespace but end with the string "_pw" are also served
 * from internal_metadata for historical reasons. (See OS-2213 and related
 * tickets)
 *
 * All other requests are served directly from customer_metadata. So a request
 * for "GET user-script" means that we want to return the value from the vmobj's
 * customer_metadata['user-script'].
 *
 */

var assert = require('/usr/node/node_modules/assert-plus');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var common = require('./common');
var crc32 = require('./crc32');
var fs = require('fs');
var hrtime = require('/usr/vm/node_modules/hrtime');
var macaddr = require('/usr/vm/node_modules/macaddr');
var net = require('net');
var path = require('path');
var VM = require('/usr/vm/node_modules/VM');
var VminfodWatcher
    = require('/usr/vm/node_modules/vminfod/client').VminfodWatcher;

var KVM_CONNECT_RETRY_INTERVAL = 100; // ms
var KVM_CONNECT_RETRY_LOG_FREQUENCY = 10; // log every X retries
var PERIODIC_CONNECTION_RETRY = 60 * 1000; // every minute

function noop() {}

function closeZoneConnection(zoneConn) {
    assert.object(zoneConn, 'zoneConn');

    // Ensure we don't have *both* .serverSocket and .conn but that we do have
    // at least one of the two.
    assert.ok(!(zoneConn.serverSocket && zoneConn.conn),
        'should not have both .conn and .serverSocket');
    assert.ok((zoneConn.serverSocket || zoneConn.conn),
        'should have either .serverSocket or .conn');

    // .serverSocket is a net.Server for non-KVM
    if (zoneConn.serverSocket) {
        zoneConn.serverSocket.close();
    }
    // .conn is a net.Socket client connection to a KVM/qemu device
    if (zoneConn.conn) {
        zoneConn.conn.destroy();
    }
}

/*
 * Call as:
 *
 *  t = newTimer();
 *  console.log('elapsed ms: ' + elapsedTimer(t));
 *
 */
function newTimer() {
    return process.hrtime();
}

function elapsedTimer(timer) {
    var end;

    assert.arrayOfNumber(timer);

    end = process.hrtime(timer);
    return (end[0] * 1000 + (end[1] / 1000000));
}


var MetadataAgent = module.exports = function (options) {
    this.log = options.log;
    this.zlog = {};
    this.zonesDebug = {};
    this.zoneConnections = {};
    this.zoneKvmReconnTimers = {};
};

/*
 * This function exists to add debug information to the zonesDebug object. That
 * information stays in memory for all known VMs so that it can be pulled from
 * core files. For example:
 *
 * > ::findjsobjects -p zonesDebug | ::jsprint -d4 zonesDebug
 * {
 *   "4149818f-44d1-4798-875c-ff37aec11042": {
 *       "last_zone_load": 1455735290175 (2016 Feb 17 18:54:50),
 *       "last_10_logs": [
 *           {
 *               "name": "metadata",
 *               "hostname": "headnode",
 *               "pid": 83175,
 *               "brand": "joyent-minimal",
 *               "zonename": "4149818f-44d1-4798-875c-ff37aec11042",
 *               "level": 30,
 *               "msg": "starting socket server",
 *               "time": 1455735290175 (2016 Feb 17 18:54:50),
 *               "v": 0,
 *           },
 *           ...
 *       ],
 *       "last_sock_create_attempt": 1455735290176 (2016 Feb 17 18:54:50),
 *       "last_sock_create_success": 1455735290804 (2016 Feb 17 18:54:50),
 *       "last_sock_listen_success": 1455735290806 (2016 Feb 17 18:54:50),
 *       ...
 *   },
 *   ...
 * }
 *
 */
MetadataAgent.prototype.addDebug = function addDebug(zonename, field, value) {
    assert.string(zonename, 'zonename');
    assert.string(field, 'field');

    var self = this;

    if (!self.zonesDebug.hasOwnProperty(zonename)) {
        self.zonesDebug[zonename] = {};
    }

    if (value === undefined) {
        self.zonesDebug[zonename][field] = new Date();
    } else {
        self.zonesDebug[zonename][field] = value;
    }
};

MetadataAgent.prototype.createZoneLog = function (type, zonename) {
    assert.string(type, 'type');
    assert.string(zonename, 'zonename');

    var self = this;
    var newRingbuffer = new bunyan.RingBuffer({limit: 10});

    self.zlog[zonename] = self.log.child({
        brand: type,
        streams: [ {level: 'trace', type: 'raw', stream: newRingbuffer} ],
        zonename: zonename});
    self.addDebug(zonename, 'last_10_logs', newRingbuffer.records);

    return (self.zlog[zonename]);
};

MetadataAgent.prototype.createServersOnExistingZones =
function createServersOnExistingZones(vms, callback) {

    assert.object(vms, 'vms');
    assert.func(callback, 'callback');

    var self = this;
    var created = 0;
    var keys = Object.keys(vms);
    var started_time = process.hrtime();

    self.log.debug('createServersOnExistingZones for %d zones', keys.length);

    async.forEach(keys, function (zonename, cb) {
        var vm = vms[zonename];
        if (!self.zlog[zonename]) {
            // create a logger specific to this VM
            self.createZoneLog(vm.brand, zonename);
        }

        if (self.zoneConnections[zonename]) {
            cb();
            return;
        }

        if (vm.brand === 'kvm' || vm.brand === 'bhyve') {
            // For KVM, the zone must be running otherwise Qemu will not
            // have created a socket.
            if (vm.zone_state !== 'running') {
                self.log.debug('skipping non-running vm %s, zone_state %s',
                    zonename, vm.zone_state);
                cb();
                return;
            }

            self.startKVMSocketServer(zonename, function (err) {
                if (!err) {
                    created++;
                }
                cb();
            });
        } else {
            self.startZoneSocketServer(zonename, function (err) {
                if (!err) {
                    created++;
                }
                cb();
            });
        }
    }, function (err) {
        var delta = process.hrtime(started_time);
        var prettyDelta = hrtime.prettyHrtime(delta);

        if (err) {
            self.log.warn(err, 'createServersOnExistingZones failure');
        }

        self.log.info('created zone metadata sockets on %d / %d zones took %s',
            created, keys.length, prettyDelta);
        callback(err);
    });
};

MetadataAgent.prototype.purgeZoneCache = function purgeZoneCache(zonename) {
    var self = this;

    assert.string(zonename, 'zonename');

    self.log.info(zonename + ' no longer exists, purging from cache(s) and '
        + 'stopping timeout');

    if (self.zonesDebug.hasOwnProperty(zonename)) {
        delete self.zonesDebug[zonename];
    }

    if (self.zlog.hasOwnProperty(zonename)) {
        delete self.zlog[zonename];
    }

    if (self.zoneConnections.hasOwnProperty(zonename)) {
        if (self.zoneConnections[zonename]) {
            // If deleting the instance before the metadata socket connected, we
            // must cancel reconnection attempts.
            self.stopKvmReconnTimer(zonename);
            // it's not undefined, so attempt to close it
            closeZoneConnection(self.zoneConnections[zonename]);
        }

        delete self.zoneConnections[zonename];
    }
};

MetadataAgent.prototype.stopKvmReconnTimer =
function stopKvmReconnTimer(zonename) {
    var self = this;

    self.log.info({zonename: zonename},
        'clearing connection retries for HVM instance.');

    if (self.zoneKvmReconnTimers.hasOwnProperty(zonename)) {
        clearTimeout(self.zoneKvmReconnTimers[zonename]);
        delete self.zoneKvmReconnTimers[zonename];
    }
};

MetadataAgent.prototype.handleZoneCreated =
function handleZoneCreated(vm) {
    var self = this;

    assert.object(vm, 'vm');
    assert.string(vm.zonename, 'vm.zonename');
    assert.string(vm.brand, 'vm.brand');

    if (!self.zlog[vm.zonename]) {
        // create a logger specific to this VM
        self.createZoneLog(vm.brand, vm.zonename);
    }

    if (vm.brand === 'kvm' || vm.brand === 'bhyve') {
        self.startKVMSocketServer(vm.zonename, noop);
    } else {
        self.startZoneSocketServer(vm.zonename, noop);
    }
};

MetadataAgent.prototype.start = function start() {
    var self = this;

    function _createServersOnExistingZonesInterval() {
        var vms = self.vminfod_watcher.vms();
        self.createServersOnExistingZones(vms, function (err) {
            /*
             * This runs periodicaly to assure that servers are always created
             * for zones.  With vminfod there is no chance that an event will be
             * missed, instead, this is run periodically to ensure that any
             * server that was closed while the VM was still running (an error)
             * is recreated (OS-7139).
             *
             * `err` is purposely ignored here.
             */
            setTimeout(_createServersOnExistingZonesInterval,
                PERIODIC_CONNECTION_RETRY);
        });
    }

    self.vminfod_watcher = new VminfodWatcher({
        log: self.log,
        name: 'Metadata Agent - VminfodWatcher'
    });

    self.vminfod_watcher.once('ready', function (ready_ev) {
        // List of VMs is ready, create the servers necessary for them
        _createServersOnExistingZonesInterval();
    });

    self.vminfod_watcher.on('create', function (ev) {
        // ignore zones we've already (still) got a connection for
        if (self.zoneConnections[ev.zonename]) {
            return;
        }

        self.log.debug({
            delay: (new Date()) - ev.date,
            when: ev.date,
            zonename: ev.zonename
        }, 'VminfodWatcher saw new zone');

        self.addDebug(ev.zonename, 'last_zone_create');
        self.handleZoneCreated(ev.vm);
    });

    self.vminfod_watcher.on('delete', function (ev) {
        // when a zone was deleted, cleanup any cached stuff for it
        self.log.debug({
            delay: (new Date()) - ev.date,
            when: ev.date,
            zonename: ev.zonename
        }, 'VminfodWatcher saw zone deletion');

        self.purgeZoneCache(ev.zonename);
    });

    self.vminfod_watcher.on('modify', function (ev) {
        var state;

        /*
         * For non-KVM and non-bhyve, we only care about create/delete since
         * the socket only needs to be created once for these zones.
         *
         * For KVM the qemu process recreates the socket on every boot, so we
         * want to catch 'start' events to ensure we connect to metadata as soon
         * as possible.
         *
         * For bhyve, the bhyve process recreates the socket every time it
         * starts. This happens when the zone first starts and every time the
         * guest reboots. The 'running' state change will catch the first one.
         * Guest reboots can be detected by 'init_restarts' incrementing, which
         * is seen when "action" is "changed" - not "added".
         */
        if (ev.vm.brand !== 'kvm' && ev.vm.brand !== 'bhyve') {
            return;
        }

        var restarts = ev.changes.filter(function (change) {
            return (change.path.length === 1
                && change.path[0] === 'init_restarts'
                && change.action === 'changed');
        });
        if (restarts.length !== 0) {
            // The previous zoneConnection should have already been cleaned up
            // when the bhyve process died and the kernel closed the connection.
            assert(!self.zoneKvmReconnTimers.hasOwnProperty(ev.zonename));
            self.handleZoneCreated(ev.vm);
        }

        // Find state transition
        state = ev.changes.filter(function (change) {
            return (change.path.length === 1 && change.path[0] === 'state');
        });
        if (state.length < 1) {
            return;
        }
        // Only 1 state change event should be seen per vminfod event
        assert.equal(state.length, 1, 'multiple "state" changes seen');
        state = state[0];

        // If a KVM zone stops while we're trying to reconnect to its metadata
        // socket, stop trying to reconnect.
        if (state === 'stopped'
            && self.zoneKvmReconnTimers.hasOwnProperty(ev.zonename)) {

            self.stopKvmReconnTimer(ev.zonename);

            // Also remove the zoneConnections entry so that the
            // connection will be recreated when we notice it going
            // running. See "The rules for zoneConnections" above.
            delete self.zoneConnections[ev.zonename];
        }

        if (state !== 'running') {
            return;
        }

        assert.equal(state, 'running', 'state != running');
        self.log.debug({
            delay: (new Date()) - ev.date,
            when: ev.date,
            zonename: ev.zonename
        }, 'VminfodWatcher saw KVM or bhyve zone boot');

        self.addDebug(ev.zonename, 'last_zone_start');

        // The "zone" wasn't technically created here, but the socket was
        // (by qemu) so as far as we're concerned this is the same thing.
        self.handleZoneCreated(ev.vm);
    });
};

MetadataAgent.prototype.stop = function () {
    var self = this;

    self.vminfod_watcher.stop();
};

MetadataAgent.prototype.startKVMSocketServer = function (zonename, callback) {
    var self = this;

    assert.string(zonename, 'zonename');
    assert.func(callback, 'callback');

    var vmobj = self.vminfod_watcher.vm(zonename);
    var zlog = self.zlog[zonename] || self.log;

    assert.object(vmobj, 'vmobj');

    var sockpath = path.join(vmobj.zonepath, '/root/tmp/vm.ttyb');

    zlog.trace('starting socket server');

    async.waterfall([
        function (cb) {
            common.retryUntil(2000, 120000,
                function (c) {
                    var err;

                    if (!self.vminfod_watcher.vm(zonename)) {
                        // zone was removed, no need to retry any further
                        err = new Error('zone no longer exists');
                        err.code = 'ENOENT';
                        c(err, true /* abort the retryUntil */);
                        return;
                    }
                    fs.exists(sockpath, function (exists) {
                        if (!exists) {
                            // in this case we'll try again
                            zlog.warn(sockpath + ' does not exist');
                        }
                        c(null, exists);
                    });
                }, function (error) {
                    if (error) {
                        zlog.error({err: error, code: error.code},
                            'Error waiting for metadata socket');
                    }
                    cb(error);
                }
            );
        }
    ], function (error) {
        var zopts = { zone: zonename, sockpath: sockpath };

        if (error) {
            callback(error);
            return;
        }

        self.createKVMServer(zopts, function () {
            if (callback) {
                callback();
            }
        });
    });
};

MetadataAgent.prototype.createKVMServer = function (zopts, callback) {
    var self = this;
    var zlog;

    assert.object(zopts, 'zopts');
    assert.string(zopts.sockpath, 'zopts.sockpath');
    assert.string(zopts.zone, 'zopts.zone');
    assert.func(callback, 'callback');

    zlog = self.zlog[zopts.zone] || self.log;

    // Ignore zones that have been removed
    if (!self.vminfod_watcher.vm(zopts.zone)) {
        zlog.trace({zonename: zopts.zone},
            'not creating kvm socket for zone that does not exist');
        callback();
        return;
    }

    // Ignore zones we've already got a connection for and then immediately
    // create an entry if we don't. To act as a mutex.
    if (self.zoneConnections[zopts.zone]) {
        zlog.trace({zonename: zopts.zone}, 'already have zoneConnections[] for '
            + 'zone -- not replacing.');
        callback();
        return;
    }
    self.zoneConnections[zopts.zone] = {};

    // refuse to overwrite an existing connection
    assert.ok(!self.zoneConnections[zopts.zone].hasOwnProperty('conn'),
        'should not have existing conn when creating new');
    assert.ok(!self.zoneConnections[zopts.zone].hasOwnProperty('serverSocket'),
        'should not have existing serverSocket when creating new');

    // replace the placeholder entry with a real one.
    self.zoneConnections[zopts.zone] = {
        conn: {}, // placeholder so we don't overwrite if we're called again
        connectsRefused: 0,
        connectsMissing: 0,
        sockpath: zopts.sockpath
    };

    function _tryConnect() {
        var buffer = '';
        var fd;
        var handler;
        var kvmstream = new net.Socket();

        handler = self.makeMetadataHandler(zopts.zone, kvmstream);

        assert.object(self.zoneConnections[zopts.zone],
            'zone connection initialized and not yet reaped');
        self.zoneConnections[zopts.zone].conn = kvmstream;

        kvmstream.on('connect', function _onConnect() {
            // either this on('connect') handler will run or the on('error')
            fd = kvmstream._handle.fd;
            zlog.info({
                conn_refused: self.zoneConnections[zopts.zone].connectsRefused,
                conn_missing: self.zoneConnections[zopts.zone].connectsMissing,
                zonename: zopts.zone
            }, 'listening on fd %d', fd);
            self.zoneConnections[zopts.zone].fd = fd;
            // we're no longer retrying connections (since we connected)
            delete self.zoneKvmReconnTimers[zopts.zone];
        });

        kvmstream.on('data', function (data) {
            var chunk, chunks;

            buffer += data.toString();
            chunks = buffer.split('\n');
            while (chunks.length > 1) {
                chunk = chunks.shift();
                handler(chunk);
            }
            buffer = chunks.pop();
        });

        kvmstream.on('error', function (e) {
            var level = 'warn';

            if (e.code === 'ECONNREFUSED') {
                var refused = self.zoneConnections[zopts.zone].connectsRefused;
                level = 'trace';

                // Our connection was refused by Qemu or bhyve, presumably
                // because it is still starting up and we're early. Try again
                // and set a handle to our retry timer so it can be cancelled if
                // the zone is stopped.
                //
                // We log every Xth retry after the first so that we don't
                // completely spam the log.
                if (refused > 0
                    && (refused % KVM_CONNECT_RETRY_LOG_FREQUENCY) === 0) {

                    zlog.info({
                        conn_refused: refused,
                        last_errcode: e.code,
                        retry_interval: KVM_CONNECT_RETRY_INTERVAL
                    }, 'KVM socket connection refused, still retrying');
                }
                self.zoneKvmReconnTimers[zopts.zone] = setTimeout(_tryConnect,
                    KVM_CONNECT_RETRY_INTERVAL);

                self.zoneConnections[zopts.zone].connectsRefused++;
            } else if (e.code === 'ENOENT') {
                var missing = self.zoneConnections[zopts.zone].connectsMissing;
                level = 'trace';

                // The connection failed because the socket is missing.  This
                // could be due to the socket having not been created the first
                // time or because qemu or bhyve is replacing a stale socket
                // with unlink() then bind().  Try again and set a handle to our
                // retry timer so it can be cancelled if the zone is stopped.
                //
                // We log every Xth retry after the first so that we don't
                // completely spam the log.
                if (missing > 0
                    && (missing % KVM_CONNECT_RETRY_LOG_FREQUENCY) === 0) {

                    zlog.info({
                        conn_missing: missing,
                        last_errcode: e.code,
                        retry_interval: KVM_CONNECT_RETRY_INTERVAL
                    }, 'KVM socket missing, still retrying');
                }
                self.zoneKvmReconnTimers[zopts.zone] = setTimeout(_tryConnect,
                    KVM_CONNECT_RETRY_INTERVAL);

                self.zoneConnections[zopts.zone].connectsMissing++;
            }

            zlog[level]({err: e}, 'KVM Socket error: ' + e.message);
        });

        kvmstream.on('close', function () {
            // When the stream closes, we'll delete from zoneConnections so that
            // on next boot (or periodic scan if for some reason we got closed
            // while the zone was actually running) we re-create.
            if (!self.zoneKvmReconnTimers.hasOwnProperty(zopts.zone)) {
                zlog.info('stream closed on fd %d', fd);
                delete self.zoneConnections[zopts.zone];
            }
        });

        zlog.trace({zonename: zopts.zone, sockpath: zopts.sockpath},
            'attempting connection to KVM socket');
        kvmstream.connect(zopts.sockpath);
    }

    _tryConnect();

    callback();
};

MetadataAgent.prototype.startZoneSocketServer =
function startZoneSocketServer(zonename, callback) {
    var self = this;

    var vmobj = self.vminfod_watcher.vm(zonename);

    assert.object(vmobj, 'vmobj');
    assert.string(vmobj.brand, 'vmobj.brand');
    assert.string(vmobj.zonepath, 'vmobj.zonename');
    assert.func(callback, 'callback');

    var zlog = self.zlog[zonename] || self.log;
    var zopts;

    zopts = {
        path: path.join('/var/zonecontrol', zonename, 'metadata.sock'),
        zone: zonename
    };

    zlog.trace('starting socket server');

    self.createZoneSocket(zopts, callback);
};

MetadataAgent.prototype.createZoneSocket =
function createZoneSocket(zopts, callback) {
    var self = this;
    var server;

    assert.object(zopts, 'zopts');
    assert.string(zopts.path, 'zopts.path');
    assert.string(zopts.zone, 'zopts.zone');
    assert.func(callback, 'callback');

    var zlog = self.zlog[zopts.zone] || self.log;
    var zonecontrol = path.dirname(zopts.path);

    if (!self.vminfod_watcher.vm(zopts.zone)) {
        zlog.info({zonename: zopts.zone},
            'zone no longer exists, not creating socket');
        callback();
        return;
    }

    // Ignore zones we've already got a connection for and then immediately
    // create an entry if we don't. To act as a mutex.
    if (self.zoneConnections[zopts.zone]) {
        zlog.trace({zonename: zopts.zone}, 'already have zoneConnections[] for '
            + 'zone -- not replacing.');
        callback();
        return;
    }
    self.zoneConnections[zopts.zone] = {};

    self.addDebug(zopts.zone, 'last_sock_create_attempt');

    fs.mkdir(zonecontrol, parseInt('700', 8), function _mkdirCb(e) {
        if (e && e.code !== 'EEXIST') {
            self.addDebug(zopts.zone, 'last_sock_create_failure', e);
            zlog.warn({zonename: zopts.zone, err: e},
                'failed to create sockpath directory');
            // We were unable to create the directory but we have not yet
            // created a real self.zoneConnections entry so we can just delete
            // the placeholder and call callback. If the VM still exists and
            // is running, we'll try again when we next poll w/
            // _checkNewZones().
            delete self.zoneConnections[zopts.zone];
            callback(e);
            return;
        }

        server = net.createServer(function (socket) {
            var buffer = '';
            var handler = self.makeMetadataHandler(zopts.zone, socket);

            socket.on('data', function (data) {
                var chunk;
                var chunks;

                buffer += data.toString();
                chunks = buffer.split('\n');
                while (chunks.length > 1) {
                    chunk = chunks.shift();
                    handler(chunk);
                }
                buffer = chunks.pop();
            });

            socket.on('error', function (err) {
                /*
                 * This is an error on the individual mdata-{get,put,delete}
                 * session. There's not really much of anything we can do
                 * about this other than log it. The server will still be
                 * running and should still accept new sessions.
                 */
                zlog.error({err: err}, 'Socket error');
            });
        });

        // refuse to overwrite an existing connection
        assert.ok(!self.zoneConnections[zopts.zone].hasOwnProperty('conn'),
            'should not have existing conn when creating new');
        assert.ok(!self.zoneConnections[zopts.zone]
            .hasOwnProperty('serverSocket'),
            'should not have existing serverSocket when creating new');

        self.zoneConnections[zopts.zone] = {
            serverSocket: server,
            sockpath: zopts.path
        };

        server.on('error', function (err) {
            zlog.error({err: err}, 'Zone socket error: %s', err.message);
            // We really don't know what this is, so dump a core so we can
            // investigate.
            throw err;
        });

        server.on('close', function () {
            // If the stream closes, we'll delete from zoneConnections so
            // that on next boot (or periodic scan if for some reason we got
            // closed while the zone was actually running) we re-create.
            zlog.info('stream closed for %s', zopts.zone);
            delete self.zoneConnections[zopts.zone];
        });

        fs.unlink(zopts.path, function _fsUnlinkCb(unlinkErr) {
            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                self.addDebug(zopts.zone, 'last_sock_create_failure',
                    unlinkErr);

                zlog.warn({
                    zonename: zopts.zone,
                    err: unlinkErr
                }, 'failed to unlink old socket');

                // We were unable to create a socket, but as with a directory
                // creation error we've not created a real self.zoneConnections
                // entry yet so we'll delete the placeholder and let the
                // _checkNewZones() catch it on the next go-round.
                delete self.zoneConnections[zopts.zone];
                callback(unlinkErr);
                return;
            }

            server.listen(zopts.path, function _serverListenCb() {
                var fd = server._handle.fd;
                zlog.info('listening on %d', fd);
                self.zoneConnections[zopts.zone].fd = fd;
                self.addDebug(zopts.zone, 'last_sock_listen_success');

                callback();
            });
        });
    });
};

function base64_decode(input) {
    try {
        return (new Buffer(input, 'base64')).toString();
    } catch (err) {
        return null;
    }
}

function internalNamespace(vmobj, want)
{
    var internal_namespace = null;
    var prefix;

    /*
     * If we have a ':' we need to check against namespaces. If it is in the
     * list, we're dealing with read-only internal_metadata instead of
     * customer_metadata.
     */
    if ((want.indexOf(':') !== -1)
        && vmobj.hasOwnProperty('internal_metadata_namespaces')) {

        prefix = (want.split(':'))[0];
        vmobj.internal_metadata_namespaces.forEach(function (ns) {
            if (ns === prefix) {
                internal_namespace = prefix;
            }
        });
    }

    return (internal_namespace);
}

MetadataAgent.prototype.makeMetadataHandler = function (zone, socket) {
    assert.string(zone, 'zone');
    assert.object(socket, 'socket');

    var self = this;
    var zlog = self.zlog[zone] || self.log;
    var write = function (str) {
        if (socket.writable) {
            socket.write(str);
        } else {
            zlog.error('Socket for ' + zone + ' closed before we could write '
                + 'anything.');
        }
    };

    return function _metadataHandler(data) {
        var cmd;
        var ns;
        var parts;
        var query;
        var reqid;
        var req_is_v2 = false;
        var start_request_timer = newTimer();
        var val;
        var vmobj;
        var want;

        vmobj = self.vminfod_watcher.vm(zone);

        // ensure sanity: we should only get metadata request for existing zones
        assert.object(vmobj, 'vmobj');

        parts = data.toString().trimRight().replace(/\n$/, '')
            .match(/^([^\s]+)\s?(.*)/);

        if (!parts) {
            write('invalid command\n');
            return;
        }

        cmd = parts[1];
        want = parts[2];
        query = {
            cmd: cmd,
            arg: want,
            req_v: 1
        };

        if ((cmd === 'NEGOTIATE' || cmd === 'GET') && !want) {
            write('invalid command\n');
            return;
        }

        // Unbox V2 protocol frames:
        if (cmd === 'V2') {
            if (!parse_v2_request(want))
                return;
        }

        if (cmd === 'GET') {
            want = (want || '').trim();
            if (!want) {
                returnit(new Error('Invalid GET Request'));
                return;
            }

            zlog.trace('Serving GET ' + want);

            if (want.slice(0, 4) === 'sdc:') {
                want = want.slice(4);

                // NOTE: sdc:nics, sdc:resolvers and sdc:routes are not a
                // committed interface, do not rely on it. At this point it
                // should only be used by mdata-fetch, if you add a consumer
                // that depends on it, please add a note about that here
                // otherwise expect it will be removed on you sometime.
                if (want === 'nics' && vmobj.hasOwnProperty('nics')) {

                    val = JSON.stringify(vmobj.nics);
                    returnit(null, val);

                } else if (want === 'resolvers'
                    && vmobj.hasOwnProperty('resolvers')) {

                    val = JSON.stringify(vmobj.resolvers);
                    returnit(null, val);

                } else if (want === 'tmpfs'
                    && vmobj.hasOwnProperty('tmpfs')) {

                    val = JSON.stringify(vmobj.tmpfs);
                    returnit(null, val);

                } else if (want === 'routes'
                    && vmobj.hasOwnProperty('routes')) {

                    var vmRoutes = [];

                    // The notes above about resolvers also to routes. It's
                    // here solely for the use of mdata-fetch, and we need
                    // to do the updateZone here so that we have latest
                    // data.
                    for (var r in vmobj.routes) {
                        var gateway;
                        var foundNic = null;
                        var route = { linklocal: false, dst: r };
                        var mac;
                        var macMatch = vmobj.routes[r]
                            .match(/^macs\[(.+)\]$/);
                        var nicMac;
                        var nicIdx = vmobj.routes[r]
                            .match(/^nics\[(\d+)\]$/);

                        if (!nicIdx && !macMatch) {
                            // Non link-local route: we have all the
                            // information we need already
                            route.gateway = vmobj.routes[r];
                            vmRoutes.push(route);
                            continue;
                        }

                        if (macMatch) {
                            try {
                                mac = macaddr.parse(macMatch[1]);
                            } catch (parseErr) {
                                zlog.warn(parseErr, 'failed to parse mac'
                                    + ' addr');
                                continue;
                            }

                            if (!vmobj.hasOwnProperty('nics'))
                                continue;

                            // Link-local route: we need the IP of the
                            // local nic with the provided mac address
                            for (var i = 0; i < vmobj.nics.length; i++) {
                                try {
                                    nicMac = macaddr.parse(vmobj.nics[i]
                                        .mac);
                                } catch (parseErr) {
                                    zlog.warn(parseErr, 'failed to parse'
                                        + ' nic mac addr');
                                    continue;
                                }
                                if (nicMac.compare(mac) === 0) {
                                    foundNic = vmobj.nics[i];
                                    break;
                                }
                            }

                            if (!foundNic || !foundNic.hasOwnProperty('ip')
                                || foundNic.ip === 'dhcp') {

                                continue;
                            }

                            gateway = foundNic.ip;

                        } else {
                            nicIdx = Number(nicIdx[1]);

                            // Link-local route: we need the IP of the
                            // local nic
                            if (!vmobj.hasOwnProperty('nics')
                                || !vmobj.nics[nicIdx]
                                || !vmobj.nics[nicIdx].hasOwnProperty('ip')
                                || vmobj.nics[nicIdx].ip === 'dhcp') {

                                continue;
                            }

                            gateway = vmobj.nics[nicIdx].ip;
                        }

                        assert.string(gateway, 'gateway');
                        route.gateway = gateway;
                        route.linklocal = true;
                        vmRoutes.push(route);
                    }

                    returnit(null, JSON.stringify(vmRoutes));
                } else if (want === 'operator-script') {
                    returnit(null, vmobj.internal_metadata['operator-script']);
                } else if (want === 'volumes') {
                    returnit(null, vmobj.internal_metadata['sdc:volumes']);
                } else {
                    val = VM.flatten(vmobj, want);
                    returnit(null, val);
                }
            } else {
                var which_mdata = 'customer_metadata';

                if (want.match(/_pw$/)) {
                    which_mdata = 'internal_metadata';
                }

                if (internalNamespace(vmobj, want) !== null) {
                    which_mdata = 'internal_metadata';
                }

                if (vmobj.hasOwnProperty(which_mdata)) {
                    returnit(null, vmobj[which_mdata][want]);
                    return;
                } else {
                    returnit(new Error('Zone did not contain '
                        + which_mdata));
                    return;
                }
            }
        } else if (!req_is_v2 && cmd === 'NEGOTIATE') {
            if (want === 'V2') {
                write('V2_OK\n');
            } else {
                write('FAILURE\n');
            }
            return;
        } else if (req_is_v2 && cmd === 'DELETE') {
            want = (want || '').trim();
            if (!want) {
                returnit(new Error('Invalid DELETE Request'));
                return;
            }

            zlog.trace('Serving DELETE ' + want);

            if (want.slice(0, 4) === 'sdc:') {
                returnit(new Error('Cannot update the "sdc" Namespace.'));
                return;
            }

            ns = internalNamespace(vmobj, want);
            if (ns !== null) {
                returnit(new Error('Cannot update the "' + ns
                    + '" Namespace.'));
                return;
            }

            setMetadata(want, null, function (err) {
                if (err) {
                    returnit(err);
                } else {
                    returnit(null, 'OK');
                }
            });
        } else if (req_is_v2 && cmd === 'PUT') {
            var key;
            var value;
            var terms;

            terms = (want || '').trim().split(' ');

            if (terms.length !== 2) {
                returnit(new Error('Invalid PUT Request'));
                return;
            }

            // PUT requests have two space-separated BASE64-encoded
            // arguments: the Key and then the Value.
            key = (base64_decode(terms[0]) || '').trim();
            value = base64_decode(terms[1]);
            query.arg = key;

            if (!key || value === null) {
                returnit(new Error('Invalid PUT Request'));
                return;
            }

            if (key.slice(0, 4) === 'sdc:') {
                returnit(new Error('Cannot update the "sdc" Namespace.'));
                return;
            }

            ns = internalNamespace(vmobj, key);
            if (ns !== null) {
                returnit(new Error('Cannot update the "' + ns
                    + '" Namespace.'));
                return;
            }

            zlog.trace('Serving PUT ' + key);
            setMetadata(key, value, function (err) {
                if (err) {
                    zlog.error(err, 'could not set metadata (key "' + key
                        + '")');
                    returnit(err);
                } else {
                    returnit(null, 'OK');
                }
            });

            return;
        } else if (cmd === 'KEYS') {
            var ckeys = [];
            var ikeys = [];

            /*
             * Keys that match *_pw$ and internal_metadata_namespace
             * prefixed keys come from internal_metadata, everything else
             * comes from customer_metadata.
             */
            ckeys = Object.keys(vmobj.customer_metadata)
                .filter(function (k) {

                return (!k.match(/_pw$/)
                    && internalNamespace(vmobj, k) === null);
            });
            ikeys = Object.keys(vmobj.internal_metadata)
                .filter(function (k) {

                return (k.match(/_pw$/)
                    || internalNamespace(vmobj, k) !== null);
            });

            returnit(null, ckeys.concat(ikeys).join('\n'));
        } else {
            zlog.error('Unknown command ' + cmd);
            returnit(new Error('Unknown command ' + cmd));
            return;
        }

        function _callCbAndLogTimer(opts, err, _cb) {
            assert.object(opts, 'opts');
            assert.arrayOfNumber(opts.timer, 'opts.timer');
            assert.string(opts.loadFile, 'opts.loadFile');
            assert.optionalObject(err, 'err');
            assert.func(_cb, '_cb');

            var elapsed = elapsedTimer(opts.timer);
            var loglvl = 'trace';

            if (elapsed >= 10) {
                // If reading the file took more than 10ms we log at
                // warn instead of trace. Something's not right.
                loglvl = 'warn';
            }
            zlog[loglvl]({
                elapsed: elapsed,
                result: (err ? 'FAILED' : 'SUCCESS'),
                zonename: vmobj.zonename
            }, 'load ' + opts.loadFile);
            _cb(err);
        }

        function setMetadata(_key, _value, cb) {
            var payload = {};
            var which = 'customer_metadata';

            // Some keys come from "internal_metadata":
            if (_key.match(/_pw$/) || _key === 'operator-script') {
                which = 'internal_metadata';
            }

            // Construct payload for VM.update()
            if (_value) {
                payload['set_' + which] = {};
                payload['set_' + which][_key] = _value;
            } else {
                payload['remove_' + which] = [ _key ];
            }

            zlog.trace({ payload: payload }, 'calling VM.update()');
            VM.update(vmobj.uuid, payload, zlog, cb);
        }

        function parse_v2_request(inframe) {
            var m;
            var m2;
            var newcrc32;
            var framecrc32;
            var clen;

            zlog.trace({ request: inframe }, 'incoming V2 request');

            m = inframe.match(
                /\s*([0-9]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+(.*)/);
            if (!m) {
                zlog.error('V2 frame did not parse: ', inframe);
                return (false);
            }

            clen = Number(m[1]);
            if (!(clen > 0) || clen !== (m[3] + ' ' + m[4]).length) {
                zlog.error('V2 invalid clen: ' + m[1]);
                return (false);
            }

            newcrc32 = crc32.crc32_calc(m[3] + ' ' + m[4]);
            framecrc32 = m[2];
            if (framecrc32 !== newcrc32) {
                zlog.error('V2 crc mismatch (ours ' + newcrc32
                    + ' theirs ' + framecrc32 + '): ' + want);
                return (false);
            }

            reqid = m[3];

            m2 = m[4].match(/\s*(\S+)\s*(.*)/);
            if (!m2) {
                zlog.error('V2 invalid body: ' + m[4]);
                return (false);
            }

            cmd = m2[1];
            want = base64_decode(m2[2]);
            query.cmd = cmd;
            query.arg = want;
            query.req_v = 2;

            req_is_v2 = true;

            return (true);
        }


        function format_v2_response(code, body) {
            var resp;
            var fullresp;

            resp = reqid + ' ' + code;
            if (body)
                resp += ' ' + (new Buffer(body).toString('base64'));

            fullresp = 'V2 ' + resp.length + ' ' + crc32.crc32_calc(
                resp) + ' ' + resp + '\n';

            zlog.trace({ response: fullresp }, 'formatted V2 response');

            return (fullresp);
        }

        function logReturn(res, error) {
            query.elapsed = elapsedTimer(start_request_timer);

            zlog.info({
                err: error,
                response: res,
                query: query
            }, 'handled %s %s', query.cmd, query.arg);
        }

        function returnit(error, retval) {
            var towrite;

            if (error) {
                zlog.error(error.message);
                if (req_is_v2) {
                    write(format_v2_response('FAILURE', error.message));
                } else {
                    write('FAILURE\n');
                }
                logReturn('FAILURE', error);
                return;
            }

            // String value
            if (common.isString(retval)) {
                if (req_is_v2) {
                    write(format_v2_response('SUCCESS', retval));
                } else {
                    towrite = retval.replace(/^\./mg, '..');
                    write('SUCCESS\n' + towrite + '\n.\n');
                }
                logReturn('SUCCESS');
                return;
            } else if (!isNaN(retval)) {
                if (req_is_v2) {
                    write(format_v2_response('SUCCESS', retval.toString()));
                } else {
                    towrite = retval.toString().replace(/^\./mg, '..');
                    write('SUCCESS\n' + towrite + '\n.\n');
                }
                logReturn('SUCCESS');
                return;
            } else if (retval) {
                // Non-string value
                if (req_is_v2) {
                    write(format_v2_response('FAILURE'));
                } else {
                    write('FAILURE\n');
                }
                logReturn('FAILURE');
                return;
            } else {
                // Nothing to return
                if (req_is_v2) {
                    write(format_v2_response('NOTFOUND'));
                } else {
                    write('NOTFOUND\n');
                }
                logReturn('NOTFOUND');
                return;
            }
        }
    };
};
