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
 * Copyright (c) 2017, Joyent, Inc. All rights reserved.
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
 *   - attempts to create a metadata socket for all existing VMs on the CN
 *   - starts an interval timer so that we check every 5 minutes for VMs that
 *     have been deleted
 *   - starts an interval timer so that we check every minute for VMs that have
 *     started running without us getting a ZWatch event
 *   - starts a ZWatch watcher that calls a callback whenever a VM is started
 *     and does not already have an active connection
 *
 * Either at agent startup or whenever we see a zone boot that does not have a
 * metadata socket, we attempt to create the appropriate socket for the type of
 * VM.
 *
 *
 * # CREATING SOCKETS
 *
 * If the VM is a KVM VM, the qemu process running in the KVM zone will be
 * running with a "ttyb" virtual serial port for the KVM guest. From the host
 * we can connect to connect to /root/tmp/vm.ttyb in the zoneroot which Qemu is
 * listening on for connections. We connect to this as a client but run a
 * metadata server on the resulting connection. Inside the KVM guest the
 * mdata-client tools connect to the serial device and are then talking to our
 * metadata handler.
 *
 * For all non-KVM VMs we create a unix domain socket in
 * /var/zonecontrol/<zonename> named metadata.sock. We mount the zonecontrol
 * directory into the zone (read-only) via the brand.
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
 * minutes, or we see a message from zoneevent) the global state objects for the
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
var execFile = require('child_process').execFile;
var fs = require('fs');
var getZoneinfo
    = require('/usr/vm/node_modules/vmload/vmload-zoneinfo').getZoneinfo;
var guessHandleType = process.binding('tty_wrap').guessHandleType;
var net = require('net');
var path = require('path');
var util = require('util');
var vasync = require('vasync');
var VM = require('/usr/vm/node_modules/VM');
var vmload = require('/usr/vm/node_modules/vmload');
var ZWatch = require('./zwatch');

var sdc_fields = [
    'alias',
    'billing_id',
    'brand',
    'cpu_cap',
    'cpu_shares',
    'create_timestamp',
    'server_uuid',
    'image_uuid',
    'datacenter_name',
    'do_not_inventory',
    'dns_domain',
    'force_metadata_socket',
    'fs_allowed',
    'hostname',
    'internal_metadata_namespaces',
    'limit_priv',
    'last_modified',
    'maintain_resolvers',
    'max_physical_memory',
    'max_locked_memory',
    'max_lwps',
    'max_swap',
    'nics',
    'owner_uuid',
    'package_name',
    'package_version',
    'quota',
    'ram',
    'resolvers',
    'routes',
    'state',
    'tmpfs',
    'uuid',
    'vcpus',
    'vnc_port',
    'zfs_io_priority',
    'zonepath',
    'zonename',
    'zone_state'
];

var KVM_CONNECT_RETRY_INTERVAL = 100; // ms
var KVM_CONNECT_RETRY_LOG_FREQUENCY = 10; // log every X retries
var MAX_RETRY = 300; // in seconds
var ZONEADM_CHECK_FREQUENCY = (5 * 60 * 1000); // ms, check for deleted zones
var MISSED_SYSEVENT_CHECK_FREQUENCY = (1 * 60 * 1000); // ms


function zoneExists(zonename, callback) {
    var exists = false;

    fs.stat('/etc/zones/' + zonename + '.xml', function _onStat(err, stats) {
        if (err) {
            if (err.code !== 'ENOENT') {
                // Should either exist or not exist but should always be
                // readable if it does exist. If not: we don't know how to
                // proceed so throw/abort.
                throw (err);
            }
        } else {
            exists = true;
        }

        callback(null, exists);
    });
}

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
    this.zones = {};
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
    assert.string(type);
    assert.string(zonename);

    var self = this;
    var newRingbuffer = new bunyan.RingBuffer({limit: 10});

    self.zlog[zonename] = self.log.child({
        brand: type,
        streams: [ {level: 'trace', type: 'raw', stream: newRingbuffer} ],
        zonename: zonename});
    self.addDebug(zonename, 'last_10_logs', newRingbuffer.records);

    return (self.zlog[zonename]);
};

