// Copyright 2018 Joyent, Inc.
//
// Tests for specifying static routes in LX zones
//

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var format = require('util').format;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

var PAYLOAD_TEMPLATE = {
    alias: 'test-routes-lx' + process.pid,
    brand: 'lx',
    do_not_inventory: true,
    kernel_version: '3.13.0'
};

test('setting custom static routes for LX branded zones', function(t) {
    var state = {
        brand: 'lx'
    };
    var vm;

    var routes = {
        '172.20.42.0/24': '172.19.1.1',
        '172.22.2.0/24': '172.19.1.1'
    };

    var expectedRoutesInZone = {
        '172.19.1.0': '0.0.0.0',
        '172.20.42.0': '172.19.1.1',
        '172.22.2.0': '172.19.1.1'
    };

    var customRoutesVmPayload = {
        archive_on_delete: true,
        autoboot: true,
        nics: [
            { nic_tag: 'admin',
              ip: '172.19.1.2',
              netmask: '255.255.255.0' }
        ],
        maintain_resolvers: true,
        nowait: false,
        routes: routes
    };

    for (var k in PAYLOAD_TEMPLATE) {
        customRoutesVmPayload[k] = PAYLOAD_TEMPLATE[k];
    }

    vmtest.on_new_vm(t, vmtest.CURRENT_UBUNTU_LX_IMAGE_UUID,
        customRoutesVmPayload, state, [
        function waitVmRunning(cb) {
            var MAX_NB_TRIES = 20;
            var nbTries = 0;
            var RETRY_PERIOD_MS = 5000;

            setTimeout(function checkVmRunning() {
                ++nbTries;

                VM.load(state.uuid, function (loadErr, vmObj) {
                    t.ifError(loadErr,
                        'loading VM after create should succeed');
                    if (vmObj && vmObj.state === 'running') {
                        vm = vmObj;
                        cb();
                    } else if (vmObj.state === 'failed' ||
                        vmObj.state === 'destroyed') {
                        cb(new Error('test VM in state ' + vmObj.state))
                    } else {
                        if (nbTries >= MAX_NB_TRIES) {
                            cb(new Error('Reached max number of retries'));
                        } else {
                            setTimeout(checkVmRunning, RETRY_PERIOD_MS);
                        }
                    }
                });
            }, RETRY_PERIOD_MS);
        },

        function checkRoutes(cb) {
            cp.exec(format('/usr/sbin/zlogin %s /bin/netstat -rn |' +
                'egrep -v \'Destination|routing\' | awk \'{ print $1,$2 }\'',
                    vm.uuid), function (err, stdout, stderr) {
                        if (err) {
                            cb(err);
                            return;
                        }

                        var actualRoutes = {};
                        stdout.split(/\n/g).forEach(function (line) {
                            var parts = line.split(' ');
                            if (parts[0] == "" || parts[0] == "127.0.0.1") {
                                return;
                            }

                            actualRoutes[parts[0]] = parts[1];
                        });

                        t.deepEqual(actualRoutes, expectedRoutesInZone,
                            'routes in zone should be ' +
                                JSON.stringify(expectedRoutesInZone) +
                                ' and are: ' + JSON.stringify(actualRoutes));

                        cb();
                    });
        }

    ], function (err) {
        t.ifError(err, 'test should not have encountered any error');
        return t.end();
    });
});
