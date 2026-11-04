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
 * Copyright 2026 Edgecast Cloud LLC.
 *
 */

var bunyan = require('/usr/vm/node_modules/bunyan');
var ConsoleBroker =
    require('/usr/vm/node_modules/console_broker').ConsoleBroker;
var fs = require('fs');
var net = require('net');
var path = require('path');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var log = bunyan.createLogger({
    level: 'fatal',
    name: 'console-broker-test',
    stream: process.stderr
});

var TMPDIR = '/tmp/cbtest.' + process.pid;
var KVM_UUID = '2b5b5ac4-6a28-4f0a-9d3c-6a0d4c1d8f01';
var ZONE_UUID = '7a1e0b16-6a2d-4f8e-8f4c-1c9a54e0e702';
var backends = [];

function rmrf(p)
{
    var st;

    try {
        st = fs.lstatSync(p);
    } catch (_) {
        return;
    }
    if (st.isDirectory()) {
        fs.readdirSync(p).forEach(function (f) {
            rmrf(path.join(p, f));
        });
        fs.rmdirSync(p);
    } else {
        fs.unlinkSync(p);
    }
}

function kvmVm()
{
    return ({
        brand: 'kvm',
        uuid: KVM_UUID,
        zonename: KVM_UUID,
        zonepath: path.join(TMPDIR, KVM_UUID)
    });
}

function zoneVm(brand)
{
    return ({
        brand: brand || 'joyent',
        uuid: ZONE_UUID,
        zonename: ZONE_UUID,
        zonepath: path.join(TMPDIR, ZONE_UUID)
    });
}

/*
 * Fake qemu serial socket: echoes what it receives.
 */
function startKvmBackend(cb)
{
    var dir = path.join(TMPDIR, KVM_UUID, 'root', 'tmp');
    var sock = path.join(dir, 'vm.console');
    var server;

    fs.mkdirSync(path.join(TMPDIR, KVM_UUID));
    fs.mkdirSync(path.join(TMPDIR, KVM_UUID, 'root'));
    fs.mkdirSync(dir);
    server = net.createServer(function (c) {
        c.pipe(c);
    });
    backends.push(server);
    server.listen(sock, cb);
}

/*
 * Fake zoneadmd console socket. reply is what is written after the IDENT
 * line arrives, in a single write.
 */
function startZoneBackend(reply, cb)
{
    var sock = path.join(TMPDIR, ZONE_UUID + '.console_sock');
    var server;

    server = net.createServer(function (c) {
        var buf = '';

        c.on('data', function onIdent(d) {
            var idx;

            buf += d.toString();
            idx = buf.indexOf('\n');
            if (idx === -1) {
                return;
            }
            c.removeListener('data', onIdent);
            server.lastIdent = buf.slice(0, idx);
            c.write(reply);
            if (reply.indexOf('OK\n') === 0) {
                c.pipe(c);
            } else {
                c.end();
            }
        });
    });
    backends.push(server);
    server.listen(sock, cb);
}

function newBroker(opts)
{
    var o = {
        log: log,
        host: '127.0.0.1',
        zoneSockDir: TMPDIR
    };
    var k;

    for (k in (opts || {})) {
        o[k] = opts[k];
    }
    return (new ConsoleBroker(o));
}

/*
 * Connects to a ticket, sends line (the token unless given) and collects
 * everything received until close.
 */
function connect(ticket, line, onData, onClose)
{
    var c = net.connect(ticket.port, ticket.host);
    var got = '';

    c.on('connect', function () {
        c.write((line === undefined ? ticket.token : line) + '\n');
    });
    c.on('data', function (d) {
        got += d.toString();
        if (onData) {
            onData(got, c);
        }
    });
    c.on('error', function () {});
    c.on('close', function () {
        if (onClose) {
            onClose(got);
        }
    });
    return (c);
}

before(function (cb) {
    rmrf(TMPDIR);
    fs.mkdirSync(TMPDIR);
    cb();
});