/**
 * Update the zones cache for the zone with name "zonename", and call "callback"
 * when done.
 *
 * @param zonename {String} the name of the zone for which to update the cache
 * @param opts {Object} an object with the following properties:
 *   - forceReload {Boolean} if true, bypasses the cache and always reload that
 *     zone's information from disk. False by default.
 * @param callback {Function} a function called when the operation is complete.
 *   The signature of that function is callback(err), where "err" is an Error
 *   object that represents the cause of failure if updating the zone cache
 *   failed.
 */
MetadataAgent.prototype.updateZone =
function updateZone(zonename, opts, callback) {
    assert.string(zonename, 'zonename');
    assert.object(opts, 'opts');
    assert.optionalBool(opts.forceReload, 'opts.forceReload');
    assert.func(callback, 'callback');

    var self = this;
    var log = self.log;

    assert.string(zonename, 'zonename');
    assert.func(callback, 'callback');

    function shouldLoad(cb) {
        if (opts.forceReload) {
            cb(null, true);
            return;
        }

        if (!self.zones.hasOwnProperty(zonename)) {
            // don't have a cache, load this guy
            log.info({zonename: zonename},
                'no cache for: ' + zonename + ', loading');
            cb(null, true);
            return;
        }

        // We do have a cached version, we'll reload only if its last modified
        // timestamp changed.
        vmload.getLastModified(zonename, path.join('/zones', zonename), log,
            function onLastModifiedLoaded(get_last_mod_err, last_modified_iso) {
                var old_mtime_iso;

                if (get_last_mod_err) {
                    log.error({
                        err: get_last_mod_err,
                        zonename: zonename
                    }, 'Error when getting last_modified for zone');
                    // We couldn't find the last modified time for this zone,
                    // the VM probably disappeared, so we're removing it from
                    // the cache.
                    self.purgeZoneCache(zonename);
                    cb(null, false);
                    return;
                }

                // We just retrieved the last modified time for the zone, which
                // means it exists, so we really should have
                // self.zones[zonename].
                assert.object(self.zones[zonename],
                    'self.zones[' + zonename + ']');

                old_mtime_iso = self.zones[zonename].last_modified;
                assert.string(old_mtime_iso, 'old_mtime_iso');
                assert.string(last_modified_iso, 'last_modified_iso');

                log.info({
                    old_mtime_ms: old_mtime_iso,
                    last_modified_ms: last_modified_iso,
                    zonename: zonename
                }, 'old last_modified vs newly-loaded last_modifed for zone');

                if (last_modified_iso > old_mtime_iso) {
                    log.info({zonename: zonename},
                        'last_modified was updated, reloading');
                    cb(null, true);
                    return;
                }

                log.trace('using cache for: ' + zonename);
                cb(null, false);
            });
    }

    shouldLoad(function (err, load) {
        var start_lookup_timer = newTimer();

        // fail open (meaning: force reload) when something went wrong
        if (load || err) {
            VM.lookup({ zonename: zonename }, { fields: sdc_fields },
                function (error, machines) {
                    var elapsed = elapsedTimer(start_lookup_timer);

                    if (!error) {
                        self.zones[zonename] = machines[0];
                        self.addDebug(zonename, 'last_zone_load');
                    }
                    log.debug({
                        elapsed: elapsed,
                        err: error,
                        zonename: zonename
                    }, 'finished VM.lookup');
                    callback(error);
                    return;
                }
            );
        } else {
            // no need to reload since there's no change, use existing data
            callback();
            return;
        }
    });
};

