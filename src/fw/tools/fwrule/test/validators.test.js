/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright 2016, Joyent, Inc. All rights reserved.
 *
 */

/*
 * Unit tests for the firewall rule validators
 */

'use strict';

var test = require('tape');
var validator = require('../lib/validators.js');



// --- Tests


test('IPv4 addresses', function (t) {
    var i;
    var valid = [
        '1.2.3.4',
        '1.0.0.0'
    ];

    var invalid = [
        '1',
        'asdf',
        '0.0.0.0',
        '01.02.03.04',
        '255.255.255.255',
        '256.0.0.1'
    ];

    for (i in valid) {
        t.ok(validator.validateIPv4address(valid[i]), valid[i]);
    }

    for (i in invalid) {
        t.notOk(validator.validateIPv4address(invalid[i]), invalid[i]);
    }

    t.end();
});


test('IPv4 subnets', function (t) {
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
        '01.02.03.04/24',
        '1.0.0.0/0'
    ];

    for (i in valid) {
        t.ok(validator.validateIPv4subnet(valid[i]), 'valid: ' + valid[i]);
    }

    for (i in invalid) {
        t.notOk(validator.validateIPv4subnet(invalid[i]),
            'invalid: ' + invalid[i]);
    }

    t.end();
});


test('ports', function (t) {
    var i;
    var valid = [
        1,
        20,
        200,
        2000,
        65535,
        '1',
        '65535',
        'all',
        'All',
        'ALL'
    ];

    var invalid = [
        0,
        {},
        65536,
        '65536',
        '',
        [],
        -1,
        'something'
    ];

    for (i in valid) {
        t.ok(validator.validatePortOrAll(valid[i]), 'valid: ' + valid[i]);
    }

    for (i in invalid) {
        t.notOk(validator.validatePortOrAll(invalid[i]),
            'invalid: ' + invalid[i]);
    }

    return t.end();
});


test('protocols', function (t) {
    var i;
    var valid = [
        'tcp',
        'TCP',
        'udp',
        'UDP',
        'icmp',
        'ICMP',
        'icmp6',
        'ICMP6'
    ];

    var invalid = [
        0,
        {},
        65536,
        '65536',
        '',
        [],
        -1,
        'something',
        'ethernet',
        'ftp'
    ];

    for (i in valid) {
        t.ok(validator.validateProtocol(valid[i]), 'valid: ' + valid[i]);
    }

    for (i in invalid) {
        t.notOk(validator.validateProtocol(invalid[i]),
            'invalid: ' + invalid[i]);
    }

    return t.end();
});

test('actions', function (t) {
    var i;
    var valid = [
        'block',
        'BLOCK',
        'allow',
        'ALLOW'
    ];

    var invalid = [
        0,
        {},
        65536,
        '65536',
        '',
        'something',
        'permit',
        'obstruct'
    ];

    for (i in valid) {
        t.ok(validator.validateAction(valid[i]), 'valid: ' + valid[i]);
    }

    for (i in invalid) {
        t.notOk(validator.validateAction(invalid[i]),
            'invalid: ' + invalid[i]);
    }

    return t.end();
});
