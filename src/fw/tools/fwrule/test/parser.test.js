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
 * Copyright (c) 2016, Joyent, Inc. All rights reserved.
 *
 *
 * Unit tests for the firewall rule parser
 */

'use strict';

var util = require('util');
var parser = require('../lib/index');
var test = require('tape');


// --- Helpers

function checkInvalidRules(t, toCheck) {
    toCheck.forEach(function (rule) {
        try {
            parser.parse(rule);
            t.fail('Parsing bad rule didn\'t fail: ' + rule);
        } catch (err) {
            t.ok(err.message, 'Failed to parse bad rule: ' + rule);
        }
    });

    t.end();
}


// --- Tests


test('empty input', function (t) {
    try {
        parser.parse('');
        t.ok(false, 'Empty input to the parser should throw!');
    } catch (err) {
        t.deepEqual(err.message,
            'Error at character 0: \'\', expected: \'FROM\', '
            + 'found: empty string');
    }
    t.end();
});


test('tags', function (t) {
    t.deepEqual(parser.parse(
        'FROM ip 1.2.3.4 TO tag some-tag ALLOW tcp PORT 80'),
        { from: [ [ 'ip', '1.2.3.4' ] ],
            to: [ [ 'tag', 'some-tag' ] ],
            action: 'allow',
            protocol: {
                name: 'tcp',
                targets: [ 80 ]
            }
        }, 'tag containing dashes');

    t.end();
});


test('icmp', function (t) {
    var vm = 'b0b92cd9-1fe7-4636-8477-81d2742566c2';

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp type 8', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ 8 ]
            }
        }, 'icmp with type');

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp type 8 code 0', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ '8:0' ]
            }
        }, 'icmp with type and code');

    t.end();
});


test('case insensitivity', function (t) {
    var vm = 'b5ff85db-fc33-4471-b045-5688cb7fa6a8';
    var ipToTag = {
        from: [ [ 'ip', '1.2.3.4' ] ],
        to: [ [ 'tag', 'some-tag' ] ],
        action: 'allow',
        protocol: {
            name: 'tcp',
            targets: [ 80 ]
        }
    };

    var anyToVM = {
        from: [ [ 'wildcard', 'any' ] ],
        to: [ [ 'vm', vm ] ],
        action: 'allow',
        protocol: {
            name: 'udp',
            targets: [ 50 ]
        }
    };

    var subnetToAll = {
        from: [ [ 'subnet', '10.8.0.0/16' ] ],
        to: [ [ 'wildcard', 'vmall' ] ],
        action: 'allow',
        protocol: {
            name: 'icmp',
            targets: [ 30 ]
        }
    };

    var ipTag = {
        from: [ [ 'subnet', '10.8.0.0/16' ],
                        [ 'ip', '10.9.0.1' ] ],
        to: [ [ 'wildcard', 'vmall' ] ],
        action: 'allow',
        protocol: {
            name: 'icmp',
            targets: [ '8:0', 9 ]
        }
    };

    [
        [ 'FROM IP 1.2.3.4 TO TAG some-tag ALLOW TCP PORTS 80', ipToTag ],
        [ 'FROM IP 1.2.3.4 TO TAG some-tag ALLOW TCP ports 80', ipToTag ],
        [ 'FROM IP 1.2.3.4 TO TAG some-tag ALLOW TCP PORT 80', ipToTag ],
        [ 'from ip 1.2.3.4 to tag some-tag allow tcp port 80', ipToTag ],
        [ util.format('from ANY to VM %s allow UDP ports 50', vm), anyToVM ],
        [ util.format('from any to vm %s allow udp ports 50', vm), anyToVM ],
        [ util.format('from ANY to VM %s allow UDP port 50', vm), anyToVM ],
        [ util.format('from any to vm %s allow udp port 50', vm), anyToVM ],
        [ 'FROM SUBNET 10.8.0.0/16 TO ALL VMS ALLOW ICMP TYPE 30',
            subnetToAll ],
        [ 'FROM subnet 10.8.0.0/16 TO all vms ALLOW icmp type 30',
            subnetToAll ],
        [ 'FROM (subnet 10.8.0.0/16 OR ip 10.9.0.1) TO all vms ALLOW '
            + 'icmp (TYPE 8 CODE 0 AND TYPE 9)', ipTag ],
        [ 'FROM (subnet 10.8.0.0/16 OR ip 10.9.0.1) TO all vms ALLOW '
            + 'icmp (type 8 code 0 and type 9)', ipTag ]

    ].forEach(function (data) {
        try {
            t.deepEqual(parser.parse(data[0]), data[1], data[0]);
        } catch (err) {
            t.ifError(err, data[0]);
        }
    });

    t.end();
});


