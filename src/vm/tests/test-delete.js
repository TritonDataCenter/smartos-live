// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// These tests ensure that delete behaves correctly.
//

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

// blatantly copied from VM.js
function rtrim(str, chars)
{
    chars = chars || '\\s';
    str = str || '';
    return str.replace(new RegExp('[' + chars + ']+$', 'g'), '');
}

function getUUID(callback)
{
    var cmd = '/usr/bin/uuid';

    execFile(cmd, ['-v', '4'], function (error, stdout, stderr) {
        if (error) {
            console.error('uuid exited non-zero (' + error.code + ')');
        }
        callback(error, rtrim(stdout));
    });
}

// w/ OS-2284 we sometimes blew up deleting a non-existent VM, test that we
// haven't regressed.
test('test deleting nonexistent VM', function(t) {
    var i;

    i = 0;
    async.whilst(
        function () {
            return i < 50;
        },
        function (callback) {
            getUUID(function (err, uuid) {
                i++;
                t.ok(!err, 'no error getting uuid: ' + (err ? err.message : 'ok'));
                if (!err) {
                    t.ok(uuid, 'uuid is: ' + uuid);
                    VM.delete(uuid, {}, function (err) {
                        if (err && err.message.match(/No such zone configured/)) {
                            t.ok(true, 'zone ' + uuid + ' already does not exist, skipping');
                        } else {
                            t.ok(!err, 'deleted VM: ' + (err ? err.message : 'success'));
                        }
                        callback();
                    });
                } else {
                    callback();
                }
            });
        }, function (err, cb) {
            t.end();
        }
    );
});

