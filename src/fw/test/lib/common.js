/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Shared integration test utilities
 */

var assert = require('assert-plus');
var cp = require('child_process');
var log = require('./log');
var util = require('util');



// --- Exports



function done(err, res, t, callback) {
    if (callback) {
        return callback(err, res);
    }

    return t.done();
}


function exec(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');
    assert.string(opts.cmd, 'opts.cmd');
    assert.string(opts.cmdName, 'opts.cmdName');
    log.debug(opts, 'exec');

    cp.exec(opts.cmd, function (err, stdout, stderr) {
        t.ifError(err, 'error running ' + opts.cmdName);
        if (err) {
            log.error({
                cmd: opts.cmd,
                cmdName: opts.cmdName,
                err: err,
                stderr: stderr,
                stdout: stdout
            }, 'error running ' + opts.cmdName);
        }

        if (log.debug()) {
            log.debug({
                cmd: opts.cmd,
                cmdName: opts.cmdName,
                err: err,
                stderr: stderr,
                stdout: stdout
            }, 'ran ' + opts.cmdName);
        }

        return callback(err, stdout, stderr);
    });
}



module.exports = {
    done: done,
    exec: exec
};
