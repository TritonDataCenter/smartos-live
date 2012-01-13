// Copyright 2011 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

process.env['TAP'] = 1;
require.paths.push('/usr/vm/test/node-tap/node_modules');
var test = require('tap').test;
var path = require('path');
var VM = require('VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var dataset_uuid = '47e6af92-daf0-11e0-ac11-473ca1173ab0';
//var vm_dataset_uuid = '56108678-1183-11e1-83c3-ff3185a5b47f';

// Format:
// 1. property of the vmobj
// 2. expected value (or parameter to transform function)
// 3. transform function (optional)
var zone_defaults = {
    'zonename': ['uuid', state_property],
    'autoboot': [true],
    'zonepath': ['uuid', prefix_zones_slash],
    'brand': ['joyent'],
    'quota': [10],
    'cpu_shares': [100],
    'zfs_io_priority': [100],
    'zfs_storage_pool_name': ['zones'],
    'max_lwps': [2000],
    'tmpfs': ['max_physical_memory', zone_property],
    'max_locked_memory': ['max_physical_memory', zone_property],
    'max_swap': ['max_physical_memory', zone_property],
    'max_physical_memory': [256],
    'billing_id': [dataset_uuid],
    'dataset_uuid': [dataset_uuid],
    'zone_root_dataset': ['uuid', prefix_zones],
    'owner_uuid': ['00000000-0000-0000-0000-000000000000'],
    'uuid': ['uuid', state_property],
    'dns_domain': ['local'],
    'limit_priv': ['default,dtrace_proc,dtrace_user'],
    'compute_node_uuid': ['<NON-EMPTY>'],
    'create_timestamp': ['<NON-EMPTY>'],
    'nics': ['<EMPTY-ARRAY>'],
    'tags': ['<EMPTY-OBJ>'],
    'customer_metadata': ['<EMPTY-OBJ>'],
    'internal_metadata': ['<EMPTY-OBJ>']
};

// properties that are only for OS VMs
var zone_only = [
    'tmpfs',
    'dataset_uuid'
];

// values specific to KVM
var kvm_defaults = {
    'ram': [256],
    'brand': ['kvm'],
    'max_physical_memory': [1280],
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
    } else {
        t.ok(value === expected, prop + ' [' + expected + ',' + value + ']');
    }
}

function check_values(t, state)
{
    if (state.brand === 'joyent') {
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
        if (prop === 'state') {
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
    state = {'brand': 'joyent'};
    vmtest.on_new_vm(t, dataset_uuid, {}, state, [
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
    vmtest.on_new_vm(t, null, {'brand': 'kvm'}, state, [
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
