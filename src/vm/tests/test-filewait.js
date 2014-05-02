// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure the filewait tool is working
//

var execFile = require('child_process').execFile;
var fs = require('fs');
var util = require('util');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// blatantly copied from VM.js
function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function printStdio(cmd, stdout, stderr)
{
    if (stdout && (rtrim(stdout).length > 0)) {
        console.error('# ' + cmd, 'stdout: ' + rtrim(stdout));
    }
    if (stderr && (rtrim(stderr).length > 0)) {
        console.error('# ' + cmd + 'stderr: ' + rtrim(stderr));
    }
}

function filewait(filename, callback)
{
    var cmd = '/usr/vm/sbin/filewait';

    execFile(cmd, [filename], function (error, stdout, stderr) {
        if (error) {
            console.error('filewait exited non-zero (' + error.code + ')');
        }
        printStdio('filewait', stdout, stderr);
        callback(error);
    });
}

function touch(filename, callback)
{
    fs.writeFile(filename, '', function (err) {
        callback(err);
    });
}

function mkdir(dirname, callback)
{
    execFile('/usr/bin/mkdir', ['-p', dirname], function (error, stdout, stderr) {
        if (error) {
            console.error('mkdir exited non-zero (' + error.code + ')');
        }
        printStdio('mkdir', stdout, stderr);
        callback(error);
    });
}

function cleanup(dirname, callback) {
    execFile('/usr/bin/rm', ['-rf', dirname], function (error, stdout, stderr) {
        if (error) {
            console.error('rm -rf exited non-zero (' + error.code + ')');
        }
        printStdio('cleanup', stdout, stderr);
        callback(error);
    });
}

/*
 * Ensure filewait behaves properly when the directory we need to watch does
 * not yet exist when we start waiting and gets created after.
 *
 */
test('test filewait when directory does not exist', function(t) {
    var data = {};
    var dir = '/tmp/filewait-test.' + process.pid;
    var file = dir + '/testfile';

    filewait(file, function (filewait_err) {
        t.ok(!filewait_err, 'filewait: ' + (filewait_err ? filewait_err.message : 'success'));
        if (filewait_err) {
            data['retval'] = filewait_err.code;
        } else {
            data['retval'] = 0;
        }
    });

    setTimeout(function () {
        mkdir(dir, function (mkdir_err) {
            t.ok(!mkdir_err, 'mkdir: ' + (mkdir_err ? mkdir_err.message : 'success'));
            touch(file, function (touch_err) {
                t.ok(!touch_err, 'touch: ' + (touch_err ? touch_err.message : 'success'));
            });

            setTimeout(function () {
                t.ok(data['retval'] === 0, 'filewait returned: ' + data['retval']);
                cleanup(dir, function (cleanup_err) {
                    t.ok(!cleanup_err, 'cleanup: ' + (cleanup_err ? cleanup_err.message : 'success'));
                    t.end();
                });
            }, 5000);
        });
    }, 1000);
});

/*
 * Ensure filewait behaves properly when the file exists before filewait is run
 *
 */
test('test filewait notices existing file', function(t) {
    var dir = '/tmp/filewait-test.' + process.pid;
    var file = dir + '/testfile';

    mkdir(dir, function (mkdir_err) {
        t.ok(!mkdir_err, 'mkdir: ' + (mkdir_err ? mkdir_err.message : 'success'));
        touch(file, function (touch_err) {
            t.ok(!touch_err, 'touch: ' + (touch_err ? touch_err.message : 'success'));
            filewait(file, function (filewait_err) {
                t.ok(!filewait_err, 'filewait: ' + (filewait_err ? filewait_err.message : 'success'));
                cleanup(dir, function (cleanup_err) {
                    t.ok(!cleanup_err, 'cleanup: ' + (cleanup_err ? cleanup_err.message : 'success'));
                    t.end();
                });
            });
        });
    });
});

/*
 * Ensure filewait behaves properly when the file gets created after we start
 * watching.
 *
 */
test('test filewait notices new file', function(t) {
    var dir = '/tmp/filewait-test.' + process.pid;
    var file = dir + '/testfile';

    mkdir(dir, function (mkdir_err) {
        t.ok(!mkdir_err, 'mkdir: ' + (mkdir_err ? mkdir_err.message : 'success'));

        filewait(file, function (filewait_err) {
            t.ok(!filewait_err, 'filewait: ' + (filewait_err ? filewait_err.message : 'success'));
            cleanup(dir, function (cleanup_err) {
                t.ok(!cleanup_err, 'cleanup: ' + (cleanup_err ? cleanup_err.message : 'success'));
                t.end();
            });
        });

        setTimeout(function() {
            touch(file, function (touch_err) {
                t.ok(!touch_err, 'touch: ' + (touch_err ? touch_err.message : 'success'));
            });
        }, 2000);
    });
});

