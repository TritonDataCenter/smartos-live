// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var net = require('net');

var bindings = require('./zsock_bindings');

// Make the net API work like 0.4 (the way it should...)
if (net.Server.prototype.listenFD.name !== "listenFDZsock") {
        net.Server.prototype.listenFD = function listenFDZsock(fd, callback) {
                var Pipe = process.binding('pipe_wrap').Pipe;
                var p = new Pipe(true);
                p.open(fd);
                p.readable = p.writable = true;
                this._handle = p;
                this.listen(callback);
        };
}



///--- Globals

var Socket = net.Socket;



/**
 * Creates a Unix Domain Socket in the specified Zone, and returns a node.js
 * Socket object, suitable for use in a net server.
 *
 * Zone must _not_ be the global zone, and the zone must be running.
 *
 * @param {Object} options an object containg the following parameters:
 *                   - zone {String} name of the zone in which to create UDS
 *                   - path {String} Path under which to create UDS
 *                   - backlog {Integer} OPTIONAL: listen backlog (default=5)
 * @param {Function} callback of form function(error, fd). fd is an int.
 * @throws {Error} any number of reasons...
 * @return {Undefined}
 */
function createZoneSocket(options, callback) {
        if (!options) throw new TypeError('options required');
        if (!(options instanceof Object)) {
                throw new TypeError('options must be an Object');
        }
        if (!options.zone) throw new TypeError('options.zone required');
        if (!options.path) throw new TypeError('options.path required');
        if (!callback) throw new TypeError('callback required');
        if (!(callback instanceof Function)) {
                throw new TypeError('callback must be a Function');
        }

        var backlog = options.backlog ? options.backlog : 5;
        bindings.zsocket(options.zone, options.path, backlog, callback);
}

module.exports = {
        createZoneSocket: createZoneSocket
};
