/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

var async = require('/usr/node/node_modules/async');
var bunyan = require('/usr/vm/node_modules/bunyan');
var fs = require('fs');
var log = bunyan.createLogger({level: 'debug', name: 'test-vmload-xml', serializers: bunyan.stdSerializers});
var path = require('path');
var vmload_xml = require('/usr/vm/node_modules/vmload/vmload-xml');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('nodeunit-plus');

// save some typing
var getVmobjXML = vmload_xml.getVmobjXML;
var getVmobjXMLFile = vmload_xml.getVmobjXMLFile;

var TESTDIR = '/usr/vm/test/testdata/vmload-xml';

/*
 * TODO: logger that errors when message >= WARN
 *
 */

/*
 * Load each .xml file in TESTDIR and if there's a .json file with the same
 * name, ensure we parse the xml to the same resulting JSON.
 *
 */
test('check test files', function (t) {
    fs.readdir(TESTDIR, function (err, files) {
        if (err) {
            throw err;
        }

        async.eachSeries(files, function (f, cb) {
            var fail_filename;
            var failure;
            var json_filename;
            var xml_filename;

            if (path.extname(f) !== '.xml') {
                cb();
                return;
            }

            xml_filename = f;
            fail_filename = path.basename(f, '.xml') + '.fail';
            json_filename = path.basename(f, '.xml') + '.json';

            if (fs.existsSync(path.join(TESTDIR, fail_filename))) {
                var data;
                data = fs.readFileSync(path.join(TESTDIR, fail_filename));
                failure = JSON.parse(data.toString());
            } else if (!fs.existsSync(path.join(TESTDIR, json_filename))) {
                cb();
                return;
            }

            getVmobjXMLFile(path.join(TESTDIR, xml_filename), {log: log},
                function (err, xml_obj) {
                    var data;
                    var json_obj;
                    var msg;

                    if (err) {
                        if (failure) {
                            t.strictEqual(err.code, failure.code,
                                xml_filename + ': got expected error code');
                            t.strictEqual(err.message, failure.message,
                                xml_filename + ': got expected error message');
                            cb();
                            return;
                        }

                        cb(err);
                        return;
                    }

                    if (failure) {
                        msg = fail_filename + ' exists and succeeded';
                        t.ok(false, msg);
                        cb(new Error(msg));
                        return;
                    }

                    data = fs.readFileSync(path.join(TESTDIR, json_filename));
                    json_obj = JSON.parse(data.toString());

                    t.deepEqual(xml_obj, json_obj, f + ' loads as expected');

                    cb();
                    return;
                }
            );
        }, function (err) {
            if (err) {
                throw err;
            }

            t.end();
        });
    });
});
