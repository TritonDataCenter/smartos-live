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

var IMAGE_UUID = vmtest.CURRENT_SMARTOS;
var TEST_OPTS = {'timeout': 240000};
var ERR_STR = 'Invalid nic tag "%s"';


function admin_nic_from_sysinfo(sysinfo) {
    var admin_nic = null;
    var nic_name;
    for (nic_name in sysinfo["Network Interfaces"]) {
        var nic = sysinfo["Network Interfaces"][nic_name];
        if (nic["NIC Names"].indexOf('admin')) {
            admin_nic = nic;
            break;
        }
    }
    return {name: nic_name, nic: admin_nic};
}

function reset_nic_tags(callback) {
    try {
        fs.unlinkSync('/tmp/bootparams');
    } catch (err) {
        if (e.code !== 'ENOENT') {
            callback(e);
            return;
        }
    }
    VM.getSysinfo(['-f'], callback);
}

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

// Assigns the nic tags in names to the admin nic: afterward, the
// admin nic has tags of ['admin'].concat(names)
function set_admin_nic_tags(t, names, callback) {
    VM.getSysinfo(function (err, sysinfo) {
        var admin_nic_info = admin_nic_from_sysinfo(sysinfo);
        var admin_nic = admin_nic_info.nic;
        var nic_name = admin_nic_info.name;

        t.ok(admin_nic, util.format('Found admin nic %s: %j', nic_name, admin_nic));
        if (!admin_nic) {
            callback(new Error('could not find admin nic'));
            return;
        }

        // Undo any changes we may have already made to the bootparams:
        try {
            fs.unlinkSync('/tmp/bootparams');
        } catch (e) {
            if (e.code !== 'ENOENT') {
                callback(e);
                return;
            }
        }

        cp.execFile('/usr/bin/bootparams', function (e, stdout, stderr) {
            var new_bootparams = stdout;
            if (e) {
                t.ok(false, 'error running bootparams: ' + e.message);
                callback(e);
                return;
            }

            for (var name in names) {
                new_bootparams += util.format("%s_nic=%s\n", names[name],
                    admin_nic["MAC Address"]);
            }
            fs.writeFileSync('/tmp/bootparams', new_bootparams);

            VM.getSysinfo(['-f'], function (er, new_sysinfo) {
                var tag_list;

                if (er) {
                  t.ok(false, 'error running sysinfo: ' + e.message);
                  callback(e);
                  return;
                }

                tag_list = new_sysinfo["Network Interfaces"][nic_name]["NIC Names"];
                t.ok(tag_list,
                  util.format("got tag list for new admin nic: %j",
                  tag_list));
                for (var n in names) {
                    t.notEqual(tag_list.indexOf(names[n]), -1,
                        "admin nic now tagged with " + names[n]);
                }

                callback(null, new_sysinfo);
                return;
            });
        });
    });
}

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

    set_admin_nic_tags(t, ['new_tag1', 'new_tag2'], function (err) {
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
              'nics': [
                { 'nic_tag': 'new_tag1', 'ip': 'dhcp' }
              ]
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
                    set_admin_nic_tags(t, ['new_tag2'],
                        function (err, sysinfo) {
                        var admin_nic_info;

                        t.ifErr(err, 'removing new_tag1');

                        if (sysinfo) {
                            admin_nic_info = admin_nic_from_sysinfo(sysinfo);
                            t.equal(
                                admin_nic_info.nic['NIC Names'].indexOf(
                                'new_tag1'), -1,
                                'admin nic not tagged with new_tag1');
                        }

                        cb(err);
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

                reset_nic_tags(function (e) {
                    t.notOk(e, "reset nic tags: " + (e ? e.message : "ok"));
                    t.end();
                });
            });
    });
});

test('create etherstub', TEST_OPTS,
    function(t) {
    dladm.createEtherstub('new_stub1', VM.log, function (err) {
        t.ifError(err, 'create new_stub1')
        t.end();
    });
});

test('booting with invalid etherstub', TEST_OPTS,
    function(t) {
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
