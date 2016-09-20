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
 * Copyright (c) 2016, Joyent, Inc. All rights reserved.
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
 * For all non-KVM VMs we create a 'zsock' inside the zone and listen on that.
 * In non-LX zones, the zsock is created in
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
 *     try to create a new socket unless checkStaleSocket determines the socket
 *     is stale (based on the fs.stat signature).
 *
 *   * when a socket is determined to be stale, the zoneConnections[uuid] should
 *     be deleted.
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
 * minutes) the global state objects for the VM are cleared.
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
 *
 * # KNOWN ISSUES
 *
 * If many zones are created and deleted between ZONEADM_CHECK_FREQUENCY
 * intervals, it would be possible to have many stale sockets open which could
 * potentially run metadata out of filedescriptors. This should be recovered
 * when we do the next check and cleanup all the destroyed VM's sockets.
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
var zsock = require('/usr/node/node_modules/zsock');
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

/*
 * Takes a zoneConnections entry (or undefined) and an 'opts' object that
 * contains at least a 'log' property which is a bunyan logger, and then
 * calls callback with:
 *
 *  callback(<Error Object>);
 *
 *      - when there's an error w/ fs.stat() that's not ENOENT.
 *
 *  callback(null, false);
 *
 *      - when the conn entry has a sockpath that's still there.
 *
 *  callback(null, true);
 *
 *      - when the conn entry has a sockpath that's been removed or
 *        when the conn entry sockpath has a different fs.stat() signature
 *
 */
function checkStaleSocket(zoneConn, opts, callback) {
    assert.optionalObject(zoneConn, 'zoneConn');
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.func(callback, 'callback');

    if (!zoneConn || !zoneConn.sockpath) {
        // if there's no zoneConn, it can't be stale
        callback(null, false);
        return;
    }

    // Ensure these are the correct types.
    assert.string(zoneConn.sockpath, 'zoneConn.sockpath');
    assert.object(zoneConn.sockstat, 'zoneConn.sockstat');

    fs.stat(zoneConn.sockpath, function _onSockpathStat(err, stats) {
        var field;
        var fields = ['dev', 'ino']; // fields to compare in fs.Stats

        if (err) {
            if (err.code === 'ENOENT') {
                opts.log.trace({
                    sockpath: zoneConn.sockpath
                }, 'ENOENT on sockpath: stale');
                callback(null, true); // stale
                return;
            }
            callback(err);
            return;
        }

        // Check for changes in the fs.stat() signature since we created this
        // socket. If it has changed, that means our handle to it is stale and
        // we should recreate it.
        for (field = 0; field < fields.length; field++) {
            if (zoneConn.sockstat[fields[field]] !== stats[fields[field]]) {
                opts.log.debug({
                    field: fields[field],
                    sockpath: zoneConn.sockpath,
                    new_sockstat: stats,
                    old_sockstat: zoneConn.sockstat
                }, 'change in sockpath fs.stat signature: stale');
                callback(null, true); // stale
                return;
            }
        }
        if ((zoneConn.sockstat.ctime
            && zoneConn.sockstat.ctime.getTime()) !== stats.ctime.getTime()) {
            opts.log.debug({
                field: 'ctime',
                sockpath: zoneConn.sockpath,
                new_sockstat: stats,
                old_sockstat: zoneConn.sockstat
            }, 'change in sockpath fs.stat signature: stale');
            callback(null, true); // stale
            return;
        }

        // no error in stat, and no diff fields means exists: not stale
        opts.log.trace({
            sockpath: zoneConn.sockpath
        }, 'sockpath still exists and fs.stat signature matches: not stale');
        callback(null, false);
        return;
    });
}

/*
 * This function does an fs.stat() on the 'sockpath' of the zoneConn and
 * attaches the fs.Stats result to the 'zoneConn' object as .sockstat. If there
 * is an error with fs.stat() conn.sockstat will be set to an empty object.
 *
 * After the stat has completed, callback() will be called. Any error from
 * fs.stat() will be passed as the first and only argument to callback().
 */
