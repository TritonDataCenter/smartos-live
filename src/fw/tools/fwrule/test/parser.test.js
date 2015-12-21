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
 * Copyright (c) 2015, Joyent, Inc. All rights reserved.
 *
 *
 * Unit tests for the firewall rule parser
 */

var util = require('util');
var parser = require('../lib/index');



exports['tags'] = function (t) {
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

    t.done();
};


exports['icmp'] = function (t) {
    var vm = 'b0b92cd9-1fe7-4636-8477-81d2742566c2';

    t.deepEqual(parser.parse(
        util.format('FROM ip 10.0.0.2 TO vm %s ALLOW icmp type 8', vm)),
        { from: [ [ 'ip', '10.0.0.2' ] ],
            to: [ [ 'vm', vm ] ],
            action: 'allow',
            protocol: {
                name: 'icmp',
                targets: [ '8' ]
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

    t.done();
};


exports['case insensitivity'] = function (t) {
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
            targets: [ '8:0', '9' ]
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
            t.ifError(err);
        }
    });

    t.done();
};

exports['port ranges'] = function (t) {

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
    t.done();
};

exports['version mismatch'] = function (t) {
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
    t.done();
};

exports['icmp with code'] = function (t) {
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

    t.done();
};


exports['tag with value'] = function (t) {
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

    t.done();
};


exports['multiple tags with values'] = function (t) {
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

    t.done();
};


exports['tag with quoted value'] = function (t) {
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

    t.done();
};


exports['tags with quoted name and value'] = function (t) {
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

    t.done();
};


exports['tags with unicode characters'] = function (t) {
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

    t.done();
};
