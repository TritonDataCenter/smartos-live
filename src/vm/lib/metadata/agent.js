var VM  = require('/usr/vm/node_modules/VM');
var ZWatch = require('./zwatch');
var ZoneBootedWatcher = require('./zone_booted_watcher');
var common = require('./common');
var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var fs = require('fs');
var net = require('net');
var path = require('path');
var util = require('util');
var zsock = require('/usr/node/node_modules/zsock');
var zutil = require('/usr/node/node_modules/zutil');

var MetadataAgent = module.exports = function (options) {
  var self = this;

  this.log4js = options.log4js;
  this.log = this.log4js.getLogger('agent');
  this.zlog = {};

  this.zones = {};
  this.zoneConnections = {};
  this.servicesWatcher = new ZoneBootedWatcher(2000, this.zones);
}

MetadataAgent.prototype.createZoneLog = function (type, zonename) {
  var self = this;
  var zlog = self.zlog[zonename] = {};
  ['info', 'debug', 'trace', 'warn', 'error', 'fatal']
    .forEach(function (l) {
      zlog[l] = function () {
        if (l === 'debug') {
          self.log[l].debug(zonename+":");
          self.log[l].apply(self.log, arguments);
        }
        else {
          self.log[l].call
            ( self.log
            , type + ":" + zonename + " - " + arguments[0]
            );
        }
      }
    });
  return zlog;
}

MetadataAgent.prototype.updateZone = function (zonename, callback) {
  var self = this;
  VM.lookup({ zonename: zonename }, { full: true }, function (error, machines) {
    self.zones[zonename] = machines[0];
    return callback();
  });
}

MetadataAgent.prototype.createServersOnExistingZones = function (callback) {
  var self = this;
  VM.lookup({}, { full: true }, function (error, zones) {
    async.forEach
      ( zones
      , function (zone, callback) {
          if (zone.zonename === 'global') {
            return callback();
          }

          self.zones[zone.zonename] = zone;

          if (zone.state !== 'running') {
            return;
          }

          if (error) {
            throw error;
          }

          if (zone.brand === 'joyent' || zone.brand === 'joyent-minimal') {
            self.startZoneSocketServer(zone.zonename, true, callback);
          }
          else if (zone.brand === 'kvm') {
            self.startKVMSocketServer(zone.zonename, callback);
          }
        }
      , function (error) {
          self.log.info(
            "Created zone metadata sockets on " + zones.length + " zones");
        }
      );
  });
}

MetadataAgent.prototype.start = function () {
  var self = this;
  var zwatch = this.zwatch = new ZWatch();
  self.createServersOnExistingZones();

  zwatch.on('zone_transition', function (msg) {
    if (msg.cmd === 'start') {
      self.updateZone(msg.zonename, function (error) {
        if (error) {
          self.log.error("Error updating attributes: "
            + error.message);
          return;
        }
        if (self.zones[msg.zonename].brand === 'joyent'
          || self.zones[msg.zonename].brand === 'joyent-minimal') {

          self.startZoneSocketServer(msg.zonename, true);
        }
        else if (self.zones[msg.zonename].brand === 'kvm') {
          self.startKVMSocketServer(msg.zonename);
        }
      });
    }
    else if (msg.cmd === 'stop' ) {
      if (self.zoneConnections[msg.zonename]) {
        self.zoneConnections[msg.zonename].end();
      }
    }
  });

  zwatch.start();
}

MetadataAgent.prototype.stop = function () {
  this.zwatch.stop();
}

MetadataAgent.prototype.startKVMSocketServer = function (zonename, callback) {
  var self = this;
  var zlog = self.createZoneLog('vm', zonename);
  var zonePath = self.zones[zonename].zonepath;
  var localpath = path.join('/var/run/smartdc');
  var smartdcpath = path.join(zonePath, 'root', localpath);
  var sockpath = path.join(self.zones[zonename].zonepath, '/root/tmp/vm.ttyb');

  zlog.info("Starting socket server");

  async.waterfall
    ( [ function (callback) {
          common.retryUntil
            ( 2000
            , 120000
            , function (callback) {
                path.exists(sockpath, function (exists) {
                  setTimeout(function () {
                    callback(null, exists);
                  }, 1000);
                });
              }
            , function (error) {
                if (error) {
                  zlog.error("Timed out waiting for metadata socket to exist.");
                  return;
                }

                if (callback) return callback();
              }
            );
        }
      ]
    , function (error) {
        var zopts
          = { zone: zonename
            , sockpath: sockpath
            };
        self.createKVMServer(zopts, function () {
          if (callback) return callback();
        });
      }
    );
}

function rtrim(str, chars) {
  chars = chars || "\\s";
  str = str || "";
  return str.replace(new RegExp("[" + chars + "]+$", "g"), "");
}

MetadataAgent.prototype.createKVMServer = function (zopts, callback) {
  var self = this;
  var zlog = self.zlog[zopts.zone];
  var kvmstream = new net.Stream();
  self.zoneConnections[zopts.zone]
  = { conn: new net.Stream()
    , done: false
    , end: function () {
        if (this.done) return;
        this.done = true;
        zlog.info("Closing kvm stream for " + zopts.zone);
        kvmstream.end();
      }
    };

  var buffer = '';
  var handler = self.makeMetadataHandler(zopts.zone, kvmstream);

  kvmstream.on('data', function (data) {
    var chunk, chunks;
    buffer += data.toString();
    chunks = buffer.split('\n');
    while (chunks.length > 1) {
      chunk = chunks.shift();
      handler(chunk);
    }
    buffer = chunks.pop();
  });

  kvmstream.on('error', function(e) {
    zlog.error("KVM Socket error: " + e.message);
    zlog.error(e.stack);
  });

  kvmstream.connect(zopts.sockpath)
}

