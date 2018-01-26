/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test utilities for running fwadm commands
 */

var assert = require('assert-plus');
var common = require('./common');
var mod_cp = require('child_process');
var mod_log = require('./log');
var util = require('util');



// --- Exports


/**
 * Test whether the ipf rules show up in 'fwadm status' for a VM
 */
function statsContain(t, uuid, inLines, inDesc, cb) {
    var cmd = 'fwadm stats ' + uuid;
    var desc = inDesc + ': ';
    // clone the input:
    var lines = inLines.slice();

    mod_cp.exec(cmd, function compareStats(err, stdout, stderr) {
        t.ifError(err, desc + 'error running: ' + cmd);
        t.equal(stderr, '', desc + 'stderr: ' + cmd);

        var rules = [];

        stdout.split('\n').forEach(function (line) {
            if (line === '') {
                return;
            }

            var parts = line.split(/\s+/g);
            parts.shift();
            var rule = parts.join(' ');
            var idx = lines.indexOf(rule);
            if (idx !== -1) {
                t.ok(true, desc + 'found rule: ' + rule);
                lines.splice(idx, 1);
            }

            rules.push(rule);
        });

        t.deepEqual(lines, [], desc + 'found all rules');
        if (lines.length !== 0) {
            t.deepEqual(rules, [], desc + 'rules found');
        }

        return cb();
    });
}


/**
 * `fwadm status <uuid>`
 */
function status(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var execOpts = {
        cmd: util.format('fwadm status -j %s', opts.uuid),
        cmdName: 'fwadm status'
    };

    common.exec(t, execOpts, function (err, stdout, stderr) {
        if (err) {
            return common.done(err, null, t, callback);
        }

        var res = JSON.parse(stdout);
        if (opts.partialExp) {
            var partialRes = {};
            for (var p in opts.partialExp) {
                partialRes[p] = res[p];
            }

            t.deepEqual(partialRes, opts.partialExp,
                'partial result: fwadm status ' + opts.uuid);
        }

        return common.done(null, res, t, callback);
    });
}


/**
 * Enable the in-zone firewall for a zone
 */
function zoneEnable(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');

    var execOpts = {
        cmd: util.format('zlogin %s ipf -E', opts.uuid),
        cmdName: 'zlogin ipf -E'
    };

    common.exec(t, execOpts, function (err, stdout, stderr) {
        if (err) {
            return common.done(err, null, t, callback);
        }

        opts.exp = true;
        return zoneRunning(t, opts, callback);
    });
}


/**
 * Check if the zone's in-zone firewall is enabled.
 */
function zoneRunning(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.string(opts.uuid, 'opts.uuid');
    assert.bool(opts.exp, 'opts.exp');

    var execOpts = {
        cmd: util.format(
            'zlogin %s ipf -V | grep Running | awk \'{ print $2 }\'',
            opts.uuid),
        cmdName: 'zlogin ipf -V'
    };

    common.exec(t, execOpts, function (err, stdout, stderr) {
        if (err) {
            return common.done(err, null, t, callback);
        }

        var res = '<unknown>';
        if (stdout == 'no\n') {
            res = false;
        }

        if (stdout == 'yes\n') {
            res = true;
        }

        t.equal(res, opts.exp, 'running status for VM ' + opts.uuid);
        return common.done(null, res, t, callback);
    });
}


module.exports = {
    statsContain: statsContain,
    status: status,
    zoneEnable: zoneEnable,
    zoneRunning: zoneRunning
};
