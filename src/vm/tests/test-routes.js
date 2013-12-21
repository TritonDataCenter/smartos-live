// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// Tests for specifying static routes
//

process.env['TAP'] = 1;
var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var fs = require('fs');
var format = require('util').format;
var path = require('path');
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var INVALID_DEST = 'Invalid route destination: "%s" '
    + '(must be IP address or CIDR)';
var INVALID_GW = 'Invalid route gateway: "%s" '
    + '(must be IP address or nic)';
var INVALID_NIC = 'Route gateway: "%s" '
    + 'refers to non-existent or DHCP nic';
var INVALID_VAL = 'Invalid value(s) for: %s';

var payload = {
    'autoboot': false,
    'brand': 'joyent-minimal',
    'alias': 'autotest-' + process.pid,
    'do_not_inventory': true
};

var test_opts = {
    'timeout': 240000
};

function readZoneFile(vmobj, file) {
    assert.ok(vmobj, 'vmobj');
    assert.ok(vmobj.zonepath, 'vmobj.zonepath');
    return fs.readFileSync(path.join(vmobj.zonepath, 'root', file), 'utf8');
}

function vmResolvers(vmobj) {
    var resolv_conf = readZoneFile(vmobj, '/etc/resolv.conf');
    var resolvers = [];
    resolv_conf.split('\n').forEach(function (line) {
        var resolver = line.match(/nameserver (.+)/);
        if (resolver) {
            resolvers.push(resolver[1]);
        }
    });

    return resolvers;
}

function vmRoutes(vmobj) {
    var static_routes = readZoneFile(vmobj, '/etc/inet/static_routes');
    var routes = {};
    static_routes.split('\n').forEach(function (line) {
        if (line.indexOf('#') === 0) {
            return;
        }

        var parts = line.split(/\s+/g);
        if (parts[0] === '-interface') {
            parts.shift();
        }
        if (parts.length !== 2) {
            return;
        }

        routes[parts[0]] = parts[1];
    });

    return routes;
}

function waitAndValidateZoneFiles(t, vm, resolvers, routes, callback) {
    var timeout;
    // For now, just wait 10 seconds for mdata:fetch to complete.
    // TODO: something smarter
    timeout = setTimeout(function () {
        clearTimeout(timeout);
        t.deepEqual(vmResolvers(vm), resolvers,
            'resolvers in resolv.conf');
        t.deepEqual(vmRoutes(vm), routes,
            'routes in static_routes');

        return callback();
    }, 10000);
}


var failures = [
    [ 'destination: invalid',
        format(INVALID_DEST, 'asdf'),
        { routes: { 'asdf': '1.2.3.4' } }
    ],

    [ 'destination: invalid IP',
        format(INVALID_DEST, '1.2.3.256'),
        { routes: { '1.2.3.256': '1.2.3.4' } }
    ],

    [ 'destination: invalid CIDR (size too big)',
        format(INVALID_DEST, '10.2.0.0/7'),
        { routes: { '10.2.0.0/7': '1.2.3.4' } }
    ],

    [ 'destination: invalid CIDR (size too small)',
        format(INVALID_DEST, '10.2.0.0/33'),
        { routes: { '10.2.0.0/33': '1.2.3.4' } }
    ],

    [ 'gateway: invalid',
        format(INVALID_GW, 'asdf'),
        { routes: { '10.2.0.0/24': 'asdf' } }
    ],

    [ 'gateway: CIDR',
        format(INVALID_GW, '10.2.0.0/24'),
        { routes: { '10.2.0.0/24': '10.2.0.0/24' } }
    ],

    [ 'gateway: invalid IP',
        format(INVALID_GW, '10.2.0.256'),
        { routes: { '10.2.0.0/24': '10.2.0.256' } }
    ],

    [ 'gateway nic: no nics',
        format(INVALID_NIC, 'nics[0]'),
        { routes: { '10.2.0.0/24': 'nics[0]' } }
    ],

    [ 'gateway nic: nic out of range',
        format(INVALID_NIC, 'nics[1]'),
        {
            routes: { '10.2.0.0/24': 'nics[1]' },
            nics: [ { 'nic_tag': 'admin', 'ip': 'dhcp' } ]
        }
    ],

    [ 'gateway nic: dhcp nic',
        format(INVALID_NIC, 'nics[0]'),
        {
            routes: { '10.2.0.0/24': 'nics[0]' },
            nics: [ { 'nic_tag': 'admin', 'ip': 'dhcp' } ]
        }
    ],

    [ 'maintain_resolvers: invalid',
        format(INVALID_VAL, 'maintain_resolvers'),
        { 'maintain_resolvers': 'asdf' }
    ]
];

