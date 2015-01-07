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
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */
var assert = require('assert');
var VM  = require('/usr/vm/node_modules/VM');
var common = require('./common');
var crc32 = require('./crc32');
var async = require('/usr/node/node_modules/async');
var zsock = require('/usr/node/node_modules/zsock');
var http = require('http');
var fs = require('fs');
var net = require('net');

var MAX_RETRY = 300; // in seconds

var MetadataAgent = module.exports = function (options) {
    var self = this;

    self.log = options.log;
    self.zlog = {};
    self.vmobjs = {};
    self.zoneRetryTimeouts = {};
    self.zoneConnections = {};
    self.eventConnectAttempts = 0;

    // set default refresh interval
    if (options.hasOwnProperty('refresh_interval')) {
        self.refresh_interval = options.refresh_interval;
    } else {
        self.refresh_interval = 300000; // 5 minutes
    }

    self.createZoneLog = function (type, zonename) {
        var opts = {brand: type, 'zonename': zonename};
        self.zlog[zonename] = self.log.child(opts);
        return (self.zlog[zonename]);
    };

    function startKVMSocketServer(zonename, callback) {
        var vmobj = self.vmobjs[zonename];
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
            createKVMServer(zopts, function () {
                if (callback) {
                    callback();
                }
            });
        });
    }

    function createKVMServer(zopts, callback) {
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
        var handler = makeMetadataHandler(zopts.zone, kvmstream);

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
    }

    function startZoneSocketServer(zonename, callback) {
        var zlog = self.zlog[zonename];
        var zonePath = self.vmobjs[zonename].zonepath;
        var localpath = '/.zonecontrol';
        var zonecontrolpath;

        if (self.vmobjs[zonename].brand === 'lx') {
            localpath = '/native' + localpath;
        }

        zonecontrolpath = path.join(zonePath, 'root', localpath);

        zlog.info('Starting socket server');

        function ensureZonecontrolExists(cb) {
            fs.exists(zonecontrolpath, function (exists) {
                if (exists)  {
                    cb();
                    return;
                } else {
                    fs.mkdir(zonecontrolpath, parseInt('700', 8), 
                        function (error) {
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

            createZoneSocket(zopts, undefined, function (createErr) {
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
    }

    function createZoneSocket(zopts, waitSecs, callback) {
        waitSecs = waitSecs || 1;

        attemptCreateZoneSocket(zopts, waitSecs);

        if (callback) {
            callback();
        }
    }

    /*
     * waitSecs here indicates how long we should wait to retry after this attempt
     * if we fail.
     */
    function attemptCreateZoneSocket(zopts, waitSecs) {
        var zlog = self.zlog[zopts.zone];

        if (!zlog) {
            // if there's no zone-specific logger, use the global one
            zlog = self.log;
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
                    attemptCreateZoneSocket(zopts, nextRetry);
                });
            }, waitSecs * 1000);
        }

        zsock.createZoneSocket(zopts, function (error, fd) {
            var server;

            if (error) {
                // If we get errors trying to create the zone socket, setup a retry
                // loop and return.
                zlog.error({err: error}, 'createZoneSocket error, %s seconds before'
                    + ' next attempt', waitSecs);
                _retryCreateZoneSocketLater();
                return;
            }

            server = net.createServer(function (socket) {
                var handler = makeMetadataHandler(zopts.zone, socket);
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
                done: false,
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
                    this.done = true;
                    zlog.info('Closing server');
                    try {
                        server.close();
                    } catch (e) {
                        zlog.error({err: e}, 'Caught exception closing server: '
                            + e.message);
                    }
                }
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

            var Pipe = process.binding('pipe_wrap').Pipe;
            var p = new Pipe(true);
            p.open(fd);
            p.readable = p.writable = true;
            server._handle = p;

            server.listen();
        });
    }

    function rtrim(str, chars) {
        chars = chars || '\\s';
        str = str || '';
        return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
    }

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

    function makeMetadataHandler(zone, socket) {
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

            vmobj = self.vmobjs[zone];

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

                        // See NOTE above about nics, same applies to resolvers.
                        // It's here solely for the use of mdata-fetch.
                        val = JSON.stringify(vmobj.resolvers);
                        returnit(null, val);
                        return;
                    } else if (want === 'tmpfs'
                        && vmobj.hasOwnProperty('tmpfs')) {
                        val = JSON.stringify(vmobjs.tmpfs);
                        returnit(null, val);
                        return;
                    } else if (want === 'routes'
                        && vmobj.hasOwnProperty('routes')) {

                        var vmRoutes = [];

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
                    } else if (want === 'operator-script') {
                        returnit(null,
                            vmobj.internal_metadata['operator-script']);
                        return;
                    } else {
                        val = VM.flatten(vmobj, want);
                        returnit(err, val);
                    }
                } else {
                    // not sdc:, so key will come from *_mdata
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
                return;
            } else {
                zlog.error('Unknown command ' + cmd);
                returnit(new Error('Unknown command ' + cmd));
                return;
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

    self.initQueue = function (callback) {
        self.queue = async.queue(function (task, callback) {
            switch (task.type) {
            case 'create':
                console.log('CREATE');
                self.vmobjs[task.zonename] = task.vm;
                self.createZoneLog(task.vm.brand, task.zonename);
                // start server
                break;
            case 'modify':
                console.log('MODIFY');
                self.vmobjs[task.zonename] = task.vm;
                break;
            case 'delete':
                console.log('DELETE');
                // stop server
                delete (self.zlog)[task.zonename];
                delete (self.vmobjs)[task.zonename];
                break;
            }
            callback();
        }, 10);
        callback();
    };

    self.startEvents = function (callback) {
        self.eventConnectAttempts += 1;

        var opts = {host: '127.0.0.1', port: 9090, path: '/events'};
        http.get(opts, function (res) {
            // reset connect attempts
            self.eventConnectAttempts = 0;
            // all of our chunks should be JSON
            res.setEncoding('utf8');
            // let this connection stay open forever
            res.connection.setTimeout(0);

            var body = '';

            res.on('data', function (data) {
                var chunk;
                var chunks;

                body += data.toString();
                chunks = body.split('\n');

                while (chunks.length > 1) {
                    chunk = chunks.shift();
                    self.queue.push(JSON.parse(chunk));
                }
                body = chunks.pop(); // remainder
            });

            res.on('end', function () {
                self.startEvents();
            });

            if (callback) {
                callback();
            }
        }).on('error', function (err) {
            self.log.debug('vminfod request failed: ' + err.message);

            if (self.eventConnectAttempts == 10) {
                self.log.error('vminfod event requests reached max attempts');
                throw new Error('Unable to subscribe to vminfod events');
            } else {
                // try again in 10 seconds
                setTimeout(function () {
                    self.startEvents(callback);
                }, 10000);
            }
        });
    };

    self.setVmobjs = function (callback) {
        var opts = {host: '127.0.0.1', port: 9090, path: '/vms'};
        http.get(opts, function (res) {
            var body = '';

            res.on('data', function (chunk) {
                body += chunk;
            });

            res.on('end', function () {
                if (res.statusCode === 200) {
                    try {
                        vmobjs = JSON.parse(body);
                        console.log('vmobjs: ' + JSON.stringify(vmobjs));
                    } catch (e) {
                        self.log.debug('failed to parse body from vminfod: '
                            + e.message);
                    }
                    callback();
                } else {
                    self.log.debug('vminfod response not usable: '
                        + res.statusCode);
                    callback();
                }
            });
        }).on('error', function (err) {
            self.log.debug('vminfod request failed: ' + err.message);
            callback();
        });
    };

    self.startServers = function (callback) {
        callback();
    };

    function reset(callback) {
        callback();
    }

    self.startTimers = function (callback) {
        setTimeout(function () {
            self.log.info('preparing to refresh data');
            reset(function (err) {
                self.startTimers();
            });
        }, self.refresh_interval);

        if (callback) {
            callback();
        }
    };

};

MetadataAgent.prototype.start = function (callback) {
    var self = this;

    async.series([
        // init queue
        function (cb) {
            self.initQueue(cb);
        },
        // pause queue
        function (cb) {
            self.queue.pause();
            cb();
        },
        // start vminfo event listener
        function (cb) {
            self.startEvents(cb);
        },
        // load vmobjs 
        function (cb) {
            self.setVmobjs(cb);
        },
        // start servers
        function (cb) {
            self.startServers(cb);
        },
        // resume queue
        function (cb) {
            self.queue.resume();
        },
        // start refresh timers
        function (cb) {
            self.startTimers(cb);
        }
    ], function (err) {
        if (callback) {
            callback();
        }
    });
}

MetadataAgent.prototype.stop = function (callback) {
    if (callback) {
        callback();
    }
}
