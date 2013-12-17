/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule validators
 */

var sys = require('sys');
var validator = require('../lib/validators.js');

var IS_NODE_08 = (process.version.indexOf('v0.8') === 0);

exports['IPv4 addresses'] = function (t) {
    var i;
    var valid = [
        '1.2.3.4',
        '1.0.0.0'
    ];

    var invalid = [
        '1',
        'asdf',
        '0.0.0.0',
        '255.255.255.255',
        '256.0.0.1'
    ];

    if (IS_NODE_08) {
        // net.isIPv4 thinks this is valid in node 0.8:
        valid.push('01.02.03.04');
    } else {
        invalid.push('01.02.03.04');
    }

    for (i in valid) {
        t.ok(validator.validateIPv4address(valid[i]), valid[i]);
    }

    for (i in invalid) {
        t.ok(!validator.validateIPv4address(invalid[i]), invalid[i]);
    }

    t.done();
};

exports['IPv4 subnets'] = function (t) {
    var i;
    var valid = [
        '1.2.3.4/24',
        '1.0.0.0/32',
        '10.88.88.24/32',
        '10.88.88.24/1'
    ];

    var invalid = [
        '1',
        'asdf',
        '0.0.0.0/32',
        '1.0.0.0/33',
        '1.0.0.0/0'
    ];

    if (IS_NODE_08) {
        // net.isIPv4 thinks this is valid in node 0.8:
        valid.push('01.02.03.04/24');
    } else {
        invalid.push('01.02.03.04/24');
    }

    for (i in valid) {
        t.ok(validator.validateIPv4subnet(valid[i]), valid[i]);
    }

    for (i in valid) {
        t.ok(!validator.validateIPv4subnet(invalid[i]), invalid[i]);
    }

    t.done();
};
