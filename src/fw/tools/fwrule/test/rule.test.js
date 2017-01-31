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
 * Unit tests for the firewall rule object
 */

'use strict';

var fwrule = require('../lib/index');
var util = require('util');
var test = require('tape');

var TAG_TEST =
    'FROM tag "%s" = "%s" TO tag "%s" = "%s" ALLOW tcp PORT 80';
var TAG_TEST_UNQUOTED = 'FROM tag %s = %s TO tag %s = %s ALLOW tcp PORT 80';


function stringify(val) {
    switch (val) {
    case '\u0085':
        return '"\\u0085"';
    default:
        return JSON.stringify(val);
    }
}


function testTagInRules(t, unquotedOK, txtIn, txtOut, val) {
    var desc = util.format('txtIn=%s, txtOut=%s, val=%s',
        stringify(txtIn), stringify(txtOut), stringify(val));
    var ruleOut = util.format(TAG_TEST, txtOut, txtOut, txtOut, txtOut);
    var toParse = [ util.format(TAG_TEST, txtIn, txtIn, txtIn, txtIn) ];

    if (unquotedOK) {
        toParse.push(
            util.format(TAG_TEST_UNQUOTED, txtIn, txtIn, txtIn, txtIn));
    }

    toParse.forEach(function (ruleIn) {
        var rule = fwrule.create({
            rule: ruleIn,
            created_by: 'fwadm',
            description: desc,
            enabled: true,
            version: fwrule.generateVersion()
        });

        var raw = {
            from: {
                ips: [],
                subnets: [],
                vms: [],
                tags: [ [ val, val ] ],
                wildcards: []
            },
            to: {
                ips: [],
                subnets: [],
                vms: [],
                tags: [ [ val, val ] ],
                wildcards: []
            },
            created_by: 'fwadm',
            description: desc,
            enabled: true,
            ports: [ 80 ],
            action: 'allow',
            protocol: 'tcp',
            uuid: rule.uuid,
            version: rule.version
        };

        t.deepEqual(rule.raw(), raw, desc + ': rule.raw()');
        t.deepEqual(rule.from, raw.from, desc + ': rule.from');
        t.deepEqual(rule.to, raw.to, desc + ': rule.to');
        t.ok(!rule.allVMs, desc + ': rule.allVMs');

        var ser = {
            created_by: 'fwadm',
            description: desc,
            enabled: true,
            global: true,
            rule: ruleOut,
            uuid: rule.uuid,
            version: rule.version
        };

        t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
        t.deepEqual(rule.serialize(['enabled', 'version']),
            { enabled: ser.enabled, version: ser.version },
            'rule.serialize(): enabled, version');
    });
}


function checkTagsInRules(t, toCheck) {
    toCheck.forEach(function (cfg) {
        testTagInRules(t, cfg.unquotedOK, cfg.in, cfg.out, cfg.val);
    });

    t.end();
}


// --- Tests



test('rule exports', function (t) {
    ['ACTIONS', 'DIRECTIONS', 'FIELDS', 'PROTOCOLS', 'TARGET_TYPES'].forEach(
        function (field) {
        t.ok(fwrule[field].length > 0, 'fwrule.' + field);
    });

    t.end();
});


