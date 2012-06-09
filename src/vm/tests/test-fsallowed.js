// Copyright 2012 Joyent, Inc.  All rights reserved.

process.env['TAP'] = 1;
var async = require('async');
var cp = require('child_process');
var execFile = cp.execFile;
var test = require('tap').test;
var path = require('path');
var VM = require('VM');
var vmtest = require('../common/vmtest.js');

VM.loglevel = 'DEBUG';

var abort = false;
var vmobj;

var image_uuid = vmtest.CURRENT_SMARTOS;

test('import joyent image', {'timeout': 360000}, function(t) {
    vmtest.ensureImage(t, '/zones/' + image_uuid, image_uuid, function (err) {
        t.ok(!err, "joyent image exists");
        t.end();
    });
});

test('create zone with fs_allowed', {'timeout': 240000}, function(t) {
    var payload = {
        'brand': 'joyent-minimal',
        'autoboot': false,
        'image_uuid': image_uuid,
        'alias': 'test-fsallowed-' + process.pid,
        'do_not_inventory': true,
        "fs_allowed": "ufs,pcfs,tmpfs"
    };

    VM.create(payload, function (err, obj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
            t.end();
        } else {
            t.ok(true, 'VM created with uuid ' + obj.uuid);
            VM.load(obj.uuid, function (e, o) {
                var allowed = [];

                t.ok(!err, 'loading VM after create');
                if (!err) {
                    console.error(JSON.stringify(o));
                    allowed = o.fs_allowed.split(',');
                    t.ok(allowed.length === 3,
                        'number of fs_allowed is correct after load ['
                        + allowed.length + ',3]');
                    t.ok(allowed.indexOf('ufs') !== -1,
                        'fs_allowed has ufs');
                    t.ok(allowed.indexOf('pcfs') !== -1,
                        'fs_allowed has pcfs');
                    t.ok(allowed.indexOf('tmpfs') !== -1,
                        'fs_allowed has tmpfs');
                    vmobj = o;
                } else {
                    abort = true;
                }
                t.end();
            });
        }
    });
});

test('empty the fs_allowed list', {'timeout': 240000}, function(t) {
    var payload = {
        'fs_allowed': ""
    };

    if (abort) {
        t.ok(false, 'skipping empty as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update VM: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'successfully updated VM');
            VM.load(vmobj.uuid, function (err, o) {
                var allowed = [];

                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    if (o.fs_allowed) {
                        allowed = o.fs_allowed.split(',');
                    }
                    t.ok(allowed.length === 0, 'update emptied fs_allowed');
                }
                t.end();
            });
        }
    });
});

test('add fs_allowed using array', {'timeout': 240000}, function(t) {
    var payload = {
        'fs_allowed': ['ufs', 'pcfs', 'tmpfs']
    };

    if (abort) {
        t.ok(false, 'skipping array add as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update VM: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'successfully updated VM');
            VM.load(vmobj.uuid, function (err, o) {
                var allowed = [];

                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    if (o.fs_allowed) {
                        allowed = o.fs_allowed.split(',');
                    }
                    t.ok(allowed.length === 3, 'update set fs_allowed [' + allowed.length + ',3]');
                    t.ok(allowed.indexOf('ufs') !== -1,
                        'fs_allowed has ufs');
                    t.ok(allowed.indexOf('pcfs') !== -1,
                        'fs_allowed has pcfs');
                    t.ok(allowed.indexOf('tmpfs') !== -1,
                        'fs_allowed has tmpfs');
                }
                t.end();
            });
        }
    });
});

test('empty the fs_allowed list using array', {'timeout': 240000}, function(t) {
    var payload = {
        'fs_allowed': []
    };

    if (abort) {
        t.ok(false, 'skipping empty as test run is aborted.');
        t.end();
        return;
    }

    VM.update(vmobj.uuid, payload, function (e) {
        if (e) {
            t.ok(false, 'failed to update VM: ' + e.message);
            abort = true;
            t.end();
        } else {
            t.ok(true, 'successfully updated VM');
            VM.load(vmobj.uuid, function (err, o) {
                var allowed = [];

                if (err) {
                    t.ok(false, 'failed update broke VM!');
                } else {
                    if (o.fs_allowed) {
                        allowed = o.fs_allowed.split(',');
                    }
                    t.ok(allowed.length === 0, 'update emptied fs_allowed');
                }
                t.end();
            });
        }
    });
});


test('delete zone', function(t) {
    if (abort) {
        t.ok(false, 'skipping delete as test run is aborted.');
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
            vmobj = {};
        });
    } else {
        t.ok(false, 'no VM to delete');
        abort = true;
        t.end();
    }
});
