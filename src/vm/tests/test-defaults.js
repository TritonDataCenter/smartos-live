// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
var execFile = require('child_process').execFile;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

// Format:
// 1. property of the vmobj
// 2. expected value (or parameter to transform function)
// 3. transform function (optional)
var zone_defaults = {
    'v': [1],
    'zonename': ['uuid', state_property],
    'autoboot': [true],
    'zonepath': ['uuid', prefix_zones_slash],
    'do_not_inventory': [true],
    'firewall_enabled': [false],
    'brand': ['joyent'],
    'quota': [10],
    'cpu_shares': [100],
    'zfs_io_priority': [100],
    'zpool': ['zones'],
    'max_lwps': [2000],
    'tmpfs': ['max_physical_memory', zone_property],
    'max_locked_memory': ['max_physical_memory', zone_property],
    'max_swap': ['max_physical_memory', zone_property],
    'max_physical_memory': [256],
    'billing_id': ['00000000-0000-0000-0000-000000000000'],
    'image_uuid': [image_uuid],
    'zfs_filesystem': ['uuid', prefix_zones],
    'zfs_root_recsize': [131072],
    'snapshots': ['<EMPTY-ARRAY>'],
    'owner_uuid': ['00000000-0000-0000-0000-000000000000'],
    'uuid': ['uuid', state_property],
    'dns_domain': ['local'],
    'limit_priv': ['default'],
    'last_modified': ['<NON-EMPTY>'],
    'server_uuid': ['<NON-EMPTY>'],
    'datacenter_name': ['<OPTIONAL-NON-EMPTY>'],
    'platform_buildstamp': ['<NON-EMPTY>'],
    'headnode_id': ['<OPTIONAL-NON-EMPTY>'],
    'create_timestamp': ['<NON-EMPTY>'],
    'resolvers': ['<EMPTY-ARRAY>'],
    'nics': ['<EMPTY-ARRAY>'],
    'routes': ['<EMPTY-OBJ>'],
    'tags': ['<EMPTY-OBJ>'],
    'customer_metadata': ['<EMPTY-OBJ>'],
    'internal_metadata': ['<EMPTY-OBJ>']
};

// properties that are only there by default for OS VMs
var zone_only = [
    'tmpfs',
    'dns_domain',
    'image_uuid'
];

// values specific to KVM
var kvm_defaults = {
    'ram': [256],
    'brand': ['kvm'],
    'max_physical_memory': [1280],
    'limit_priv': ['default,-file_link_any,-net_access,-proc_fork,-proc_info,-proc_session'],
    'billing_id': ['00000000-0000-0000-0000-000000000000'],
    'disks': ['<EMPTY-ARRAY>'],
    'vcpus': [1]
};

for (idx in zone_defaults) {
    if (zone_only.indexOf(idx) !== -1) {
        //console.error('skipping zone-only: ' + idx);
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
    var vmobj = state.vmobj;

    value = vmobj[prop];
    if (transform) {
        expected = transform(state, expected);
    }
    if (expected === '<NON-EMPTY>') {
        t.ok(value.length > 0, prop + ' [' + expected + ',' + value + ']');
    } else if (expected === '<EMPTY-ARRAY>') {
        t.ok(JSON.stringify(value) === '[]', prop + ' [],' + JSON.stringify(value));
    } else if (expected === '<EMPTY-OBJ>') {
        t.ok(JSON.stringify(value) === '{}', prop + ' {},' + JSON.stringify(value));
    } else if (expected === '<OPTIONAL-NON-EMPTY>') {
        if (value !== undefined) {
            // this is optional, but if it exists it should be non-empty
            t.ok(value.toString().length > 0, prop + ' [' + expected + ',' + value + ']');
        }
    } else {
        t.ok(value === expected, prop + ' [' + expected + ':' + typeof(expected)
            + ',' + value + ':' + typeof(value) + ']');
    }
}

function check_values(t, state)
{
    if (state.brand === 'joyent-minimal') {
        defaults = zone_defaults;
    } else if (state.brand === 'kvm') {
        defaults = kvm_defaults;
    }

    for (def in defaults) {
        //def = defaults[def];

        prop = def;
        expected = defaults[def][0];
        transform = defaults[def][1];

        check_property(t, state, prop, expected, transform);
    }

    for (prop in state.vmobj) {
        // the only remaining members we expect are state and zoneid
        if (prop === 'state' || prop === 'zone_state') {
            continue;
        } else if (prop === 'zoneid') {
            continue;
        } else if (state.brand === 'kvm' && prop === 'pid') {
            continue;
        } else if (!defaults.hasOwnProperty(prop)) {
            t.ok(false, 'unexpected property: ' + prop);
        }
    }
}

test('check default zone properties', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {'do_not_inventory': true}, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                state.vmobj = obj;
                check_values(t, state);
                cb();
            });
        }
    ]);
});

test('check default kvm properties', {'timeout': 240000}, function(t) {
    state = {'brand': 'kvm'};
    vmtest.on_new_vm(t, null, {'brand': 'kvm',
        'do_not_inventory': true}, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }
                t.ok(true, 'loaded obj for new VM');
                state.vmobj = obj;
                check_values(t, state);
                cb();
            });
        }
    ]);
});

test('check default create_timestamp', {'timeout': 240000}, function(t) {
    state = {'brand': 'joyent-minimal'};
    var vmobj;

    vmtest.on_new_vm(t, image_uuid, {'do_not_inventory': true}, state, [
        function (cb) {
            zonecfg(['-z', state.uuid, 'remove attr name=create-timestamp;'], function (err, fds) {
                t.ok(!err, 'removing create-timestamp: ' + (err ? err.message : 'ok'));
                cb(err);
            });
        }, function (cb) {
            VM.load(state.uuid, function(err, obj) {
                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
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

                t.ok(vmobj.create_timestamp === dataset_creation_time, 'VM has create_timestamp, expected: '
                    + dataset_creation_time + ', actual: ' + vmobj.create_timestamp);

                cb();

            });
        }
    ]);
});
