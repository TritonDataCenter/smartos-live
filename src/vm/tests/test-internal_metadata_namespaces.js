// Copyright 2015 Joyent, Inc.  All rights reserved.
//
// These tests ensure that the internal_metadata_namespaces feature:
//
//  * shows up in KEYS when internal_metadata has namespaced key
//  * does not allow PUT to namespaced key from in the zone
//  * does not allow DELETE to namespaced key from in the zone
//  * shows GET result from internal_metadata for namespaced keys
//  * does not interfere with PUT or DELETE on non-namespaced keys
//  * does not show non-namespaced internal_metadata keys
//

var async = require('/usr/node/node_modules/async');
var exec = require('child_process').exec;
var fs = require('fs');
var utils = require('/usr/vm/node_modules/utils');
var VM = require('/usr/vm/node_modules/VM');
var vmtest = require('../common/vmtest.js');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

VM.loglevel = 'DEBUG';

var image_uuid = vmtest.CURRENT_SMARTOS_UUID;
var trim = utils.trim;

function waitForSvc(t, zonename, svc, state, callback) {
    var cmd = '/usr/bin/svcs -z ' + zonename + ' -Ho state ' + svc;
    var cur_state = '';

    async.until(function () {
        return (cur_state === state);
    }, function (cb) {
        exec(cmd, function (error, stdout, stderr) {
            var result = stdout.split('\n')[0];
            if (result && result.length > 0) {
                cur_state = result;
            }
            cb();
        });
    }, function (err) {
        t.equal(cur_state, state, svc + ' went "' + cur_state + '"');
        callback(err);
    });
}

test('test exercising internal_metadata_namespaces', function (t) {
    var payload = {
        alias: 'test-internal_metadata_namespaces-' + process.pid,
        autoboot: false,
        brand: 'joyent-minimal',
        do_not_inventory: true,
        internal_metadata_namespaces: ['baz', 'foo'],
        max_locked_memory: 512,
        max_physical_memory: 512,
        max_swap: 1024
    };
    var metadata = {
        customer_metadata: {
            'bar:foo': 'customer',
            'foo:bar': 'customer',
            'user-script': 'mdata-get foo:bar > /tmp/which_metadata.foobar\n'
                + 'mdata-get bar:foo > /tmp/which_metadata.barfoo\n'
                + 'mdata-list > /tmp/mdata.list\n'
                + 'mdata-put foo:qux value > /tmp/mdata_put.fooqux; '
                + 'echo $? > /tmp/mdata_put.fooqux.code\n'
                + 'mdata-put quux:qux value > /tmp/mdata_put.quuxqux; '
                + 'echo $? > /tmp/mdata_put.quuxqux.code\n'
                + 'mdata-delete user-script\n' // just to make checking easier
                + 'mdata-delete foo:bar; ' // should fail
                + 'echo $? > /tmp/mdata_delete.foobar.code\n'
                + 'exit 0\n'
        },
        internal_metadata: {
            'bar:foo': 'internal',
            'foo:bar': 'internal',
            'hidden': 'this should be hidden in the zone'
        }
    };
    var state = {brand: payload.brand};

    function checkOutputFile(filename, expected, string, cb) {
        fs.readFile('/zones/' + state.uuid + '/root/tmp/' + filename, 'utf8',
            function (error, data) {
                var lines;
                var results = [];

                t.ok(!error, 'loaded `' + filename + '` file');
                if (error) {
                    cb(error);
                    return;
                }
                lines = trim(data).split('\n');
                lines.forEach(function (line) {
                    results.push(trim(line));
                });

                t.deepEqual(results, expected, string);
                cb();
            }
        );
    }

    function checkWhichMetadata(file_ext, expected, string, cb) {
        checkOutputFile('which_metadata.' + file_ext, [expected], string, cb);
    }

    vmtest.on_new_vm(t, image_uuid, payload, state, [
        function (cb) {
            // replace metadata.json with version that tells us which we got
            fs.writeFile('/zones/' + state.uuid + '/config/metadata.json',
                JSON.stringify(metadata, null, 2) + '\n',
                function (err) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    cb();
                }
            );
        }, function (cb) {
            // Sanity check VM metadata
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'load obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }
                t.equal(obj.internal_metadata['bar:foo'], 'internal',
                    'check internal_metadata[\'bar:foo\']');
                t.equal(obj.internal_metadata['foo:bar'], 'internal',
                    'check internal_metadata[\'foo:bar\']');
                t.equal(obj.customer_metadata['bar:foo'], 'customer',
                    'check customer_metadata[\'bar:foo\']');
                t.equal(obj.customer_metadata['foo:bar'], 'customer',
                    'check customer_metadata[\'foo:bar\']');
                t.deepEqual(obj.internal_metadata_namespaces, ['baz', 'foo'],
                    'check internal_metadata_namespaces');
                cb();
            });
        }, function (cb) {
            VM.start(state.uuid, {}, function (err) {
                t.ok(!err, 'start VM');
                cb(err);
            });
        }, function (cb) {
            // wait for mdata:fetch
            waitForSvc(t, state.uuid, 'svc:/smartdc/mdata:execute', 'online',
                cb);
        }, function (cb) {
            checkWhichMetadata('barfoo', 'customer', 'check that non-namespaced'
                + ' key comes from customer_metadata', cb);
        }, function (cb) {
            checkWhichMetadata('foobar', 'internal', 'check that namespaced key'
                + ' comes from internal_metadata', cb);
        }, function (cb) {
            checkOutputFile('mdata.list', [
                'bar:foo',
                'user-script',
                'foo:bar'
            ], 'check that list includes namespaced internal_metadata key', cb);
        }, function (cb) {
            // This put should have failed since foo: is namespaced
            checkOutputFile('mdata_put.fooqux.code', ['2'], 'check that '
                + 'mdata-put fails for foo: namespace', cb);
        }, function (cb) {
            // This put should have failed since quux: is not namespaced
            checkOutputFile('mdata_put.quuxqux.code', ['0'], 'check that '
                + 'mdata-put still succeeds for non-namespaced key', cb);
        }, function (cb) {
            // This delete should have failed since foo: is namespaced
            checkOutputFile('mdata_delete.foobar.code', ['2'], 'check that '
                + 'mdata-delete fails for foo: namespace key', cb);
        }, function (cb) {
            // Check final metadata is what we expect
            VM.load(state.uuid, function (err, obj) {
                t.ok(!err, 'load obj for new VM');
                if (err) {
                    cb(err);
                    return;
                }
                t.deepEqual(obj.internal_metadata, {
                    'bar:foo': 'internal',
                    'foo:bar': 'internal',
                    'hidden': 'this should be hidden in the zone'
                }, 'check final internal_metadata: '
                    + JSON.stringify(obj.internal_metadata));
                t.deepEqual(obj.customer_metadata, {
                    'bar:foo': 'customer',
                    'foo:bar': 'customer',
                    'quux:qux': 'value'
                }, 'check final customer_metadata: '
                    + JSON.stringify(obj.customer_metadata));
                cb();
            });
        }
    ]);
});