after(function (cb) {
    backends.forEach(function (s) {
        try {
            s.close();
        } catch (_) {
            // already closed
        }
    });
    backends = [];
    rmrf(TMPDIR);
    cb();
});

test('kvm ticket relays serial console', function (t) {
    var broker = newBroker();

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            t.equal(ticket.type, 'serial');
            t.equal(ticket.host, '127.0.0.1');
            t.ok(/^[0-9a-f]{64}$/.test(ticket.token), 'token format');
            t.equal(ticket.expires_in, 30);

            connect(ticket, undefined, function (got, c) {
                if (got === 'OK\n') {
                    c.write('hello');
                } else if (got === 'OK\nhello') {
                    c.end();
                }
            }, function (got) {
                t.equal(got, 'OK\nhello');
                broker.close();
                t.done();
            });
        });
    });
});

test('zone handshake keeps output sent with OK', function (t) {
    var broker = newBroker();

    startZoneBackend('OK\nlogin: ', function () {
        broker.issue(zoneVm('lx'), function (err, ticket) {
            t.ifError(err);
            t.equal(ticket.type, 'zone');

            connect(ticket, undefined, function (got, c) {
                if (got === 'OK\nlogin: ') {
                    t.equal(backends[0].lastIdent, 'IDENT C 0');
                    c.end();
                }
            }, function (got) {
                t.equal(got, 'OK\nlogin: ');
                broker.close();
                t.done();
            });
        });
    });
});

test('bhyve console is reported as serial', function (t) {
    var broker = newBroker();

    broker.issue(zoneVm('bhyve'), function (err, ticket) {
        t.ifError(err);
        t.equal(ticket.type, 'serial');
        broker.close();
        t.done();
    });
});

test('zone console held by zlogin returns busy', function (t) {
    var broker = newBroker();

    startZoneBackend('4242\n', function () {
        broker.issue(zoneVm(), function (err, ticket) {
            t.ifError(err);
            connect(ticket, undefined, null, function (got) {
                t.equal(got, 'ERR busy\n');
                broker.close();
                t.done();
            });
        });
    });
});

test('missing console socket returns unavailable', function (t) {
    var broker = newBroker();

    broker.issue(zoneVm(), function (err, ticket) {
        t.ifError(err);
        connect(ticket, undefined, null, function (got) {
            t.equal(got, 'ERR console unavailable\n');
            broker.close();
            t.done();
        });
    });
});

test('bad token is rejected and ticket survives', function (t) {
    var broker = newBroker();

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            connect(ticket, new Array(65).join('0'), null, function (got) {
                t.equal(got, 'ERR invalid token\n');
                connect(ticket, undefined, function (got2, c) {
                    if (got2 === 'OK\n') {
                        c.end();
                    }
                }, function (got2) {
                    t.equal(got2, 'OK\n');
                    broker.close();
                    t.done();
                });
            });
        });
    });
});

test('token is single use', function (t) {
    var broker = newBroker();

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            // Keep a second ticket alive so the listener stays up.
            broker.issue(kvmVm(), function (err2) {
                t.ifError(err2);
                connect(ticket, undefined, function (got, c) {
                    if (got === 'OK\n') {
                        c.end();
                    }
                }, function () {
                    connect(ticket, undefined, null, function (got) {
                        t.equal(got, 'ERR invalid token\n');
                        broker.close();
                        t.done();
                    });
                });
            });
        });
    });
});

test('only one session per VM', function (t) {
    var broker = newBroker();

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, t1) {
            t.ifError(err);
            broker.issue(kvmVm(), function (err2, t2) {
                t.ifError(err2);
                var first = connect(t1, undefined, function (got) {
                    if (got !== 'OK\n') {
                        return;
                    }
                    connect(t2, undefined, null, function (got2) {
                        t.equal(got2, 'ERR busy\n');
                        first.end();
                    });
                }, function () {
                    broker.close();
                    t.done();
                });
            });
        });
    });
});

test('revoke ends an active session', function (t) {
    var broker = newBroker();

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            connect(ticket, undefined, function (got) {
                if (got === 'OK\n') {
                    broker.revoke(KVM_UUID);
                }
            }, function (got) {
                t.equal(got, 'OK\n');
                t.equal(Object.keys(broker.sessions).length, 0);
                broker.close();
                t.done();
            });
        });
    });
});

