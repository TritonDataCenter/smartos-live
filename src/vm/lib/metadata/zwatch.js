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

    if (ev.type !== 'modify')
        return;

    var data = {
        zonename: ev.zonename,
        when: ev.ts.getTime() * 1000000
    };

    var changes = ev.changes || [];
    changes = changes.filter(function (c) {
        return c.path.length === 1 && c.path[0] === 'zone_state';
    });

    if (changes.length !== 1)
        return;

    var change = changes[0];

    if (change.to === 'shutting_down' && change.from === 'running') {
        data.cmd = 'stop';
    } else if (change.to === 'running' && change.from === 'ready') {
        data.cmd = 'start';
    } else {
        data.cmd = 'unknown';
    }

    self.emit('zone_transition', data);
};

ZWatch.prototype.stop = function stop() {
    return this.vs.stop();
};
