// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that default values don't change accidentally.
//

var async = require('/usr/node/node_modules/async');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;

test('create VM with 2 nics', function(t) {
    var state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-primary-flag-' + process.pid,
        autoboot: false,
        do_not_inventory: true,
        nowait: true,
        nics: [
            {nic_tag: 'admin', ip: 'dhcp'},
            {nic_tag: 'admin', ip: 'dhcp'}
        ]
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var has_primary = 0;
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        t.ok((n.primary === true),
                            'nic.primary is boolean true');
                        has_primary++;
                    }
                }

                t.ok((has_primary === 1), 'VM has ' + has_primary + ' primary'
                    + ' nics, expected: 1');
                cb();
            });
        }, function (cb) {
            // test setting other primary
            VM.load(state.uuid, function(err, obj) {
                var n;
                var update_mac;

                if (err) {
                    t.ok(false, 'VM.load: ' + err.message);
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (!n.hasOwnProperty('primary')) {
                        if (update_mac) {
                            t.ok(false, 'Found more than one primary');
                            cb();
                            return;
                        }
                        update_mac = n.mac;
                    }
                }

                if (!update_mac) {
                    t.ok(false, 'No non-primary nics found ' + update_mac);
                    cb();
                    return;
                }

                VM.update(state.uuid, {update_nics: [{mac: update_mac, primary: true}]},
                    function (e) {

                    t.ok((!e), 'updating to set non-primary -> primary');
                    if (e) {
                        return cb(e);
                    }

                    VM.load(state.uuid, function (err, obj) {
                        t.ok(!err, 'reloading obj after update');
                        if (err) {
                            return cb(err);
                        }
                        for (n in obj.nics) {
                            n = obj.nics[n];
                            t.ok(!n.hasOwnProperty('primary')
                                || (n.mac === update_mac
                                    && n.hasOwnProperty('primary')), 'nic '
                                        + n.mac + ' has correct primary flag '
                                        + 'setting: ' + n.primary);
                        }
                        cb();
                    });
                });

            });
        }, function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var n;
                var update_mac;

                t.ok(!err, 'VM.load: ' + (err ? err.message : 'ok'));
                if (err) {
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        update_mac = n.mac;
                    }
                }

                VM.update(state.uuid, {update_nics: [{mac: update_mac, primary: false}]}, function (e) {

                    t.ok(e, 'updating to set primary=false failed');
                    cb();
                });
            });
        }, function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var n;
                var update_mac;

                t.ok(!err, 'VM.load: ' + (err ? err.message : 'ok'));
                if (err) {
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        update_mac = n.mac;
                    }
                }

                VM.update(state.uuid, {update_nics: [{mac: update_mac, primary: 'blah'}]},
                    function (e) {

                    t.ok(e, 'updating to set primary="blah" failed');
                    cb();
                });
            });
        }, function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var n;
                var existing_macs = [];

                t.ok(!err, 'VM.load: ' + (err ? err.message : 'ok'));
                if (err) {
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    existing_macs.push(n.mac);
                }

                VM.update(state.uuid, {add_nics: [{primary: true, nic_tag: 'admin', ip: 'dhcp'}]},
                    function (e) {

                    t.ok(!e, 'add nic failed');
                    if (e) {
                        return cb(e);
                    }

                    VM.load(state.uuid, function (err, obj) {
                        t.ok(!err, 'VM.load reload after create: '
                             + (err ? err.message : 'ok'));
                        if (err) {
                           return cb(err);
                        }

                        for (n in obj.nics) {
                            n = obj.nics[n];
                            if (existing_macs.indexOf(n.mac) !== -1) {
                                // old one, should not be primary
                                t.ok(!n.hasOwnProperty('primary'), 'old no longer primary');
                            } else {
                                // new one, should be primary
                                t.ok(n.hasOwnProperty('primary'), 'new is now primary');
                            }
                        }

                        cb();
                    });
                });
            });
        }
    ], function (err) {
        t.end();
    });
});

test('create VM with 2 nics (second primary)', function(t) {
    var state = {brand: 'joyent-minimal'};
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-primary-flag-' + process.pid,
        autoboot: false,
        do_not_inventory: true,
        nowait: true,
        nics: [
            {nic_tag: 'admin', ip: 'dhcp'},
            {nic_tag: 'admin', ip: 'dhcp', primary: 1}
        ]
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var has_primary = 0;
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        t.ok((n.primary === true),
                            'nic.primary is boolean true');
                        has_primary++;
                    }
                }

                t.ok((has_primary === 1), 'VM has ' + has_primary + ' primary'
                    + ' nics, expected: 1');
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});

test('create VM with 3 nics (all primary)', function(t) {
    var state = {
        brand: 'joyent-minimal',
        expect_create_failure: true
    };
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-primary-flag-' + process.pid,
        autoboot: false,
        do_not_inventory: true,
        nowait: true,
        nics: [
            {nic_tag: 'admin', ip: 'dhcp', primary: true},
            {nic_tag: 'admin', ip: 'dhcp', primary: true},
            {nic_tag: 'admin', ip: 'dhcp', primary: 1}
        ]
    }, state, [], function (err) {
        t.end();
    });
});

test('create VM with 3 nics (one primary, 2 false)', function(t) {
    var state = { brand: 'joyent-minimal' };
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-primary-flag-' + process.pid,
        autoboot: false,
        do_not_inventory: true,
        nowait: true,
        nics: [
            {nic_tag: 'admin', ip: 'dhcp', primary: true},
            {nic_tag: 'admin', ip: 'dhcp', primary: false},
            {nic_tag: 'admin', ip: 'dhcp', primary: false}
        ]
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var has_primary = 0;
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        t.ok((n.primary === true),
                            'nic.primary is boolean true');
                        has_primary++;
                    }
                }

                t.ok((has_primary === 1), 'VM has ' + has_primary + ' primary'
                    + ' nics, expected: 1');
                cb();
            });
        }
    ],
    function (err) {
        t.end();
    });
});

test('create VM with 3 nics (all false)', function(t) {
    var state = { brand: 'joyent-minimal' };
    vmtest.on_new_vm(t, image_uuid, {
        alias: 'test-primary-flag-' + process.pid,
        autoboot: false,
        do_not_inventory: true,
        nowait: true,
        nics: [
            {nic_tag: 'admin', ip: 'dhcp', primary: false},
            {nic_tag: 'admin', ip: 'dhcp', primary: false},
            {nic_tag: 'admin', ip: 'dhcp', primary: false}
        ]
    }, state, [
        function (cb) {
            VM.load(state.uuid, function(err, obj) {
                var has_primary = 0;
                var n;

                if (err) {
                    t.ok(false, 'load obj from new VM: ' + err.message);
                    return cb(err);
                }

                for (n in obj.nics) {
                    n = obj.nics[n];
                    if (n.hasOwnProperty('primary')) {
                        t.ok((n.primary === true),
                            'nic.primary is boolean true');
                        has_primary++;
                    }
                }

                t.ok((has_primary === 1), 'VM has ' + has_primary + ' primary'
                    + ' nics, expected: 1');
                cb();
            });
        }
    ], function (err) {
        t.end();
    });
});
