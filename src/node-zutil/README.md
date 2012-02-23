node-zutil is a small library specific to Sun Solaris (and derived OS's like
illumos) that provides a wrapper over some APIs in zone.h and libzonecfg.h.

The libzonecfg API is in fact rather overwhelming, and for now I only needed
the ability to read attributes, so that's all that's in here. Over time I
expect that list will grow.

The wrappers over zone.h are pretty much all the publicly supported ones
plus zone_list (which brings us to a whopping total of 4 APIs).

## Usage

    var zutil = require('zutil');

    var myZone = zutil.getZone();
    var someOtherZone = zutil.getZoneByName('foo');
    var yetAnotherZone = zutil.getZoneById(20);
    var state = zutil.getZoneState('foo');
    var allZones = zutil.listZones();

    zutil.getZoneAttributes(someOtherZone.name, function(error, attrs) {
      for (var i = 0; i < attrs.length; i++) {
        console.log('NAME: ' + attrs[i].name);
	console.log('TYPE: ' + attrs[i].type);
	console.log('VALUE: ' + attrs[i].value);
      }
    });
    zutil.getZoneAttribute(someOtherZone.name, 'bar', function(error, attr) {
      console.log('NAME: ' + attr.name);
      console.log('TYPE: ' + attr.type);
      console.log('VALUE: ' + attr.value);
    });

There you go.  That's the whole API for now.

## Installation

    npm install zutil

(You can also install it by doing `node-waf configure build` and then
linking or copying the folder into your project's `node_modules`
directory.)

## License

MIT.

## Bugs

See <https://github.com/mcavage/node-zutil/issues>.
