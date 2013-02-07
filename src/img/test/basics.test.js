/*
 * Copyright (c) 2012 Joyent Inc. All rights reserved.
 *
 * Some base imgadm tests.
 */

var format = require('util').format;
var exec = require('child_process').exec;


// node-tap API
if (require.cache[__dirname + '/tap4nodeunit.js'])
    delete require.cache[__dirname + '/tap4nodeunit.js'];
var tap4nodeunit = require('./tap4nodeunit.js');
var after = tap4nodeunit.after;
var before = tap4nodeunit.before;
var test = tap4nodeunit.test;


var IMGADM = 'imgadm';
//IMGADM = '/image/usr/img/sbin/imgadm';

before(function (next) {
    next();
});

test('imgadm --version', function (t) {
    exec(IMGADM + ' --version', function (err, stdout, stderr) {
        t.ifError(err, err);
        t.equal(stderr, '', 'stderr');
        t.ok(/^imgadm \d+\.\d+\.\d+/.test(stdout),
            format('stdout is a version: "%s"', stdout.trim()));
        t.end();
    });
});
