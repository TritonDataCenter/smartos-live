/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for enabling / disabling firewalls in a VM
 */

process.env['TAP'] = 1;
var fw = require('/usr/fw/lib/fw');
var test = require('tap').test;
var util = require('util');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('/usr/vm/test/common/vmtest');



// --- Globals



VM.loglevel = 'DEBUG';
var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var TEST_OPTS = { timeout: 240000 };



// --- Tests



test('enable / disable', TEST_OPTS, function (t) {
        var state = {
                brand: 'joyent-minimal',
                // We don't need the ubuntu image for these tests:
                ensure_images: [ IMAGE_UUID ]
        };
        var vm;
        var vm_params = {
                alias: 'fw-enable' + process.pid,
                autoboot: true,
                do_not_inventory: true,
                firewall_enabled: true,
                nics: [
                        {
                                nic_tag: 'admin',
                                ip: '10.4.0.30',
                                netmask: '255.255.255.0'
                        }
                ],
                nowait: false,
                ram: 128
        };

        // Create a VM with firewall enabled
        vmtest.on_new_vm(t, IMAGE_UUID, vm_params, state, [
                function (cb) {
                        // Verify VM object parameters
                        VM.load(state.uuid, function (err, obj) {
                                t.ifErr(err, 'loading new VM: err');
                                if (!obj) {
                                        return cb(err);
                                }

                                vm = obj;
                                t.equal(vm.firewall_enabled, true,
                                    'firewall enabled');
                                return cb();
                        });

                }, function (cb) {
                        // Verify that the firewall is running
                        fw.status({ uuid: vm.uuid }, function (err, res) {
                                t.ifErr(err, 'firewall status: err');
                                if (err) {
                                    return cb(err);
                                }

                                t.equal(res.running, true, 'status: running');
                                return cb();
                        });

                }, function (cb) {
                        VM.update(state.uuid, { firewall_enabled: false },
                                function (err, obj) {
                                t.ifErr(err, 'updating VM: err');
                                if (!obj) {
                                        return cb(err);
                                }

                                t.equal(obj.firewall_enabled, false,
                                    'firewall disabled');
                                return cb();
                        });

                }, function (cb) {
                        VM.load(state.uuid, function (err, obj) {
                                t.ifErr(err, 'loading updated VM: err');
                                if (!obj) {
                                        return cb(err);
                                }

                                vm = obj;
                                t.equal(vm.firewall_enabled, false,
                                    'firewall disabled');
                                return cb();
                        });

                }, function (cb) {
                        fw.status({ uuid: vm.uuid }, function (err, res) {
                                t.ifErr(err, 'firewall status: err');
                                if (err) {
                                        return cb(err);
                                }

                                t.equal(res.running, false,
                                    'firewall not running');
                                return cb();
                        });

                // Now re-enable and make sure the changes take effect
                }, function (cb) {
                        VM.update(state.uuid, { firewall_enabled: true },
                                function (err, obj) {
                                t.ifErr(err, 'updating VM: err');
                                if (!obj) {
                                        return cb(err);
                                }

                                t.equal(obj.firewall_enabled, true,
                                    'firewall enabled');
                                return cb();
                        });

                }, function (cb) {
                        VM.load(state.uuid, function (err, obj) {
                                t.ifErr(err, 'loading updated VM: err');
                                if (!obj) {
                                        return cb(err);
                                }

                                vm = obj;
                                t.equal(obj.firewall_enabled, true,
                                    'firewall enabled');
                                return cb();
                        });

                }, function (cb) {
                        fw.status({ uuid: vm.uuid }, function (err, res) {
                                t.ifErr(err, 'firewall status: err');
                                if (err) {
                                        return cb(err);
                                }

                                t.equal(res.running, true,
                                    'firewall running');
                                return cb();
                        });
                }

        ], function () {
                t.end();
        });
});
