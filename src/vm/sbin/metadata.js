#!/usr/node/bin/node --abort_on_uncaught_exception

var bunyan = require('/usr/node/node_modules/bunyan');

var Agent = require('../lib/metadata/agent');

var log = bunyan.createLogger({
    name: 'metadata',
    level: 'debug',
    serializers: bunyan.stdSerializers
});

var options = { log: log };
var agent = new Agent(options);

// Call .start() from a setImmediate callback to work around OS-5140
// and test that the theory presented in that ticket to explain the crash
// in uv__platform_init is actually valid.
setImmediate(function _startAgent() {
    agent.start();
});

process.on('uncaughtException', function (error) {
    log.fatal('Uncaught exception in agent: ' + error.message);
    log.fatal(error.stack);
    agent.stop();
    process.exit(1);
});

process.on('exit', function () {
    log.info('Agent exiting');
    agent.stop();
});
