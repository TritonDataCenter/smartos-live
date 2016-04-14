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
 * OVERVIEW
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
 *   - starts a Zwatch watcher that calls a callback whenever a VM is started or
 *     stopped.
 *
 * When a zone starts, it attempts to create an appropriate server on a socket
 * for the VM to serve the metadata protocol to the mdata tools inside the zone.
 * If the VM is a KVM VM, this means listening on the "ttyb" virtual serial port
 * of the VM. Otherwise it means creating a 'zsock' inside the zone and
 * listening on that.
 *
 * With a socket created and the server listening, the client in the zone can
 * make queries using the metadata protocol described at:
 *
 *    https://eng.joyent.com/mdata/protocol.html
 *
 * When a zone stops, metadata agent will close the server that it opened for
 * the stopped zone.
 *
 * If a recoverable error occurs during operation or during server creation and
 * the zone still exists, the creation of the socket will be retried on an
 * exponential backoff schedule with a delay up to MAX_RETRY seconds between
 * attempts. Once the delay reaches MAX_RETRY, it will no longer be incremented.
 *
 * When a zone is deleted, (no longer shows up in the list we're loading every 5
 * minutes) the global state objects for the VM are cleared.
 *
 * For debugging, there are several useful properties attached to the
 * MetadataAgent object. These can be pulled out of metadata agent cores to
 * provide visibility into the state.
 *
 */

var assert = require('/usr/node/node_modules/assert-plus');
var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var common = require('./common');
var crc32 = require('./crc32');
var execFile = require('child_process').execFile;
var fs = require('fs');
var guessHandleType = process.binding('tty_wrap').guessHandleType;
var net = require('net');
var path = require('path');
var util = require('util');
var vasync = require('vasync');
var VM  = require('/usr/vm/node_modules/VM');
var zsock = require('/usr/node/node_modules/zsock');
var zutil = require('/usr/node/node_modules/zutil');
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


var MetadataAgent = module.exports = function (options) {
    this.log = options.log;
    this.zlog = {};
    this.zones = {};
    this.zonesDebug = {};
    this.zoneRetryTimeouts = {};
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
 *               "msg": "Starting socket server",
 *               "time": 1455735290175 (2016 Feb 17 18:54:50),
 *               "v": 0,
 *           },
 *           ...
 *       ],
 *       "last_zsock_create_attempt": 1455735290176 (2016 Feb 17 18:54:50),
 *       "last_zsock_create_success": 1455735290804 (2016 Feb 17 18:54:50),
 *       "last_zsock_listen_success": 1455735290806 (2016 Feb 17 18:54:50),
 *       "last_zone_stop": undefined,
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

