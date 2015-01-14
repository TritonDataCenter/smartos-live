/*
 * Copyright 2012 Mark Cavage.  All rights reserved.
 *
 * Help nodeunit API feel like node-tap's.
 *
 * Usage:
 *      if (require.cache[__dirname + '/tap4nodeunit.js'])
 *          delete require.cache[__dirname + '/tap4nodeunit.js'];
 *      var tap4nodeunit = require('./tap4nodeunit.js');
 *      var after = tap4nodeunit.after;
 *      var before = tap4nodeunit.before;
 *      var test = tap4nodeunit.test;
 */

var p = console.log;
// Set to `true` for verbose output on `t.exec` usage.
var verbose = false ? console.warn : function () {};



// ---- Exports

module.exports = {

    after: function after(teardown) {
        module.parent.exports.tearDown = function _teardown(callback) {
            try {
                teardown.call(this, callback);
            } catch (e) {
                console.error('after:\n' + e.stack);
                process.exit(1);
            }
        };
    },

    before: function before(setup) {
        module.parent.exports.setUp = function _setup(callback) {
            try {
                setup.call(this, callback);
            } catch (e) {
                console.error('before:\n' + e.stack);
                process.exit(1);
            }
        };
    },

    test: function test(name, tester) {
        module.parent.exports[name] = function _(t) {
            var _done = false;
            t.end = function end() {
                if (!_done) {
                    _done = true;
                    t.done();
                }
            };
            t.notOk = function notOk(ok, message) {
                return (t.ok(!ok, message));
            };

            // ---- Custom (to the img test suite) helpers.

            /**
             * Exec a command and assert it exitted zero.
             *
             * @param cmd {String} The command to run.
             * @param opts {Object} `child_process.exec` options. Optional.
             * @param cb {Function} Callback called as
             *      `function (err, stdout, stderr)`.
             */
            t.exec = function exec(cmd, opts, cb) {
                if (cb === undefined) {
                    cb = opts;
                    opts = undefined;
                }
                var exec = require('child_process').exec;
                verbose('cmd:', cmd);
                exec(cmd, function (err, stdout, stderr) {
                    verbose('err:', err);
                    verbose('stdout: %j', stdout);
                    verbose('stderr: %j', stderr);
                    t.ifError(err);
                    cb(err, stdout, stderr);
                });
            };

            tester.call(this, t);
        };
    }
};