test('validation failures', test_opts, function(t) {

    async.forEachSeries(failures, function (fail, cb) {
        var desc = ' (' + fail[0] + ')';
        var newPayload = {};
        var state = {
            'brand': 'joyent-minimal',
            'expect_create_failure': true
        };

        [payload, fail[2]].forEach(function (obj) {
            for (var k in obj) {
                newPayload[k] = obj[k];
            }
        });

        vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, newPayload, state, [],
            function (err) {
            t.ok(state.hasOwnProperty('create_err'), 'create_err set' + desc);
            if (!state.create_err) {
                cb();
                return;
            }

            t.equal(state.create_err.message,
                fail[1], 'correct error message returned' + desc);

            cb();
        });
    }, function () {
        return t.end();
    });
});


test('update routes and resolvers', test_opts, function(t) {
    var state = {
        'brand': 'joyent-minimal'
    };
    var vm;

    var inZoneRoutes = {
        '172.21.1.1': '172.20.1.2',     // nics[1].ip
        '172.22.2.0/24': '172.19.1.1'
    };
    var oldResolvers;
    var resolvers = [ '172.21.1.1' ];
    var routes = {
        '172.21.1.1': 'nics[1]',
        '172.22.2.0/24': '172.19.1.1'
    };
    var newPayload = {
        'nics': [
            { 'nic_tag': 'admin',
              'ip': '172.19.1.2',
              'netmask': '255.255.255.0' },
            { 'nic_tag': 'admin',
              'ip': '172.20.1.2',
              'netmask': '255.255.255.0' },
        ],
        'maintain_resolvers': true,
        'nowait': false,
        'resolvers': resolvers,
        'routes': routes
    };

    for (var k in payload) {
        newPayload[k] = payload[k];
    }

    newPayload.autoboot = true;

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, newPayload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading new VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes present');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers present');
                    vm = obj;

                    t.deepEqual(vmResolvers(vm), resolvers,
                        'resolvers in resolv.conf');
                    t.deepEqual(vmRoutes(vm), inZoneRoutes,
                        'routes in static_routes');
                }

                cb(err);
            });
        },

        function (cb) {
            var updatePayload = {
                remove_routes: [ '172.22.2.0/24' ],
                resolvers: [ '8.8.8.8', '8.8.4.4' ],
                set_routes: {
                    '172.22.3.0/24': '172.19.1.1'
                },
            };
            delete routes['172.22.2.0/24'];
            delete inZoneRoutes['172.22.2.0/24'];

            routes['172.22.3.0/24'] = '172.19.1.1';
            inZoneRoutes['172.22.3.0/24'] = '172.19.1.1';

            resolvers = updatePayload.resolvers;

            VM.update(state.uuid, updatePayload, function (err) {
                t.ifErr(err, 'Updating VM');
                cb(err);
            });
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes updated');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            waitAndValidateZoneFiles(t, vm, resolvers, inZoneRoutes, cb);
        },

        function (cb) {
            // Don't allow removing a nic out from under a static route
            var updatePayload = {
                remove_nics: [ vm.nics[1].mac ]
            };

            VM.update(state.uuid, updatePayload, function (err) {
                t.ok(err, 'Error updating VM');
                if (err) {
                    t.equal(err.message, format(INVALID_NIC, 'nics[1]'),
                        'Error message correct');
                }

                cb();
            });
        },

        function (cb) {
            // Do allow removing a nic and the route that refers to it at
            // the same time
            var updatePayload = {
                remove_nics: [ vm.nics[1].mac ],
                remove_routes: [ '172.21.1.1' ]
            };
            delete routes['172.21.1.1'];
            delete inZoneRoutes['172.21.1.1'];

            VM.update(state.uuid, updatePayload, function (err) {
                t.ifErr(err, 'Updating VM');
                cb(err);
            });
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes updated');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            waitAndValidateZoneFiles(t, vm, resolvers, inZoneRoutes, cb);
        },

        function (cb) {
            // Don't update resolvers in the zone if maintain_resolvers is
            // not set
            var updatePayload = {
                maintain_resolvers: false,
                resolvers: [ '172.21.1.2' ]
            };
            oldResolvers = resolvers;
            resolvers = updatePayload.resolvers;

            VM.update(state.uuid, updatePayload, function (err) {
                t.ifErr(err, 'Updating VM');
                cb(err);
            });
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes are the same');
                    t.deepEqual(obj.resolvers, resolvers,
                        'VM object resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            // resolv.conf in the zone should have the old resolvers, not
            // the ones we just updated. static_routes in the zone should
            // also be unchanged.
            waitAndValidateZoneFiles(t, vm, oldResolvers, inZoneRoutes, cb);

        },

        function (cb) {
            // The changes should persist across reboots
            VM.reboot(state.uuid, {}, function(err) {
                if (err) {
                    t.ifErr(err, 'reboot VM');
                    return cb(err);
                }

                VM.load(state.uuid, function (err2, obj) {
                    t.ifErr(err2, 'loading VM');
                    if (obj) {
                        t.deepEqual(obj.routes, routes,
                            'routes are the same');
                        t.deepEqual(obj.resolvers, resolvers,
                            'resolvers are the same');
                        vm = obj;
                    }

                    cb(err2);

                });
            });
        },

        function (cb) {
            // resolv.conf and static_routes should be unchanged
            waitAndValidateZoneFiles(t, vm, oldResolvers, inZoneRoutes, cb);
        },

        function (cb) {
            // Set maintain_resolvers again: we should now have the new
            // resolvers in the zone
            VM.update(state.uuid, { maintain_resolvers: true }, function (err) {
                t.ifErr(err, 'Updating VM');
                cb(err);
            });
        },

        function (cb) {
            // resolv.conf and static_routes should now match the VM object
            waitAndValidateZoneFiles(t, vm, resolvers, inZoneRoutes, cb);
        }

    ], function (err) {
        return t.end();
    });
});