test('parentheses around wildcards', function (t) {
    var anyToAll = {
        from: [ [ 'wildcard', 'any' ] ],
        to: [ [ 'wildcard', 'vmall' ] ],
        action: 'allow',
        protocol: {
            name: 'udp',
            targets: [ 50 ]
        }
    };

    [
        [ 'from (ANY) to ALL VMS allow UDP ports 50', anyToAll ],
        [ 'from (any) to all vms allow udp ports 50', anyToAll ],
        [ 'from ANY to (ALL VMS) allow UDP ports 50', anyToAll ],
        [ 'from any to (all vms) allow udp ports 50', anyToAll ],
        [ 'FROM ( ANY ) TO ALL VMS ALLOW UDP ports 50', anyToAll ],
        [ 'FROM ( ANY ) TO all vms ALLOW udp ports 50', anyToAll ],
        [ 'from ANY to ( ALL VMS ) allow UDP ports 50', anyToAll ],
        [ 'from any to ( all vms ) allow udp ports 50', anyToAll ],
        [ 'from ( any ) to ( all vms ) allow udp ports 50', anyToAll ],
        [ 'from (any) to (all vms) allow udp ports 50', anyToAll ]
    ].forEach(function (data) {
        try {
            t.deepEqual(parser.parse(data[0]), data[1], data[0]);
        } catch (err) {
            t.ifError(err, data[0]);
        }
    });

    t.end();
});


test('incomplete rule text', function (t) {
    var check = [ ];

    var to = [ 'TO' ];
    var targets = [
        'any', 'all vms', 'ip 1.2.3.4', 'ip fd00::1', 'subnet 1.2.3.0/24',
        'subnet fd00::/64', 'tag foo', 'tag foo = bar',
        'vm ca3eb1d6-1555-44fb-ea1a-ab66f4685214'
    ];
    var endings = [ 'port', 'ports', 'ports 1 -', 'ports 1-', 'type',
        'type 128 code' ];

    function buildStr(str, remains) {
        check.push(str);

        if (remains[0] !== undefined) {
            remains[0].forEach(function (strB) {
                buildStr(str + ' ' + strB, remains.slice(1));
            });
        }
    }

    buildStr('FROM',
        [ targets, to, targets, parser.ACTIONS, parser.PROTOCOLS, endings ]);

    checkInvalidRules(t, check);
});


test('Invalid: Logical operations', function (t) {
    checkInvalidRules(t, [
        'FROM (tag a foo tag b) TO any ALLOW tcp PORT 80',
        'FROM (tag a xor tag b) TO any ALLOW tcp PORT 80',
        'FROM (tag a nand tag b) TO any ALLOW tcp PORT 80',
        'FROM (tag a not tag b) TO any ALLOW tcp PORT 80',
        'FROM (tag a nor tag b) TO any ALLOW tcp PORT 80',
        'FROM (tag a xnor tag b) TO any ALLOW tcp PORT 80'
    ]);
});


test('Invalid: Actions', function (t) {
    checkInvalidRules(t, [
        'FROM any TO any DENY tcp PORT 80',
        'FROM any TO any FORWARD tcp PORT 80',
        'FROM any TO any OBSTRUCT tcp PORT 80',
        'FROM any TO any PASS tcp PORT 80',
        'FROM any TO any PASSTHROUGH tcp PORT 80',
        'FROM any TO any PERMIT tcp PORT 80'
    ]);
});


test('Invalid: Protocols', function (t) {
    checkInvalidRules(t, [
        'FROM any TO any ALLOW foo PORT 80',
        'FROM any TO any ALLOW bar PORT 80',
        'FROM any TO any ALLOW ftp PORT 80',
        'FROM any TO any ALLOW ssh PORT 80',
        'FROM any TO any ALLOW http PORT 80',
        'FROM any TO any ALLOW sctp PORT 80',
        'FROM any TO any ALLOW dccp PORT 80',
        'FROM any TO any ALLOW mtcp PORT 80'
    ]);
});

