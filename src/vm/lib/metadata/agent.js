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
        self.log[l].call(
          self.log, type + ":" + zonename + " - " + arguments[0]);
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

          if (zone.brand === 'kvm') {
            self.startKVMSocketServer(zone.zonename, callback);
          }
          else if (zone.force_metadata_socket) {
            self.startZoneSocketServer(zone.zonename, false, callback);
          }
          else {
            self.startZoneSocketServer(zone.zonename, true, callback);
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
        if (self.zones[msg.zonename].brand === 'kvm') {
          self.startKVMSocketServer(msg.zonename);
        }
        else if (self.zones[msg.zonename].force_metadata_socket) {
          self.startZoneSocketServer(msg.zonename, false);
        }
        else {
          self.startZoneSocketServer(msg.zonename, true);
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
  var localpath = '/var/run/smartdc';
  var smartdcpath = path.join(zonePath, 'root', localpath);
  var sockpath = path.join(self.zones[zonename].zonepath, '/root/tmp/vm.ttyb');

  zlog.info("Starting socket server");

  async.waterfall
    ( [ function (callback) {
          common.retryUntil
            ( 2000
            , 120000
            , function (callback) {
                fs.exists(sockpath, function (exists) {
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
          zlog.info("Timed out waiting for zone system/filesystem/minimal after"
            + " " + timeoutAfterSeconds + " seconds.");
          self.servicesWatcher.unwatch(zonename);
        }, timeoutAfterSeconds * 1000)

        self.servicesWatcher.watch(zonename, function () {
          clearTimeout(timeout);
          zlog.info("Zone booted successfully.");
          callback();
        });
      }
    , function (callback) {
        fs.exists(smartdcpath, function (exists) {
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
      var gzsockpath = path.join(smartdcpath, 'metadata.sock');

      var zopts
        = { zone: zonename
          , path: sockpath
          };
      self.createZoneSocket(zopts, function (createErr) {
        if (createErr) {
          zlog.error('createZoneSocket Error: ' + createErr.message);
          zlog.error(createErr.stack);
        }

        fs.chmod(
          gzsockpath,
          parseInt('0700', 8),
          function (chownErr) {
            if (chownErr) {
              zlog.error('chown Error: ' + chownErr.message);
              zlog.error(chownErr.stack);
            }
            zlog.info("Zone socket created.");
            if (callback) {
              return callback();
            }
          });
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
        zlog.error('ZSocket error: ' + e.message);
        zlog.error(e.stack);
        zlog.info(
          'Attempting to recover;'
          + ' closing and recreating zone socket and server.');
        try {
            server.close();
        }
        catch (e) {
            zlog.error('Caught exception closing server: ' + e.message);
            zlog.error(e.stack);
        }

        socket.end();
        self.createZoneSocket(zopts);
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
  });

  if (callback) {
    callback();
  }
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
    var lookup_fields = [];
    var matches;
    var parts =
      rtrim(data.toString()).replace(/\n$/,'').match(/^([^\s]+)\s?(.*)/);

    if (!parts) {
      write("invalid command\n");
      return;
    }

    var cmd = parts[1];
    var want = parts[2];

    if (cmd === 'GET' && !want) {
        write("invalid command\n");
        return;
    }

    if (cmd === 'GET' && want.slice(0, 4) === 'sdc:') {
        matches = want.slice(4).match(/^([^\.]*)\./);
        if (matches) {
            lookup_fields.push(matches[1]);
        } else {
            lookup_fields.push(want.slice(4));
            if (want.slice(4) === 'routes') {
              // We require nics data for routes to determine the IPs for
              // link-local routes
              lookup_fields.push('nics');
            }
        }
    } else {
        lookup_fields.push('customer_metadata');
    }

    VM.lookup({ zonename: zone }, { fields: lookup_fields },
      function (error, rows) {

      if (error) {
        zlog.error("Error looking up zone: " + error.message);
        zlog.error(error.stack);
        return returnit(new Error("Error looking up zone"));
      }

      if (cmd === 'KEYS') {
        var vmobj = rows.length ? rows[0] : {};
        return returnit(null,
          Object.keys(vmobj.customer_metadata).join("\n"));
      } else if (cmd === 'GET') {
        if (!rows || !rows.length) {
          returnit(new Error('Zone lookup did not return row data'));
          return;
        }

        var vmobj = rows.length ? rows[0] : {};
        if (!vmobj) {
          returnit(new Error('Zone lookup did not return data'));
          return;
        }

        zlog.info("Serving " + want);
        if (want.slice(0, 4) === 'sdc:') {
          want = want.slice(4);

          // NOTE: sdc:nics, sdc:resolvers and sdc:routes are not a committed
          // interface, do not rely on it.
          // At this point it should only be used by mdata-fetch, if you add
          // a consumer that depends on it, please add a note about that here
          // otherwise expect it will be removed on you sometime.
          if (want === 'nics' && vmobj.hasOwnProperty('nics')) {
            var val = JSON.stringify(vmobj.nics);
            return returnit(null, val);
          } else if (want === 'resolvers'
            && vmobj.hasOwnProperty('resolvers')) {

            // See NOTE above about nics, same applies to resolvers. It's here
            // solely for the use of mdata-fetch.
            var val = JSON.stringify(vmobj.resolvers);
            return returnit(null, val);
          } else if (want === 'routes' && vmobj.hasOwnProperty('routes')) {
            var vmRoutes = [];

            // The NOTE above also applies to routes. It's here solely for
            // the use of mdata-fetch.
            for (var r in vmobj.routes) {
              var route = { linklocal: false, dst: r };
              var nicIdx = vmobj.routes[r].match(/nics\[(\d+)\]/);
              if (!nicIdx) {
                // Non link-local route: we have all the information we
                // need already
                route.gateway = vmobj.routes[r];
                vmRoutes.push(route);
                continue;
              }
              nicIdx = Number(nicIdx[1]);

              // Link-local route: we need the IP of the local nic
              if (!vmobj.hasOwnProperty('nics') || !vmobj.nics[nicIdx]
                || !vmobj.nics[nicIdx].hasOwnProperty('ip')
                || vmobj.nics[nicIdx].ip === 'dhcp') {
                continue;
              }

              route.gateway = vmobj.nics[nicIdx].ip;
              route.linklocal = true;
              vmRoutes.push(route);
            }

            return returnit(null, JSON.stringify(vmRoutes));
          } else {
            var val = VM.flatten(vmobj, want);
            return returnit(null, val);
          }
        }
        else {
          if (vmobj.hasOwnProperty('customer_metadata')) {
            returnit(null, vmobj.customer_metadata[want]);
            return;
          } else {
            returnit(new Error('Zone did not contain customer_metadata'));
            return;
          }
        }
      }
    });

    function returnit (error, val) {
      if (error) {
        zlog.error(error.message);
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
  };
}


