var util = require('util');
var spawn = require('child_process').spawn;
var common = require('./common');

var ZWatch = module.exports = function () {
    process.EventEmitter.call(this);
};

util.inherits(ZWatch, process.EventEmitter);

ZWatch.prototype.start = function (log) {
    var self = this;

    var handler = function (event) {
        if (event.newstate === 'shutting_down'
            && event.oldstate === 'running') {

            event.cmd = 'stop';
        } else if (event.newstate === 'running'
            && event.oldstate === 'ready') {

            event.cmd = 'start';
        } else {
            event.cmd = 'unknown';
        }

        self.emit('zone_transition', event);
    };

    function start() {
        log.info('Starting zwatch');
        delete self.zwatch;
        var zwatch = self.zwatch = spawn('/usr/vm/sbin/zoneevent');

        zwatch.stdout.on('data',
            common.createJsonChunkParser(log, handler, '\n'));

        zwatch.stderr.on('data', function (data) {
            log.error('error: ' + data.toString());
        });

        zwatch.on('exit', function (code) {
            log.info('Detected zoneevent exiting (%d)', code);
        });
    }

    start();
};

ZWatch.prototype.stop = function () {
    this.zwatch.kill();
};