test('Invalid: Parameters for TCP & UDP', function (t) {
    checkInvalidRules(t, [
        'FROM any TO any ALLOW tcp PORT hello',
        'FROM any TO any ALLOW udp PORT hello',
        'FROM any TO any ALLOW tcp PORT ssh',
        'FROM any TO any ALLOW udp PORT ssh',
        'FROM any TO any ALLOW tcp PORT _',
        'FROM any TO any ALLOW udp PORT _',
        'FROM any TO any ALLOW tcp PORT *',
        'FROM any TO any ALLOW udp PORT *',
        'FROM any TO any ALLOW tcp PORTS hello',
        'FROM any TO any ALLOW udp PORTS hello',
        'FROM any TO any ALLOW tcp PORTS ssh',
        'FROM any TO any ALLOW udp PORTS ssh',
        'FROM any TO any ALLOW tcp PORTS ssh-http',
        'FROM any TO any ALLOW udp PORTS ssh-http',
        'FROM any TO any ALLOW tcp PORTS _',
        'FROM any TO any ALLOW udp PORTS _',
        'FROM any TO any ALLOW tcp PORTS *',
        'FROM any TO any ALLOW udp PORTS *',
        'FROM any TO any ALLOW tcp TYPE 128',
        'FROM any TO any ALLOW udp TYPE 128',
        'FROM any TO any ALLOW tcp TYPE 128 CODE 0',
        'FROM any TO any ALLOW udp TYPE 128 CODE 0'
    ]);
});

test('Invalid: Parameters for ICMP(6)', function (t) {
    checkInvalidRules(t, [
        'FROM any TO any ALLOW icmp PORT 80',
        'FROM any TO any ALLOW icmp6 PORT 80',
        'FROM any TO any ALLOW icmp PORTS 80',
        'FROM any TO any ALLOW icmp6 PORTS 80',
        'FROM any TO any ALLOW icmp PORTS 80-85',
        'FROM any TO any ALLOW icmp6 PORTS 80-85',
        'FROM any TO any ALLOW icmp TYPE foo',
        'FROM any TO any ALLOW icmp6 TYPE foo',
        'FROM any TO any ALLOW icmp TYPE *',
        'FROM any TO any ALLOW icmp6 TYPE *',
        'FROM any TO any ALLOW icmp TYPE 1:0',
        'FROM any TO any ALLOW icmp6 TYPE 1:0',
        'FROM any TO any ALLOW icmp 1:0',
        'FROM any TO any ALLOW icmp6 1:0',
        'FROM any TO any ALLOW icmp TYPE 128 CODE foo',
        'FROM any TO any ALLOW icmp6 TYPE 128 CODE foo',
        'FROM any TO any ALLOW icmp TYPE 128 CODE *',
        'FROM any TO any ALLOW icmp6 TYPE 128 CODE *',
        'FROM any TO any ALLOW icmp TYPE 128 CODE _',
        'FROM any TO any ALLOW icmp6 TYPE 128 CODE _'
    ]);
});


test('port ranges', function (t) {
    var rangeA = {
        from: [ [ 'ip', '1.2.3.4' ] ],
        to: [ [ 'tag', 'some-tag' ] ],
        action: 'allow',
        protocol: {
            name: 'tcp',
            targets: [ { start: 20, end: 40 } ]
        }
    };

    [
        [ 'FROM IP 1.2.3.4 TO TAG some-tag ALLOW TCP PORTS 20-40', rangeA ],
        [ 'FROM IP 1.2.3.4 TO TAG some-tag ALLOW TCP PORTS 20 - 40', rangeA ]
    ].forEach(function (data) {
        try {
            t.deepEqual(parser.parse(data[0]), data[1], data[0]);
        } catch (err) {
            t.ifError(err);
        }
    });
    t.end();
});


test('version mismatch', function (t) {
    try {
        parser.parse('FROM tag foo TO tag bar ALLOW TCP PORTS 20-30',
            { maxVersion: 1 });
        t.ok(false,
            'Using port ranges is a newer feature and should fail in v1');
    } catch (err) {
        t.deepEqual(err.message,
            'The rule uses a feature (port ranges) newer than this API allows',
            'Correct error message for using ports in version 1');
    }
    t.end();
});


test('icmp with code', function (t) {
    var vm = 'b0b92cd9-1fe7-4636-8477-81d2742566c2';
    var ruleTxt = util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp type 8 '
        + 'code 0', vm);

    t.deepEqual(parser.parse(ruleTxt),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ '8:0' ]
            }
        }, 'icmp with type');

    t.end();
});


test('icmp type all', function (t) {
    var vm = 'b0b92cd9-1fe7-4636-8477-81d2742566c2';

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp type all', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ 'all' ]
            }
        }, 'icmp type all');

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp ( TYPE ALL )', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ 'all' ]
            }
        }, 'icmp type all in parens');

    t.end();
});


