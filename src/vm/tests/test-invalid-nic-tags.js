// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// Test invalid nic tag detection
//

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var dladm = require('/usr/vm/node_modules/dladm');
var fs = require('fs');
var util = require('util');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');
var mod_tag = require('../common/nictag');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var ERR_STR = 'Invalid nic tag "%s"';
var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var TAGS_ADDED = [];


// --- VM-related helpers


// Stop a VM (and wait for it to actually be stopped)
function stopVM(t, vm, uuid, callback) {
    VM.stop(uuid, {}, function (err) {
        t.notOk(err, 'No error stopping VM');
        if (err) {
            t.ok(false, "error stopping: " + err.message);
        }

        VM.waitForZoneState(vm, 'installed', {timeout: 30},
            function(e) {
            // Allow an error here - maybe the zone is already stopped.
            // We'll catch the inconsistency with the test below.

            VM.load(uuid, function(er, obj) {
                t.ifError(er, 'loading stopped VM');
                t.equal(obj.state, 'stopped', 'VM is stopped');
                callback(er);
            });
        });
    });
}



// --- nic tag-related helpers



// Assigns the nic tags in names to the admin nic: afterward,
// the admin nic has tags of:
//     ['admin', <any other tags it had before>].concat(names)
function add_admin_nic_tags(t, names, callback) {
    mod_tag.list(t, function (err, tags) {
        t.ifError(err, 'error listing nic tags');
        if (err) {
            callback(err);
            return;
        }

        var admin_nic = tags.admin;
        if (!tags.admin) {
            var msg = 'Could not find admin nic!';
            t.ok(false, msg);
            callback(new Error(msg));
            return;
        }

        async.forEachSeries(names, function _addTag(name, cb) {
            // Record so we can reset at the end of the test
            TAGS_ADDED.push(name);

            if (tags.hasOwnProperty(name)) {
                if (tags[name] !== admin_nic) {
                    cb(new Error('tag "' + name
                        + '" is already assigned to non-admin nic "'
                        + tags[name] + '"'));
                    return;
                }

                t.ok(true, 'Skipping adding nic tag "' + name +
                    '", since it is already assigned');
                cb();
                return;
            }

            mod_tag.add(t, name, admin_nic, cb);
        }, callback);
    });
}

// Assigns the nic tags in names to the admin nic: afterward,
// the admin nic has tags of:
//     ['admin', <any other tags it had before>].concat(names)
function remove_admin_nic_tags(t, names, force, callback) {
    if (typeof (names) !== 'object') {
        names = [ names ];
    }

    mod_tag.list(t, function (err, tags) {
        t.ifError(err, 'error listing nic tags');
        if (err) {
            callback(err);
            return;
        }

        var admin_nic = tags.admin;
        if (!tags.admin) {
            var msg = 'Could not find admin nic!';
            t.ok(false, msg);
            callback(new Error(msg));
            return;
        }

        if (!names || names.length === 0) {
            callback();
            return;
        }

        async.forEachSeries(names, function _rmTag(name, cb) {
            if (!tags.hasOwnProperty(name)) {
                t.ok(true, 'Skipping removing nic tag "' + name +
                    '", since it is not assigned');
                cb();
                return;
            }

            mod_tag.del(t, name, force, cb);
            return;
        }, callback);
    });
}


// Resets the nic tags for the admin nic to their state before the
// test was run
function reset_nic_tags(t, callback) {
    remove_admin_nic_tags(t, TAGS_ADDED, false, callback);
}



// --- Tests



test('create with invalid nic tag', function(t) {
    var state = {brand: 'joyent-minimal', expect_create_failure: true };
    vmtest.on_new_vm(t, IMAGE_UUID,
        {
          alias: 'test-invalid-nic-tags-' + process.pid,
          autoboot: false,
          do_not_inventory: true,
          nowait: false,
          nics: [
            { nic_tag: 'does_not_exist', ip: 'dhcp' }
          ]
        }, state, [],
        function (err) {
            t.ok(state.hasOwnProperty('create_err'), 'create_err set');
            t.equal(state.create_err.message,
                util.format(ERR_STR, 'does_not_exist'),
                'create returns invalid nic tag message');
            t.end();
        });
});

