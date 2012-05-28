var execFile = require('child_process').execFile;
var path = require('path');

var ZoneBootedWatcher = module.exports = function (delay, allZones) {
  this.delay = delay;
  this.allZones = allZones;
  this.zones = {};
}

ZoneBootedWatcher.prototype.startExecutingSvcs = function () {
  var self = this;
  self.interval = setInterval(function () {
    execFile
      ( '/usr/bin/svcs'
      , [ '-o', 'zone,state', '-HpZ', 'milestone/multi-user' ]
      , {}
      , function (error, stdout, stderr) {
          console.log("Executed svcs.");
          if (error) { }
          var lines = stdout.toString().trim().split("\n");
          lines.forEach(function (line) {
            var parts = line.split(/\s+/);
            var zone = parts[0];
            var state = parts[1];
            var zoneObj;
            if (state === 'online' && self.zones.hasOwnProperty(zone)) {
              if (self.zones[zone]) {
                var fn = (self.zones[zone]);
                self.unwatch(zone);
                fn();
              }
            } else if (self.allZones.hasOwnProperty(zone)
              && self.zones.hasOwnProperty(zone)) {

              zoneObj = self.allZones[zone];
              if (path.existsSync(path.join(zoneObj.zonepath,
                '/root/tmp/.ready_for_metadata'))) {

                var fn = (self.zones[zone]);
                self.unwatch(zone);
                fn();
              }
            }
          });
        }
      );
  }, this.delay);
}

ZoneBootedWatcher.prototype.start = function (zone) {
  var self = this;
  self.startExecutingSvcs();
}

ZoneBootedWatcher.prototype.watch = function (zone, callback) {
  var self = this;
  if (!Object.keys(self.zones).length) {
    self.zones[zone] = callback;
    self.startExecutingSvcs();
    return;
  }
  self.zones[zone] = callback;
}

ZoneBootedWatcher.prototype.unwatch = function (zone) {
  var self = this;
  self.zones[zone] = undefined;
  delete self.zones[zone];
  if (!Object.keys(self.zones).length) {
    clearInterval(self.interval);
  }
}