test('icmp6 type all', function (t) {
    var vm = 'b0b92cd9-1fe7-4636-8477-81d2742566c2';

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp6 type all', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp6',
                targets: [ 'all' ]
            }
        }, 'icmp6 type all');

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp6 ( TYPE ALL )', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp6',
                targets: [ 'all' ]
            }
        }, 'icmp6 type all in parens');

    t.end();
});


test('Tags: With value', function (t) {
    var ruleTxt = 'FROM tag foo = bar TO ip 8.8.8.8 BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt),
        { from: [ [ 'tag', [ 'foo', 'bar' ] ] ],
            to: [ [ 'ip', '8.8.8.8' ] ],
            action: 'block',
            protocol: {
                name: 'udp',
                targets: [ 53 ]
            }
        }, 'tag = value');

    t.end();
});


test('Tags: Multiple values', function (t) {
    var ruleTxt = 'FROM (tag foo = bar OR tag some = value) TO '
        + 'ip 8.8.8.8 BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt),
        { from: [
            [ 'tag', [ 'foo', 'bar' ] ],
            [ 'tag', [ 'some', 'value' ] ]
        ],
            to: [ [ 'ip', '8.8.8.8' ] ],
            action: 'block',
            protocol: {
                name: 'udp',
                targets: [ 53 ]
            }
        }, 'tag = value');

    t.end();
});


test('Tags: Quoted value', function (t) {
    var ruleTxt = 'FROM tag foo = "some value" TO ip 8.8.8.8 BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt),
        { from: [ [ 'tag', [ 'foo', 'some value' ] ] ],
            to: [ [ 'ip', '8.8.8.8' ] ],
            action: 'block',
            protocol: {
                name: 'udp',
                targets: [ 53 ]
            }
        }, 'tag = value');

    t.end();
});


test('Tags: Quoted name and value', function (t) {
    var ruleTxt = 'FROM (tag "tag one" = "some value" OR '
        + 'tag "tag two" = "another value")'
        + 'TO ip 8.8.8.8 BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt),
        { from: [
                [ 'tag', [ 'tag one', 'some value' ] ],
                [ 'tag', [ 'tag two', 'another value' ] ]
            ],
            to: [ [ 'ip', '8.8.8.8' ] ],
            action: 'block',
            protocol: {
                name: 'udp',
                targets: [ 53 ]
            }
        }, 'tag = value');

    t.end();
});


test('Tags: Escaped characters', function (t) {
    var ruleTxt = 'FROM (tag "\\"" = "\\)" OR tag "\\n" = "\\b") TO tag "\\(" '
        + 'BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt), {
        from: [ [ 'tag', [ '"', ')' ] ],
                [ 'tag', [ '\n', '\b' ] ] ],
        to: [ [ 'tag', '(' ] ],
        action: 'block',
        protocol: {
            name: 'udp',
            targets: [ 53 ]
        }
    });

    t.end();
});


test('Tags: Parens shouldn\'t have to be escaped', function (t) {
    var ruleTxt = 'FROM tag "(" = "(" TO tag ")" = ")" '
        + 'BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt), {
        from: [ [ 'tag', [ '(', '(' ] ] ],
        to: [ [ 'tag', [ ')', ')' ] ] ],
        action: 'block',
        protocol: {
            name: 'udp',
            targets: [ 53 ]
        }
    });

    t.end();
});


test('Tags: UTF-8 characters can be written using \\u', function (t) {
    var escapedTxt = 'FROM tag "\\u2603" = "\\u0631\\u062c\\u0644 '
        + '\\u0627\\u0644\\u062b\\u0644\\u062c" TO tag "\\u26C4" '
        + 'BLOCK udp PORT 53';
    var unicodeTxt = 'FROM tag "☃" = "رجل الثلج" TO tag "⛄" '
        + 'BLOCK udp PORT 53';

    t.deepEqual(parser.parse(escapedTxt), parser.parse(unicodeTxt));

    t.end();
});


test('Tags: Unicode characters', function (t) {
    var ruleTxt = 'FROM (tag "☂" = "ທ" OR '
        + 'tag "삼겹살" = "불고기")'
        + 'TO ip 8.8.8.8 BLOCK udp PORT 53';

    t.deepEqual(parser.parse(ruleTxt),
        { from: [
                [ 'tag', [ '☂', 'ທ' ] ],
                [ 'tag', [ '삼겹살', '불고기' ] ]
            ],
            to: [ [ 'ip', '8.8.8.8' ] ],
            action: 'block',
            protocol: {
                name: 'udp',
                targets: [ 53 ]
            }
        }, 'tag = value');

    t.end();
});