MetadataAgent.prototype.createServersOnExistingZones = function () {
    var self = this;
    var created = 0;

    VM.lookup({}, { fields: sdc_fields }, function (error, zones) {
        async.forEach(zones, function (zone, cb) {
            if (zone.zonename === 'global') {
                cb();
                return;
            }

            self.zones[zone.zonename] = zone;
            self.addDebug(zone.zonename, 'last_zone_load');

            if (error) {
                throw error;
            }

            if (!self.zlog[zone.zonename]) {
                // create a logger specific to this VM
                self.createZoneLog(zone.brand, zone.zonename);
            }

            // It is possible for VM.lookup() to take a long time. While we're
            // waiting for it, the watcher could have seen the zone creation and
            // created a socket for the zone. In case that happened, we ignore
            // zones we've already got a connection for.
            if (self.zoneConnections[zone.zonename]) {
                cb();
                return;
            }

            if (zone.brand === 'kvm') {

                // For KVM, the zone must be running otherwise Qemu will not
                // have created a socket.
                if (zone.zone_state !== 'running') {
                    self.log.debug('skipping zone ' + zone.zonename
                        + ' which has ' + 'non-running zone_state: '
                        + zone.zone_state);
                    cb();
                    return;
                }

                self.startKVMSocketServer(zone.zonename, function (err) {
                    if (!err) {
                        created++;
                    }
                    cb();
                });
            } else {
                self.startZoneSocketServer(zone.zonename, function (err) {
                    if (!err) {
                        created++;
                    }
                    cb();
                });
            }
        }, function (err) {
            self.log.info('created zone metadata sockets on %d / %d zones',
                created, zones.length);
        });
    });
};

MetadataAgent.prototype.purgeZoneCache = function purgeZoneCache(zonename) {
    assert.string(zonename);

    var self = this;

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
            // it's not undefined, so attempt to close it
            closeZoneConnection(self.zoneConnections[zonename]);
        }
        delete self.zoneConnections[zonename];
    }
    if (self.zones.hasOwnProperty(zonename)) {
        delete self.zones[zonename];
    }
};

MetadataAgent.prototype.stopKvmReconnTimer =
function stopKvmReconnTimer(zonename) {
    var self = this;

    self.log.warn({zonename: zonename},
        'clearing connection retries for KVM VM.');

    if (self.zoneKvmReconnTimers.hasOwnProperty(zonename)) {
        clearTimeout(self.zoneKvmReconnTimers[zonename]);
        delete self.zoneKvmReconnTimers[zonename];
    }
};

MetadataAgent.prototype.checkMissedSysevents = function checkMissedSysevents() {
    var self = this;
    var start_kstat_timer = newTimer();

    // Reminder: getZoneinfo only returns *running* zones since it pulls its
    // data from the kernel.
    getZoneinfo(null, {log: self.log}, function (err, results) {
        assert.ifError(err);

        function _assumeCreated(zonename) {
            self.addDebug(zonename, 'last_zone_found_existing');
            self.handleZoneCreated(zonename);
        }

        self.log.debug({
            elapsed: elapsedTimer(start_kstat_timer),
            zoneCount: Object.keys(results).length
        }, 'loaded VM kstats');

        Object.keys(results).forEach(function _checkZoneConn(zonename) {
            var zoneConn = self.zoneConnections[zonename]; // may be undefined

            if (!zoneConn) {
                // If we have no zoneConn, It's likely we failed a previous
                // attempt to create one. In any case, since the zone does exist
                // (it's in getZoneinfo) we should attempt to create a new
                // socket for it.
                self.log.warn({zonename: zonename}, 'zone is missing '
                    + 'zoneConnections entry, (re)trying socket creation');
                _assumeCreated(zonename);
                return;
            }
        });

        // We expect the VMs in self.zoneKvmReconnTimers to be 'running', since
        // we're actively retrying connections to their ttyb sockets. If they
        // went not-running unexpectedly, kill the retries.
        Object.keys(self.zoneKvmReconnTimers).forEach(
            function _checkTimer(zonename) {
                if (!results.hasOwnProperty(zonename)) {
                    self.log.warn({zonename: zonename}, 'was reconnecting for '
                        + 'KVM zone, but it is no longer running.');
                    self.stopKvmReconnTimer(zonename);

                    // Also remove the zoneConnections entry so that the
                    // connection will be recreated when we notice it going
                    // running. See "The rules for zoneConnections" above.
                    delete self.zoneConnections[zonename];
                }
            }
        );
    });
};

