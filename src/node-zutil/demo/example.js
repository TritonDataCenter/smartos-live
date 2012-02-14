// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.

var util = require('util');
var zutil = require('../lib/zutil');

var myZone = zutil.getZone();
console.log("\nMy Zone: " + util.inspect(myZone));

var someOtherZone = zutil.getZoneByName('453ec030-c996-4ef0-8e36-dca08ee46928');
console.log("\nOther Zone: " + util.inspect(someOtherZone));

var yetAnotherZone = zutil.getZoneById(20);
console.log("\nYet Another Zone: " + util.inspect(yetAnotherZone));

var allZones = zutil.listZones();
console.log("\nAll Zones: " + util.inspect(allZones));

zutil.getZoneAttributes(someOtherZone.name, function(error, attrs) {
  console.log('\nAttributes for %s:', someOtherZone.name);
  for (var i = 0; i < attrs.length; i++) {
    console.log('\tNAME: ' + attrs[i].name);
    console.log('\tTYPE: ' + attrs[i].type);
    console.log('\tVALUE: ' + attrs[i].value);
    console.log();
  }
});

zutil.getZoneAttribute(someOtherZone.name, 'owner-uuid', function(error, attr) {
  console.log('\nAttribute %s for %s:', 'property-version', someOtherZone.name);
  console.log('\tNAME: ' + attr.name);
  console.log('\tTYPE: ' + attr.type);
  console.log('\tVALUE: ' + attr.value);
});
