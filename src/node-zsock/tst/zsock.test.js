/*
 * Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
 * Copyright 2016 Joyent, Inc. All rights reserved.
 */
var fs = require('fs');
var net = require('net');
var testCase = require('nodeunit').testCase;
var uuid = require('node-uuid');

var zsock = require('../lib/zsock');

/**
 * In order to run these tests, you must:
 * 1) Be root
 * 2) have a zone called foo (or set TEST_ZONE to the zone name)
 * 3) Have configure your zones to live under /zones
 *
 * Basically, it's probably easier if you just trust me
 * to ensure this works...
 */
module.exports = testCase({

  setUp: function(callback) {
    this.zone = process.env.TEST_ZONE || 'foo';
    this.socketPath = '/tmp/.' + uuid();
    callback();
  },

  tearDown: function(callback) {
    try {
      var path = '/zones/' + this.zone + '/root' + this.socketPath;
      fs.unlinkSync(path);
    } catch (e) {
      // Might not exist, just eat it
    }
    callback();
  },

  noOptions: function(test) {
    test.expect(1);
    test.throws(function() {
      zsock.createZoneSocket();
    });
    test.done();
  },

  missingZone: function(test) {
    var self = this;
    test.expect(1);
    test.throws(function() {
      zsock.createZoneSocket({
        path: self.socketPath
      });
    });
    test.done();
  },

  missingPath: function(test) {
    var self = this;
    test.expect(1);
    test.throws(function() {
      zsock.createZoneSocket({
        zone: self.zone
      });
    });
    test.done();
  },

  missingCallback: function(test) {
    var self = this;
    test.expect(1);
    test.throws(function() {
      zsock.createZoneSocket({
        zone: uuid(),
        path: self.socketPath
      });
    });
    test.done();
  },

  invalidCallback: function(test) {
    var self = this;
    test.expect(1);
    test.throws(function() {
      zsock.createZoneSocket({
        zone: uuid(),
        path: self.socketPath
      }, 5);
    });
    test.done();
  },

  globalZone: function(test) {
    var self = this;
    test.expect(2);
    function _cb(err, fd) {
        test.ok(err, 'expected error: ' + (err ? err.message : 'but got none'));
        test.ok(fd !== 0, 'fd should be non-zero, got: ' + fd);
        test.done();
        return;
    }
    zsock.createZoneSocket({
      zone: 'global',
      path: self.socketPath
    }, _cb);
  },

  success: function(test) {
    var self = this;
    test.expect(3);
    test.equal(process.getuid(), 0, "must be root to run this test");

    var _cb = function(err, fd) {
      test.ok(!err, err + " (must have zone named 'foo' or set TEST_ZONE envvar)");
      test.ok(fd);
      var server = net.createServer();
      server.listenFD(fd, function() {
        server.close();
        test.done();
      });
    };

    zsock.createZoneSocket({zone: self.zone, path: self.socketPath}, _cb);
  }

});
