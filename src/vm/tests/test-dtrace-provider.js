// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that dtrace-provider doesn't break silently.
//

var util = require('util');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

test('load dtrace-provider', function(t) {
    var dp = require('/usr/node/node_modules/dtrace-provider');

    t.ok(util.inspect(dp.DTraceProvider) == '[Function: DTraceProvider]', 'DTraceProvider is not stub');
    t.end();
});

