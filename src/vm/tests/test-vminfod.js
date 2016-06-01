// Copyright 2015 Joyent, Inc.

var VminfodClient = require('vminfod/client');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

test('create VminfodClient object and test /status', function (t) {
    var vc = new VminfodClient();
    t.ok(vc, 'VminfodClient created');

    vc.status(function (err, stats) {
        t.ifError(err, 'vc.status no error');
        t.ok(stats, 'vc.status object found');
        t.end();
    });
});
