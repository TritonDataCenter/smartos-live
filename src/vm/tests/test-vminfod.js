// Copyright 2015 Joyent, Inc.

var spawn = require('child_process').spawn;

var VminfodClient = require('vminfod/client');

var VM_PAYLOAD = {
    autoboot: true,
    brand: 'joyent-minimal',
    do_not_inventory: true,
    image_uuid: '01b2c898-945f-11e1-a523-af1afbe22822'
};

var EXPECTED_CHANGES = {
    create: {
        zone_state: {
            action: 'changed',
            from: 'ready',
            to: 'running'
        },
        boot_timestamp: {
            action: 'changed'
        },
        pid: {
            action: 'changed',
            from: 0
        },
        last_modified: {
            action: 'changed'
        },
        transition_to: {
            action: 'removed',
            from: 'running'
        }
    },
    stop: {
        autoboot: {
            action: 'changed',
            from: true,
            to: false
        },
        exit_status: {
            action: 'added',
            from: null,
            to: 0
        },
        exit_timestamp: {
            action: 'added',
            from: null
        },
        zone_state: {
            action: 'changed',
            from: 'shutting_down',
            to: 'down'
        },
        state: {
            action: 'changed',
            from: 'down',
            to: 'stopped'
        },
        pid: {
            action: 'removed'
        },
        last_modified: {
            action: 'changed'
        },
        boot_timestamp: {
            action: 'removed'
        }
    },
    start: {
        autoboot: {
            action: 'changed',
            from: false,
            to: true
        },
        exit_status: {
            action: 'removed'
        },
        exit_timestamp: {
            action: 'removed'
        },
        zone_state: {
            action: 'changed',
            from: 'ready',
            to: 'running'
        },
        state: {
            action: 'changed',
            from: 'ready',
            to: 'running'
        },
        pid: {
            action: 'changed',
            from: 0
        },
        last_modified: {
            action: 'changed'
        },
        boot_timestamp: {
            action: 'added'
        }
    },
    delete: {
        quota: {
            action: 'removed'
        },
        zfs_root_recsize: {
            action: 'removed'
        },
        zfs_filesystem: {
            action: 'removed'
        },
        zpool: {
            action: 'removed'
        },
        internal_metadata: {
            action: 'removed'
        },
        customer_metadata: {
            action: 'removed'
        },
        exit_timestamp: {
            action: 'removed'
        },
        exit_status: {
            action: 'removed'
        },
        pid: {
            action: 'removed'
        },
        boot_timestamp: {
            action: 'removed'
        },
        autoboot: {
            action: 'changed',
            from: true,
            to: false
        },
        state: {
            action: 'changed',
            to: 'stopped'
        }
    }
};

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

function vmadm(args, stdin, callback) {
    if (typeof (stdin) === 'function') {
        callback = stdin;
        stdin = null;
    }
    var buffers = {stdout: '', stderr: ''};
    var stderr = [];
    var stdout = [];

    var child = spawn('/usr/vm/sbin/vmadm', args, {stdio: 'pipe'});

    if (stdin)
        child.stdin.write(stdin);
    child.stdin.end();

    child.stdout.on('data', function (data) {
        lineChunk(data, 'stdout', function (chunk) {
            stdout.push(chunk);
        });
    });

    child.stderr.on('data', function (data) {
        lineChunk(data, 'stderr', function (chunk) {
            stderr.push(chunk);
        });
    });

    child.on('close', function (code, signal) {
        var err = null;
        var msg;
        if (code !== 0)
            err = new Error(msg);

        callback(err, {stdout: stdout.join('\n'), stderr: stderr.join('\n')});
    });

    function lineChunk(data, buffer, handler) {
        var chunk;
        var chunks;

        buffers[buffer] += data.toString();
        chunks = buffers[buffer].split('\n');

        while (chunks.length > 1) {
            chunk = chunks.shift();
            handler(chunk);
        }
        buffers[buffer] = chunks.pop(); // remainder
    }
}

test('create VminfodClient object and test /status', function (t) {
    var vc = new VminfodClient();
    t.ok(vc, 'VminfodClient created');

    vc.status(function (err, stats) {
        t.ifError(err, 'vc.status no error');
        t.ok(stats, 'vc.status object found');
        t.end();
    });
});

test('zone lifecycle', function (t) {
    var TIMEOUT = 30 * 1000;
    var events = [];

    var vc = new VminfodClient();
    var vs = vc.createEventStream();

    var phase;
    var vm_uuid;
    var timeout;

    var i = 0;
    vs.on('readable', function () {
        var ev;
        while ((ev = vs.read()) !== null) {
            if (i++ === 0) {
                t.equal(ev.type, 'ack', 'VminfodStream started');
                break;
            }
            events.push(ev);
            processEvent(ev);
        }
    });

    timeout = setTimeout(fail, TIMEOUT);
    create();

    function fail() {
        t.ok(false, 'timeout exceeded');
        vs.stop();
        t.end();
        console.error('states still left');
        console.error(EXPECTED_CHANGES[phase]);
    }

    function processEvent(ev) {
        if (!phase)
            return;
        if (ev.zonename !== vm_uuid)
            return;

        // ensure all events in EXPECTED_CHANGES are found
        var expected = EXPECTED_CHANGES[phase];
        if (ev.type !== 'modify')
            return;
        // loop each change
        (ev.changes || []).forEach(function (change) {
            if (!expected.hasOwnProperty(change.path))
                return;
            var ex = expected[change.path];

            var fullmatch = true;
            Object.keys(ex).forEach(function (key) {
                if (ex[key] !== change[key])
                    fullmatch = false;
            });

            if (fullmatch) {
                t.ok(true, phase + ' event match for ' + change.path);
                console.error('%s event match for %s', phase, change.path);
                delete expected[change.path];
            }
        });

        if (Object.keys(expected).length === 0) {
            clearTimeout(timeout);
            timeout = null;
            console.error('phase %s ended', phase);

            timeout = setTimeout(fail, TIMEOUT);
            switch (phase) {
            case 'create': phase = 'stop'; stop(); break;
            case 'stop': phase = 'start'; start(); break;
            case 'start': phase = 'delete'; _delete(); break;
            case 'delete':
                console.error('ending test');
                clearTimeout(timeout);
                vs.stop();
                t.end();
                break;
            }
        }
    }

    function create() {
        console.error('starting create');
        vmadm(['create'], JSON.stringify(VM_PAYLOAD), function (err, stdio) {
            t.ok(!err, (err ? err.message : 'created VM'));

            /* JSSTYLED */
            var match = stdio.stderr.match(/Successfully created VM ([0-9a-f\-]*)/);
            if (match) {
                vm_uuid = match[1];
            } else {
                t.ok(false, 'failed to get uuid from new VM');
                vs.stop();
                return;
            }

            // playback the events received before the vm's UUID was known
            phase = 'create';
            events.forEach(function (ev) {
                processEvent(ev);
            });
        });
    }

    function stop() {
        phase = 'stop';
        console.error('starting %s phase', phase);
        vmadm(['stop', vm_uuid], function (err, stdio) {
            t.ok(!err, (err ? err.message : 'stopped VM'));
        });
    }

    function start() {
        phase = 'start';
        console.error('starting %s phase', phase);
        vmadm(['start', vm_uuid], function (err, stdio) {
            t.ok(!err, (err ? err.message : 'started VM'));
        });
    }

    function _delete() {
        phase = 'delete';
        console.error('starting %s phase', phase);
        vmadm(['delete', vm_uuid], function (err, stdio) {
            t.ok(!err, (err ? err.message : 'deleted VM'));
        });
    }
});
