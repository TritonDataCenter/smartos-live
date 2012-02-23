// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var fs = require('fs');
var net = require('net');

var zsock = require('../lib/zsock');

var zopts = {
  zone: process.env.ZSOCK_ZONE,
  path: '/tmp/.zsock-demo'
};

zsock.createZoneSocket(zopts, function(err, fd) {

  if (err) throw err;

  var server = net.createServer(function(c) {
    c.write('hello from the global zone...\r\n');
    c.pipe(c);
  });

  server.on('error', function(e) {
    if (e.code !== 'EINTR') {
      throw e;
    }
  });

  server.listenFD(fd, function() {
    console.log('Listening in zone %s on %s', zopts.zone, zopts.path);
    console.log('To test, run the following commands\n');
    console.log('\nzlogin %s', zopts.zone);
    console.log('\npkgin -y install gnetcat');
    console.log('\necho -n -e "foo\\r\\n" | nc -U %s', zopts.path);
  });
});

