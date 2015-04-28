// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// Tests for specifying static routes
//

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var fs = require('fs');
var format = require('util').format;
var path = require('path');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

// If true, don't delete VMs once the test is complete
var DO_NOT_CLEANUP_VMS = false;

var INVALID_DEST = 'Invalid route destination: "%s" '
    + '(must be IP address or CIDR)';
var INVALID_GW = 'Invalid route gateway: "%s" '
    + '(must be IP address or nic)';
var INVALID_NIC = 'Route gateway: "%s" '
    + 'refers to non-existent or DHCP nic';
var INVALID_VAL = 'Invalid value(s) for: %s';

var payload = {
    alias: 'test-routes-' + process.pid,
    autoboot: false,
    brand: 'joyent-minimal',
    do_not_inventory: true
};

var LAST_METADATA_RESTART_TIME;
var LAST_NETWORKING_RESTART_TIME;
var ROUTING_SVC = 'routing-setup';
var RESTART_TRIES = 10;

function debugKeepVM(state, cb) {
    if (DO_NOT_CLEANUP_VMS) {
        // If state.uuid is missing, vmtest.on_new_vm won't delete it
        console.error('# Not cleaning up VM: ' + state.uuid);
        delete state.uuid;
    }

    cb();
}

function getServiceStartTime(uuid, svc, callback) {
    cp.execFile('/usr/bin/svcs', ['-H', '-o', 'stime', '-z', uuid, svc],
        function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        return callback(null, stdout.replace('\n', ''));
    });
}

function getStartTimes(t, state, desc, callback) {
    getServiceStartTime(state.uuid, 'mdata:fetch', function (err, time) {
        if (err) {
            t.ifError(err, format('Error getting metadata service start time ' +
                'for VM %s (%s)', state.uuid, desc));
            return callback(err);
        }

        t.ok(time, format('metadata start time of %s', time));
        LAST_METADATA_RESTART_TIME = time;
        getServiceStartTime(state.uuid, ROUTING_SVC,
            function (err2, time2) {
            if (err) {
                t.ifError(err, format('Error getting network/physical service' +
                    'start time for VM %s (%s)', state.uuid, desc));
                return callback(err);
            }

            t.ok(time2, format('networking start time of %s', time2));
            LAST_NETWORKING_RESTART_TIME = time2;

            callback();
        });
    });
}

function getRoutingTables(uuid, callback) {
    cp.exec(format('/usr/sbin/zlogin %s /usr/bin/netstat -rnf inet |' +
        'egrep -v \'Destination|Routing|---\' | awk \'{ print $1,$2 }\'', uuid),
        function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        var routes = {};
        stdout.split(/\n/g).forEach(function (line) {
            var parts = line.split(' ');
            if (parts[0] == "" || parts[0] == "127.0.0.1") {
                return;
            }

            routes[parts[0]] = parts[1];
        });

        return callback(null, routes);
    });
}

function readZoneFile(vmobj, file) {
    assert.ok(vmobj, 'vmobj');
    assert.ok(vmobj.zonepath, 'vmobj.zonepath');
    return fs.readFileSync(path.join(vmobj.zonepath, 'root', file), 'utf8');
}

function runRouteCmd(t, uuid, cmd, callback) {
    cp.exec(format('/usr/sbin/zlogin %s /usr/sbin/route %s',
        uuid, cmd), function (err, stdout, stderr) {
        t.ifError(err, 'running route ' + cmd);
        t.equal(stderr, '', 'stderr: route ' + cmd);
        if (err) {
            t.equal(stdout, '', 'stdout: route ' + cmd);
            return callback(err);
        }

        return callback(null, stdout);
    });
}

// Update the metadata service start time (so we can use it to determine when
// the service restarts) and then do a VM.update
function updateVM(t, state, payload, desc, callback) {
    getStartTimes(t, state, desc, function (err) {
        if (err) {
            t.ifError(err, format('Error getting metadata service start time ' +
                'for VM %s (%s)', state.uuid, desc));
            return callback(err);
        }

        VM.update(state.uuid, payload, function (err) {
            t.ifError(err, 'Updating VM ' + state.uuid);
            return callback(err);
        });
    });
}

