#!/usr/node/bin/node
/*
 * Copyright (c) 2013 Joyent Inc., All Rights Reserved.
 *
 * SYNOPSIS:
 *
 *   filewait /.zonecontrol/metadata.sock
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
var looper;
var watcher;

if (process.argv.length !== 3) {
    console.error('Usage: ' + process.argv[1] + ' <filename>');
    process.exit(2);
}

filename = process.argv[2];
dir = path.dirname(filename);

// cleans up fs.watch watcher and exits (0) if the file exists.
function exitIfExists(fn)
{
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

// calls callback only if global "dir" exists in the filesystem.
function watchWhenDirExists(callback)
{
    fs.exists(dir, function (exists) {
        if (exists) {
            if (looper) {
                clearInterval(looper);
                looper = null;
            }
            callback();
        }
    });
}

// when "dir" exists in the filesystem, start watching for the file.
function watchIfReady()
{
    watchWhenDirExists(function () {
        // The code in this callback should only ever be called once as the
        // watchWhenDirExists() function will call us only after clearing the
        // Interval when the directory exists.
        watcher = fs.watch(dir, function () {
            // we don't care about *what* event just happened, just that one did
            exitIfExists(filename);
        });

        // We check once here in case it already exists, in which case the
        // watcher will never send an event about it. If it doesn't exist yet,
        // we'll check again when the dir changes.
        exitIfExists(filename);
    });
}

// We start an interval to retry every 500ms then we also give it a try right
// now. If the dir exists immediately, watchWhenDirExists() will cancel the
// watcher, and if it doesn't exist the loop will catch it.
looper = setInterval(watchIfReady, 500);
watchIfReady();