test('expired ticket stops the listener', function (t) {
    var broker = newBroker({ticketTtl: 50});

    broker.issue(kvmVm(), function (err, ticket) {
        t.ifError(err);
        t.ok(broker.server !== null, 'listening');
        setTimeout(function () {
            t.equal(broker.server, null, 'listener stopped');
            var c = net.connect(ticket.port, ticket.host);
            c.on('error', function (e) {
                t.equal(e.code, 'ECONNREFUSED');
                t.done();
            });
            c.on('connect', function () {
                t.ok(false, 'connect should fail');
                c.destroy();
                t.done();
            });
        }, 150);
    });
});

test('unauthenticated connection times out', function (t) {
    var broker = newBroker({authTimeout: 50});

    broker.issue(kvmVm(), function (err, ticket) {
        t.ifError(err);
        var c = net.connect(ticket.port, ticket.host);
        c.on('error', function () {});
        c.on('close', function () {
            setTimeout(function () {
                t.equal(broker.pendingCount, 0);
                broker.close();
                t.done();
            }, 20);
        });
    });
});

test('idle session times out', function (t) {
    var broker = newBroker({idleTimeout: 50});

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            connect(ticket, undefined, null, function (got) {
                t.equal(got, 'OK\n');
                t.equal(Object.keys(broker.sessions).length, 0);
                broker.close();
                t.done();
            });
        });
    });
});

test('docker and unknown brands are refused', function (t) {
    var broker = newBroker();
    var vm = zoneVm('lx');

    vm.docker = true;
    broker.issue(vm, function (err) {
        t.ok(err, 'docker refused');
        broker.issue({brand: 'builder', uuid: ZONE_UUID}, function (err2) {
            t.ok(err2, 'unknown brand refused');
            t.equal(broker.server, null, 'no listener started');
            t.done();
        });
    });
});

test('old tickets are dropped past the per-VM limit', function (t) {
    var broker = newBroker({maxTicketsPerVm: 2});
    var tokens = [];

    function issueN(n, cb) {
        if (n === 0) {
            cb();
            return;
        }
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            tokens.push(ticket);
            issueN(n - 1, cb);
        });
    }

    issueN(3, function () {
        t.equal(Object.keys(broker.tickets).length, 2);
        connect(tokens[0], undefined, null, function (got) {
            t.equal(got, 'ERR invalid token\n');
            broker.close();
            t.done();
        });
    });
});

test('pending connection does not keep the listener alive', function (t) {
    var broker = newBroker({ticketTtl: 50, authTimeout: 5000});

    broker.issue(kvmVm(), function (err, ticket) {
        t.ifError(err);
        var c = net.connect(ticket.port, ticket.host);
        c.on('error', function () {});
        c.on('close', function () {
            setTimeout(function () {
                t.equal(broker.server, null, 'listener stopped');
                t.equal(broker.pendingCount, 0);
                t.done();
            }, 20);
        });
    });
});

test('global ticket limit', function (t) {
    var broker = newBroker({maxTickets: 1});

    broker.issue(kvmVm(), function (err) {
        t.ifError(err);
        broker.issue(zoneVm(), function (err2) {
            t.ok(err2, 'second ticket refused');
            broker.close();
            t.done();
        });
    });
});

test('session ends at maximum session time', function (t) {
    var broker = newBroker({maxSessionTime: 50});

    startKvmBackend(function () {
        broker.issue(kvmVm(), function (err, ticket) {
            t.ifError(err);
            var iv;
            var c = connect(ticket, undefined, function (got) {
                if (got === 'OK\n') {
                    // Keep traffic flowing so only the lifetime limit applies.
                    iv = setInterval(function () {
                        c.write('x');
                    }, 10);
                }
            }, function () {
                clearInterval(iv);
                t.equal(Object.keys(broker.sessions).length, 0);
                broker.close();
                t.done();
            });
        });
    });
});