// Validate the following in the zone:
// * resolv.conf
// * static_routes
// * static_routes.vmadm
function validateZoneData(t, vm, opts, callback) {
    var desc = format(' (%s)', opts.desc);
    var resolvers = opts.resolvers;
    var vmadmRoutes = opts.vmadmRoutes;
    var zoneRoutes = opts.inZoneRoutes;
    var routingTable = opts.routingTable;
    var i = 0;
    var interval = 1000;
    var timeout;
    // Time to wait after the metadata service restart (needs to be
    // higher for a start / reboot, since the routing-setup service needs
    // to run)
    var waitAfter = opts.start ? 10000 : 5000;

    function checkChanges() {
        getServiceStartTime(vm.uuid, 'mdata:fetch', function (err, time) {
            clearTimeout(timeout);
            i++;
            if (err) {
                // If the zone is booting or rebooting, we might get repository
                // unavailable errors
                if (!(opts.start && err.message.match(
                    /repository server unavailable/) !== null)) {
                    t.ifError(err, 'Error getting metadata service start time ' +
                        'for VM ' + vm.uuid);
                }
                if (i == RESTART_TRIES) {
                    return callback();
                }

                timeout = setTimeout(checkChanges, timeout);
                return;
            }

            if (time != LAST_METADATA_RESTART_TIME) {
                // Service has restarted: wait a little longer for it to
                // finish
                timeout = setTimeout(function () {
                    clearTimeout(timeout);
                    t.ok(time, format('last metadata restart time changed from ' +
                        '%s to %s (after %d tries)',
                        LAST_METADATA_RESTART_TIME, time, i));
                    LAST_METADATA_RESTART_TIME = time;

                    t.deepEqual(vmResolvers(vm), resolvers,
                        'resolvers in resolv.conf' + desc);
                    t.deepEqual(vmRoutes(vm, true), zoneRoutes,
                        'routes in static_routes' + desc);
                    t.deepEqual(vmRoutes(vm), vmadmRoutes,
                        'routes in static_routes.vmadm' + desc);

                    if (opts.start) {
                        return waitAndCheckRoutes(t, vm, routingTable, desc,
                            callback);
                    }

                    getRoutingTables(vm.uuid, function (err2, table) {
                        t.ifError(err2, 'Error getting routing tables for ' +
                            'VM ' + vm.uuid);
                        if (err2) {
                            return callback(err2);
                        }

                        t.deepEqual(table, routingTable,
                            'routing table' + desc);
                        return callback();
                    });
                }, waitAfter);
                return;
            }

            if (i == RESTART_TRIES) {
                if (opts.start) {
                    return callback();
                }

                t.ok(false, format('metadata service for VM %s did not ' +
                    'restart after %d seconds', vm.uuid,
                    (interval / 1000) * RESTART_TRIES));
                return callback();
            }

            timeout = setTimeout(checkChanges, timeout);
        });
    }

    timeout = setTimeout(checkChanges, timeout);
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

function vmRoutes(vmobj, inZone) {
    var file = '/etc/inet/static_routes.vmadm';
    if (inZone) {
        file = '/etc/inet/static_routes';
    }

    try {
        var static_routes = readZoneFile(vmobj, file);
    } catch (err) {
        if (err.code == 'ENOENT') {
            return {};
        }

        throw err;
    }

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

function waitAndCheckRoutes(t, vm, routingTable, desc, callback) {
    var i = 0;
    var interval = 1000;
    var timeout;
    var waitAfter = 5000;

    function checkService() {
        getServiceStartTime(vm.uuid, ROUTING_SVC, function (err, time) {
            clearTimeout(timeout);
            i++;
            if (err) {
                t.ifError(err, 'Error getting network/physical service start ' +
                    'time for VM ' + vm.uuid);
                if (i == RESTART_TRIES) {
                    return callback();
                }

                timeout = setTimeout(checkService, timeout);
                return;
            }

            if (time != LAST_NETWORKING_RESTART_TIME) {
                // Service has restarted: wait a little longer for it to
                // finish
                timeout = setTimeout(function () {
                    clearTimeout(timeout);
                    t.ok(time, format('last network/physical restart time ' +
                        'changed from %s to %s (after %d tries)',
                        LAST_NETWORKING_RESTART_TIME, time, i));
                    LAST_NETWORKING_RESTART_TIME = time;

                    getRoutingTables(vm.uuid, function (err2, table) {
                        t.ifError(err2, 'Error getting routing tables for ' +
                            'VM ' + vm.uuid);
                        if (err2) {
                            return callback(err2);
                        }

                        t.deepEqual(table, routingTable,
                            'routing table' + desc);
                        return callback();
                    });
                }, waitAfter);
                return;
            }

            if (i == RESTART_TRIES) {
                t.ok(false, format('network/physical service for VM %s did ' +
                    'not restart after %d seconds', vm.uuid,
                    (interval / 1000) * RESTART_TRIES));
                return callback();
            }

            timeout = setTimeout(checkService, timeout);
        });
    }

    timeout = setTimeout(checkService, timeout);
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
            nics: [ { nic_tag: 'admin', ip: 'dhcp' } ]
        }
    ],

    [ 'gateway nic: dhcp nic',
        format(INVALID_NIC, 'nics[0]'),
        {
            routes: { '10.2.0.0/24': 'nics[0]' },
            nics: [ { nic_tag: 'admin', ip: 'dhcp' } ]
        }
    ],

    [ 'maintain_resolvers: invalid',
        format(INVALID_VAL, 'maintain_resolvers'),
        { maintain_resolvers: 'asdf' }
    ]
];


