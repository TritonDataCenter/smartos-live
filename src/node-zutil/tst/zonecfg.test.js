// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
var testCase = require('nodeunit').testCase;
var uuid = require('node-uuid');
var zutil = require('../lib/zutil');

// Change these to your zone to run this
var _zoneName = '6ceeeab9-a721-4b57-a388-dbbeaab5b53e';
var _zoneAttr = 'owner-uuid';

module.exports = testCase({

  setUp: function(callback) {
    callback();
  },

  tearDown: function(callback) {
    callback();
  },

  badZone: function(test) {
    test.expect(2);
    zutil.getZoneAttributes(uuid(), function(error, attrs) {
      test.ok(error);
      test.ok(!attrs);
      test.done();
    });
  },

  getZoneAttrMissing: function(test) {
    test.expect(1);
    test.throws(function() {
      zutil.getZoneAttribute(_zoneName, function(error, attr) {});
    });
    test.done();
  },

  listZoneAttrs: function(test) {
    test.expect(5);
    zutil.getZoneAttributes(_zoneName, function(error, attrs) {
      test.ifError(error);
      test.ok(attrs);
      test.ok(attrs[0].name);
      test.ok(attrs[0].type);
      test.ok(attrs[0].value);
      test.done();
    });
  },

  getZoneAttr: function(test) {
    test.expect(7);
    zutil.getZoneAttribute(_zoneName, _zoneAttr, function(error, attr) {
      test.ifError(error);
      test.ok(attr);
      test.ok(attr.name);
      test.ok(attr.type);
      test.ok(attr.value);
      test.equal(_zoneAttr, attr.name);
      test.equal('string', attr.type);
      test.done();
    });
  },

  listThenGet: function(test) {
    test.expect(12);
    zutil.getZoneAttributes(_zoneName, function(error, attrs) {
      test.ifError(error);
      test.ok(attrs);
      test.ok(attrs[0].name);
      test.ok(attrs[0].type);
      test.ok(attrs[0].value);
      zutil.getZoneAttribute(_zoneName, _zoneAttr, function(error, attr) {
        test.ifError(error);
        test.ok(attr);
        test.ok(attr.name);
        test.ok(attr.type);
        test.ok(attr.value);
        test.equal(_zoneAttr, attr.name);
        test.equal('string', attr.type);
        test.done();
      });
    });
  },

  getZoneState: function (test) {
    test.expect(1);
    var state = zutil.getZoneState('global');
    test.equal(state, 'running');
    test.done();
  },

  getBadZoneState: function (test) {
    test.expect(1);

    var state;
    test.throws(function() {
      zutil.getZoneState('the-twilight-zone');
    });
    test.done();
  }
});
