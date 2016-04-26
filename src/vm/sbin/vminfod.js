#!/usr/node/bin/node --abort_on_uncaught_exception
/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright 2015, Joyent, Inc.
 *
 * Vminfod starting point
 */

var onlyif = require('/usr/node/node_modules/onlyif');
var bunyan = require('/usr/node/node_modules/bunyan');
var VMInfo = require('../node_modules/vminfod/vminfo');

onlyif.rootInSmartosGlobal(function (err) {

    var log = bunyan.createLogger({
        name: 'vminfo',
        level: 'debug',
        serializers: bunyan.stdSerializers
    });

    if (err) {
        log.error(err, 'Fatal: cannot run because: ' + err.message);
        process.exit(1);
    }

    log.info('Starting vminfod');

    var options = {log: log};
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