test('validation failures', function(t) {
    async.forEachSeries(failures, function (fail, cb) {
        var desc = ' (' + fail[0] + ')';
        var newPayload = {};
        var state = {
            brand: 'joyent-minimal',
            expect_create_failure: true
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


test('update routes and resolvers', function(t) {
    var state = {
        brand: 'joyent-minimal'
    };
    var vm;

    // Routes set in the zone
    var inZoneRoutes = {};
    // Routes controlled by vmadm:
    var vmadmRoutes = {
        '172.21.1.1': '172.20.1.2',     // nics[1].ip
        '172.22.2.0/24': '172.19.1.1'
    };
    // Kernel's routing table for the zone:
    var routingTable = {
        '172.19.1.0': '172.19.1.2',     // nics[1] local subnet route
        '172.20.1.0': '172.20.1.2',     // nics[2] local subnet route
        '172.21.1.1': '172.20.1.2',
        '172.22.2.0': '172.19.1.1'
    };
    var oldResolvers;
    var resolvers = [ '172.21.1.1' ];
    var routes = {
        '172.21.1.1': 'nics[1]',
        '172.22.2.0/24': '172.19.1.1'
    };
    var newPayload = {
        nics: [
            { nic_tag: 'admin',
              ip: '172.19.1.2',
              netmask: '255.255.255.0' },
            { nic_tag: 'admin',
              ip: '172.20.1.2',
              netmask: '255.255.255.0' },
        ],
        maintain_resolvers: true,
        nowait: false,
        resolvers: resolvers,
        routes: routes
    };

    for (var k in payload) {
        newPayload[k] = payload[k];
    }

    newPayload.autoboot = true;

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, newPayload, state, [
        function (cb) {
            getStartTimes(t, state, 'after provision', cb);
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading new VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes present');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers present');
                    vm = obj;

                    t.deepEqual(vmResolvers(vm), resolvers,
                        'initial resolvers in resolv.conf');
                    t.deepEqual(vmRoutes(vm), vmadmRoutes,
                        'initial routes in static_routes');
                }

                cb(err);
            });
        },

        function (cb) {
            validateZoneData(t, vm, {
                desc: 'initial',
                start: true,
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            var updatePayload = {
                remove_routes: [ '172.22.2.0/24' ],
                resolvers: [ '8.8.8.8', '8.8.4.4' ],
                set_routes: {
                    '172.22.3.0/24': '172.19.1.1'
                }
            };
            delete routes['172.22.2.0/24'];
            delete routingTable['172.22.2.0'];
            delete vmadmRoutes['172.22.2.0/24'];

            routes['172.22.3.0/24'] = '172.19.1.1';
            vmadmRoutes['172.22.3.0/24'] = '172.19.1.1';
            routingTable['172.22.3.0'] = '172.19.1.1';

            resolvers = updatePayload.resolvers;

            updateVM(t, state, updatePayload, 'update 1', cb);
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading VM after update 1');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'update 1: routes updated');
                    t.deepEqual(obj.resolvers, resolvers,
                        'update 1: resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            validateZoneData(t, vm, {
                desc: 'update 1',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
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
            // Allow removing a nic and the route that refers to it at
            // the same time
            var updatePayload = {
                remove_nics: [ vm.nics[1].mac ],
                remove_routes: [ '172.21.1.1' ]
            };
            delete routes['172.21.1.1'];
            delete routingTable['172.21.1.1'];
            delete vmadmRoutes['172.21.1.1'];

            updateVM(t, state, updatePayload, 'update 2', cb);
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes updated');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers updated');
                    vm = obj;
                }

                cb(err);
            });
        },

        function (cb) {
            validateZoneData(t, vm, {
                desc: 'update 2',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
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

            updateVM(t, state, updatePayload, 'update 3', cb);
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading VM');
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
            validateZoneData(t, vm, {
                desc: 'update 3',
                resolvers: oldResolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // The changes should persist across reboots
            VM.reboot(state.uuid, {}, function(err) {
                if (err) {
                    t.ifError(err, 'reboot VM');
                    return cb(err);
                }

                VM.load(state.uuid, function (err2, obj) {
                    t.ifError(err2, 'loading VM');
                    if (obj) {
                        t.deepEqual(obj.routes, routes,
                            'routes are the same after reboot');
                        t.deepEqual(obj.resolvers, resolvers,
                            'resolvers are the same after reboot');
                        vm = obj;
                    }

                    cb(err2);
                });
            });
        },

        function (cb) {
            // This is delayed from update 2 above - we removed the nic
            // (and therefore its route), but the nic won't be really
            // gone until after the reboot.
            delete routingTable['172.20.1.0'];

            // resolv.conf and static_routes should be unchanged
            validateZoneData(t, vm, {
                desc: 'after reboot',
                start: true,
                resolvers: oldResolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Set maintain_resolvers again: we should now have the new
            // resolvers in the zone
            updateVM(t, state, {maintain_resolvers: true}, 'update 4', cb);
        },

        function (cb) {
            // resolv.conf and static_routes should now match the VM object
            validateZoneData(t, vm, {
                desc: 'update 4',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Add a route inside the VM
            runRouteCmd(t, state.uuid, '-p add 172.22.4.0/24 172.19.1.253', cb);
        },

        function (cb) {
            // Confirm that the route was applied
            routingTable['172.22.4.0'] = '172.19.1.253';
            inZoneRoutes['172.22.4.0/24'] = '172.19.1.253';

            getRoutingTables(state.uuid, function (err, res) {
                t.ifError(err, 'getting routes');
                if (res) {
                    t.deepEqual(res, routingTable,
                       'routes after adding in-zone route');
                }

                cb(err);
            });
        },

        function (cb) {
            // Add the same route with vmadm - it should not get added to
            // static_routes.vmadm
            var updatePayload = {
                set_routes: {
                    '172.22.4.0/24': '172.19.1.253'
                }
            };

            updateVM(t, state, updatePayload, 'update 5', cb);
        },

        function (cb) {
            validateZoneData(t, vm, {
                desc: 'update 5',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Add the same route with vmadm - it should not get added to
            // static_routes.vmadm
            var updatePayload = {
                set_routes: {
                    '172.22.5.0/24': '172.19.1.253'
                }
            };

            updateVM(t, state, updatePayload, 'update 6', cb);
        },

        function (cb) {
            routingTable['172.22.5.0'] = '172.19.1.253';
            vmadmRoutes['172.22.5.0/24'] = '172.19.1.253';

            validateZoneData(t, vm, {
                desc: 'update 6',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Add the same route inside the VM
            runRouteCmd(t, state.uuid, '-p add 172.22.5.0/24 172.19.1.253', cb);
        },

        function (cb) {
            inZoneRoutes['172.22.5.0/24'] = '172.19.1.253';

            validateZoneData(t, vm, {
                desc: 'after route add 172.22.5.0/24',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Delete the route from vmadm.  This shouldn't remove the route
            // from static_routes or the routing tables
            var updatePayload = {
                remove_routes: [ '172.22.5.0/24' ]
            };

            updateVM(t, state, updatePayload, 'update 7', cb);
        },

        function (cb) {
            delete vmadmRoutes['172.22.5.0/24'];

            validateZoneData(t, vm, {
                desc: 'update 7',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // Remove the rest of the vmadm-defined routes.
            var updatePayload = {
                remove_routes: [ ]
            };
            for (var r in vmadmRoutes) {
                updatePayload.remove_routes.push(r);
                delete vmadmRoutes[r];
            }

            delete routingTable['172.22.3.0'];
            updateVM(t, state, updatePayload, 'update 8', cb);
        },

        function (cb) {
            validateZoneData(t, vm, {
                desc: 'update 8',
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            VM.reboot(state.uuid, {}, function(err) {
                t.ifError(err, 'reboot VM');
                return cb(err);
            });
        },

        function (cb) {
            // resolv.conf and static_routes should be unchanged
            validateZoneData(t, vm, {
                desc: 'after second reboot',
                start: true,
                resolvers: resolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // static_routes.vmadm should not exist anymore
            t.ok(!fs.existsSync(path.join(vm.zonepath,
                'root/etc/inet/static_routes.vmadm')),
                'static_routes.vmadm no longer exists');
            cb();
        },

        function (cb) {
            debugKeepVM(state, cb);
        }

    ], function (err) {
        return t.end();
    });
});


test('create zone without maintain_resolvers', function(t) {
    var state = {
        'brand': 'joyent-minimal'
    };
    var vm;

    var inZoneRoutes = {};
    var vmadmRoutes = {
        '172.21.1.1': '172.20.1.3'     // nics[0].ip
    };
    var routingTable = {
        '172.20.1.0': '172.20.1.3',
        '172.21.1.1': '172.20.1.3'
    };
    var oldResolvers;
    var resolvers = [ '172.21.1.1' ];
    var routes = {
        '172.21.1.1': 'nics[0]'
    };
    var newPayload = {
        nics: [
            { nic_tag: 'admin',
              ip: '172.20.1.3',
              netmask: '255.255.255.0' },
        ],
        // leaving out maintain_resolvers on purpose
        nowait: false,
        resolvers: resolvers,
        routes: routes
    };

    for (var k in payload) {
        newPayload[k] = payload[k];
    }

    newPayload.autoboot = true;

    vmtest.on_new_vm(t, vmtest.CURRENT_SMARTOS_UUID, newPayload, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading new VM');
                if (obj) {
                    t.deepEqual(obj.routes, routes, 'routes present');
                    t.deepEqual(obj.resolvers, resolvers, 'resolvers present');
                    vm = obj;

                    // We expect the resolvers to be set on the initial boot
                    t.deepEqual(vmResolvers(vm), resolvers,
                        'resolvers in resolv.conf');
                    t.deepEqual(vmRoutes(vm), vmadmRoutes,
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
            delete vmadmRoutes['172.22.2.0/24'];

            routes['172.22.3.0/24'] = '172.19.1.1';
            vmadmRoutes['172.22.3.0/24'] = '172.19.1.1';

            oldResolvers = resolvers;
            resolvers = updatePayload.resolvers;

            updateVM(t, state, updatePayload, 'update 1', cb);
        },

        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                t.ifError(err, 'loading VM');
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

            validateZoneData(t, vm, {
                desc: 'update 1',
                resolvers: oldResolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            // The old resolvers should stay across reboots
            VM.reboot(state.uuid, {}, function(err) {
                if (err) {
                    t.ifError(err, 'reboot VM');
                    return cb(err);
                }

                VM.load(state.uuid, function (err2, obj) {
                    t.ifError(err2, 'loading VM');
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
            validateZoneData(t, vm, {
                start: true,
                desc: 'after reboot',
                resolvers: oldResolvers,
                vmadmRoutes: vmadmRoutes,
                inZoneRoutes: inZoneRoutes,
                routingTable: routingTable
            }, cb);
        },

        function (cb) {
            debugKeepVM(state, cb);
        }

    ], function (err) {
        return t.end();
    });
});
