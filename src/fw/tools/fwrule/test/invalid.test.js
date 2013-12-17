/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule object
 */

var fwrule = require('../lib/index');
var util = require('util');



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;


function longStr() {
    var str = '';
    for (var i = 0; i < 256; i++) {
        str += '0';
    }

    return str;
}


function nIPs(n) {
    var ips = [];
    for (var i = 0; i < n; i++) {
        ips.push('10.0.0.' + i);
    }

    return '( ip ' + ips.join(' OR ip ') + ' )';
}


function nPorts(n) {
    var ports = [];
    for (var i = 0; i < n; i++) {
        ports.push('1' + i);
    }

    return '( port ' + ports.join(' AND port ') + ' )';
}


function nTypes(n) {
    var types = [];
    for (var i = 0; i < n; i++) {
        types.push(i.toString());
    }

    return '( type ' + types.join(' AND type ') + ' )';
}



var VALID_RULE = 'FROM ip 10.0.0.1 TO all vms ALLOW TCP port 53';
var INVALID = [
    [ 'invalid IP: too many numbers',
        {
            rule: 'FROM ip 10.99.99.99.254 TO tag smartdc_role ALLOW tcp '
                + 'port 22' },
            'rule', 'Error at character 19: \'.254 TO tag smartdc_\', '
                            + 'found: unexpected text'],

    [ 'invalid UUID',
        { uuid: 'invalid',
            rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
        }, 'uuid', 'Invalid rule UUID' ],

    [ 'invalid owner UUID',
        { owner_uuid: 'invalid',
            rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
        }, 'owner_uuid', 'Invalid owner UUID' ],

    [ 'non-target type in FROM',
        { rule: 'FROM foo TO ip 8.8.8.8 ALLOW udp port 53' },
        'rule', 'Error at character 4: \'foo\', '
                        + 'expected: \'(\', \'all\', \'any\', \'ip\', '
                        + '\'subnet\', \'vm\', \'tag\', found: word'],

    [ 'invalid subnet',
        { rule: 'FROM tag foo TO subnet 10.8.0.0/33 ALLOW udp port 53' },
        'rule', 'Subnet "10.8.0.0/33" is invalid (must be in CIDR format)' ],

    [ 'invalid port: too small',
        { rule: 'FROM tag foo TO subnet 10.8.0.0/24 ALLOW udp port 0' },
        'rule', 'Port number "0" is invalid' ],

    [ 'invalid port: too big',
        { rule: 'FROM tag foo TO subnet 10.8.0.0/24 ALLOW udp port 65537' },
        'rule', 'Port number "65537" is invalid' ],

    [ 'invalid VM UUID',
        { rule: 'FROM vm asdf TO subnet 10.8.0.0/24 ALLOW udp port 50' },
        'rule', 'UUID "asdf" is invalid'],

    [ 'all vms with other targets on FROM side',
        { rule: 'FROM (all vms OR tag one) TO ip 10.0.0.1 ALLOW udp port 53' },
        'rule', 'Error at character 13: \'OR\', expected: \')\', found: OR' ],

    [ 'all vms with other targets on TO side',
        { rule: 'FROM tag one TO (all vms OR tag two) ALLOW udp port 53' },
        'rule', 'Error at character 24: \'OR\', expected: \')\', found: OR' ],

    [ 'any with other targets on FROM side',
        { rule: 'FROM (any OR tag one) TO ip 10.0.0.1 ALLOW udp port 53' },
        'rule', 'Error at character 9: \'OR\', expected: \')\', found: OR' ],

    [ 'any with other targets on TO side',
        { rule: 'FROM ip 10.0.0.1 TO (any OR tag one) ALLOW udp port 53' },
        'rule', 'Error at character 24: \'OR\', expected: \')\', found: OR' ],

    [ 'other ports listed with ALL first', {
        rule: 'FROM ip 10.0.0.1 TO all vms ALLOW TCP (port ALL AND port 53)' },
        'rule',
        'Error at character 47: \'AND\', expected: \'EOF\', \')\', found: AND'
    ],

    [ 'other ports listed with ALL second', {
        rule: 'FROM ip 10.0.0.1 TO all vms ALLOW TCP (port 53 AND port ALL)'
        }, 'rule',
        'Error at character 55: \'ALL\', expected: \'WORD\', found: ALL' ],

    [ 'created_by: object instead of string', {
        created_by: { },
        rule: VALID_RULE
        }, 'created_by',
        'created_by must be a string'],

    [ 'created_by: array instead of string', {
        created_by: ['asdf'],
        rule: VALID_RULE
        }, 'created_by',
        'created_by must be a string'],

    [ 'created_by: number instead of string', {
        created_by: 42,
        rule: VALID_RULE
        }, 'created_by',
        'created_by must be a string'],

    [ 'created_by: string too long', {
        created_by: longStr(),
        rule: VALID_RULE
        }, 'created_by',
        'created_by must be shorter than 255 characters'],

    [ 'description: object instead of string', {
        description: { },
        rule: VALID_RULE
        }, 'description',
        'description must be a string'],

    [ 'description: array instead of string', {
        description: ['asdf'],
        rule: VALID_RULE
        }, 'description',
        'description must be a string'],

    [ 'description: number instead of string', {
        description: 42,
        rule: VALID_RULE
        }, 'description',
        'description must be a string'],

    [ 'description: string too long', {
        description: longStr(),
        rule: VALID_RULE
        }, 'description',
        'description must be shorter than 255 characters'],

    [ 'rule: from any to any', {
        rule: 'FROM any TO any ALLOW TCP port 53'
        }, 'rule',
        'rule does not affect VMs'],

    [ 'rule: from any to any', {
        rule: 'FROM any TO any ALLOW TCP port 53'
        }, 'rule',
        'rule does not affect VMs'],

    [ 'rule: from ip to subnet', {
        rule: 'FROM ip 10.8.0.1 TO subnet 10.9.0.0/16 ALLOW TCP port 53'
        }, 'rule',
        'rule does not affect VMs'],

    [ 'rule: from ip to any', {
        rule: 'FROM ip 10.9.0.1 TO any ALLOW TCP port 53'
        }, 'rule',
        'rule does not affect VMs'],

    [ 'global: not boolean', {
        rule: VALID_RULE,
        global: 'asdf'
        }, 'global',
        'global must be true or false'],

    [ 'both global and owner_uuid set', {
        rule: VALID_RULE,
        global: true,
        owner_uuid: 'e7d9d022-6272-11e3-a746-131978000f45'
        }, 'global',
        'cannot specify both global and owner_uuid'],

    [ 'rule: max number per side', {
        rule: 'FROM ' + nIPs(25) + ' TO all vms ALLOW TCP port 53'
        }, 'rule',
        'maximum of 24 targets allowed per side'],

    [ 'rule: max number per side', {
        rule: 'FROM all vms TO ' + nIPs(25) + ' BLOCK TCP port 53'
        }, 'rule',
        'maximum of 24 targets allowed per side'],

    [ 'rule: max number of ports', {
        rule: 'FROM all vms TO ip 192.168.5.4 BLOCK TCP ' + nPorts(9)
        }, 'rule',
        'maximum of 24 ports allowed'],

    [ 'rule: max number of ICMP types', {
        rule: 'FROM all vms TO ip 192.168.5.4 BLOCK ICMP ' + nTypes(9)
        }, 'rule',
        'maximum of 24 types allowed']
];


