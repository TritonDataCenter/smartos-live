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
  t.ok(!rule.allVMs, 'rule.allVMs');

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
    rule: ruleTxt,
    uuid: rule.uuid,
    version: rule.version
  }, 'rule.serialize()');

  t.done();
};


exports['all vms'] = function (t) {
  var ip = '192.168.3.2';

  var ruleTxt = util.format('FROM ip %s TO all vms ALLOW tcp PORT 80', ip);

  var rule = fwrule.create({
    rule: ruleTxt,
    enabled: true,
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
    rule: ruleTxt,
    uuid: rule.uuid,
    version: rule.version
  }, 'rule.serialize()');
  t.ok(!rule.allVMs, 'rule.allVMs');

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
    rule: 'FROM ip 10.88.88.1 TO tag tag2 ALLOW tcp '
      + '(PORT 6 AND PORT 10 AND PORT 80 AND PORT 1002 AND PORT 1052 '
      + 'AND PORT 30245)',
    uuid: rule.uuid,
    version: rule.version
  }, 'rule.serialize()');

  t.done();
};



// Use to run only one test in this file:
if (runOne) {
  module.exports = {
    oneTest: runOne
  };
}
