/*
 * This file and its contents are supplied under the terms of the
 * Common Development and Distribution License ("CDDL"), version 1.0.
 * You may only use this file in accordance with the terms of version
 * 1.0 of the CDDL.
 *
 * A full copy of the text of the CDDL should have accompanied this
 * source.  A copy of the CDDL is also available via the Internet at
 * http://www.illumos.org/license/CDDL.
 */

/*
 * Copyright 2016 Joyent, Inc.
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
