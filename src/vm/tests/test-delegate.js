// Copyright 2015 Joyent, Inc.  All rights reserved.

var async = require('/usr/node/node_modules/async');
var cp = require('child_process');
var execFile = cp.execFile;
var fs = require('fs');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var abort = false;
var bundle_filename;
var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var vmobj;
var payload = {
    alias: 'test-delegate-' + process.pid,
    brand: 'joyent-minimal',
    image_uuid: image_uuid,
    do_not_inventory: true,
    delegate_dataset: true,
    ram: 256,
    max_swap: 256
};

test('import dataset', function(t) {
    fs.exists('/zones/' + image_uuid, function (exists) {
        t.ok(exists, "dataset exists");
        t.end();
    });
});

test('create zone', function(t) {
    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            VM.load(obj.uuid, function (e, o) {
                if (e) {
                    t.ok(false, 'unable to load VM after create');
                    abort = true;
                } else {
                    vmobj = o;
                    t.ok(true, 'created VM: ' + vmobj.uuid);
                }
                t.end();
            });
        }
    });
});

test('check delegated', function(t) {
    if (abort) {
        t.ok(false, 'skipping send as test run is aborted.');
        t.end();
        return;
    }

    cp.exec('zlogin ' + vmobj.uuid + ' zfs list | grep zones/' + vmobj.uuid + '/data',
        function (error, stdout, stderr) {
            if (error) {
                t.ok(false, 'VM does not appear to have dataset: ' + error.message);
                abort = true;
            } else {
                t.ok(true, 'VM had delegated dataset');
            }
            t.end();
        }
    );
});

test('delete zone', function(t) {
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
