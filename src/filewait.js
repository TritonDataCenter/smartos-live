#!/usr/node/bin/node
/*
 * Copyright (c) 2013 Joyent Inc., All Rights Reserved.
 *
 * SYNOPSIS:
 *
 *   wait_for_file /.zonecontrol/metadata.sock
 *
 * EXIT CODE:
 *
 *   0 when file exists
 *   2 on usage error
 *
 * NOTE: this process will keep running either until the file specified exists
 * or until it is killed, unless there's a usage error.
 *
 */

var fs = require('fs');
var path = require('path');

var dir;
var filename;
var watcher;

if (process.argv.length !== 3) {
    console.error('Usage: ' + process.argv[1] + ' <filename>');
    process.exit(2);
}

filename = process.argv[2];
dir = path.dirname(filename);

function exitIfExists(fn) {
    fs.exists(fn, function (exists) {
        if (exists) {
            if (watcher) {
                watcher.close();
                watcher = null;
            }
            console.log(filename + ' now exists');
            process.exit(0);
        }
    });
}

watcher = fs.watch(dir, function () {
    // we don't care about *what* event just happened, just that one did
    exitIfExists(filename);
});

// We check once here in case it already exists, in which case the watcher will
// never send an event about it. If it doesn't exist yet, we'll check again when
// the dir changes.
exitIfExists(filename);
