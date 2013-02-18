/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule object
 */

var fwrule = require('../lib/index');
var util = require('util');



exports['all target types'] = function (t) {
  var ips = ['192.168.1.1', '10.2.0.3'];
  var vms = ['9a343ca8-b42a-4a27-a9c5-800f57d1e8ed',
    '518908b6-8299-466d-8ea5-20a0ceff63ec'];
  var tags = ['tag1', 'tag2'];
  var subnets = ['192.168.2.0/24', '10.2.1.0/24'];

  var rule = fwrule.create({ rule:
    util.format('FROM (ip %s OR vm %s OR tag %s OR subnet %s) ',
      ips[0], vms[0], tags[0], subnets[0])
      + util.format('TO (ip %s OR vm %s OR tag %s OR subnet %s)',
      ips[1], vms[1], tags[1], subnets[1])
      + ' ALLOW tcp port 80',
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

  var serialized = rule.serialize();
  t.deepEqual(serialized, {
    enabled: false,
    rule: ruleTxt,
    uuid: rule.uuid,
    version: rule.version
  }, 'rule.serialize()');

  t.done();
};


exports['multiple ports and owner_uuid'] = function (t) {
  var inRule = {
    rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp (PORT 1002 AND PORT 1052)',
    enabled: true,
    owner_uuid: '00000000-0000-0000-0000-000000000000',
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

  t.deepEqual(rule.serialize(), {
    enabled: true,
    owner_uuid: inRule.owner_uuid,
    rule: inRule.rule,
    uuid: rule.uuid,
    version: rule.version
  }, 'rule.serialize()');

  t.done();
};


/*jsl:ignore*/
var INVALID = [
  // Invalid IP
  [ {
      rule: 'FROM ip 10.99.99.99.254 TO tag smartdc_role ALLOW tcp port 22'
    }, /Unrecognized text/],
  // Invalid UUID
  [ { uuid: 'invalid',
      rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
      /* JSSTYLED */
    }, /Invalid rule UUID "invalid"/ ],
  // Invalid owner UUID
  [ { owner_uuid: 'invalid',
      rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
      /* JSSTYLED */
    }, /Invalid owner UUID "invalid"/ ],
  // Non-target type in FROM
  [ { rule: 'FROM foo TO ip 8.8.8.8 ALLOW udp port 53'
    }, /Expecting/ ],
  // Invalid subnet
  [ { rule: 'FROM tag foo TO subnet 10.8.0.0/33 ALLOW udp port 53'
      /* JSSTYLED */
    }, /Subnet "10.8.0.0\/33" is invalid/ ]
];
/*jsl:end*/


exports['Invalid rules'] = function (t) {
  INVALID.forEach(function (data) {
    var rule = data[0];
    var expMsg = data[1];
    t.throws(function () { fwrule.create(rule); }, expMsg,
      'Error thrown: ' + expMsg);
  });

  t.done();
};

/*
 * Need tests around versions:
 * - if one is supplied, when it overrides what's already on disk
 * - version updates when doing a fw.update()
 *
 * Can't add duplicate uuids
 * - or rules that are identical
 */
