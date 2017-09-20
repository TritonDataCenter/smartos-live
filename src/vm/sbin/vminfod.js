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
 * Copyright 2017 Joyent, Inc.
 *
 * Vminfod starting point
 */

var onlyif = require('/usr/node/node_modules/onlyif');
var bunyan = require('/usr/node/node_modules/bunyan');
var Vminfod = require('../node_modules/vminfod/vminfod');

var log = bunyan.createLogger({
    name: 'vminfod',
    level: 'debug',
    serializers: bunyan.stdSerializers
});

function startVminfod() {
    var opts = {
        log: log
    };
    var vminfod = new Vminfod(opts);

    log.info('Starting vminfod');

    vminfod.start();

    process.on('uncaughtException', function (err) {
        log.fatal({err: err},
            'Uncaught exception in vminfo process: %s',
            err.message);
        log.fatal('%s', err.stack);

        vminfod.stop();
        process.exit(1);
    });

    process.on('exit', function () {
        log.info('Vminfo process exiting');
        vminfod.stop();
    });
}

onlyif.rootInSmartosGlobal(function (err) {
    if (err) {
        log.error({err: err},
            'Fatal: cannot run because: %s', err.message);
        process.exit(1);
    }

    startVminfod();
});
