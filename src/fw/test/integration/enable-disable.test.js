/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for enabling / disabling firewalls in a VM
 */

var mod_fw = require('../lib/fw');
var util = require('util');
var mod_vm = require('../lib/vm');



// --- Globals



var d = {};



// --- Tests



exports['enable / disable'] = {
    'create': function (t) {
        mod_vm.create(t, {
            params: {
                firewall_enabled: true,
                image_uuid: mod_vm.images.smartos,
                nics: [
                    {
                        nic_tag: 'admin',
                        ip: '10.4.0.30',
                        netmask: '255.255.255.0'
                    }
                ]
            },
            partialExp: {
                firewall_enabled: true
            }
        });
    },

    'fw status after create': function (t) {
        d.vm = mod_vm.lastCreated();
        t.ok(d.vm, 'have last created VM');

        mod_fw.status(t, {
            uuid: d.vm.uuid,
            partialExp: {
                running: true
            }
        });
    },

    'update: disable firewall': function (t) {
        mod_vm.update(t, {
            uuid: d.vm.uuid,
            params: {
                firewall_enabled: false
            },
            partialExp: {
                firewall_enabled: false
            }
        });
    },

    'fw status after disable': function (t) {
        mod_fw.status(t, {
            uuid: d.vm.uuid,
            partialExp: {
                running: false
            }
        });
    },

    'update: re-enable firewall': function (t) {
        mod_vm.update(t, {
            uuid: d.vm.uuid,
            params: {
                firewall_enabled: true
            },
            partialExp: {
                firewall_enabled: true
            }
        });
    },

    'fw status after re-enable': function (t) {
        mod_fw.status(t, {
            uuid: d.vm.uuid,
            partialExp: {
                running: true
            }
        });
    }
};



// --- Teardown



exports['teardown'] = function (t) {
    mod_vm.delAllCreated(t, {});
};