test('create zone without maintain_resolvers', test_opts, function(t) {
    var state = {
        'brand': 'joyent-minimal'
    };
    var vm;

    var inZoneRoutes = {
        '172.21.1.1': '172.20.1.3'     // nics[0].ip
    };
    var oldResolvers;
    var resolvers = [ '172.21.1.1' ];
    var routes = {
        '172.21.1.1': 'nics[0]'
    };
    var newPayload = {
        'nics': [
            { 'nic_tag': 'admin',
              'ip': '172.20.1.3',
              'netmask': '255.255.255.0' },
        ],
        // leaving out maintain_resolvers on purpose
        'nowait': false,
        'resolvers': resolvers,
        'routes': routes
    };

    for (var k in payload) {
        newPayload[k] = payload[k];
    }

    newPayload.autoboot = true;

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, newPayload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading new VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes present');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers present');
                    vm = obj;

                    // We expect the resolvers to be set on the initial boot
                    t.deepEqual(vmResolvers(vm), resolvers,
                        'resolvers in resolv.conf');
                    t.deepEqual(vmRoutes(vm), inZoneRoutes,
                        'routes in static_routes');
                }

                cb(err);
            });
        },

        function (cb) {
            var updatePayload = {
                resolvers: [ '8.8.8.8', '8.8.4.4' ],
                set_routes: {
                    '172.22.3.0/24': '172.19.1.1'
                }
            };
            delete routes['172.22.2.0/24'];
            delete inZoneRoutes['172.22.2.0/24'];

            routes['172.22.3.0/24'] = '172.19.1.1';
            inZoneRoutes['172.22.3.0/24'] = '172.19.1.1';

            oldResolvers = resolvers;
            resolvers = updatePayload.resolvers;

            VM.update(state.uuid, updatePayload, function (err) {
                t.ifErr(err, 'Updating VM');
                cb(err);
            });
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifErr(err, 'loading VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes updated');
                    // updated resolvers should show up in the VM object
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            // resolv.conf should not have the updated resolvers, since
            // maintain_resolvers is not set

            waitAndValidateZoneFiles(t, vm, oldResolvers, inZoneRoutes, cb);
        },

        function (cb) {
            // The old resolvers should stay across reboots
            VM.reboot(state.uuid, {}, function(err) {
                if (err) {
                    t.ifErr(err, 'reboot VM');
                    return cb(err);
                }

                VM.load(state.uuid, function (err2, obj) {
                    t.ifErr(err2, 'loading VM');
                    if (obj) {
                        t.deepEqual(obj.routes, routes,
                            'routes are the same');
                        t.deepEqual(obj.resolvers, resolvers,
                            'resolvers are the same');
                        vm = obj;
                    }

                    cb(err2);

                });
            });
        },

        function (cb) {
            // resolv.conf and static_routes should be unchanged
            waitAndValidateZoneFiles(t, vm, oldResolvers, inZoneRoutes, cb);
        }

    ], function (err) {
        return t.end();
    });
});
