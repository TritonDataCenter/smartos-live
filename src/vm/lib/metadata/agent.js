// vim: set ts=4 sts=4 sw=4 et:
var VM  = require('/usr/vm/node_modules/VM');
var ZWatch = require('./zwatch');
var common = require('./common');
var crc32 = require('./crc32');
var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var net = require('net');
var path = require('path');
var util = require('util');
var zsock = require('/usr/node/node_modules/zsock');
var zutil = require('/usr/node/node_modules/zutil');

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
    'zonename'
];

var MetadataAgent = module.exports = function (options) {
    this.log = options.log;
    this.zlog = {};
    this.zones = {};
    this.zoneConnections = {};
};

MetadataAgent.prototype.createZoneLog = function (type, zonename) {
    var self = this;
    self.zlog[zonename] = self.log.child({brand: type, 'zonename': zonename});
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

            if (err) {
                // fail open when we can't stat
                log.error({err: err}, 'cannot fs.stat() ' + zonename);
                cb(true);
                return;
            }

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
                    self.zones[zonename] = machines[0];
                    callback();
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

            if (zone.state !== 'running') {
                self.log.debug('skipping zone ' + zone.zonename + ' which has '
                    + 'non-running state: ' + zone.state);
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
                    self.log.info(z + ' no longer exists, purging from cache');
                    delete self.zones[z];
                    if (self.zlog.hasOwnProperty(z)) {
                        delete self.zlog[z];
                    }
                }
            });
        });
    }, (5 * 60 * 1000));

    self.log.info('Setup interval to purge deleted zones.');
};

MetadataAgent.prototype.start = function () {
    var self = this;
    var zwatch = this.zwatch = new ZWatch();
    self.createServersOnExistingZones();
    self.startDeletedZonesPurger();

    zwatch.on('zone_transition', function (msg) {
        if (msg.cmd === 'start') {
            self.updateZone(msg.zonename, function (error) {
                if (error) {
                    self.log.error({err: error}, 'Error updating attributes: '
                        + error.message);
                    return;
                }
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
            });
        } else if (msg.cmd === 'stop') {
            if (self.zoneConnections[msg.zonename]) {
                self.zoneConnections[msg.zonename].end();
            }
        }
    });

    zwatch.start(self.log);
};

MetadataAgent.prototype.stop = function () {
    this.zwatch.stop();
};

MetadataAgent.prototype.startKVMSocketServer = function (zonename, callback) {
    var self = this;
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
        done: false,
        end: function () {
            if (this.done) {
                return;
            }
            this.done = true;
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
    var zlog = self.zlog[zonename];
    var zonePath = self.zones[zonename].zonepath;
    var localpath = '/.zonecontrol';
    var zonecontrolpath = path.join(zonePath, 'root', localpath);

    zlog.info('Starting socket server');

    function ensureZonecontrolExists(cb) {
        fs.exists(zonecontrolpath, function (exists) {
            if (exists)  {
                cb();
                return;
            } else {
                fs.mkdir(zonecontrolpath, parseInt('700', 8), function (error) {
                    cb(error);
                });
            }
        });
    }

    ensureZonecontrolExists(function (err) {
        var sockpath = path.join(localpath, 'metadata.sock');
        var zopts = {
            zone: zonename,
            path: sockpath
        };

        if (err) {
            callback({err: err}, 'unable to create ' + zonecontrolpath);
            return;
        }

        self.createZoneSocket(zopts, function (createErr) {
            if (createErr) {
                // We call callback here, but don't include the error because
                // this is running in async.forEach and we don't want to fail
                // the others and there's nothing we can do to recover anyway.
                if (callback) {
                    callback();
                }
                return;
            }

            zlog.info('Zone socket created.');

            if (callback) {
                callback();
            }
        });
    });
};

MetadataAgent.prototype.createZoneSocket =
function (zopts, callback, waitSecs) {
    var self = this;
    var zlog = self.zlog[zopts.zone];
    waitSecs = waitSecs || 1;

    zsock.createZoneSocket(zopts, function (error, fd) {
        if (error) {
            // If we get errors trying to create the zone socket, wait and then
            // keep retrying.
            waitSecs = waitSecs * 2;
            zlog.error(
                { err: error },
                'createZoneSocket error, %s seconds before next attempt',
                waitSecs);
            setTimeout(function () {
                self.createZoneSocket(zopts, function () {}, waitSecs);
            }, waitSecs * 1000);
            return;
        }

        var server = net.createServer(function (socket) {
            var handler = self.makeMetadataHandler(zopts.zone, socket);
            var buffer = '';
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
                } catch (e) {
                    zlog.error({err: e}, 'Caught exception closing server: '
                        + e.message);
                }

                socket.end();
                self.createZoneSocket(zopts);
            });
        });

        self.zoneConnections[zopts.zone] = {
            conn: server,
            done: false,
            end: function () {
                if (this.done) {
                    return;
                }
                this.done = true;
                zlog.info('Closing server');
                server.close();
            }
        };

        server.on('error', function (e) {
            zlog.error({err: e}, 'Zone socket error: ' + e.message);
            if (e.code !== 'EINTR') {
                throw e;
            }
        });
        var Pipe = process.binding('pipe_wrap').Pipe;
        var p = new Pipe(true);
        p.open(fd);
        p.readable = p.writable = true;
        server._handle = p;

        server.listen();
    });

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

MetadataAgent.prototype.makeMetadataHandler = function (zone, socket) {
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

    return function (data) {
        var cmd;
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
                    val = JSON.stringify(vmobj.nics);
                    returnit(null, val);
                    return;
                } else if (want === 'resolvers'
                    && vmobj.hasOwnProperty('resolvers')) {

                    // resolvers and routes are special because we might reload
                    // metadata trying to get the new ones w/o zone reboot. To
                    // ensure these are fresh we always run updateZone which
                    // reloads the data if stale.
                    self.updateZone(zone, function () {
                        // See NOTE above about nics, same applies to resolvers.
                        // It's here solely for the use of mdata-fetch.
                        val = JSON.stringify(self.zones[zone].resolvers);
                        returnit(null, val);
                        return;
                    });
                } else if (want === 'routes'
                    && vmobj.hasOwnProperty('routes')) {

                    var vmRoutes = [];

                    self.updateZone(zone, function () {

                        vmobj = self.zones[zone];

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

                // *_pw$ keys come from internal_metadata, everything else comes
                // from customer_metadata
                ckeys = Object.keys(vmobj.customer_metadata)
                    .filter(function (k) {

                    return (!k.match(/_pw$/));
                });
                ikeys = Object.keys(vmobj.internal_metadata)
                    .filter(function (k) {

                    return (k.match(/_pw$/));
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
