// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// Tests for VM.lookup()
//

var assert = require('assert');
var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var utils = require('/usr/vm/node_modules/utils');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var trim = utils.trim;

/*
 * For a given 'key: value' pair here, we test that setting alias to <key>
 * results in <value> being stored in zonecfg (the base64 encoded version) and
 * then we test that loading the VM object back we once again get <key>.
 */
/* BEGIN JSSTYLED */
var test_aliases = {
    '': '',
    'x': 'eA==',
    'hello': 'aGVsbG8=',
    'hello world': 'aGVsbG8gd29ybGQ=',
    'öÖ-çÇ-şŞ-ıI-iİ-üÜ-ğĞ':
        'w7bDli3Dp8OHLcWfxZ4txLFJLWnEsC3DvMOcLcSfxJ4=',
    'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZAlphaBravoCharlieDeltaechoFoxtrotGolfHotelIndiaJulietKiloLimaMikeNovemberOscarPapaQuebecRomeoSierraTangoUniformVictorZulu987654':
        'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVpBbHBoYUJyYXZvQ2hhcmxpZURlbHRhZWNob0ZveHRyb3RHb2xmSG90ZWxJbmRpYUp1bGlldEtpbG9MaW1hTWlrZU5vdmVtYmVyT3NjYXJQYXBhUXVlYmVjUm9tZW9TaWVycmFUYW5nb1VuaWZvcm1WaWN0b3JadWx1OTg3NjU0'
};
/* END JSSTYLED */

function getZonecfgAlias(uuid, callback)
{
    var cmd = '/usr/sbin/zonecfg -z ' + uuid + ' info attr name=alias';
    var pattern = '^value: (.*)$';

    assert(uuid, 'no uuid passed to getZonecfgAlias');

    exec(cmd, function (error, stdout, stderr) {
        var alias = '';
        var match;

        if (error) {
            callback(error);
            return;
        }

        if (stdout === 'No such attr resource.') {
            alias = '';
        } else {
            stdout.split('\n').forEach(function (line) {
                match = trim(line).match(pattern);
                if (match) {
                    alias = match[1];
                }
            });
        }

        callback(null, alias);
    });
}

function setAndCheckAlias(t, uuid, alias, base64, callback)
{
    async.waterfall([
        function _updateAlias(cb) {
            // update to test alias
            VM.update(uuid, {alias: alias}, function (e) {
                t.ok(!e, 'update VM with alias "' + alias + '": '
                    + (e ? e.message : 'success'));
                cb();
            });
        }, function (cb) {
            // check that zonecfg value is correct
            getZonecfgAlias(uuid, function _checkZonecfgAlias(err, zalias) {
                t.equal(zalias, base64);
                if (err) {
                    t.ok(false, 'failed to get alias from zonecfg: '
                        + err.message);
                }
                cb();
            });
        }, function (cb) {
            // check that loaded value is correct
            VM.load(uuid, {fields: ['alias']}, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed to load VM after update: '
                        + err.message);
                    cb(err);
                    return;
                }

                t.equal((obj.alias == undefined) ? '' : obj.alias, alias);
                cb();
            });
        }
    ], callback);
}

test('test alias', function (t) {
    var state = {brand: 'joyent-minimal'};

    vmtest.on_new_vm(t, image_uuid, {
        alias: 'testing-aliases',
        brand: 'joyent-minimal',
        do_not_inventory: true
    }, state, [
        function (cb) {
            t.ok(state.uuid, 'VM uuid is ' + state.uuid);

            async.eachSeries(Object.keys(test_aliases), function (k, c) {
                setAndCheckAlias(t, state.uuid, k, test_aliases[k], c);
            }, cb);
        }
    ], function () {
        t.end();
    });
});