test('all target types', function (t) {
    var desc = 'all target types';
    var ips = ['192.168.1.1', '10.2.0.3'];
    var vms = ['9a343ca8-b42a-4a27-a9c5-800f57d1e8ed',
        '518908b6-8299-466d-8ea5-20a0ceff63ec'];
    var tags = ['tag1', 'tag2'];
    var subnets = ['192.168.2.0/24', '10.2.1.0/24'];
    var ruleTxt = util.format('FROM (ip %s OR vm %s OR tag %s OR subnet %s) ',
        ips[0], vms[0], tags[0], subnets[0])
        + util.format('TO (ip %s OR vm %s OR tag %s OR subnet %s)',
        ips[1], vms[1], tags[1], subnets[1])
        + ' ALLOW tcp port 80';

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [ips[0]],
            subnets: [subnets[0]],
            vms: [vms[0]],
            tags: [tags[0]],
            wildcards: []
        },
        to: {
            ips: [ips[1]],
            subnets: [subnets[1]],
            vms: [vms[1]],
            tags: [tags[1]],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: util.format('FROM (ip %s OR subnet %s OR tag "%s" OR vm %s) '
            + 'TO (ip %s OR subnet %s OR tag "%s" OR vm %s) ALLOW tcp PORT 80',
            ips[0], subnets[0], tags[0], vms[0],
            ips[1], subnets[1], tags[1], vms[1]),
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('any', function (t) {
    var ip = '192.168.3.2';
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var tag = 'tag3';
    var subnet = '192.168.0.0/16';

    var ruleTxt = util.format(
        'FROM (ip %s OR subnet %s OR tag "%s" OR vm %s) TO any'
        + ' ALLOW tcp PORT 80', ip, subnet, tag, vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [ip],
            subnets: [subnet],
            vms: [vm],
            tags: [tag],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('all vms', function (t) {
    var ip = '192.168.3.2';
    var owner = '50716241-ac8d-4e63-a9e4-77ff07cede61';

    var ruleTxt = util.format('FROM ip %s TO all vms ALLOW tcp PORT 80', ip);

    var rule = fwrule.create({
        rule: ruleTxt,
        enabled: true,
        owner_uuid: owner,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [ip],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['vmall']
        },
        enabled: true,
        owner_uuid: owner,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.deepEqual(rule.wildcards, raw.to.wildcards, 'rule.wildcards');
    t.ok(rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        // no global flag set because the rule has an owner_uuid
        owner_uuid: owner,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('tags', function (t) {
    var ruleTxt = 'FROM ip 1.2.3.4 TO tag some-tag ALLOW tcp PORT 80';
    var rule = new fwrule.create({
        rule: ruleTxt,
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [ '1.2.3.4' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'some-tag' ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        global: true,
        rule: 'FROM ip 1.2.3.4 TO tag "some-tag" ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.end();
});


test('tag "hasOwnProperty"', function (t) {
    var ruleTxt = 'FROM ip 1.2.3.4 TO (tag hasOwnProperty OR tag some-tag) '
        + 'ALLOW tcp PORT 80';
    var rule = new fwrule.create({
        rule: ruleTxt,
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [ '1.2.3.4' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'hasOwnProperty', 'some-tag' ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        global: true,
        rule: 'FROM ip 1.2.3.4 TO (tag "hasOwnProperty" OR tag "some-tag") '
            + 'ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.end();
});


test('multiple ports and owner_uuid', function (t) {
    var inRule1 = {
        rule: 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp '
            + '(PORT 1002 AND PORT 1052)',
        enabled: true,
        owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853',
        version: fwrule.generateVersion()
    };
    var inRule2 = {
        rule: 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp '
            + 'PORTS 1002, 1052',
        enabled: true,
        owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853',
        version: fwrule.generateVersion()
    };


    var rule1 = fwrule.create(inRule1);
    var rule2 = fwrule.create(inRule2);
    var raw = {
        action: 'allow',
        enabled: inRule1.enabled,
        from: {
            ips: [ '10.88.88.1' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        owner_uuid: inRule1.owner_uuid,
        protocol: 'tcp',
        ports: [ 1002, 1052 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'tag2' ],
            wildcards: []
        },
        uuid: rule1.uuid,
        version: rule1.version
    };

    t.deepEqual(rule1.raw(), raw, 'rule1.raw()');
    t.deepEqual(rule1.ports, raw.ports, 'rule1.ports');
    t.deepEqual(rule1.protoTargets, raw.ports, 'rule1.protoTargets');

    t.deepEqual(rule1.serialize(), {
        enabled: true,
        owner_uuid: inRule1.owner_uuid,
        rule: inRule1.rule,
        uuid: rule1.uuid,
        version: rule1.version
    }, 'rule1.serialize()');

    raw.uuid = rule2.uuid;
    raw.version = rule2.version;

    t.deepEqual(rule2.raw(), raw, 'rule2.raw()');
    t.deepEqual(rule2.ports, raw.ports, 'rule2.ports');
    t.deepEqual(rule2.protoTargets, raw.ports, 'rule2.protoTargets');

    t.deepEqual(rule2.serialize(), {
        enabled: true,
        owner_uuid: inRule2.owner_uuid,
        rule: inRule1.rule,
        uuid: rule2.uuid,
        version: rule2.version
    }, 'rule2.serialize()');

    t.end();
});


test('icmp', function (t) {
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var ruleTxt = util.format(
        'FROM any TO vm %s ALLOW icmp TYPE 8', vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        enabled: true,
        types: [ '8' ],
        action: 'allow',
        protocol: 'icmp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('icmp with code', function (t) {
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var ruleTxt = util.format(
        'FROM any TO vm %s ALLOW icmp TYPE 8 CODE 0', vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        enabled: true,
        types: [ '8:0' ],
        action: 'allow',
        protocol: 'icmp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('icmp: multiple types', function (t) {
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var ruleTxt = util.format(
        'FROM any TO vm %s ALLOW icmp (TYPE 8 CODE 0 AND TYPE 11 CODE 0 '
        + 'AND TYPE 30)', vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        enabled: true,
        types: [ '8:0', '11:0', '30' ],
        action: 'allow',
        protocol: 'icmp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.types, raw.types, 'rule.types');
    t.deepEqual(rule.protoTargets, raw.types, 'rule.protoTargets');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('sorting: icmp codes', function (t) {
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var rule = fwrule.create({
        rule: util.format(
        'FROM any TO vm %s ALLOW icmp '
        + '(TYPE 8 CODE 0 AND TYPE 3 CODE 11 AND TYPE 40 AND TYPE 3 CODE 1 '
        + 'AND TYPE 30 AND TYPE 3 CODE 5)', vm),
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        enabled: true,
        types: [ '3:1', '3:5', '3:11', '8:0', '30', '40' ],
        action: 'allow',
        protocol: 'icmp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: util.format(
        'FROM any TO vm %s ALLOW icmp '
        + '(TYPE 3 CODE 1 AND TYPE 3 CODE 5 AND TYPE 3 CODE 11 '
        + 'AND TYPE 8 CODE 0 AND TYPE 30 AND TYPE 40)', vm),
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('sorting: icmp6 codes', function (t) {
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';

    var rule = fwrule.create({
        rule: util.format(
        'FROM any TO vm %s ALLOW icmp6 '
        + '(TYPE 8 CODE 0 AND TYPE 3 CODE 11 AND TYPE 40 AND TYPE 3 CODE 1 '
        + 'AND TYPE 30 AND TYPE 3 CODE 5)', vm),
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [],
            tags: [],
            wildcards: ['any']
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        enabled: true,
        types: [ '3:1', '3:5', '3:11', '8:0', '30', '40' ],
        action: 'allow',
        protocol: 'icmp6',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: util.format(
        'FROM any TO vm %s ALLOW icmp6 '
        + '(TYPE 3 CODE 1 AND TYPE 3 CODE 5 AND TYPE 3 CODE 11 '
        + 'AND TYPE 8 CODE 0 AND TYPE 30 AND TYPE 40)', vm),
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('sorting: ports', function (t) {
    var inRule = {
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
            + '(PORT 1002 AND PORT 10 AND PORT 1052 AND PORT 80 AND PORT 30245 '
            + 'AND PORT 6)',
        enabled: true,
        version: fwrule.generateVersion()
    };

    var rule = fwrule.create(inRule);
    var raw = {
        action: 'allow',
        enabled: inRule.enabled,
        from: {
            ips: [ '10.88.88.1' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 6, 10, 80, 1002, 1052, 30245 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'tag2' ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp '
            + '(PORT 6 AND PORT 10 AND PORT 80 AND PORT 1002 AND PORT 1052 '
            + 'AND PORT 30245)',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('sorting: port ranges', function (t) {
    var inRule = {
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
            + 'PORTS 1002, 20-40, 10, 1052, 80, 30245, 6 - 11',
        enabled: true,
        version: fwrule.generateVersion()
    };

    var rule = fwrule.create(inRule);
    var raw = {
        action: 'allow',
        enabled: inRule.enabled,
        from: {
            ips: [ '10.88.88.1' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ { start: 6, end: 11 }, 10, { start: 20, end: 40 },
            80, 1002, 1052, 30245 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'tag2' ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.strictEqual(rule.raw().ports[0].start, raw.ports[0].start,
        'Both starts are Numbers');
    t.strictEqual(rule.raw().ports[0].end, raw.ports[0].end,
        'Both ends are Numbers');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp '
            + 'PORTS 6 - 11, 10, 20 - 40, 80, 1002, 1052, 30245',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('single port range', function (t) {
    var inRule = {
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
            + 'PORTS 50-50',
        enabled: true,
        version: fwrule.generateVersion()
    };

    var rule = fwrule.create(inRule);
    var raw = {
        action: 'allow',
        enabled: inRule.enabled,
        from: {
            ips: [ '10.88.88.1' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ { start: 50, end: 50 } ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'tag2' ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: true,
        global: true,
        rule: 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp '
            + 'PORTS 50 - 50',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.end();
});


test('port ALL', function (t) {
    var normalText = 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp PORT all';
    var parenText = 'FROM ip 10.88.88.1 TO tag "tag2" ALLOW tcp ( PORT all )';
    var ruleTexts = [ normalText, parenText ];

    ruleTexts.forEach(function (ruleText) {
        var inRule = {
            rule: ruleText,
            enabled: true,
            version: fwrule.generateVersion()
        };

        var rule = fwrule.create(inRule);
        var raw = {
            action: 'allow',
            enabled: inRule.enabled,
            from: {
                ips: [ '10.88.88.1' ],
                vms: [],
                subnets: [],
                tags: [],
                wildcards: []
            },
            protocol: 'tcp',
            ports: [ 'all' ],
            to: {
                ips: [],
                vms: [],
                subnets: [],
                tags: [ 'tag2' ],
                wildcards: []
            },
            uuid: rule.uuid,
            version: rule.version
        };

        t.deepEqual(rule.raw(), raw, 'rule.raw()');
        t.deepEqual(rule.ports, raw.ports, 'rule.ports');
        t.deepEqual(rule.protoTargets, raw.ports, 'rule.protoTargets');

        t.deepEqual(rule.serialize(), {
            enabled: true,
            global: true,
            rule: normalText,
            uuid: rule.uuid,
            version: rule.version
        }, 'rule.serialize()');
    });

    t.end();
});


test('tags: equal', function (t) {
    var ruleTxt =
        'FROM ip 1.2.3.4 TO tag some-tag = value ALLOW tcp PORT 80';
    var rule = new fwrule.create({
        rule: ruleTxt,
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [ '1.2.3.4' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ [ 'some-tag', 'value' ] ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        global: true,
        rule: 'FROM ip 1.2.3.4 TO tag "some-tag" = "value" ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.to.tags, 'rule.tags');

    t.end();
});


test('multiple tags: equal', function (t) {
    var ruleTxt = 'FROM ip 1.2.3.4 TO '
        + '(tag some-tag = value OR tag some-tag = value2) ALLOW tcp PORT 80';
    var rule = new fwrule.create({
        rule: ruleTxt,
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [ '1.2.3.4' ],
            vms: [],
            subnets: [],
            tags: [],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [
                [ 'some-tag', 'value' ],
                [ 'some-tag', 'value2' ]
            ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        global: true,
        rule: 'FROM ip 1.2.3.4 TO '
            + '(tag "some-tag" = "value" OR tag "some-tag" = "value2")'
            + ' ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.to.tags, 'rule.tags');

    t.end();
});


test('multiple tags: multiple values', function (t) {
    var rule = new fwrule.create({
        rule: 'FROM (tag some-tag OR tag some-tag = value0) TO '
            + '(tag some-tag = value OR tag some-tag = value2) '
            + 'ALLOW tcp PORT 80',
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [ 'some-tag' ],
            wildcards: []
        },
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [
                [ 'some-tag', 'value' ],
                [ 'some-tag', 'value2' ]
            ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        global: true,
        // 'some-tag = value0' is a subset of 'tag some-tag', so it is not
        // included in the rule text
        rule: 'FROM tag "some-tag" TO '
            + '(tag "some-tag" = "value" OR tag "some-tag" = "value2") '
            + 'ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.from.tags, 'rule.tags');

    t.end();
});


test('multiple tags: multiple quoted values', function (t) {
    var owner = 'ace1da4b-9ab2-4991-8298-700bec1b70ed';
    var rule = new fwrule.create({
        owner_uuid: owner,
        rule: 'FROM '
            + '(tag "김치" = "백김치" '
            + 'OR tag "김치" = "白김치") TO '
            + '(tag "some tag" = value '
            + 'OR tag some-tag = "another value") '
            + 'ALLOW tcp PORT 80',
        version: fwrule.generateVersion()
    });

    var raw = {
        action: 'allow',
        enabled: false,
        from: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [
                [ '김치', '白김치' ],
                [ '김치', '백김치' ]
            ],
            wildcards: []
        },
        owner_uuid: owner,
        protocol: 'tcp',
        ports: [ 80 ],
        to: {
            ips: [],
            vms: [],
            subnets: [],
            tags: [
                [ 'some tag', 'value' ],
                [ 'some-tag', 'another value' ]
            ],
            wildcards: []
        },
        uuid: rule.uuid,
        version: rule.version
    };
    t.deepEqual(rule.raw(), raw, 'rule.raw()');

    t.deepEqual(rule.serialize(), {
        enabled: false,
        owner_uuid: owner,
        rule: 'FROM (tag "김치" = "白김치" '
            + 'OR tag "김치" = "백김치") TO '
            + '(tag "some tag" = "value" OR tag "some-tag" = "another value") '
            + 'ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, [
                [ 'some tag', 'value' ],
                [ 'some-tag', 'another value' ],
                [ '김치', '白김치' ],
                [ '김치', '백김치' ]
        ], 'rule.tags');

    t.end();
});


test('IPv6 sources', function (t) {
    var desc = 'IPv6 sources';
    var vm = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var ips = ['fd00::2', 'fe80::8:20ff:fe40:65e4'];
    var ruleTxt = util.format('FROM (ip %s OR ip %s) ', ips[0], ips[1])
        + util.format('TO vm %s ALLOW tcp PORT 80', vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: ips,
            subnets: [],
            vms: [],
            tags: [],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('IPv6 subnet sources', function (t) {
    var desc = 'IPv6 subnet sources';
    var vm = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var cidr = 'fd00::/64';
    var ruleTxt = util.format('FROM subnet %s ', cidr)
        + util.format('TO vm %s ALLOW tcp PORT 80', vm);

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [cidr],
            vms: [],
            tags: [],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('IPv6 destinations', function (t) {
    var desc = 'IPv6 destinations';
    var vm = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var ips = ['fd00::1', 'fd00::2'];
    var ruleTxt = util.format('FROM vm %s ', vm)
        + util.format('TO (ip %s OR ip %s) ALLOW tcp PORT 80', ips[0], ips[1]);

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        to: {
            ips: ips,
            subnets: [],
            vms: [],
            tags: [],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('IPv6 subnet destinations', function (t) {
    var desc = 'IPv6 subnet destinations';
    var vm = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var cidr = 'fd00::/64';
    var ruleTxt = util.format('FROM vm %s ', vm)
        + util.format('TO subnet %s BLOCK tcp PORT 80', cidr);

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: [],
            subnets: [],
            vms: [vm],
            tags: [],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [cidr],
            vms: [],
            tags: [],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'block',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('Mixed IPv4 and IPv6', function (t) {
    var desc = 'Mixed IPv4 and IPv6';
    var vm1 = '9a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var vm2 = '518908b6-8299-466d-8ea5-20a0ceff63ec';
    var ips = ['10.10.10.5', 'fd00::1'];
    var ruleTxt =
        util.format('FROM (ip %s OR ip %s OR vm %s) ', ips[0], ips[1], vm1)
        + util.format('TO vm %s ALLOW tcp PORT 80', vm2);

    var rule = fwrule.create({
        rule: ruleTxt,
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        version: fwrule.generateVersion()
    });

    var raw = {
        from: {
            ips: ips,
            subnets: [],
            vms: [vm1],
            tags: [],
            wildcards: []
        },
        to: {
            ips: [],
            subnets: [],
            vms: [vm2],
            tags: [],
            wildcards: []
        },
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        ports: [ 80 ],
        action: 'allow',
        protocol: 'tcp',
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.raw(), raw, 'rule.raw()');
    t.deepEqual(rule.from, raw.from, 'rule.from');
    t.deepEqual(rule.to, raw.to, 'rule.to');
    t.ok(!rule.allVMs, 'rule.allVMs');

    var ser = {
        created_by: 'fwadm',
        description: desc,
        enabled: true,
        global: true,
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.end();
});


test('Tag names and values: Normal', function (t) {
    var tags = [ 'foo', 'foo-bar', 'foo_bar', 'db2', 'foo_bar-baz', '_' ];

    var check = [];
    tags.forEach(function (tag) {
        check.push({ unquotedOK: true, in: tag, out: tag, val: tag });
        var tagUpper = tag.toUpperCase();
        check.push({
            unquotedOK: true,
            in: tagUpper,
            out: tagUpper,
            val: tagUpper
        });
    });

    checkTagsInRules(t, check);
});


test('Tag names and values: IP addresses and subnets', function (t) {
    checkTagsInRules(t, [
        { in: '1.2.3.4', out: '1.2.3.4', val: '1.2.3.4' },
        { in: '1.2.3.0/24', out: '1.2.3.0/24', val: '1.2.3.0/24' },
        { in: '1.2.3.0\\/24', out: '1.2.3.0/24', val: '1.2.3.0/24' },
        { in: 'fd00::a:b:c:5', out: 'fd00::a:b:c:5', val: 'fd00::a:b:c:5' },
        { in: 'fc00::/7', out: 'fc00::/7', val: 'fc00::/7' },
        { in: 'fc00::\\/7', out: 'fc00::/7', val: 'fc00::/7' }
    ]);
});


test('Tag names and values: Numeric', function (t) {
    var numbers = [
        '0', '1', '5', '2000', '1234567890', '987654321', '23', '00000', '0',
        '01', '10', '111111111'
    ];

    var check = [];
    numbers.forEach(function (num) {
        check.push({ unquotedOK: true, in: num, out: num, val: num });
    });

    checkTagsInRules(t, check);
});


test('Tag names and values: Keywords', function (t) {
    var kws = [
        'tag', 'from', 'to', 'ip', 'subnet', 'vm', 'any', 'all', 'all vms',
        'vms', 'or', 'and', 'block', 'allow', 'port', 'ports', 'tcp', 'udp',
        'icmp', 'icmp6', 'type', 'code'
    ];

    var check = [];
    kws.forEach(function (kw) {
        check.push({ in: kw, out: kw, val: kw });
        var kwUpper = kw.toUpperCase();
        check.push({ in: kwUpper, out: kwUpper, val: kwUpper });
    });

    checkTagsInRules(t, check);
});


test('Tag names and values: Escaped characters', function (t) {
    checkTagsInRules(t, [
        { val: ' ', in: ' ', out: ' ' },
        { val: ' ', in: '\\u0020', out: ' ' },
        { val: '\t', in: '\t', out: '\\t' },
        { val: '\t', in: '\\t', out: '\\t' },
        { val: '\t', in: '\\u0009', out: '\\t' },
        { val: '\n', in: '\n', out: '\\n' },
        { val: '\n', in: '\\n', out: '\\n' },
        { val: '\n', in: '\\u000A', out: '\\n' },
        { val: '\b', in: '\b', out: '\\b' },
        { val: '\b', in: '\\b', out: '\\b' },
        { val: '\b', in: '\\u0008', out: '\\b' },
        { val: '\f', in: '\f', out: '\\f' },
        { val: '\f', in: '\\f', out: '\\f' },
        { val: '\f', in: '\\u000C', out: '\\f' },
        { val: '\r', in: '\r', out: '\\r' },
        { val: '\r', in: '\\r', out: '\\r' },
        { val: '\r', in: '\\u000D', out: '\\r' },
        { val: '/', in: '/', out: '/' },
        { val: '/', in: '\\/', out: '/' },
        { val: '(', in: '(', out: '\\(' },
        { val: '(', in: '\\(', out: '\\(' },
        { val: ')', in: ')', out: '\\)' },
        { val: ')', in: '\\)', out: '\\)' },
        { val: '"', in: '\\"', out: '\\"' },
        { val: '\\', in: '\\\\', out: '\\\\' }
    ]);
});


test('Tag names and values: Odd characters', function (t) {
    var chars = [
        '!', '@', '#', '$', '%', '^', '&', '*', ',', '.', '<', '>', '?', ';',
        ':', '\'', '[', ']', '{', '}', '|', '=', '+', '~', '`', '-', '_'
    ];

    var check = [];
    chars.forEach(function (c) {
        check.push({ in: c, out: c, val: c });
    });

    checkTagsInRules(t, check);
});


test('Tag names and values: ASCII control characters', function (t) {
    var chars = [
        '0000', // null (NUL)
        '0001', // start of heading (SOH)
        '0002', // start of text (STX)
        '0003', // end of text (ETX)
        '0004', // end of transmission (EOT)
        '0005', // enquiry (ENQ)
        '0006', // acknowledgement (ACK)
        '0007', // bell (BEL)
        '000B', // vertical tab (VT)
        '000E', // shift out (SO)
        '000F', // shift in (SI)
        '0010', // data link escape (DLE)
        '0011', // device control 1 (DC1)/XON
        '0012', // device control 2 (DC2)
        '0013', // device control 3 (DC3)/XOFF
        '0014', // device control 4 (DC4)
        '0015', // negative acknowledgement (NAK)
        '0016', // synchronous idle (SYN)
        '0017', // end of transmission block (ETB)
        '0018', // cancel (CAN)
        '0019', // end of medium (EM)
        '001A', // substitute (SUB)
        '001B', // escape (ESC)
        '001C', // file separator (FS)
        '001D', // group separator (GS)
        '001E', // record separator (RS)
        '001F', // unit separator (US)
        '007F'  // delete (DEL)
    ];

    var check = [];
    chars.forEach(function (str) {
        var space = String.fromCharCode(parseInt(str, 16));
        var escaped = '\\u' + str;
        var escapedLC = '\\u' + str.toLowerCase();
        check.push({ in: space, out: escaped, val: space });
        check.push({ in: escaped, out: escaped, val: space });
        check.push({ in: escapedLC, out: escaped, val: space });
    });

    checkTagsInRules(t, check);
});


test('Tag names and values: Unicode whitespace characters', function (t) {
    var chars = [
        '000B', // vertical tab
        '0085', // next line
        '00A0', // non-breaking space
        '1680', // ogham space mark
        '180E', // mongolian vowel separator
        '2000', // en quad
        '2001', // em quad
        '2002', // en space
        '2003', // em space
        '2004', // three-per-em space
        '2005', // four-per-em space
        '2006', // six-per-em space
        '2007', // figure space
        '2008', // punctuation space
        '2009', // thin space
        '200A', // hair space
        '200B', // zero width space
        '200C', // zero width non-joiner
        '200D', // zero width joiner
        '2028', // line separator
        '2029', // paragraph separator
        '202F', // narrow no-break space
        '205F', // medium mathematical space
        '2060', // word joiner
        '3000', // ideographic space
        'FEFF'  // zero width no-break space
    ];

    var check = [];
    chars.forEach(function (str) {
        var space = String.fromCharCode(parseInt(str, 16));
        var escaped = '\\u' + str;
        var escapedLC = '\\u' + str.toLowerCase();
        check.push({ in: space, out: escaped, val: space });
        check.push({ in: escaped, out: escaped, val: space });
        check.push({ in: escapedLC, out: escaped, val: space });
    });

    checkTagsInRules(t, check);
});
