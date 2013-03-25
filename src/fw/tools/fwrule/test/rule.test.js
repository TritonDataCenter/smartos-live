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


var INVALID = [
  [ 'invalid IP: too many numbers',
    {
      rule: 'FROM ip 10.99.99.99.254 TO tag smartdc_role ALLOW tcp port 22' },
      'rule', 'Error at character 19: \'.254 TO tag smartdc_\', '
              + 'found: unexpected text'],

  [ 'invalid UUID',
    { uuid: 'invalid',
      rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
    }, 'uuid', 'Invalid rule UUID "invalid"' ],

  [ 'invalid owner UUID',
    { owner_uuid: 'invalid',
      rule: 'FROM tag foo TO ip 8.8.8.8 ALLOW udp port 53'
    }, 'owner_uuid', 'Invalid owner UUID "invalid"' ],

  [ 'non-target type in FROM',
    { rule: 'FROM foo TO ip 8.8.8.8 ALLOW udp port 53' },
    'rule', 'Error at character 4: \'foo\', '
            + 'expected: \'(\', \'all\', \'any\', \'ip\', '
            + '\'subnet\', \'vm\', \'tag\', found: tag text'],

  [ 'invalid subnet',
    { rule: 'FROM tag foo TO subnet 10.8.0.0/33 ALLOW udp port 53' },
    'rule', 'Subnet "10.8.0.0/33" is invalid (must be in CIDR format)' ],

  [ 'invalid port',
    { rule: 'FROM tag foo TO subnet 10.8.0.0/24 ALLOW udp port 0' },
    'rule', 'Invalid port number "0"' ],

  [ 'invalid VM UUID',
    { rule: 'FROM vm asdf TO subnet 10.8.0.0/24 ALLOW udp port 50' },
    'rule', 'Error at character 7: \'asdf\', '
            + 'expected: \'UUID\', found: tag text'],

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
    'rule', 'Error at character 24: \'OR\', expected: \')\', found: OR' ]
];


exports['Invalid rules'] = function (t) {
  INVALID.forEach(function (data) {
    var testName = data[0];
    var expMsg = data[3];
    var field = data[2];
    var rule = data[1];
    var thrown = false;

    try {
      fwrule.create(rule);
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
          + 'expected: \'FROM\', found: tag text'],
        ['uuid', 'Invalid rule UUID "invalid"'],
        ['owner_uuid', 'Invalid owner UUID "invalid"'],
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
    t.equal(err.message, 'No rule specified!', 'error message');
    t.equal(err.field, 'rule', 'err.field');
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