MetadataAgent.prototype.startPeriodicChecks = function startPeriodicChecks() {
    var self = this;

    // Every 5 minutes we check to see whether zones we've got in self.zones
    // were deleted. If they are, we delete the record from the cache and close
    // any open connection.

    function _checkDeletedZones() {
        var cmd = '/usr/sbin/zoneadm';
        var start_zoneadm_timer = newTimer();

        execFile(cmd, ['list', '-c'], function (err, stdout, stderr) {
            var elapsed = elapsedTimer(start_zoneadm_timer);
            var zones = {};

            if (err) {
                self.log.error({
                    elapsed: elapsed,
                    err: err
                }, 'unable to get list of zones');
                return;
            }

            // each output line is a zonename, so we turn this into an object
            // that looks like:
            //
            // {
            //   zonename: true,
            //   zonename: true
            //   ...
            // }
            //
            // so we can then loop through all the cached zonenames and remove
            // those that don't exist on the system any longer.
            stdout.trim().split(/\n/).forEach(function (z) {
                if (z !== 'global') {
                    zones[z] = true;
                }
            });

            self.log.debug({
                elapsed: elapsed,
                zonesFound: Object.keys(zones).length
            }, 'loaded zoneadm list of existing zones');

            Object.keys(self.zones).forEach(function (z) {
                if (!zones.hasOwnProperty(z)) {
                    self.purgeZoneCache(z);
                }
            });

            // schedule the next check
            setTimeout(_checkDeletedZones, ZONEADM_CHECK_FREQUENCY);
        });
    }

    // Here we check for boot messages that we might have missed due to the fact
    // that sysevent messages are unreliable.

    function _checkNewZones() {
        self.checkMissedSysevents();

        // schedule the next check
        setTimeout(_checkNewZones, MISSED_SYSEVENT_CHECK_FREQUENCY);
    }

    // Set the first timers to kick these checks off.

    setTimeout(_checkDeletedZones, ZONEADM_CHECK_FREQUENCY);
    self.log.info('Setup timer to purge deleted zones every %d ms',
        ZONEADM_CHECK_FREQUENCY);

    setTimeout(_checkNewZones, MISSED_SYSEVENT_CHECK_FREQUENCY);
    self.log.info('Setup timer to detect (missed) new zones every %d ms',
        MISSED_SYSEVENT_CHECK_FREQUENCY);
};

MetadataAgent.prototype.handleZoneCreated =
function handleZoneCreated(zonename) {
    assert.string(zonename, 'zonename');
    var self = this;

    // We don't wait around for results from creating the sockets because on
    // failure self.startKVMSocketServer or self.startZoneSocketServer should
    // leave us in a place we can retry on the next periodic check. So we just
    // pass this dummy callback instead.
    function _dummyCb() {
    }

    self.updateZone(zonename, {}, function (error) {
        if (error) {
            self.log.error({err: error}, 'Error updating '
                + 'attributes: ' + error.message);

            // When there's an error, we'll have not set in self.zones, so we'll
            // try again next time we see that the zone is running.
            return;
        }

        // If the zone was not deleted between the time we saw it start and
        // now, (we did a vmadm lookup in between via updateZone which could
        // have taken a while) we'll start the watcher.
        if (self.zones[zonename]) {
            if (!self.zlog[zonename]) {
                // create a logger specific to this VM
                self.createZoneLog(self.zones[zonename].brand, zonename);
            }

            if (self.zones[zonename].brand === 'kvm') {
                self.startKVMSocketServer(zonename, _dummyCb);
            } else {
                self.startZoneSocketServer(zonename, _dummyCb);
            }
        }
    });
};

