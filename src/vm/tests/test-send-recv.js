// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var kvm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;
var vmobj;

var kvm_payload = {
    alias: 'test-send-recv-' + process.pid,
    brand: 'kvm',
    autoboot: false,
    do_not_inventory: true,
    ram: 256,
    max_swap: 1024,
    disk_driver: 'virtio',
    nic_driver: 'virtio',
    disks: [
        {boot: true, image_uuid: kvm_image_uuid},
        {size: 1024}
    ],
    customer_metadata: {hello: 'world'}
};

var smartos_payload = {
    alias: 'test-send-recv-' + process.pid,
    brand: 'joyent-minimal',
    image_uuid: image_uuid,
    do_not_inventory: true,
    ram: 256,
    max_swap: 1024,
    customer_metadata: {hello: 'world'}
};

[['zone', smartos_payload], ['kvm', kvm_payload]].forEach(function (d) {
    var thing_name = d[0];
    var thing_payload = d[1];

    test('create ' + thing_name, function(t) {
        VM.create(thing_payload, function (err, obj) {
            if (err) {
                t.ok(false, 'error creating VM: ' + err.message);
                t.end();
            } else {
                VM.load(obj.uuid, function (e, o) {
                    // we wait 5 seconds here as there's a bug in the zone startup
                    // where shutdown doesn't work while part of smf is still
                    // starting itself. This should be fixed with OS-1027 when
                    // that's in as we could then just wait for the zone to go from
                    // 'provisioning' -> 'running' before continuing.
                    setTimeout(function() {
                        if (e) {
                            t.ok(false, 'unable to load VM after create');
                            abort = true;
                            t.end()
                            return;
                        }
                        vmobj = o;
                        t.ok(true, 'created VM: ' + vmobj.uuid);
                        t.end();
                    }, 5000);
                });
            }
        });
    });

    test('send ' + thing_name, function(t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }
        bundle_filename = '/var/tmp/test.' + vmobj.uuid + '.vmbundle.' + process.pid;

        cp.exec('/usr/vm/sbin/vmadm send ' + vmobj.uuid + ' > ' + bundle_filename,
            function (error, stdout, stderr) {
                if (error) {
                    t.ok(false, 'vm send to ' + bundle_filename + ': ' + error.message);
                    abort = true;
                    t.end();
                } else {
                    VM.load(vmobj.uuid, function (e, o) {
                        if (e) {
                            t.ok(false, 'reloading after send: ' + e.message);
                            abort = true;
                        } else {
                            t.ok(o.state === 'stopped', 'VM is stopped after send (actual: ' + o.state + ')');
                        }
                        t.end();
                    });
                }
            }
        );
    });

    test('delete after sending ' + thing_name, function(t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }
        if (vmobj.uuid) {
            VM.delete(vmobj.uuid, function (err) {
                if (err) {
                    t.ok(false, 'error deleting VM: ' + err.message);
                    abort = true;
                } else {
                    t.ok(true, 'deleted VM: ' + vmobj.uuid);
                }
                t.end();
            });
        } else {
            t.ok(false, 'no VM to delete');
            abort = true;
            t.end();
        }
    });

    test('receive ' + thing_name, function(t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }

        cp.exec('/usr/vm/sbin/vmadm recv < ' + bundle_filename,
            function (error, stdout, stderr) {
                var ival;
                var loading = false;
                var loops = 0;

                // we don't really care if this works, this is just cleanup.
                cp.exec('rm -f ' + bundle_filename, function() {});

                if (error) {
                    t.ok(false, 'vm recv from ' + bundle_filename + ': ' + error.message);
                    abort = true;
                    t.end();
                } else {
                    obj = {};

                    ival = setInterval(function () {
                        if (loading === false) {
                            loading = true;
                        } else {
                            // already loading, skip;
                            loops = loops + 5;
                            return;
                        }
                        if (loops > 120) {
                            clearInterval(ival);
                            t.ok(false, "Timed out after 2 mins waiting for zone to settle.");
                            abort = true;
                        }
                        VM.load(vmobj.uuid, function (err, obj) {
                            if (err) {
                                clearInterval(ival);
                                t.ok(false, 'reloading after receive: ' + err.message);
                                abort = true;
                                t.end();
                                // leave loading since we don't want any more runs.
                                return;
                            } else {
                                if (!obj.hasOwnProperty('transition') && (obj.state === 'running' || obj.state === 'stopped')) {
                                    // DONE!
                                    clearInterval(ival);
                                    t.ok(true, 'Zone went to state: ' + obj.state);

                                    for (prop in vmobj) {
                                        if (['boot_timestamp', 'last_modified', 'pid', 'zoneid'].indexOf(prop) !== -1) {
                                            // we expect these properties to be different.
                                            continue;
                                        }
                                        t.ok(obj.hasOwnProperty(prop), 'new object still has property ' + prop);
                                        if (obj.hasOwnProperty(prop)) {
                                            old_vm = JSON.stringify(vmobj[prop]);
                                            new_vm = JSON.stringify(obj[prop]);
                                            t.ok(new_vm == old_vm, 'matching properties ' + prop + ': [' + old_vm + '][' + new_vm + ']');
                                        }
                                    }
                                    for (prop in obj) {
                                        if (!vmobj.hasOwnProperty(prop)) {
                                            t.ok(false, 'new object has extra property ' + JSON.stringify(prop));
                                        }
                                    }

                                    t.end();
                                    return;
                                } else {
                                    t.ok(true, 'Zone in state: ' + obj.state + ' waiting to settle.');
                                }
                                loading = false;
                            }
                        });
                        loops = loops + 5;
                    }, 5000);
                }
            }
        );
    });

    test('delete after receiving ' + thing_name, function(t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }
        if (vmobj.uuid) {
            VM.delete(vmobj.uuid, function (err) {
                if (err) {
                    t.ok(false, 'error deleting VM: ' + err.message);
                } else {
                    t.ok(true, 'deleted VM: ' + vmobj.uuid);
                }
                t.end();
            });
        } else {
            t.ok(false, 'no VM to delete');
            t.end();
        }
    });
});
