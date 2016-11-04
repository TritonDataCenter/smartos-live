var EventEmitter = require('events').EventEmitter;
var util = require('util');

var vminfod = require('/usr/vm/node_modules/vminfod/client');

module.exports = ZWatch;

function ZWatch(logger) {
    var self = this;

    // become an event emitter
    EventEmitter.call(self);

    // create a vminfod event stream
    self.vs = new vminfod.VminfodEventStream();
    self.vs.on('readable', function () {
        var ev;
        while ((ev = self.vs.read()) !== null) {
            if (ev.type !== 'modify') {
                break;
            }
            var data = {
                zonename: ev.zonename,
                when: ev.ts.getTime() * 1000000
            };
            var changes = ev.changes || [];
            for (var i = 0; i < changes.length; i++) {
                var change = ev.changes[i];
                if (change.path === 'zone_state') {
                    if (change.to === 'shutting_down'
                        && change.from === 'running') {

                        data.cmd = 'stop';
                    } else if (change.to === 'running'
                        && change.from === 'ready') {

                        data.cmd = 'start';
                    } else {
                        data.cmd = 'unknown';
                    }
                    self.emit('zone_transition', data);
                    break;
                }
            }
        }
    });
}
util.inherits(ZWatch, EventEmitter);

ZWatch.prototype.stop = function stop() {
    return this.vs.stop();
};