MetadataAgent.prototype.start = function start() {
    var self = this;
    var zwatch = this.zwatch = new ZWatch(self.log);
    self.createServersOnExistingZones();
    self.startPeriodicChecks();

    zwatch.on('zone_transition', function (msg) {
        var when = new Date(msg.when / 1000000);

        // when a zone was deleted, cleanup any cached stuff for it
        if (msg.cmd === 'delete') {
            self.log.debug({
                delay: (new Date()).getTime() - when.getTime(), // in ms
                when: when,
                zonename: msg.zonename
            }, 'ZWatch watcher saw zone deletion');

            self.purgeZoneCache(msg.zonename);
            return;
        }

        // For non-KVM, we only care about create/delete since the socket
        // only needs to be created once for these zones. For KVM however,
        // the qemu process recreates the socket on every boot, so we want
        // to catch 'start' events for KVM to ensure we connect to metadata
        // as soon as possible.
        if (msg.cmd === 'start' && self.zones.hasOwnProperty(msg.zonename)
            && self.zones[msg.zonename].brand === 'kvm') {
            // KVM VM started

            self.log.debug({
                delay: (new Date()).getTime() - when.getTime(), // in ms
                when: when,
                zonename: msg.zonename
            }, 'ZWatch watcher saw KVM zone start');

            self.addDebug(msg.zonename, 'last_zone_start');

            // The "zone" wasn't technically created here, but the socket was
            // (by qemu) so as far as we're concerned this is the same thing.
            self.handleZoneCreated(msg.zonename);
            return;
        }

        // If a KVM zone stops while we're trying to reconnect to its metadata
        // socket, stop trying to reconnect.
        if (msg.cmd === 'stop'
            && self.zoneKvmReconnTimers.hasOwnProperty(msg.zonename)) {

            self.log.debug({
                delay: (new Date()).getTime() - when.getTime(), // in ms
                when: when,
                zonename: msg.zonename
            }, 'ZWatch watcher saw retrying KVM zone stop');

            self.stopKvmReconnTimer(msg.zonename);

            // Also remove the zoneConnections entry so that the
            // connection will be recreated when we notice it going
            // running. See "The rules for zoneConnections" above.
            delete self.zoneConnections[msg.zonename];

            return;
        }

        // ignore everything else except create
        if (msg.cmd !== 'create') {
            return;
        }

        // ignore zones we've already (still) got a connection for
        if (self.zoneConnections[msg.zonename]) {
            return;
        }

        self.log.debug({
            delay: (new Date()).getTime() - when.getTime(), // in ms
            when: when,
            zonename: msg.zonename
        }, 'ZWatch watcher saw new zone');

        zoneExists(msg.zonename, function _zoneExists(_, exists) {

            if (!exists) {
                self.log.warn({transition: msg},
                    'ignoring transition for zone that no longer exists');
                return;
            }

            // we only handle create, so that's what this was
            self.addDebug(msg.zonename, 'last_zone_create');
            self.handleZoneCreated(msg.zonename);
        });
    });
};

MetadataAgent.prototype.stop = function () {
    this.zwatch.stop();
};

