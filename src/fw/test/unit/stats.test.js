/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * 'fwadm stats' tests
 */

var fw;
var helpers = require('../lib/helpers');
var mocks = require('../lib/mocks');
var mod_uuid = require('uuid');
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



exports['No ipfstat output'] = function (t) {
    fw.stats({ uuid: mod_uuid.v4() }, function (err, res) {
        t.ok(err, 'Got error');
        if (!err) {
            return t.done();
        }

        t.equal(err.message, 'No output from ipfstat', 'Error message');
        t.done();
    });
};


exports['empty list, ipf not running'] = function (t) {
    var uuid = mod_uuid.v4();
    mocks.values.child_process['/usr/sbin/ipfstat'] = {
        err: null,
        stderr: 'empty list for ipfilter(out)\n'
                    + 'empty list for ipfilter(in)\n',
        stdout: ''
    };

    mocks.values.child_process['/usr/sbin/ipf'] = {
        err: new Error('some error'),
        stderr: 'Could not find running zone: uuid',
        stdout: 'ipf: IP Filter: v4.1.9 (592)'
    };

    fw.stats({ uuid: uuid }, function (err, res) {
        t.ok(err, 'Got error');
        if (!err) {
            return t.done();
        }

        t.equal(err.message, util.format(
                'Firewall is not running for VM "%s"', uuid), 'Error message');
        t.done();
    });
};


exports['empty list, ipf running'] = function (t) {
    var uuid = mod_uuid.v4();
    mocks.values.child_process['/usr/sbin/ipfstat'] = {
        err: null,
        stderr: 'empty list for ipfilter(out)\n'
                    + 'empty list for ipfilter(in)\n',
        stdout: ''
    };

    fw.stats({ uuid: uuid }, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        t.deepEqual(res, { rules: [] }, 'results');
        t.done();
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    mocks.teardown();
    t.done();
};
