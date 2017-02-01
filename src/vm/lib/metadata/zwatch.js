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

var vminfod = require('/usr/vm/node_modules/vminfod/client');

module.exports = ZWatch;

function ZWatch(opts) {
    var self = this;

    var name = [];
    if (opts.name)
        name.push(opts.name);
    name.push('ZWatch');

    // become an event emitter
    EventEmitter.call(self);

    // create a vminfod event stream
    var vs_opts = {
        log: opts.log,
        name: name.join(' - ')
    };
    self.vs = new vminfod.VminfodEventStream(vs_opts);
    self.vs.on('readable', function () {
        var ev;
        while ((ev = self.vs.read()) !== null) {
            self._handle_event(ev);
        }
    });
}
util.inherits(ZWatch, EventEmitter);

ZWatch.prototype._handle_event = function _handle_event(ev) {
    var self = this;

    // only care about create and delete
    if (ev.type === 'create' || ev.type === 'delete')
        return;

    var data = {
        cmd: ev.type,
        zonename: ev.zonename,
        ts: ev.ts
    };

    self.emit('zone_transition', data);
};

ZWatch.prototype.stop = function stop() {
    return this.vs.stop();
};
