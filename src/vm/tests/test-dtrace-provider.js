// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// These tests ensure that dtrace-provider doesn't break silently.
//

process.env['TAP'] = 1;

var test = require('tap').test;
var util = require('util');

test('load dtrace-provider', {}, function(t) {
    var dp = require('/usr/node/node_modules/dtrace-provider');

    t.ok(util.inspect(dp.DTraceProvider) == '[Function: DTraceProvider]', 'DTraceProvider is not stub');
    t.end();
});

