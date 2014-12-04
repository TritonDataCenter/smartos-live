// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure the OpenOnError logger works
//

var execFile = require('child_process').execFile;
var bunyan = require('/usr/node/node_modules/bunyan');
var fs = require('fs');
var ooel = require('../../node_modules/openonerrlogger');
var util = require('util');
var utils = require('../../node_modules/utils');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

/*
 * create a logger, start writing a message to it every second
 * after 5 seconds, log one message at 'error' level and keep going
 * after 5 more seconds stop and check that there are 10 messages in the file.
 *
 */
test('test basic OpenOnError logging', function (t) {
    var log;
    var logfile = '/tmp/logfile.' + process.pid + '.log';
    var written = 0;

    function cleanup() {
        try {
            fs.unlinkSync(logfile);
        } catch (e) {
            // ignored
        }
        try {
            fs.unlinkSync(logfile + '.old');
        } catch (e) {
            // ignored
        }
    }

    cleanup(); // start clean
    log = ooel.createLogger({logname: 'test-logger', filename: logfile});
    t.ok(true, 'logging to ' + logfile);

    function done() {
        fs.readFile(logfile, 'utf8', function (error, data) {
            var i;
            var json;
            var lines;

            t.ok(!error, 'loaded log file: '
                + (error ? error.message : 'success'));
            if (!error) {
                lines = utils.trim(data).split('\n');
                t.ok(lines.length === 10, 'read 10 lines from ' + logfile);
                for (i = 0; i < lines.length; i++) {
                    json = JSON.parse(lines[i]);
                    if (json.written !== i) {
                        t.ok(false, 'lines[' + i + ']: unexpected "written" '
                            + 'value: ' + JSON.stringify(json));
                        t.end();
                        return;
                    }
                }
            }
            t.ok(true, '"written:" values match line numbers');

            fs.unlinkSync(logfile);
            t.end();
        });
    }

    function reEnable() {
        setTimeout(function () {
            if (written === 5) {
                log.error({written: written}, 'message %d', written);
            } else {
                log.debug({written: written}, 'message %d', written);
            }
            written++;
            if (written < 10) {
                reEnable();
            } else {
                done();
            }
        }, 1000);
    }

    reEnable();
});

/*
 * create a logger, start writing a message to it every second
 * after 2 seconds, start looping to move the file out of the way.
 * continue this for 20 seconds or until we crash.
 *
 */
test('test moved log file', function (t) {
    var done_moving = false;
    var log;
    var logfile = '/tmp/logfile.' + process.pid + '.log';
    var move_counter = 0;
    var written = 0;

    function cleanup() {
        try {
            fs.unlinkSync(logfile);
        } catch (e) {
            // ignored
        }
        try {
            fs.unlinkSync(logfile + '.old');
        } catch (e) {
            // ignored
        }
    }
    cleanup(); // start clean
    log = ooel.createLogger({logname: 'test-logger', filename: logfile});
    t.ok(true, 'logging to ' + logfile);

    function done() {
        done_moving = 1;
        cleanup();
        t.ok(true, 'moved ' + move_counter + ' times.');
        t.end();
    }

    function startMover() {
        setTimeout(function () {
            fs.rename(logfile, logfile + '.old', function () {
                move_counter++;
                if (!done_moving) {
                    startMover();
                }
            });
        }, 10);
    }

    function reEnable() {
        setTimeout(function () {
            if (written === 20) {
                startMover();
            }
            log.error({written: written}, 'message %d', written);
            written++;
            if (written < 120) {
                reEnable();
            } else {
                done();
            }
        }, 100);
    }

    reEnable();
});
