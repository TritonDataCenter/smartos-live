node-zsock is a very small library specific to Sun derived operating systems
(i.e., illumos).  This library allows a node server running in the Global
Zone to open Unix Domain Sockets in other zones, safely, under the same
FS path in each zone. By using this mechanism, you can enable IPC across zones.

## Usage

The library is very simple, and small, and only exposes you the ability to
create a new fd socket that can be used with the existing node net API:

    var zsock = require('zsock');
    zsock.createZoneSocket({
      zone: 'foo',
      path: '/tmp/sock'
    }, function(err, fd) {
      if (err) throw err;

      var server = net.createServer(function(c) {
        c.write('hello from the global zone...\r\n');
        c.pipe(c);
      });

      server.listenFD(fd);
    });

Note that this API creates a STREAM socket (i.e., there's no datagram support).
But that seems to be the general case in node anyway.

## Installation

    npm install zsock

(You can also install it by doing `node-waf configure build` and then
linking or copying the folder into your project's `node_modules`
directory.)

## License

MIT.  'Nuff said.

## Bugs

See <https://github.com/mcavage/node-zsock/issues>.