test('reboot / shutdown / start / update with invalid nic tag',
    function(t) {
    var state = {brand: 'joyent-minimal'};
    var vm;

    add_admin_nic_tags(t, ['new_tag1', 'new_tag2'], function (err) {
        if (err) {
            t.end();
            return;
        }

        // Create a VM with a nic on new_tag1
        vmtest.on_new_vm(t, IMAGE_UUID,
            {
              alias: 'test-invalid-nic-tags-' + process.pid,
              autoboot: true,
              do_not_inventory: true,
              nowait: false,
              nics: [ {
                  nic_tag: 'new_tag1',
                  ip: '10.11.12.13',
                  netmask: '255.255.255.0'
              } ]
            }, state, [
                function (cb) {
                    // Verify that the nic has new_tag1
                    VM.load(state.uuid, function(err, obj) {
                        t.ifError(err, 'loading new VM');
                        if (obj) {
                            t.equal(obj.nics[0].nic_tag, 'new_tag1',
                                'VM created with new nic tag');
                            t.equal(obj.state, 'running', 'VM is running');
                            vm = obj;
                        }

                        cb(err);
                    });
                }, function (cb) {
                    // Remove new_tag1
                    remove_admin_nic_tags(t, 'new_tag1', true, function (err) {
                        t.ifError(err, 'removing new_tag1');
                        if (err) {
                            cb(err);
                            return;
                        }

                        mod_tag.list(t, function (err2, tags) {
                            if (err2) {
                                cb(err2);
                                return;
                            }

                            t.equal(tags.new_tag1, undefined,
                                'new_tag1 deleted');

                            cb();
                        });
                    });
                }, function (cb) {
                    // VM should refuse to reboot due to missing nic tag
                    VM.reboot(state.uuid, {}, function(err) {
                        t.ok(err, 'Error rebooting');
                        t.equal(err.message, 'Cannot reboot vm: '
                            + util.format(ERR_STR, 'new_tag1'),
                            'VM refused to reboot due to missing nic tag');

                        cb();
                    });
                }, function (cb) {
                    stopVM(t, vm, state.uuid, cb);
                }, function (cb) {
                    // Starting VM should error out
                    VM.start(state.uuid, {}, function(err) {
                        t.ok(err, 'Error starting VM');
                        if (err) {
                            t.equal(err.message,
                                util.format(ERR_STR, 'new_tag1'));
                        }

                        cb();
                    });
                }, function (cb) {
                    // Update to valid nic tag
                    var payload = {
                      update_nics: [
                          {
                              mac: vm.nics[0].mac,
                              nic_tag: 'new_tag2'
                          }
                      ]
                    };

                    VM.update(state.uuid, payload, function(err) {
                        t.ifError(err, 'Updating VM');

                        cb();
                    });
                }, function (cb) {
                    // Update to invalid nic tag should fail
                    var payload = {
                      update_nics: [
                          {
                              mac: vm.nics[0].mac,
                              nic_tag: 'new_tag1'
                          }
                      ]
                    };

                    VM.update(state.uuid, payload, function(err) {
                        t.ok(err, 'Error updating VM');
                        if (err) {
                            t.equal(err.message,
                                util.format(ERR_STR, 'new_tag1'));
                        }

                        cb();
                    });
                }
            ],
            function (err) {
                t.ifError(err, 'Error during chain');

                reset_nic_tags(t, function (e) {
                    t.notOk(e, "reset nic tags: " + (e ? e.message : "ok"));
                    t.end();
                });
            });
    });
});

test('create etherstub', function(t) {
    dladm.createEtherstub('new_stub1', VM.log, function (err) {
        t.ifError(err, 'create new_stub1')
        t.end();
    });
});

test('booting with invalid etherstub', function(t) {
    var state = {brand: 'joyent-minimal'};
    var vm;

    // Create a VM with a nic on new_tag1
    vmtest.on_new_vm(t, IMAGE_UUID,
        {
          alias: 'test-invalid-nic-tags-' + process.pid,
          autoboot: true,
          do_not_inventory: true,
          nowait: false,
          nics: [
            { nic_tag: 'new_stub1',
              ip: '10.4.4.40',
              netmask: '255.255.255.0'
            },
            { nic_tag: 'external',
              ip: '10.88.88.99',
              netmask: '255.255.255.0',
              primary: true
            }
          ]
        }, state, [
            function (cb) {
                // Verify that the nic has new_stub1
                VM.load(state.uuid, function(err, obj) {
                    t.ifError(err, 'loading new VM');
                    if (obj) {
                        t.equal(obj.nics[0].nic_tag, 'new_stub1',
                            'VM created with new nic tag');
                        vm = obj;
                    }

                    cb(err);
                });
            }, function (cb) {
                stopVM(t, vm, state.uuid, cb);
            }, function (cb) {
                // Confirm VM is stopped
                VM.load(state.uuid, function(err, obj) {
                    t.ifError(err, 'Error loading VM');
                    if (obj) {
                        t.equal(obj.state, 'stopped', 'VM is stopped');
                    }

                    cb(err);
                });
            }, function (cb) {
                // Remove new_stub1
                dladm.deleteEtherstub('new_stub1', VM.log, function (err, sysinfo) {
                    t.ifError(err, 'removing new_stub1');

                    cb(err);
                });
            }, function (cb) {
                // Starting VM should error out
                VM.start(state.uuid, {}, function(err) {
                    t.ok(err, 'Error starting VM');
                    if (err) {
                        t.equal(err.message,
                            util.format(ERR_STR, 'new_stub1'),
                            'Correct error message on start');
                    }

                    cb();
                });
            }
        ],
        function (err) {
            t.ifError(err, 'No error in chain');
            t.end();
        });
});

// This is just in case the delete in the test above didn't work
test('delete etherstub', function(t) {
    dladm.deleteEtherstub('new_stub1', VM.log, function (e) {
        t.ok(true);
        t.end();
    });
});
