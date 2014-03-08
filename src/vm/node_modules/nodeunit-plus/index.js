// Copyright 2013 Mark Cavage.  All rights reserved.

var domain = require('domain');

var bunyan = require('bunyan');
var once = require('once');



///--- Hacks

var _require = require.bind(null);
require = function () {
    if (require.cache[__filename])
        delete require.cache[__filename];

    _require.apply(require, arguments);
};



///--- Helpers

function createLogger(name, stream) {
    var log = bunyan.createLogger({
        level: (process.env.LOG_LEVEL || 'info'),
        name: name || process.argv[1],
        serializers: bunyan.stdSerializers,
        stream: stream || process.stdout,
        src: true
    });
    return (log);
}



///--- Exports

module.exports = {

    after: function after(teardown) {
        module.parent.exports.tearDown = function _teardown(cb) {
            var d = domain.create();
            var self = this;

            d.once('error', function (err) {
                console.error('after: uncaught error\n' + err.stack);
                process.exit(1);
            });

            d.run(function () {
                teardown.call(self, once(cb));
            });
        };
    },

    before: function before(setup) {
        module.parent.exports.setUp = function _setup(cb) {
            var d = domain.create();
            var self = this;

            d.once('error', function (err) {
                console.error('before: uncaught error\n' + err.stack);
                process.exit(1);
            });

            d.run(function () {
                setup.call(self, once(cb));
            });
        };
    },

    test: function test(name, tester) {
        module.parent.exports[name] = function _(t) {
            var d = domain.create();
            var self = this;

            this.log = this.log || createLogger();

            d.once('error', function (err) {
                t.ifError(err);
                t.end();
            });

            d.add(t);
            d.run(function () {
                t.end = once(function () {
                    t.done();
                });
                t.notOk = function notOk(ok, message) {
                    return (t.ok(!ok, message));
                };

                tester.call(self, t);
            });
        };
    },

    createLogger: createLogger
};



Object.keys(module.exports).forEach(function (k) {
    global[k] = module.exports[k];
});