exports['Invalid rules'] = function (t) {
    INVALID.forEach(function (data) {
        var testName = data[0];
        var expMsg = data[3];
        var field = data[2];
        var opts;
        var rule = data[1];
        var thrown = false;

        try {
            opts = (field == 'global' ? { enforceGlobal: true } : {});
            fwrule.create(rule, opts);
        } catch (err) {
            thrown = true;
            t.equal(err.message, expMsg, 'Error message correct: ' + testName);
            t.equal(err.field, field, 'Error field correct: ' + testName);
        }

        t.ok(thrown, 'Error thrown: ' + testName);
    });

    t.done();
};


exports['Invalid parameters'] = function (t) {
    var thrown = false;
    var invalid = {
        enabled: 'invalid',
        rule: 'invalid',
        owner_uuid: 'invalid',
        uuid: 'invalid'
    };

    try {
        fwrule.create(invalid);
    } catch (err) {
        thrown = true;

        t.ok(err.hasOwnProperty('ase_errors'), 'multiple errors');
        if (err.hasOwnProperty('ase_errors')) {
            t.equal(err.ase_errors.length, 4, '4 sub-errors');
            t.deepEqual(err.ase_errors.map(function (e) {
                return [ e.field, e.message ];
            }), [
                ['rule', 'Error at character 0: \'invalid\', '
                    + 'expected: \'FROM\', found: word'],
                ['uuid', 'Invalid rule UUID'],
                ['owner_uuid', 'Invalid owner UUID'],
                ['enabled', 'enabled must be true or false']
            ], 'sub-errors');
        }
    }

    t.ok(thrown, 'error thrown');
    t.done();
};


exports['Missing rule field'] = function (t) {
    var thrown = false;

    try {
        fwrule.create({});
    } catch (err) {
        thrown = true;
        t.equal(err.message, 'No rule specified', 'error message');
        t.equal(err.field, 'rule', 'err.field');
    }

    t.ok(thrown, 'error thrown');
    t.done();
};


exports['global and owner_uuid not set'] = function (t) {
    var thrown = false;

    try {
        fwrule.create({
            rule: 'FROM any to all vms ALLOW tcp port 80'
        }, { enforceGlobal: true });
    } catch (err) {
        thrown = true;
        t.equal(err.message, 'owner_uuid required', 'error message');
        t.equal(err.field, 'owner_uuid', 'err.field');
    }

    t.ok(thrown, 'error thrown');
    t.done();
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        oneTest: runOne
    };
}
