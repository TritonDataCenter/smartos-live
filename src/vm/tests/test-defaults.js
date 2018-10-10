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
 * These tests ensure that default values don't change accidentally.
 */

var execFile = require('child_process').execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var vasync = require('/usr/vm/node_modules/vasync');
var vminfod = require('/usr/vm/node_modules/vminfod/client');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var idx;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

// Format:
// 1. property of the vmobj
// 2. expected value (or parameter to transform function)
// 3. transform function (optional)
var zone_defaults = {
    autoboot: [true],
    billing_id: ['00000000-0000-0000-0000-000000000000'],
    brand: ['joyent'],
    boot_timestamp: ['<NON-EMPTY>'],
    cpu_shares: [100],
    create_timestamp: ['<NON-EMPTY>'],
    customer_metadata: ['<EMPTY-OBJ>'],
    datacenter_name: ['<OPTIONAL-NON-EMPTY>'],
    dns_domain: ['local'],
    do_not_inventory: [true],
    firewall_enabled: [false],
    headnode_id: ['<OPTIONAL-NON-EMPTY>'],
    hvm: [false],
    image_uuid: [image_uuid],
    internal_metadata: ['<EMPTY-OBJ>'],
    last_modified: ['<NON-EMPTY>'],
    limit_priv: ['default'],
    max_locked_memory: ['max_physical_memory', zone_property],
    max_lwps: [2000],
    max_msg_ids: [4096],
    max_physical_memory: [256],
    max_sem_ids: [4096],
    max_shm_memory: ['max_physical_memory', zone_property],
    max_shm_ids: [4096],
    max_swap: ['max_physical_memory', zone_property],
    nics: ['<EMPTY-ARRAY>'],
    owner_uuid: ['00000000-0000-0000-0000-000000000000'],
    pid: ['<OPTIONAL-NON-EMPTY>'],
    platform_buildstamp: ['<NON-EMPTY>'],
    quota: [10],
    resolvers: ['<EMPTY-ARRAY>'],
    routes: ['<EMPTY-OBJ>'],
    server_uuid: ['<NON-EMPTY>'],
    snapshots: ['<EMPTY-ARRAY>'],
    tags: ['<EMPTY-OBJ>'],
    tmpfs: ['max_physical_memory', zone_property],
    uuid: ['uuid', state_property],
    v: [1],
    zfs_filesystem: ['uuid', prefix_zones],
    zfs_io_priority: [100],
    zfs_root_recsize: [131072],
    zonename: ['uuid', state_property],
    zonepath: ['uuid', prefix_zones_slash],
    zpool: ['zones']
};

// properties that are only there by default for OS VMs
var zone_only = [
    'dns_domain',
    'image_uuid',
    'tmpfs'
];

// values specific to KVM
var kvm_defaults = {
    billing_id: ['00000000-0000-0000-0000-000000000000'],
    brand: ['kvm'],
    disks: ['<EMPTY-ARRAY>'],
    hvm: [true],
    /* JSSTYLED */
    limit_priv: ['default,-file_link_any,-net_access,-proc_fork,-proc_info,-proc_session'],
    max_physical_memory: [1280],
    ram: [256],
    vcpus: [1]
};

for (idx in zone_defaults) {
    if (zone_only.indexOf(idx) !== -1) {
        // console.error('skipping zone-only: ' + idx);
        // jsl:pass
    } else if (!kvm_defaults.hasOwnProperty(idx)) {
        kvm_defaults[idx] = zone_defaults[idx];
    }
}

function zone_property(state, property)
{
    return state.vmobj[property];
}

function state_property(state, property)
{
    return state[property];
}

function prefix_zones_slash(state, property)
{
    return '/zones/' + state[property];
}

function prefix_zones(state, property)
{
    return 'zones/' + state[property];
}

// trim functions also copied from VM.js
function ltrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('^[' + chars + ']+', 'g'), '');
}

function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function trim(str, chars)
{
    return ltrim(rtrim(str, chars), chars);
}

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

function zonecfg(args, callback)
{
    var cmd = '/usr/sbin/zonecfg';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}
