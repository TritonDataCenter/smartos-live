/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2018, Joyent, Inc.
 *
 */

var cp = require('child_process');
var fs = require('fs');
var util = require('util');

var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var kvm_image_uuid = vmtest.CURRENT_UBUNTU_UUID;
var VMADM = '/usr/vm/sbin/vmadm';

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
    var abort = false;
    var bundle_filename;
    var vmobj;

    var thing_name = d[0];
    var thing_payload = d[1];

    test('create ' + thing_name, function (t) {
        VM.create(thing_payload, function (err, obj) {
            if (err) {
                abort = true;
                t.ok(false, 'error creating VM: ' + err.message);
                t.end();
                return;
            }

            VM.load(obj.uuid, function (e, o) {
                if (e) {
                    t.ok(false, 'unable to load VM after create');
                    abort = true;
                    t.end();
                    return;
                }

                vmobj = o;
                t.ok(true, 'created VM: ' + vmobj.uuid);
                t.end();
            });
        });
    });

    test('send ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }

        bundle_filename = util.format('/var/tmp/test.%s.vmbundle.%d',
            vmobj.uuid, process.pid);

        var stderr = '';
        var ws = fs.createWriteStream(bundle_filename);
        var args = [
            'send',
            vmobj.uuid
        ];

        var child = cp.spawn(VMADM, args);
        child.stdout.pipe(ws);
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', function (data) {
            stderr += data;
        });

        child.once('error', function (err) {
            t.ok(false, util.format('vm send to "%s": %s',
                bundle_filename, err.message));
            abort = true;
            t.end();
        });

        child.once('close', function (code) {
            if (code !== 0) {
                t.ok(false, util.format('vm send to "%s": code %d',
                    bundle_filename, code));
                abort = true;
                console.error(stderr);
                t.end();
            }

            VM.load(vmobj.uuid, function (e, o) {
                if (e) {
                    t.ok(false, 'reloading after send: ' + e.message);
                    abort = true;
                    t.end();
                    return;
                }
                t.ok(o.state === 'stopped', util.format(
                    'VM is stopped after send (actual: %s)', o.state));
                t.end();
            });
        });
    });

    test('delete after sending ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }

        if (!vmobj.uuid) {
            t.ok(false, 'no VM to delete');
            abort = true;
            t.end();
            return;
        }

        VM.delete(vmobj.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
                abort = true;
                t.end();
                return;
            }

            t.ok(true, 'deleted VM: ' + vmobj.uuid);
            t.end();
        });
    });

    test('receive ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }

        var rs = fs.createReadStream(bundle_filename);
        var stderr = '';

        var child = cp.spawn(VMADM, ['recv']);
        rs.pipe(child.stdin);
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', function (data) {
            stderr += data;
        });

        child.once('error', function (err) {
            t.ok(false, util.format('vm send to "%s": %s',
                bundle_filename, err.message));
            abort = true;
            t.end();
        });

        child.once('close', function (code) {
            // we don't really care if this works, this is just cleanup.
            try {
                fs.unlinkSync(bundle_filename);
            } catch (e) {}

            if (code !== 0) {
                t.ok(false, util.format('vm send to "%s": code %d',
                    bundle_filename, code));
                console.error(stderr);
                abort = true;
                t.end();
            }

            var started = Math.floor(Date.now() / 1000);
            function waitForZoneToSettle() {
                var now = Math.floor(Date.now() / 1000);

                if (now - started > 120) {
                    t.ok(false, 'Timeout waiting for zone to settle');
                    abort = true;
                    t.end();
                    return;
                }

                VM.load(vmobj.uuid, function (err, obj) {
                    if (err) {
                        // give up
                        t.ok(false, 'reloading after receive: ' + err.message);
                        abort = true;
                        t.end();
                        return;
                    }

                    if (obj.hasOwnProperty('transition')
                        || ['running', 'stopped'].indexOf(obj.state) === -1) {

                        // wait for zone to settle
                        t.ok(true, util.format(
                            'Zone in state: %s - waiting to settle',
                            obj.state));
                        setTimeout(waitForZoneToSettle, 5 * 1000);
                        return;
                    }

                    // zone settled!
                    t.ok(true, 'Zone went to state: ' + obj.state);

                    Object.keys(vmobj).forEach(function (prop) {
                        // we expect these properties to be different.
                        var skipProps = [
                            'boot_timestamp',
                            'last_modified',
                            'pid',
                            'zonedid',
                            'zoneid'
                        ];
                        if (skipProps.indexOf(prop) !== -1) {
                            return;
                        }

                        t.ok(obj.hasOwnProperty(prop),
                            'new object still has property ' + prop);

                        if (obj.hasOwnProperty(prop)) {
                            var old_vm = JSON.stringify(vmobj[prop]);
                            var new_vm = JSON.stringify(obj[prop]);
                            t.ok(new_vm === old_vm, util.format(
                                'matching properties "%s": [%s][%s]',
                                prop, old_vm, new_vm));
                        }
                    });

                    Object.keys(obj).forEach(function (prop) {
                        if (!vmobj.hasOwnProperty(prop)) {
                            t.ok(false, util.format(
                                'new object has extra property %s', prop));
                        }
                    });

                    t.end();
                });
            }

            waitForZoneToSettle();
        });
    });

    test('delete after receiving ' + thing_name, function (t) {
        if (abort) {
            t.ok(false, 'skipping send as test run is aborted.');
            t.end();
            return;
        }

        if (!vmobj.uuid) {
            t.ok(false, 'no VM to delete');
            t.end();
            return;
        }

        VM.delete(vmobj.uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
                t.end();
                return;
            }

            t.ok(true, 'deleted VM: ' + vmobj.uuid);
            t.end();
        });
    });
});
