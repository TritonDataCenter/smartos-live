/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * fwadm: rule tests
 */

var mod_rule = require('../../lib/rule');
var util = require('util');



// --- Tests



exports['all target types'] = function (t) {
  var ips = ['192.168.1.1', '10.2.0.3'];
  var machines = ['9a343ca8-b42a-4a27-a9c5-800f57d1e8ed',
    '518908b6-8299-466d-8ea5-20a0ceff63ec'];
  var tags = ['tag1', 'tag2'];
  var subnets = ['192.168.2.0/24', '10.2.1.0/24'];

  var rule = mod_rule.create({ rule:
    util.format('FROM (ip %s OR machine %s OR tag %s OR subnet %s) ',
      ips[0], machines[0], tags[0], subnets[0])
      + util.format('TO (ip %s OR machine %s OR tag %s OR subnet %s)',
      ips[1], machines[1], tags[1], subnets[1])
      + ' ALLOW tcp port 80',
    enabled: true
  });
  var raw = {
    from: {
      ips: [ips[0]],
      subnets: [subnets[0]],
      machines: [machines[0]],
      tags: [tags[0]]
    },
    to: {
      ips: [ips[1]],
      subnets: [subnets[1]],
      machines: [machines[1]],
      tags: [tags[1]]
    },
    enabled: true,
    ports: [ 80 ],
    action: 'allow',
    protocol: 'tcp',
    uuid: rule.uuid
  };

  t.deepEqual(rule.raw(), raw, 'rule.raw()');
  t.deepEqual(rule.from, raw.from, 'rule.from');
  t.deepEqual(rule.to, raw.to, 'rule.to');

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
    t.throws(function () { mod_rule.create(rule); }, expMsg,
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