MetadataAgent.prototype.startZoneSocketServer =
function (zonename, checkService, callback) {
  var self = this;
  var zlog = self.createZoneLog('zone', zonename);
  var zonePath = self.zones[zonename].zonepath;
  var localpath = '/var/run/smartdc';
  var smartdcpath = path.join(zonePath, 'root', localpath);

  zlog.info("Starting socket server");

  async.waterfall
  ( [ function (callback) {
        if (!checkService) {
          return callback();
        }

        var timeoutAfterSeconds = 60 * 60;
        var timeout = setTimeout(function () {
          zlog.info("Timed out waiting for zone multi-user milestone after "
            + timeoutAfterSeconds + " seconds.");
          self.servicesWatcher.unwatch(zonename);
        }, timeoutAfterSeconds * 1000)

        self.servicesWatcher.watch(zonename, function () {
          clearTimeout(timeout);
          zlog.info("Zone booted successfully.");
          callback();
        });
      }
    , function (callback) {
        path.exists(smartdcpath, function (exists) {
          if (exists)  {
            return callback();
          }
          else {
            fs.mkdir(smartdcpath, parseInt('0755', 8), function (error) {
              callback(error);
            });
          }
        });
      }
    ]
  , function (error) {
      var sockpath = path.join(localpath, 'metadata.sock');
      var zopts
        = { zone: zonename
          , path: sockpath
          };
      self.createZoneSocket(zopts, function () {
        zlog.info("Zone socket created.");
        if (callback) {
          return callback();
        }
      });
    }
  );
}

MetadataAgent.prototype.createZoneSocket = function (zopts, callback) {
  var self = this;
  var zlog = self.zlog[zopts.zone];
  zsock.createZoneSocket(zopts, function(err, fd) {
    if (err) throw err;

    var server = net.createServer(function (socket) {
      var handler = self.makeMetadataHandler(zopts.zone, socket);
      var buffer = '';
      socket.on('data', function (data) {
        var chunk, chunks;
        buffer += data.toString();
        chunks = buffer.split('\n');
        while (chunks.length > 1) {
          chunk = chunks.shift();
          handler(chunk);
        }
        buffer = chunks.pop();
      });

      socket.on('error', function (e) {
        zlog.error("Socket error");
        zlog.error(e.message);
        zlog.error(e.stack);
        zlog.debug(e);
      });
    });

    self.zoneConnections[zopts.zone]
      = { conn: server
        , done: false
        , end: function () {
            if (this.done) return;
            this.done = true;
            zlog.info("Closing server");
            server.close();
          }
        };

    server.on('error', function(e) {
      zlog.error("Zone socket error:");
      zlog.error(e.message);
      zlog.error(e.stack);
      if (e.code !== 'EINTR') {
        throw e;
      }
    });
    var Pipe = process.binding("pipe_wrap").Pipe;
    var p = new Pipe(true);
    p.open(fd);
    p.readable = p.writable = true;
    server._handle = p;
    
    server.listen();

    /*
     var Pipe = process.binding("pipe_wrap").Pipe;
       var p = new Pipe(true);
       p.open(0);
       p.onread = function(pool, offset, length, handle) {
               if(handle) {
                       handle.onconnection = function(client) {
                       };
                       handle.listen();
                       p.onread = function() {};
                       p.close();
               }
       }
       p.readStart();
      */


  });

  callback();
}

MetadataAgent.prototype.makeMetadataHandler = function (zone, socket) {
  var self = this;
  var zlog = self.zlog[zone];
  var write = function (str) {
    if (socket.writable) {
      socket.write(str);
    }
    else {
      zlog.error(
        "Socket for " + zone + " closed before we could write anything.");
    }
  };

  return function (data) {
    var parts = rtrim(data.toString()).replace(/\n$/,'').split(/^GET\s+/);
    var want = parts[1];
    if (!want) {
      write("invalid command\n");
      return;
    }

    function returnit (error, val) {
      if (error) {
        write("FAILURE\n");
        return;
      }

      // String value
      if (common.isString(val)) {
        var towrite = val.replace(/^\./mg, "..")
        write("SUCCESS\n"+towrite+"\n.\n");
        return;
      }
      else if (!isNaN(val)) {
        var towrite = val.toString().replace(/^\./mg, "..")
        write("SUCCESS\n"+towrite+"\n.\n");
        return;
      }
      // Non-string value
      else if (val) {
        write("FAILURE\n");
        return;
      }
      // Nothing to return
      else {
        write("NOTFOUND\n");
        return;
      }
    }

    VM.lookup({ zonename: zone }, { full: true }, function (error, rows) {
      if (error) {
        zlog.error("Error looking up zone: " + error.message);
        zlog.error(error.stack);
        return returnit(new Error("Error looking up zone"));
      }

      var metadata = rows.length ? rows[0] : {};

      zlog.info("Serving " + want);
      if (want.slice(0, 4) === 'sdc:') {
        want = want.slice(4);
        var val = VM.flatten(metadata, want);
        return returnit(null, val);
      }
      else {
        return returnit(null, metadata.customer_metadata[want]);
      }
    });
  };
}


