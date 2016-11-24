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
 * Copyright (c) 2016, Joyent, Inc. All rights reserved.
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var SyseventStream = require('/usr/vm/node_modules/sysevent-stream');

module.exports = ZWatch;

function ZWatch(logger) {
    var self = this;

    // become an event emitter
    EventEmitter.call(self);

    // create a Sysevent event emitter
    var opts = {
        logger: logger,
        class: 'status',
        channel: 'com.sun:zones:status'
    };
    self.se = new SyseventStream(opts);
    self.se.on('readable', function () {
        var ev;
        while ((ev = self.se.read()) !== null) {
            var data = ev.data;
            if (data.newstate === 'shutting_down'
                && data.oldstate === 'running') {

                data.cmd = 'stop';
            } else if (data.newstate === 'running'
                && data.oldstate === 'ready') {

                data.cmd = 'start';
            } else if (data.newstate === 'configured' && data.oldstate === '') {
                data.cmd = 'create';
            } else if (data.oldstate === 'configured' && data.newstate === '') {
                data.cmd = 'delete';
            } else {
                data.cmd = 'unknown';
            }

            self.emit('zone_transition', data);
        }
    });
}
util.inherits(ZWatch, EventEmitter);

ZWatch.prototype.stop = function stop() {
    return this.se.stop();
};
