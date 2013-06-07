// Copyright 2012 Joyent, Inc.  All rights reserved.
//
// Test invalid nic tag detection
//

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var dladm = require('/usr/vm/node_modules/dladm');
var fs = require('fs');
var test = require('tap').test;
var util = require('util');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var ERR_STR = 'Invalid nic tag "%s"';
var IMAGE_UUID = vmtest.CURRENT_SMARTOS_UUID;
var NICTAGADM = '/usr/bin/nictagadm';
var TAGS_ADDED = [];
var TEST_OPTS = {'timeout': 240000};



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
                t.ifErr(er, 'loading stopped VM');
                t.equal(obj.state, 'stopped', 'VM is stopped');
                callback(er);
            });
        });
    });
}



// --- nic tag-related helpers



// List all nic tags on the system, returning an object mapping tag names
// to MAC addresses
function listTags(callback) {
    // list output looks like:
    //   external|00:50:56:3d:a7:95
    cp.execFile(NICTAGADM, ['list', '-p', '-d', '|'],
        function (err, stdout, stderr) {
        if (err) {
            return callback(err);
        }

        var tags = {};

        stdout.split('\n').forEach(function (line) {
            var tagData = line.split('|');
            if (tagData[1] === '-') {
                return;
            }

            tags[tagData[0]] = tagData[1];
        });

        return callback(null, tags);
    });
}


// Assigns the nic tags in names to the admin nic: afterward,
// the admin nic has tags of:
//     ['admin', <any other tags it had before>].concat(names)
function add_admin_nic_tags(t, names, callback) {
    listTags(function (err, tags) {
        t.ifErr(err, 'error listing nic tags');
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

            cp.execFile(NICTAGADM, ['add', name, admin_nic],
                function (err2, stdout, stderr) {
                t.ifErr(err2, 'nictagadm add ' + name + ' ' + admin_nic);
                if (err2) {
                    return cb(err2);
                }

                return cb();
            });
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

    listTags(function (err, tags) {
        t.ifErr(err, 'error listing nic tags');
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

            var args = ['delete'];
            if (force) {
                args.push('-f');
            }
            args.push(name);

            cp.execFile(NICTAGADM, args, function (err2, stdout, stderr) {
                t.ifErr(err2, 'nictagadm delete ' + name);
                if (err2) {
                    return cb(err2);
                }

                return cb();
            });

        }, callback);
    });
}


// Resets the nic tags for the admin nic to their state before the
// test was run
function reset_nic_tags(t, callback) {
    remove_admin_nic_tags(t, TAGS_ADDED, false, callback);
}



// --- Tests



test('create with invalid nic tag', TEST_OPTS, function(t) {
    var state = {'brand': 'joyent-minimal', 'expect_create_failure': true };
    vmtest.on_new_vm(t, IMAGE_UUID,
        { 'autoboot': false,
          'do_not_inventory': true,
          'alias': 'autozone-' + process.pid,
          'nowait': false,
          'nics': [
            { 'nic_tag': 'does_not_exist', 'ip': 'dhcp' }
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

test('reboot / shutdown / start / update with invalid nic tag', TEST_OPTS,
    function(t) {
    var state = {'brand': 'joyent-minimal'};
    var vm;

    add_admin_nic_tags(t, ['new_tag1', 'new_tag2'], function (err) {
        if (err) {
            t.end();
            return;
        }

        // Create a VM with a nic on new_tag1
        vmtest.on_new_vm(t, IMAGE_UUID,
            { 'autoboot': true,
              'do_not_inventory': true,
              'alias': 'autozone-' + process.pid,
              'nowait': false,
              'nics': [ {
                  'nic_tag': 'new_tag1',
                  'ip': '10.11.12.13',
                  'netmask': '255.255.255.0'
              } ]
            }, state, [
                function (cb) {
                    // Verify that the nic has new_tag1
                    VM.load(state.uuid, function(err, obj) {
                        t.ifErr(err, 'loading new VM');
                        if (obj) {
                            t.equal(obj.nics[0].nic_tag, 'new_tag1',
                                'VM created with new nic tag');
                            vm = obj;
                        }

                        cb(err);
                    });
                }, function (cb) {
                    // Remove new_tag1
                    remove_admin_nic_tags(t, 'new_tag1', true, function (err) {
                        t.ifErr(err, 'removing new_tag1');
                        if (err) {
                            cb(err);
                            return;
                        }

                        listTags(function (err2, tags) {
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
                      'update_nics': [
                          {
                              mac: vm.nics[0].mac,
                              nic_tag: 'new_tag2'
                          }
                      ]
                    };

                    VM.update(state.uuid, payload, function(err) {
                        t.ifErr(err, 'Updating VM');

                        cb();
                    });
                }, function (cb) {
                    // Update to invalid nic tag should fail
                    var payload = {
                      'update_nics': [
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
                t.ifErr(err, 'Error during chain');

                reset_nic_tags(t, function (e) {
                    t.notOk(e, "reset nic tags: " + (e ? e.message : "ok"));
                    t.end();
                });
            });
    });
});

test('create etherstub', TEST_OPTS, function(t) {
    dladm.createEtherstub('new_stub1', VM.log, function (err) {
        t.ifError(err, 'create new_stub1')
        t.end();
    });
});

test('booting with invalid etherstub', TEST_OPTS, function(t) {
    var state = {'brand': 'joyent-minimal'};
    var vm;

    // Create a VM with a nic on new_tag1
    vmtest.on_new_vm(t, IMAGE_UUID,
        { 'autoboot': true,
          'do_not_inventory': true,
          'alias': 'autozone-' + process.pid,
          'nowait': false,
          'nics': [
            { 'nic_tag': 'new_stub1',
              'ip': '10.4.4.40',
              'netmask': '255.255.255.0'
            },
            { 'nic_tag': 'external',
              'ip': '10.88.88.99',
              'netmask': '255.255.255.0',
              'primary': true
            }
          ]
        }, state, [
            function (cb) {
                // Verify that the nic has new_stub1
                VM.load(state.uuid, function(err, obj) {
                    t.ifErr(err, 'loading new VM');
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
                    t.ifErr(err, 'Error loading VM');
                    if (obj) {
                        t.equal(obj.state, 'stopped', 'VM is stopped');
                    }

                    cb(err);
                });
            }, function (cb) {
                // Remove new_stub1
                dladm.deleteEtherstub('new_stub1', VM.log, function (err, sysinfo) {
                    t.ifErr(err, 'removing new_stub1');

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
            t.ifErr(err, 'No error in chain');
            t.end();
        });
});

// This is just in case the delete in the test above didn't work
test('delete etherstub', TEST_OPTS, function(t) {
    dladm.deleteEtherstub('new_stub1', VM.log, function (e) {
        t.ok(true);
        t.end();
    });
});
