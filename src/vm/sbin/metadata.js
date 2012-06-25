#!/usr/node/bin/node

var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var net = require('net');
var path = require('path');
var util = require('util');
var zsock = require('/usr/node/node_modules/zsock');
var zutil = require('/usr/node/node_modules/zutil');
var log4js = require('/usr/node/node_modules/log4js');
var tty = require('tty');

var Agent = require('../lib/metadata/agent');

log4js.clearAppenders();
var isatty = tty.isatty(process.stdout.fd);
log4js.addAppender
    (log4js.consoleAppender
        (isatty
            ? log4js.colouredLayout
            : log4js.basicLayout
        )
    );

var log = log4js.getLogger('process');

var options = { log4js: log4js };
var agent = new Agent(options);
agent.start();

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
