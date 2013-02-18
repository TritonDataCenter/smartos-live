/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for the firewall rule parser
 */

var parser = require('../lib/index');

exports['tags'] = function (t) {
  var ruleTxt = 'FROM ip 1.2.3.4 TO tag some-tag ALLOW tcp PORT 80';
  t.deepEqual(parser.parse(ruleTxt),
    { from: [ [ 'ip', '1.2.3.4' ] ],
      to: [ [ 'tag', 'some-tag' ] ],
      action: 'allow',
      protocol: 'tcp',
      ports: [ 80 ]
    }, 'contains dashes');

  t.done();
};
