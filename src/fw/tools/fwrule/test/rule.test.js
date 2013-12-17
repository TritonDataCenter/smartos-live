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



// --- Tests



exports['rule exports'] = function (t) {
    ['ACTIONS', 'DIRECTIONS', 'FIELDS', 'PROTOCOLS', 'TARGET_TYPES'].forEach(
        function (field) {
        t.ok(fwrule[field].length > 0, 'fwrule.' + field);
    });

    t.done();
};


exports['all target types'] = function (t) {
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
        rule: util.format('FROM (ip %s OR subnet %s OR tag %s OR vm %s) '
            + 'TO (ip %s OR subnet %s OR tag %s OR vm %s) ALLOW tcp PORT 80',
            ips[0], subnets[0], tags[0], vms[0],
            ips[1], subnets[1], tags[1], vms[1]),
        uuid: rule.uuid,
        version: rule.version
    };

    t.deepEqual(rule.serialize(), ser, 'rule.serialize()');
    t.deepEqual(rule.serialize(['enabled', 'version']),
        { enabled: ser.enabled, version: ser.version },
        'rule.serialize(): enabled, version');

    t.done();
};


exports['any'] = function (t) {
    var ip = '192.168.3.2';
    var vm = '8a343ca8-b42a-4a27-a9c5-800f57d1e8ed';
    var tag = 'tag3';
    var subnet = '192.168.0.0/16';

    var ruleTxt = util.format(
        'FROM (ip %s OR subnet %s OR tag %s OR vm %s) TO any ALLOW tcp PORT 80',
        ip, subnet, tag, vm);

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

    t.done();
};


exports['all vms'] = function (t) {
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

    t.done();
};


exports['tags'] = function (t) {
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
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');
    t.ok(!rule.allVMs, 'rule.allVMs');

    t.done();
};


exports['multiple ports and owner_uuid'] = function (t) {
    var inRule = {
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
            + '(PORT 1002 AND PORT 1052)',
        enabled: true,
        owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853',
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
        owner_uuid: inRule.owner_uuid,
        protocol: 'tcp',
        ports: [ 1002, 1052 ],
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
        owner_uuid: inRule.owner_uuid,
        rule: inRule.rule,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.done();
};


exports['icmp'] = function (t) {
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

    t.done();
};


exports['icmp with code'] = function (t) {
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

    t.done();
};


exports['icmp: multiple types'] = function (t) {
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

    t.done();
};


exports['sorting: icmp codes'] = function (t) {
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

    t.done();
};


exports['sorting: ports'] = function (t) {
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
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
            + '(PORT 6 AND PORT 10 AND PORT 80 AND PORT 1002 AND PORT 1052 '
            + 'AND PORT 30245)',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.done();
};


exports['port ALL'] = function (t) {
    var inRule = {
        rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp PORT all',
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
        rule: inRule.rule,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.done();
};


exports['tags: equal'] = function (t) {
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
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.to.tags, 'rule.tags');

    t.done();
};


exports['multiple tags: equal'] = function (t) {
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
        rule: ruleTxt,
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.to.tags, 'rule.tags');

    t.done();
};


exports['multiple tags: multiple values'] = function (t) {
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
        rule: 'FROM tag some-tag TO '
            + '(tag some-tag = value OR tag some-tag = value2) '
            + 'ALLOW tcp PORT 80',
        uuid: rule.uuid,
        version: rule.version
    }, 'rule.serialize()');

    t.ok(!rule.allVMs, 'rule.allVMs');
    t.deepEqual(rule.tags, raw.from.tags, 'rule.tags');

    t.done();
};


exports['multiple tags: multiple quoted values'] = function (t) {
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
            + '(tag "some tag" = value OR tag some-tag = "another value") '
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

    t.done();
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        oneTest: runOne
    };
}
