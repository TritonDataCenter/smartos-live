/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * fwadm tests
 */

var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var util = require('util');



// --- Globals





// --- Setup



exports['setup'] = function (t) {
    fw = mocks.setup();
    t.ok(fw, 'fw loaded');
    t.done();
};


// run before every test
exports.setUp = function (cb) {
    mocks.reset();
    cb();
};



// --- Tests



exports['running status'] = function (t) {
    fw.status({ uuid: 'uuid' }, function (err, res) {
        t.ifError(err);
        t.deepEqual(res, {
            'ipf': 'v4.1.9 (592)',
            'kernel': 'v4.1.9',
            'running': true,
            'log flags': '0 = none set',
            'default': 'nomatch -> block all, Logging: available',
            'active list': '0',
            'feature mask': '0x107'
        }, 'status return value');

        t.done();
    });
};


exports['not running when zone down'] = function (t) {
    mocks.values.child_process['/usr/sbin/ipf'] = {
        err: new Error('some error'),
        stderr: 'Could not find running zone: uuid',
        stdout: 'ipf: IP Filter: v4.1.9 (592)'
    };

    fw.status({ uuid: 'uuid' }, function (err, res) {
        t.ifError(err);
        t.deepEqual(res, { running: false }, 'false status returned');
        t.done();
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    mocks.teardown();
    t.done();
};
