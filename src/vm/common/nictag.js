/*
 * Copyright 2015 Joyent, Inc.  All rights reserved.
 *
 * Shared functions for working with nic tags
 */

var cp = require('child_process');

var NICTAGADM = '/usr/bin/nictagadm';



function addTag(t, name, nic, callback) {
    cp.execFile(NICTAGADM, ['add', name, nic], function (err, stdout, stderr) {
        t.ifError(err, 'nictagadm add ' + name + ' ' + nic);
        if (err) {
            return callback(err);
        }

        return callback();
    });
}


function delTag(t, name, force, callback) {
    var args = ['delete'];
    if (force) {
        args.push('-f');
    }
    args.push(name);

    cp.execFile(NICTAGADM, args, function (err, stdout, stderr) {
        t.ifError(err, 'nictagadm delete ' + name);
        if (err) {
            return callback(err);
        }

        return callback();
    });
}


// List all nic tags on the system, returning an object mapping tag names
// to MAC addresses
function listTags(t, callback) {
    // list output looks like:
    //   external|00:50:56:3d:a7:95
    cp.execFile(NICTAGADM, ['list', '-p', '-d', '|'],
            function (err, stdout, stderr) {
        t.ifError(err, 'nictagadm list');
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


module.exports = {
    add: addTag,
    del: delTag,
    list: listTags
};