function addConnSockStat(zoneConn, callback) {
    assert.object(zoneConn, 'zoneConn');
    assert.string(zoneConn.sockpath, 'zoneConn.sockpath');
    assert.func(callback, 'callback');

    fs.stat(zoneConn.sockpath, function _statSock(e, st) {
        if (e) {
            // If there was an error w/ the stat, it's most likely because
            // the state of the world has changed. We'll fill in sockstat
            // with an empty object here so that checkStaleSocket will report
            // this as stale.
            zoneConn.sockstat = {};
        } else {
            zoneConn.sockstat = st;
        }
        assert.object(zoneConn.sockstat, 'zoneConn.sockstat');
        callback(e);
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
 *       "last_zsock_create_attempt": 1455735290176 (2016 Feb 17 18:54:50),
 *       "last_zsock_create_success": 1455735290804 (2016 Feb 17 18:54:50),
 *       "last_zsock_listen_success": 1455735290806 (2016 Feb 17 18:54:50),
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

MetadataAgent.prototype.updateZone = function updateZone(zonename, callback) {
    var self = this;
    var log = self.log;

    assert.string(zonename, 'zonename');
    assert.func(callback, 'callback');

    function shouldLoad(cb) {
        if (!self.zones.hasOwnProperty(zonename)) {
            // don't have a cache, load this guy
            log.info({zonename: zonename},
                'no cache for: ' + zonename + ', loading');
            cb(null, true);
            return;
        }

        // We do have a cached version, we'll reload only if timestamp of the
        // XML file changed. The vmadm operations we care about will "touch"
        // this file to update the last_modified if they don't change it
        // directly.
        fs.stat('/etc/zones/' + zonename + '.xml', function (err, stats) {
            var old_mtime;

            if (err && err.code === 'ENOENT') {
                // VM has disappeared, purge from cache
                self.purgeZoneCache(zonename);
                cb(null, false);
                return;
            } else if (err) {
                log.error({err: err, zonename: zonename},
                    'cannot fs.stat(), reloading');
                cb(err);
                return;
            }

            // we just did a successful stat, we really should have
            // self.zones[zonename]
            assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');

            old_mtime = (new Date(self.zones[zonename].last_modified));
            if (stats.mtime.getTime() > old_mtime.getTime()) {
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

            if (zone.zone_state !== 'running') {
                self.log.debug('skipping zone ' + zone.zonename + ' which has '
                    + 'non-running zone_state: ' + zone.zone_state);
                cb();
                return;
            }

            if (error) {
                throw error;
            }

            if (!self.zlog[zone.zonename]) {
                // create a logger specific to this VM
                self.createZoneLog(zone.brand, zone.zonename);
            }

            // It is possible for VM.lookup() to take a long time. While we're
            // waiting for it, the watcher could have seen the zone start and
            // created a socket for the zone. In case that happened, we ignore
            // zones we've already got a connection for.
            if (self.zoneConnections[zone.zonename]) {
                cb();
                return;
            }

            if (zone.brand === 'kvm') {
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

MetadataAgent.prototype.checkMissedSysevents = function checkMissedSysevents() {
    var self = this;
    var start_kstat_timer = newTimer();

    getZoneinfo(null, {log: self.log}, function (err, results) {
        assert.ifError(err);

        function _assumeBooted(zonename) {
            self.addDebug(zonename, 'last_zone_found_running');
            self.handleZoneBoot(zonename);
        }

        self.log.debug({
            elapsed: elapsedTimer(start_kstat_timer),
            zoneCount: Object.keys(results).length
        }, 'loaded VM kstats');

        Object.keys(results).forEach(function (zonename) {
            var zoneConn = self.zoneConnections[zonename]; // may be undefined

            if (!zoneConn) {
                // If we have no zoneConn, It's likely we failed a previous
                // attempt to create one. In any case, since the zone does exist
                // (it's in getZoneinfo) we should attempt to create a new
                // socket for it.
                self.log.warn({zonename: zonename}, 'zone is missing '
                    + 'zoneConnections entry, (re)trying socket creation');
                _assumeBooted(zonename);
                return;
            }

            checkStaleSocket(zoneConn, {log: self.log}, function (e, isStale) {
                if (e) {
                    // This currently can only happen when fs.stat fails. We'll
                    // just have to assume the socket is not stale if we can't
                    // prove it is. We'll try again next interval.
                    self.log.error({err: e, zonename: zonename},
                        'unable to check for existence of socket');
                } else if (isStale)  {
                    self.log.debug({zonename: zonename}, 'stale socket detected'
                        + ' cleaning up');

                    if (self.zoneConnections[zonename]) {
                        // not undefined so attempt to close
                        closeZoneConnection(self.zoneConnections[zonename]);
                    }
                    delete self.zoneConnections[zonename];
                    _assumeBooted(zonename);
                } else if (!self.zones[zonename]) {
                    self.log.warn({zonename: zonename},
                        'zone is running, but we had no record. Probably lost '
                        + 'or delayed sysevent.');
                    _assumeBooted(zonename);
                }
            });
        });
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

MetadataAgent.prototype.handleZoneBoot = function handleZoneBoot(zonename) {
    assert.string(zonename, 'zonename');
    var self = this;

    // We don't wait around for results from creating the sockets because on
    // failure self.startKVMSocketServer or self.startZoneSocketServer should
    // leave us in a place we can retry on the next periodic check. So we just
    // pass this dummy callback instead.
    function _dummyCb() {
    }

    self.updateZone(zonename, function (error) {
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

MetadataAgent.prototype.start = function () {
    var self = this;
    var zwatch = this.zwatch = new ZWatch(self.log);
    self.createServersOnExistingZones();
    self.startPeriodicChecks();

    zwatch.on('zone_transition', function (msg) {
        var zoneConn = self.zoneConnections[msg.zonename];
        var when = new Date(msg.when / 1000000);

        // ignore everything except start
        if (msg.cmd !== 'start') {
            return;
        }

        checkStaleSocket(zoneConn, {log: self.log}, function (e, isStale) {
            if (e) {
                // This currently can only happen when fs.stat fails. We'll
                // just have to assume the socket is not stale if we can't
                // prove it is. We'll try again next interval.
                self.log.error({err: e, zonename: msg.zonename},
                    'unable to check for existence of socket');
            } else if (isStale)  {
                self.log.debug({zonename: msg.zonename},
                    'stale socket detected cleaning up');
                if (self.zoneConnections[msg.zonename]) {
                    // not undefined so attempt to close
                    closeZoneConnection(self.zoneConnections[msg.zonename]);
                }
                delete self.zoneConnections[msg.zonename];
            }

            // ignore zones we've already (still) got a connection for
            if (self.zoneConnections[msg.zonename]) {
                return;
            }

            self.log.debug({
                delay: (new Date()).getTime() - when.getTime(), // in ms
                when: when,
                zonename: msg.zonename
            }, 'ZWatch watcher saw zone start');

            zoneExists(msg.zonename, function _zoneExists(_, exists) {

                if (!exists) {
                    self.log.warn({transition: msg},
                        'ignoring transition for zone that no longer exists');
                    return;
                }

                // we only handle start, so that's what this was
                self.addDebug(msg.zonename, 'last_zone_start');
                self.handleZoneBoot(msg.zonename);
            });
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
    var zlog = self.zlog[zonename];
    var sockpath = path.join(vmobj.zonepath, '/root/tmp/vm.ttyb');

    zlog.trace('starting socket server');

    async.waterfall([
        function (cb) {
            common.retryUntil(2000, 120000,
                function (c) {
                    fs.exists(sockpath, function (exists) {
                        if (!exists) {
                            zlog.warn(sockpath + ' does not exist');
                        }
                        setTimeout(function () {
                            c(null, exists);
                        }, 1000);
                    });
                }, function (error) {
                    if (error) {
                        zlog.error({err: error}, 'Timed out waiting for '
                            + 'metadata socket');
                    }
                    cb(error);
                }
            );
        }
    ], function (error) {
        var zopts = { zone: zonename, sockpath: sockpath };
        self.createKVMServer(zopts, function () {
            if (callback) {
                callback();
            }
        });
    });
};

MetadataAgent.prototype.createKVMServer = function (zopts, callback) {
    var self = this;
    var buffer;
    var fd;
    var handler;
    var kvmstream;
    var zlog;

    assert.object(zopts, 'zopts');
    assert.string(zopts.sockpath, 'zopts.sockpath');
    assert.string(zopts.zone, 'zopts.zone');
    assert.func(callback, 'callback');

    zlog = self.zlog[zopts.zone];

    // Ignore zones we've already got a connection for and then immediately
    // create an entry if we don't. To act as a mutex.
    if (self.zoneConnections[zopts.zone]) {
        zlog.trace({zonename: zopts.zone}, 'already have zoneConnections[] for '
            + 'zone -- not replacing.');
        callback();
        return;
    }
    self.zoneConnections[zopts.zone] = {};

    kvmstream = new net.Socket();

    // refuse to overwrite an existing connection
    assert.ok(!self.zoneConnections[zopts.zone].hasOwnProperty('conn'),
        'should not have existing conn when creating new');
    assert.ok(!self.zoneConnections[zopts.zone].hasOwnProperty('serverSocket'),
        'should not have existing serverSocket when creating new');

    // replace the placeholder entry with a real one.
    self.zoneConnections[zopts.zone] = {
        conn: kvmstream,
        sockpath: zopts.sockpath,
        sockstat: {}
    };

    buffer = '';
    handler = self.makeMetadataHandler(zopts.zone, kvmstream);

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
        zlog.error({err: e}, 'KVM Socket error: ' + e.message);
    });

    kvmstream.on('close', function () {
        // When the stream closes, we'll delete from zoneConnections so that on
        // next boot (or periodic scan if for some reason we got closed while
        // the zone was actually running) we re-create.
        zlog.info('stream closed on fd %d', fd);
        delete self.zoneConnections[zopts.zone];
    });

    kvmstream.connect(zopts.sockpath);

    fd = kvmstream._handle.fd;
    zlog.info('listening on fd %d', fd);
    self.zoneConnections[zopts.zone].fd = fd;

    addConnSockStat(self.zoneConnections[zopts.zone], callback);
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

    var zlog = self.zlog[zonename];
    var zonePath = self.zones[zonename].zonepath;
    var localpath = '/.zonecontrol';
    var zopts;

    if (self.zones[zonename].brand === 'lx') {
        localpath = '/native' + localpath;
    }

    zopts = {
        path: path.join(localpath, 'metadata.sock'),
        zone: zonename,
        zoneroot: path.join(zonePath, 'root')
    };

    zlog.trace('starting socket server');

    self.createZoneSocket(zopts, callback);
};

/*
 * This tries to make sure that the directories in:
 *
 *  path.dirname(path.join(zopts.zoneroot, zopts.path))
 *
 * exist or are created. It then calls callback().
 *
 * If the directories all exist or were created, the callback is called with
 * no arguments.
 *
 * If we were unable to create or check the directory, callback() will be
 * called with an error object indicating what the problem was.
 *
 */
function _ensureSockpathDirsExist(zopts, log, callback) {
    assert.object(zopts, 'zopts');
    assert.string(zopts.path, 'zopts.path');
    assert.string(zopts.zoneroot, 'zopts.zoneroot');
    assert.object(log, 'log');
    assert.func(callback, 'callback');

    var d;
    var dirs = [];
    var sockdir = path.dirname(path.join(zopts.zoneroot, zopts.path));
    var zoneroot = zopts.zoneroot;

    function _ensureDir(dir, cb) {
        fs.stat(dir, function _statDirCb(err, stats) {
            var newErr;

            if (err) {
                if (err.code === 'ENOENT') {
                    // does not exist, so create it.
                    fs.mkdir(dir, parseInt('700', 8), function _mkdirCb(e) {
                        log.debug({dir: dir, zone: zopts.zone, err: e},
                            'attempted fs.mkdir()');
                        cb(e);
                    });
                } else {
                    cb(err);
                }
                return;
            }

            if (!stats.isDirectory()) {
                newErr = new Error(dir + ' is not a directory');
                newErr.code = 'ENOTDIR';
                cb(newErr);
                return;
            }

            cb(); // exists and is a directory
        });
    }

    /*
     * We need to check all the directories below zoneroot to ensure there
     * are no symlinks or other shenanigans going on since we're running in
     * the GZ and they'd be evaluated there.
     *
     * So we build an array that looks like:
     *
     *  [
     *     '<zoneroot>/foo/bar',
     *     '<zoneroot>/foo'
     *  ]
     *
     * and then attempt to ensure each component exists.
     */
    d = sockdir;
    while (d.length > zoneroot.length) {
        dirs.push(d);
        d = path.dirname(d);
    }

    assert.ok(dirs.length > 0, 'should have at least one dir');

    vasync.forEachPipeline({
        inputs: dirs,
        func: _ensureDir
    }, callback);
}

MetadataAgent.prototype.createZoneSocket =
function createZoneSocket(zopts, callback) {
    var self = this;
    var server;

    assert.object(zopts, 'zopts');
    assert.string(zopts.path, 'zopts.path');
    assert.string(zopts.zone, 'zopts.zone');
    assert.string(zopts.zoneroot, 'zopts.zoneroot');
    assert.func(callback, 'callback');

    var zlog = self.zlog[zopts.zone];

    if (!zlog) {
        // if there's no zone-specific logger, use the global one
        zlog = self.log;
    }

    if (!self.zones[zopts.zone]) {
        zlog.info({zonename: zopts.zone},
            'zone no longer exists, not creating zsock');
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

    self.addDebug(zopts.zone, 'last_zsock_create_attempt');
    _ensureSockpathDirsExist(zopts, zlog, function _ensureDirsExistCb(error) {
        if (error) {
            self.addDebug(zopts.zone, 'last_zsock_create_failure', error);

            zlog.warn({zonename: zopts.zone, err: error},
                'failed to create sockpath directory');

            // We were unable to create the directory but we have not yet
            // created a real self.zoneConnections entry so we can just delete
            // the placeholder and call callback. If the VM still exists and
            // is running, we'll try again when we next poll w/
            // _checkNewZones().
            delete self.zoneConnections[zopts.zone];
            callback(error);
            return;
        }

        zsock.createZoneSocket(zopts, function _onCreateZsock(sockErr, fd) {
            var zsockErr = sockErr;
            var handleType;
            var handleFd;

            // If zsock gave us a bogus handle, we don't know what to do with
            // that so we'll consider it an error. This is usually a bug in
            // zsock so the warn message we output here will help us determine
            // when these have been fixed. Since we do this only when
            // zsock.createZoneSocket claims success, we also keep the fd for
            // logging if it's bogus.
            if (!zsockErr) {
                handleFd = fd;
                handleType = guessHandleType(fd);
                if (handleType !== 'PIPE') {
                    zsockErr = new Error('zsock FD must be a pipe (got '
                        + handleType + ')');
                }
            }

            if (zsockErr) {
                self.addDebug(zopts.zone, 'last_zsock_create_failure',
                    zsockErr);

                zlog.warn({
                    zonename: zopts.zone,
                    err: zsockErr,
                    fd: handleFd,
                    handleType: handleType
                }, 'failed to create zsock');

                // We were unable to create a zsock, but as with a directory
                // creation error we've not created a real self.zoneConnections
                // entry yet so we'll delete the placeholder and let the
                // _checkNewZones() catch it on the next go-round.
                delete self.zoneConnections[zopts.zone];
                callback(zsockErr);
                return;
            }

            self.addDebug(zopts.zone, 'last_zsock_create_success');

            server = net.createServer(function (socket) {
                var buffer = '';
                var handler = self.makeMetadataHandler(zopts.zone, socket);

                zlog.trace('new connection on fd ' + fd);

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
                    zlog.error({err: err}, 'ZSocket error');
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
                fd: fd, // so it's in the core for debugging
                sockpath: path.join(zopts.zoneroot, zopts.path),
                sockstat: {}
            };

            server.on('error', function (err) {
                zlog.error({err: err}, 'Zone socket error: %s', err.message);
                if (err.code === 'ENOTSOCK' || err.code === 'EBADF') {
                    // The socket inside the zone went away, likely due to
                    // resource constraints (ie: disk full)
                    try {
                        server.close();
                    } catch (e) {
                        zlog.error({err: e}, 'Caught exception closing server: '
                            + e.message);
                    }
                    // remove the connection so we'll create a new one
                    delete self.zoneConnections[zopts.zone];
                } else if (err.code !== 'EINTR') {
                    // We really don't know what this is, so dump a core so we
                    // can investigate.
                    throw err;
                }
            });

            server.on('close', function () {
                // If the stream closes, we'll delete from zoneConnections so
                // that on next boot (or periodic scan if for some reason we got
                // closed while the zone was actually running) we re-create.
                zlog.info('stream closed on fd %d', fd);
                delete self.zoneConnections[zopts.zone];
            });

            server.listen({fd: fd});
            zlog.info('listening on fd %d', fd);
            self.addDebug(zopts.zone, 'last_zsock_listen_success');

            addConnSockStat(self.zoneConnections[zopts.zone], callback);
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
    var zlog = self.zlog[zone];
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
                    self.updateZone(zone, function (error) {
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
                    self.updateZone(zone, function (error) {
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
                    self.updateZone(zone, function (error) {
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

                    self.updateZone(zone, function (error) {
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