MetadataAgent.prototype.startKVMSocketServer = function (zonename, callback) {
    var self = this;

    assert.string(zonename, 'zonename');
    assert.func(callback, 'callback');
    assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');
    assert.object(self.zlog[zonename], 'self.zlog[' + zonename + ']');

    var vmobj = self.zones[zonename];
    var zlog = self.zlog[zonename] || self.log;
    var sockpath = path.join(vmobj.zonepath, '/root/tmp/vm.ttyb');

    zlog.trace('starting socket server');

    async.waterfall([
        function (cb) {

            common.retryUntil(2000, 120000,
                function (c) {
                    var err;

                    if (!self.zones[zonename]) {
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
    if (!self.zones[zopts.zone]) {
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
        sockpath: zopts.sockpath
    };

    function _tryConnect() {
        var buffer = '';
        var fd;
        var handler;
        var kvmstream = new net.Socket();

        handler = self.makeMetadataHandler(zopts.zone, kvmstream);

        self.zoneConnections[zopts.zone].conn = kvmstream;

        kvmstream.on('connect', function _onConnect() {
            // either this on('connect') handler will run or the on('error')
            fd = kvmstream._handle.fd;
            zlog.info({
                conn_refused: self.zoneConnections[zopts.zone].connectsRefused,
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
            var refused = self.zoneConnections[zopts.zone].connectsRefused;

            if (e.code === 'ECONNREFUSED') {
                level = 'trace';

                // Our connection was refused by Qemu, presumably because Qemu
                // is still starting up and we're early. Try again and set a
                // handle to our retry timer so it can be cancelled if the zone
                // is stopped.
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

    assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');
    assert.string(self.zones[zonename].brand,
        'self.zones[' + zonename + '].brand');
    assert.string(self.zones[zonename].zonepath,
        'self.zones[' + zonename + '].zonepath');
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

    if (!self.zones[zopts.zone]) {
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
        // ensure sanity: we should only get metadata request for existing zones
        assert.object(self.zones[zone], 'self.zones[' + zone + ']');

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

        vmobj = self.zones[zone];

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
                    self.updateZone(zone, {}, function (error) {
                        if (error) {
                            // updating our cache for this VM failed, so we'll
                            // use the existing data.
                            zlog.error({err: error, zone: zone},
                                'Failed to reload vmobj using cached values');
                        }
                        if (self.zones[zone]) {
                            val = JSON.stringify(self.zones[zone].nics);
                        } else {
                            val = JSON.stringify(vmobj.nics);
                        }
                        returnit(null, val);
                        return;
                    });
                } else if (want === 'resolvers'
                    && vmobj.hasOwnProperty('resolvers')) {

                    // resolvers, nics and routes are special because we might
                    // reload metadata trying to get the new ones w/o zone
                    // reboot. To ensure these are fresh we always run
                    // updateZone which reloads the data if stale.
                    self.updateZone(zone, {}, function (error) {
                        if (error) {
                            // updating our cache for this VM failed, so we'll
                            // use the existing data.
                            zlog.error({err: error, zone: zone},
                                'Failed to reload vmobj using cached values');
                        }
                        // See NOTE above about nics, same applies to resolvers.
                        // It's here solely for the use of mdata-fetch.
                        if (self.zones[zone]) {
                            val = JSON.stringify(self.zones[zone].resolvers);
                        } else {
                            val = JSON.stringify(vmobj.resolvers);
                        }
                        returnit(null, val);
                        return;
                    });
                } else if (want === 'tmpfs'
                    && vmobj.hasOwnProperty('tmpfs')) {
                    // We want tmpfs to reload the cache right away because we
                    // might be depending on a /etc/vfstab update
                    self.updateZone(zone, {}, function (error) {
                        if (error) {
                            // updating our cache for this VM failed, so we'll
                            // use the existing data.
                            zlog.error({err: error, zone: zone},
                                'Failed to reload vmobj using cached values');
                        }
                        if (self.zones[zone]) {
                            val = JSON.stringify(self.zones[zone].tmpfs);
                        } else {
                            val = JSON.stringify(vmobj.tmpfs);
                        }
                        returnit(null, val);
                        return;
                    });
                } else if (want === 'routes'
                    && vmobj.hasOwnProperty('routes')) {

                    var vmRoutes = [];

                    /*
                     * Always reload the information about the zone, including
                     * its routes, so that the instance can have the most up to
                     * date information about them when it sets static routes.
                     * This should not have a significant performance impact
                     * since the sdc:routes metadata information is queried only
                     * once at boot time, and we don't expect users to query
                     * that information frequently. Using the last modified time
                     * of the zones cache to compare it with the last modified
                     * time of the routes.json zone configuration file would not
                     * allow us to determine when to use the cache and when to
                     * reload the zone's information because with node v0.10.x,
                     * which is the version used by vmadm, fs.stat's output
                     * resolution is 1 second. Any change to the routes
                     * information happening in the same second as the previous
                     * change to a zone configuration would not trigger a
                     * reload. We could write a binary add-on to handle that,
                     * but it seems it would introduce a lot of complexity for
                     * no significant benefit. Hopefully we can move to node
                     * v0.12.x or later at some point and rely on a better
                     * resolution for fs.*stat APIs.
                     */
                    self.updateZone(zone, {
                        forceReload: true
                    }, function (error) {
                        if (error) {
                            // updating our cache for this VM failed, so we'll
                            // use the existing data.
                            zlog.error({err: error, zone: zone},
                                'Failed to reload vmobj using cached values');
                        }

                        if (self.zones[zone]) {
                            vmobj = self.zones[zone];
                        }

                        // The notes above about resolvers also to routes. It's
                        // here solely for the use of mdata-fetch, and we need
                        // to do the updateZone here so that we have latest
                        // data.
                        for (var r in vmobj.routes) {
                            var route = { linklocal: false, dst: r };
                            var nicIdx = vmobj.routes[r].match(/nics\[(\d+)\]/);
                            if (!nicIdx) {
                                // Non link-local route: we have all the
                                // information we need already
                                route.gateway = vmobj.routes[r];
                                vmRoutes.push(route);
                                continue;
                            }
                            nicIdx = Number(nicIdx[1]);

                            // Link-local route: we need the IP of the local nic
                            if (!vmobj.hasOwnProperty('nics')
                                || !vmobj.nics[nicIdx]
                                || !vmobj.nics[nicIdx].hasOwnProperty('ip')
                                || vmobj.nics[nicIdx].ip === 'dhcp') {

                                continue;
                            }

                            route.gateway = vmobj.nics[nicIdx].ip;
                            route.linklocal = true;
                            vmRoutes.push(route);
                        }

                        returnit(null, JSON.stringify(vmRoutes));
                        return;
                    });
                } else if (want === 'operator-script') {
                    addMetadata(function (err) {
                        if (err) {
                            returnit(new Error('Unable to load metadata: '
                                + err.message));
                            return;
                        }

                        returnit(null,
                            vmobj.internal_metadata['operator-script']);
                        return;
                    });
                } else if (want === 'volumes') {
                    addMetadata(function returnVolumes(err) {
                        if (err) {
                            returnit(new Error('Unable to load metadata: '
                                + err.message));
                            return;
                        }

                        returnit(null,
                            vmobj.internal_metadata['sdc:volumes']);
                        return;
                    });
                } else {
                    addTags(function (err) {
                        if (!err) {
                            val = VM.flatten(vmobj, want);
                        }
                        returnit(err, val);
                        return;
                    });
                }
            } else {
                // not sdc:, so key will come from *_mdata
                addMetadata(function (err) {
                    var which_mdata = 'customer_metadata';

                    if (err) {
                        returnit(new Error('Unable to load metadata: '
                            + err.message));
                        return;
                    }

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
                });
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
            addMetadata(function (err) {
                var ckeys = [];
                var ikeys = [];

                if (err) {
                    returnit(new Error('Unable to load metadata: '
                        + err.message));
                    return;
                }

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
                return;
            });
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

        function addTags(cb) {
            var cbOpts = {timer: newTimer(), loadFile: 'tags'};
            var filename;

            filename = vmobj.zonepath + '/config/tags.json';
            fs.readFile(filename, function (err, file_data) {

                if (err && err.code === 'ENOENT') {
                    vmobj.tags = {};
                    _callCbAndLogTimer(cbOpts, null, cb);
                    return;
                }

                if (err) {
                    zlog.error({err: err}, 'failed to load tags.json: '
                        + err.message);
                    _callCbAndLogTimer(cbOpts, err, cb);
                    return;
                }

                try {
                    vmobj.tags = JSON.parse(file_data.toString());
                    _callCbAndLogTimer(cbOpts, null, cb);
                } catch (e) {
                    zlog.error({err: e}, 'unable to tags.json for ' + zone
                        + ': ' + e.message);
                    _callCbAndLogTimer(cbOpts, e, cb);
                }

                return;
            });
        }

        function addMetadata(cb) {
            var cbOpts = {timer: newTimer(), loadFile: 'metadata'};
            var filename;

            // If we got here, our answer comes from metadata so read that file.

            // NOTE: In the future, if the fs.readFile overhead here ends up
            // being larger than a stat would be, we might want to cache these
            // and reload only when mtime changes.
            //
            // Alternatively: when OS-2647 lands we might just use vminfod.

            filename = vmobj.zonepath + '/config/metadata.json';

            fs.readFile(filename, function (err, file_data) {
                var json = {};
                var mdata_types = [ 'customer_metadata', 'internal_metadata' ];

                // start w/ both empty, if we fail partway through there will
                // just be no metadata instead of wrong metadata.
                vmobj.customer_metadata = {};
                vmobj.internal_metadata = {};

                if (err && err.code === 'ENOENT') {
                    _callCbAndLogTimer(cbOpts, null, cb);
                    return;
                }

                if (err) {
                    zlog.error({err: err}, 'failed to load mdata.json: '
                        + err.message);
                    _callCbAndLogTimer(cbOpts, err, cb);
                    return;
                }

                try {
                    json = JSON.parse(file_data.toString());
                    mdata_types.forEach(function (mdata) {
                        if (json.hasOwnProperty(mdata)) {
                            vmobj[mdata] = json[mdata];
                        }
                    });
                    _callCbAndLogTimer(cbOpts, null, cb);
                } catch (e) {
                    zlog.error({err: e}, 'unable to load metadata.json for '
                        + zone + ': ' + e.message);
                    _callCbAndLogTimer(cbOpts, e, cb);
                }

                return;
            });
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
