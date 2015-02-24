#!/usr/node/bin/node --abort_on_uncaught_exception

var onlyif = require('/usr/node/node_modules/onlyif');
var bunyan = require('/usr/node/node_modules/bunyan');
var VMInfo = require('../node_modules/vmevent/vminfo');

onlyif.rootInSmartosGlobal(function (err) {

    var log = bunyan.createLogger({
        name: 'vminfo',
        level: 'info',
        serializers: bunyan.stdSerializers
    });

    if (err) {
        log.error(err, 'Fatal: cannot run because: ' + err.message);
        process.exit(1);
    }

    log.info('Starting vminfod');

    var options = { log: log };
    var vminfo = new VMInfo(options);
    vminfo.start();

    process.on('uncaughtException', function (error) {
        log.fatal('Uncaught exception in vminfo process: '
            + error.message);
        log.fatal(error.stack);
        vminfo.stop();
        process.exit(1);
    });

    process.on('exit', function () {
        log.info('VMInfo process exiting');
        vminfo.stop();
    });
});