function check_property(t, state, prop, expected, transform)
{
    var value;
    var vmobj = state.vmobj;

    value = vmobj[prop];
    if (transform) {
        expected = transform(state, expected);
    }
    if (expected === '<NON-EMPTY>') {
        t.ok(value.length > 0, prop + ' [' + expected + ',' + value + ']');
    } else if (expected === '<EMPTY-ARRAY>') {
        t.ok(JSON.stringify(value) === '[]', prop + ' [],'
            + JSON.stringify(value));
    } else if (expected === '<EMPTY-OBJ>') {
        t.ok(JSON.stringify(value) === '{}', prop + ' {},'
            + JSON.stringify(value));
    } else if (expected === '<OPTIONAL-NON-EMPTY>') {
        if (value !== undefined) {
            // this is optional, but if it exists it should be non-empty
            t.ok(value.toString().length > 0, prop + ' [' + expected + ','
                + value + ']');
        }
    } else {
        t.ok(value === expected, prop + ' [' + expected + ':'
            + typeof (expected) + ',' + value + ':' + typeof (value) + ']');
    }
}

function check_values(t, state)
{
    var def;
    var defaults;
    var expected;
    var prop;
    var transform;

    if (state.brand === 'joyent-minimal') {
        defaults = zone_defaults;
    } else if (state.brand === 'kvm') {
        defaults = kvm_defaults;
    }

    for (def in defaults) {
        // def = defaults[def];

        prop = def;
        expected = defaults[def][0];
        transform = defaults[def][1];

        check_property(t, state, prop, expected, transform);
    }

    for (prop in state.vmobj) {
        // the only remaining members we expect are state and zoneid
        if (prop === 'state' || prop === 'zone_state') {
            continue;
        } else if (prop === 'zoneid' || prop === 'zonedid') {
            continue;
        } else if (state.brand === 'kvm' && prop === 'pid') {
            continue;
        } else if (prop.match(/^transition_/)) {
            continue;
        } else if (!defaults.hasOwnProperty(prop)) {
            t.ok(false, 'unexpected property: ' + prop);
        }
    }
}

test('check default zone properties', function (t) {
    var state = {brand: 'joyent-minimal'};

    vmtest.on_new_vm(t, image_uuid, {
        do_not_inventory: true
    }, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    cb(err);
                    return;
                }
                t.ok(true, 'loaded obj for new VM');
                state.vmobj = obj;
                check_values(t, state);
                cb();
            });
        }
    ]);
});

test('check default kvm properties', function (t) {
    var state = {brand: 'kvm'};

    vmtest.on_new_vm(t, null, {
        brand: 'kvm',
        do_not_inventory: true
    }, state, [
        function (cb) {
            VM.load(state.uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    cb(err);
                    return;
                }
                t.ok(true, 'loaded obj for new VM');
                state.vmobj = obj;
                check_values(t, state);
                cb();
            });
        }
    ]);
});

test('check default create_timestamp', function (t) {
    var state = {brand: 'joyent-minimal'};
    var vmobj;

    vmtest.on_new_vm(t, image_uuid, {
        do_not_inventory: true
    }, state, [
        function (cb) {
            var vs = new vminfod.VminfodEventStream('test-defaults.js');
            vs.once('ready', function () {
                vasync.parallel({
                    funcs: [
                        function (cb2) {
                            var obj = {
                                type: 'modify',
                                zonename: state.uuid
                            };
                            var opts = {
                                timeout: 30 * 1000,
                                catchErrors: true,
                                teardown: true
                            };
                            var changes = [
                                {
                                    path: ['create_timestamp'],
                                    action: 'changed'
                                }
                            ];
                            vs.watchForChanges(obj, changes, opts,
                                function (err) {
                                if (err) {
                                    cb2(err);
                                    return;
                                }

                                cb2();
                            });
                        },
                        function (cb2) {
                            zonecfg(['-z', state.uuid,
                                'remove attr name=create-timestamp;'],
                                function (err, fds) {

                                t.ok(!err, 'removing create-timestamp: '
                                    + (err ? err.message : 'ok'));
                                cb2(err);
                            });
                        }
                    ]
                }, function (err) {
                    cb(err);
                });
            });
        }, function (cb) {
            VM.load(state.uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    cb(err);
                    return;
                }
                vmobj = obj;
                cb();
            });
        }, function (cb) {
            zfs(['get', '-pHo', 'value', 'creation', vmobj.zfs_filesystem],
                function (err, fds) {

                var creation_timestamp = trim(fds.stdout);
                var dataset_creation_time;

                if (!err && !creation_timestamp) {
                    err = new Error('Unable to find creation timestamp in zfs '
                        + 'output');
                }

                if (err) {
                    cb(err);
                    return;
                }

                dataset_creation_time =
                    (new Date(creation_timestamp * 1000)).toISOString();

                t.ok(vmobj.create_timestamp === dataset_creation_time, 'VM has'
                    + ' create_timestamp, expected: ' + dataset_creation_time
                    + ', actual: ' + vmobj.create_timestamp);

                cb();

            });
        }
    ]);
});