MetadataAgent.prototype.updateZone = function (zonename, callback) {
    var self = this;
    var log = self.log;

    function shouldLoad(cb) {
        if (!self.zones.hasOwnProperty(zonename)) {
            // don't have a cache, load this guy
            log.info('no cache for: ' + zonename + ', loading');
            cb(true);
            return;
        }

        // we do have a cached version, we'll reload only if timestamp changed.
        fs.stat('/etc/zones/' + zonename + '.xml', function (err, stats) {
            var old_mtime;

            if (err && err.code === 'ENOENT') {
                // VM has disappeared, purge from cache
                self.purgeZoneCache(zonename);
                cb(false);
                return;
            } else if (err) {
                // fail open when we can't stat
                log.error({err: err}, 'cannot fs.stat() ' + zonename);
                cb(true);
                return;
            }

            // we just did a successful stat, we really should have
            // self.zones[zonename]
            assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');

            old_mtime = (new Date(self.zones[zonename].last_modified));
            if (stats.mtime.getTime() > old_mtime.getTime()) {
                log.info('last_modified was updated, reloading: ' + zonename);
                cb(true);
                return;
            }

            log.debug('using cache for: ' + zonename);
            cb(false);
        });
    }

    shouldLoad(function (load) {
        if (load) {
            VM.lookup({ zonename: zonename }, { fields: sdc_fields },
                function (error, machines) {
                    if (!error) {
                        self.zones[zonename] = machines[0];
                        self.addDebug(zonename, 'last_zone_load');
                    }
                    log.trace({zone: zonename, err: error},
                        'finished VM.lookup');
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

            if (zone.brand === 'kvm') {
                self.startKVMSocketServer(zone.zonename, function (err) {
                    cb();
                });
            } else {
                self.startZoneSocketServer(zone.zonename, function (err) {
                    cb();
                });
            }
        }, function (err) {
            self.log.info('Created zone metadata sockets on ' + zones.length
                + ' zones');
        });
    });
};

MetadataAgent.prototype.purgeZoneCache = function purgeZoneCache(zonename) {
    assert.string(zonename);

    var self = this;

    self.log.info(zonename + ' no longer exists, purging from cache(s) and '
        + 'stopping timeout');

    if (self.zoneRetryTimeouts.hasOwnProperty(zonename)) {
        clearTimeout(self.zoneRetryTimeouts[zonename]);
        delete self.zoneRetryTimeouts[zonename];
    }
    if (self.zonesDebug.hasOwnProperty(zonename)) {
        delete self.zonesDebug[zonename];
    }
    if (self.zlog.hasOwnProperty(zonename)) {
        delete self.zlog[zonename];
    }
    if (self.zoneConnections.hasOwnProperty(zonename)) {
        delete self.zoneConnections[zonename];
    }
    if (self.zones.hasOwnProperty(zonename)) {
        delete self.zones[zonename];
    }
};

MetadataAgent.prototype.startDeletedZonesPurger = function () {
    var cmd = '/usr/sbin/zoneadm';
    var self = this;

    // Every 5 minutes we check to see whether zones we've got in self.zones
    // were deleted. If they are, we delete the record from the cache.
    setInterval(function () {
        execFile(cmd, ['list', '-c'], function (err, stdout, stderr) {
            var zones = {};
            if (err) {
                self.log.error({err: err}, 'unable to get list of zones');
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
            stdout.split(/\n/).forEach(function (z) {
                zones[z] = true;
            });
            Object.keys(self.zones).forEach(function (z) {
                if (!zones.hasOwnProperty(z)) {
                    self.purgeZoneCache(z);
                }
            });
        });
    }, (5 * 60 * 1000));

    self.log.info('Setup interval to purge deleted zones.');
};

MetadataAgent.prototype.start = function () {
    var self = this;
    var zwatch = this.zwatch = new ZWatch(self.log);
    self.createServersOnExistingZones();
    self.startDeletedZonesPurger();

    zwatch.on('zone_transition', function (msg) {

        // ignore unknown transitions
        if (['start', 'stop'].indexOf(msg.cmd) === -1) {
            return;
        }

        zoneExists(msg.zonename, function _zoneExists(_, exists) {
            if (!exists) {
                self.log.warn({transition: msg}, 'ignoring transition for zone'
                    + 'that no longer exists');
                return;
            }
            self.log.trace({transition: msg}, 'saw zone transition');

            if (msg.cmd === 'start') {
                self.addDebug(msg.zonename, 'last_zone_start');
                self.updateZone(msg.zonename, function (error) {
                    if (error) {
                        self.log.error({err: error}, 'Error updating '
                            + 'attributes: ' + error.message);
                        return;
                    }

                    // If the zone was not deleted between the time we saw it
                    // start and now, (we did a vmadm lookup in between via
                    // updateZone) we'll start the watcher.
                    if (self.zones[msg.zonename]) {
                        if (!self.zlog[msg.zonename]) {
                            // create a logger specific to this VM
                            self.createZoneLog(self.zones[msg.zonename].brand,
                                msg.zonename);
                        }

                        if (self.zones[msg.zonename].brand === 'kvm') {
                            self.startKVMSocketServer(msg.zonename);
                        } else {
                            self.startZoneSocketServer(msg.zonename);
                        }
                    }
                });
            } else if (msg.cmd === 'stop') {
                self.addDebug(msg.zonename, 'last_zone_stop');
                if (self.zoneConnections[msg.zonename]) {
                    self.log.trace('saw zone ' + msg.zonename
                        + ' stop, calling end()');
                    self.zoneConnections[msg.zonename].end();
                }
            }
        });
    });
};

MetadataAgent.prototype.stop = function () {
    this.zwatch.stop();
};

MetadataAgent.prototype.startKVMSocketServer = function (zonename, callback) {
    var self = this;

    assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');
    assert.object(self.zlog[zonename], 'self.zlog[' + zonename + ']');

    var vmobj = self.zones[zonename];
    var zlog = self.zlog[zonename];
    var sockpath = path.join(vmobj.zonepath, '/root/tmp/vm.ttyb');

    zlog.info('Starting socket server');

    async.waterfall([
        function (cb) {
            common.retryUntil(2000, 120000,
                function (c) {
                    fs.exists(sockpath, function (exists) {
                        zlog.debug(sockpath + ' exists: ' + exists);
                        setTimeout(function () {
                            c(null, exists);
                        }, 1000);
                    });
                }, function (error) {
                    if (error) {
                        zlog.error({err: error}, 'Timed out waiting for '
                            + 'metadata socket');
                    } else {
                        zlog.debug('returning from startKVMSocketServer w/o '
                            + 'error');
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

function rtrim(str, chars) {
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

MetadataAgent.prototype.createKVMServer = function (zopts, callback) {
    var self = this;
    var zlog = self.zlog[zopts.zone];
    var kvmstream = new net.Stream();

    self.zoneConnections[zopts.zone] = {
        conn: new net.Stream(),
        done: null,
        end: function () {
            if (this.done) {
                return;
            }
            this.done = new Date();
            zlog.info('Closing kvm stream for ' + zopts.zone);
            kvmstream.end();
        }
    };

    var buffer = '';
    var handler = self.makeMetadataHandler(zopts.zone, kvmstream);

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

    kvmstream.connect(zopts.sockpath);
    callback();
};

MetadataAgent.prototype.startZoneSocketServer =
function (zonename, callback) {
    var self = this;

    assert.object(self.zones[zonename], 'self.zones[' + zonename + ']');
    assert.string(self.zones[zonename].brand,
        'self.zones[' + zonename + '].brand');
    assert.string(self.zones[zonename].zonepath,
        'self.zones[' + zonename + '].zonepath');

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

    zlog.info('Starting socket server');

    self.createZoneSocket(zopts, undefined, function _createZoneSocketCb(err) {
        if (err) {
            zlog.error({err: err}, 'Failed to create zone socket.');
        } else {
            zlog.info('Zone socket created.');
        }

        // We call callback here, but don't include the error if there was one,
        // because this is running in async.forEach and we don't want to fail
        // the others and there's nothing we can do to recover anyway. We'll
        // just leave it to self.createZoneSocket to schedule a retry.

        if (callback) {
            callback();
        }
    });
};

/*
 * waitSecs here indicates how long we should wait to retry after this attempt
 * if we fail.
 */
function attemptCreateZoneSocket(self, zopts, waitSecs) {
    assert.object(zopts, 'zopts');
    assert.string(zopts.path, 'zopts.path');
    assert.string(zopts.zone, 'zopts.zone');
    assert.string(zopts.zoneroot, 'zopts.zoneroot');

    var zlog = self.zlog[zopts.zone];

    if (!zlog) {
        // if there's no zone-specific logger, use the global one
        zlog = self.log;
    }

    if (!self.zones[zopts.zone]) {
        zlog.info('Zone %s no longer exists, not creating zsock', zopts.zone);
        return;
    }

    zlog.debug('attemptCreateZoneSocket(): zone: %s, wait: %d', zopts.zone,
        waitSecs);

    function _retryCreateZoneSocketLater() {
        if (self.zoneRetryTimeouts[zopts.zone]) {
            zlog.error('_retryCreateZoneSocketLater(): already have a retry '
                + 'running, not starting another one.');
            return;
        }

        zlog.info('Will retry zsock creation for %s in %d seconds',
            zopts.zone, waitSecs);

        self.zoneRetryTimeouts[zopts.zone] = setTimeout(function () {
            var nextRetry = waitSecs * 2;

            if (nextRetry > MAX_RETRY) {
                nextRetry = MAX_RETRY;
            }

            zlog.info('Retrying %s', zopts.zone);
            self.zoneRetryTimeouts[zopts.zone] = null;
            process.nextTick(function () {
                attemptCreateZoneSocket(self, zopts, nextRetry);
            });
        }, waitSecs * 1000);
    }

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
    function _ensureSockpathDirsExist(callback) {
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
                            zlog.debug({dir: dir, zone: zopts.zone, err: e},
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

    function _attemptCreate(callback) {
        _ensureSockpathDirsExist(function _ensureSockpathDirsExistCb(error) {
            if (error) {
                callback(error);
                return;
            }
            zsock.createZoneSocket(zopts, callback);
        });
    }

    self.addDebug(zopts.zone, 'last_zsock_create_attempt');
    _attemptCreate(function (error, fd) {
        var server;

        if (error) {
            zoneExists(zopts.zone, function _zoneExists(_, exists) {
                if (!exists) {
                    zlog.warn({err: error}, 'error creating socket and zone no '
                        + 'longer exists, not retrying');
                    return;
                }
                // If we get errors trying to create the zone socket, setup a
                // retry loop and return.
                zlog.error({err: error}, 'createZoneSocket error, %s seconds '
                    + 'before next attempt', waitSecs);
                _retryCreateZoneSocketLater();
                return;
            });
            return;
        }

        self.addDebug(zopts.zone, 'last_zsock_create_success');

        server = net.createServer(function (socket) {
            var handler = self.makeMetadataHandler(zopts.zone, socket);
            var buffer = '';

            zlog.trace('creating new server for FD ' + fd);

            socket.on('data', function (data) {
                var chunk, chunks;
                buffer += data.toString();
                chunks = buffer.split('\n');
                while (chunks.length > 1) {
                    chunk = chunks.shift();
                    handler(chunk);
                }
                buffer = chunks.pop();
            });

            socket.on('error', function (err) {
                zlog.error({err: err}, 'ZSocket error: ' + err.message);
                zlog.info('Attempting to recover; closing and recreating zone '
                    + 'socket and server.');
                try {
                    server.close();
                    socket.end();
                } catch (e) {
                    zlog.error({err: e}, 'Caught exception closing server: %s',
                        e.message);
                }
                _retryCreateZoneSocketLater();
                return;
            });
        });

        /*
         * When we create a new zoneConnections entry, we want to make sure if
         * there's an existing one (due to an error that we're retrying for
         * example) that we clear the existing one and its timeout before
         * creating a new one.
         */
        zlog.trace('creating new zoneConnections[' + zopts.zone + ']');
        if (self.zoneConnections[zopts.zone]
            && !self.zoneConnections[zopts.zone].done) {

            self.log.trace('creating new connection for ' + zopts.zone
                + ', but existing zoneConnection exists, calling end()');
            self.zoneConnections[zopts.zone].end();
        }

        self.zoneConnections[zopts.zone] = {
            conn: server,
            done: null,
            end: function () {
                if (self.zoneRetryTimeouts[zopts.zone]) {
                    // When .end() is called, want to stop any existing retries
                    clearTimeout(self.zoneRetryTimeouts[zopts.zone]);
                    self.zoneRetryTimeouts[zopts.zone] = null;
                }
                if (this.done) {
                    zlog.trace(zopts.zone + ' ' + fd + ' already done, not '
                        + 'closing again.');
                    return;
                }
                this.done = new Date();
                zlog.info('Closing server');
                try {
                    server.close();
                } catch (e) {
                    zlog.error({err: e}, 'Caught exception closing server: '
                        + e.message);
                }
            },
            fd: fd // so it's in the core for debugging
        };

        server.on('error', function (err) {
            zlog.error({err: err}, 'Zone socket error: %s', err.message);
            if (err.code === 'ENOTSOCK' || err.code === 'EBADF') {
                // the socket inside the zone went away,
                // likely due to resource constraints (ie: disk full)
                try {
                    server.close();
                } catch (e) {
                    zlog.error({err: e}, 'Caught exception closing server: '
                        + e.message);
                }
                // start the retry timer
                _retryCreateZoneSocketLater();
            } else if (err.code !== 'EINTR') {
                throw err;
            }
        });

        if (guessHandleType(fd) !== 'PIPE') {
            zlog.debug('fd %d is not a pipe, retry creating zone socket', fd);
            _retryCreateZoneSocketLater();
        } else {
            zlog.debug('listening on fd %d', fd);
            server.listen({fd: fd});
            self.addDebug(zopts.zone, 'last_zsock_listen_success');
        }
    });
}

MetadataAgent.prototype.createZoneSocket =
function (zopts, waitSecs, callback) {
    var self = this;
    waitSecs = waitSecs || 1;

    attemptCreateZoneSocket(self, zopts, waitSecs);

    if (callback) {
        callback();
    }
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
        var val;
        var vmobj;
        var want;
        var reqid;
        var req_is_v2 = false;

        parts = rtrim(data.toString()).replace(/\n$/, '')
            .match(/^([^\s]+)\s?(.*)/);

        if (!parts) {
            write('invalid command\n');
            return;
        }

        cmd = parts[1];
        want = parts[2];

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

            zlog.info('Serving GET ' + want);

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

            zlog.info('Serving DELETE ' + want);

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

            zlog.info('Serving PUT ' + key);
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

        function addTags(cb) {
            var filename;

            filename = vmobj.zonepath + '/config/tags.json';
            fs.readFile(filename, function (err, file_data) {

                if (err && err.code === 'ENOENT') {
                    vmobj.tags = {};
                    cb();
                    return;
                }

                if (err) {
                    zlog.error({err: err}, 'failed to load tags.json: '
                        + err.message);
                    cb(err);
                    return;
                }

                try {
                    vmobj.tags = JSON.parse(file_data.toString());
                    cb();
                } catch (e) {
                    zlog.error({err: e}, 'unable to tags.json for ' + zone
                        + ': ' + e.message);
                    cb(e);
                }

                return;
            });
        }

        function addMetadata(cb) {
            var filename;

            // If we got here, our answer comes from metadata.
            // XXX In the future, if the require overhead here ends up being
            // larger than a stat would be, we might want to cache these and
            // reload when mtime changes.

            filename = vmobj.zonepath + '/config/metadata.json';

            fs.readFile(filename, function (err, file_data) {
                var json = {};
                var mdata_types = [ 'customer_metadata', 'internal_metadata' ];

                // start w/ both empty, if we fail partway through there will
                // just be no metadata instead of wrong metadata.
                vmobj.customer_metadata = {};
                vmobj.internal_metadata = {};

                if (err && err.code === 'ENOENT') {
                    cb();
                    return;
                }

                if (err) {
                    zlog.error({err: err}, 'failed to load mdata.json: '
                        + err.message);
                    cb(err);
                    return;
                }

                try {
                    json = JSON.parse(file_data.toString());
                    mdata_types.forEach(function (mdata) {
                        if (json.hasOwnProperty(mdata)) {
                            vmobj[mdata] = json[mdata];
                        }
                    });
                    cb();
                } catch (e) {
                    zlog.error({err: e}, 'unable to load metadata.json for '
                        + zone + ': ' + e.message);
                    cb(e);
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

        function returnit(error, retval) {
            var towrite;

            if (error) {
                zlog.error(error.message);
                if (req_is_v2)
                    write(format_v2_response('FAILURE', error.message));
                else
                    write('FAILURE\n');
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
                return;
            } else if (!isNaN(retval)) {
                if (req_is_v2) {
                    write(format_v2_response('SUCCESS', retval.toString()));
                } else {
                    towrite = retval.toString().replace(/^\./mg, '..');
                    write('SUCCESS\n' + towrite + '\n.\n');
                }
                return;
            } else if (retval) {
                // Non-string value
                if (req_is_v2)
                    write(format_v2_response('FAILURE'));
                else
                    write('FAILURE\n');
                return;
            } else {
                // Nothing to return
                if (req_is_v2)
                    write(format_v2_response('NOTFOUND'));
                else
                    write('NOTFOUND\n');
                return;
            }
        }
    };
};
