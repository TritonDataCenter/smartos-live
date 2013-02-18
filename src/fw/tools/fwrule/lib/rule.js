/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: firewall rule model
 */

var mod_uuid = require('node-uuid');
var parser = require('./parser');
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var VError = require('verror').VError;



// --- Globals



var DIRECTIONS = ['to', 'from'];
var TARGET_TYPES = ['wildcard', 'ip', 'subnet', 'tag', 'vm'];
var UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Internal functions



/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
  DIRECTIONS.forEach(function (dir) {
    if (!obj.hasOwnProperty(dir)) {
      return;
    }

    TARGET_TYPES.forEach(function (type) {
      var name = type + 's';
      if (!obj[dir].hasOwnProperty(name)) {
        return;
      }

      callback(dir, type, type, obj[dir][name]);
    });
  });
}



// --- Firewall object and methods



/**
 * Firewall rule constructor
 */
function FwRule(data) {
  if (!data.rule && !data.parsed) {
    throw new Error('No rule specified!');
  }

  var parsed = data.parsed || parser.parse(data.rule);
  // XXX: more validation here, now that we have all of the args
  var d;
  var dir;

  this.enabled = data.hasOwnProperty('enabled') ? data.enabled : false;
  this.ports = parsed.ports;
  this.action = parsed.action;
  this.protocol = parsed.protocol;
  this.from = {};
  this.to = {};

  this.ips = {};
  this.tags = {};
  this.vms = {};
  this.subnets = {};

  if (data.uuid) {
    if (!UUID_REGEX.test(data.uuid)) {
      throw new VError('Invalid rule UUID "%s"', data.uuid);
    }
    this.uuid = data.uuid;
  } else {
    this.uuid = mod_uuid.v4();
  }

  this.version = data.version || generateVersion();

  if (data.owner_uuid) {
    if (!UUID_REGEX.test(data.owner_uuid)) {
      throw new VError('Invalid owner UUID "%s"', data.owner_uuid);
    }
    this.owner_uuid = data.owner_uuid;
  }

  var dirs = {
    'to': {},
    'from': {}
  };

  for (d in DIRECTIONS) {
    dir = DIRECTIONS[d];
    for (var j in parsed[dir]) {
      var target = parsed[dir][j];
      var name = target[0] + 's';
      if (!dirs[dir].hasOwnProperty(name)) {
        dirs[dir][name] = {};
      }

      this[name][target[1]] = 1;
      dirs[dir][name][target[1]] = 1;
    }
  }

  // Now dedup and sort
  for (d in DIRECTIONS) {
    dir = DIRECTIONS[d];
    for (var t in TARGET_TYPES) {
      var type = TARGET_TYPES[t] + 's';
      if (dirs[dir].hasOwnProperty(type)) {
        this[dir][type] = Object.keys(dirs[dir][type]).sort();
      } else {
        this[dir][type] = [];
      }
    }
  }

  this.ips = Object.keys(this.ips).sort();
  this.tags = Object.keys(this.tags).sort();
  this.vms = Object.keys(this.vms).sort();
  this.subnets = Object.keys(this.subnets).sort();
}


/**
 * Returns the internal representation of the rule
 */
FwRule.prototype.raw = function () {
  return {
    'action': this.action,
    'enabled': this.enabled,
    'from': this.from,
    'ports': this.ports,
    'protocol': this.protocol,
    'to': this.to,
    'uuid': this.uuid,
    'version': this.version
  };
};


/**
 * Returns the serialized version of the rule, suitable for storing
 */
FwRule.prototype.serialize = function () {
  var ser = {
    enabled: this.enabled,
    rule: this.text(),
    uuid: this.uuid,
    version: this.version
  };

  if (this.owner_uuid) {
    ser.owner_uuid = this.owner_uuid;
  }

  return ser;
};


/**
 * Returns the text of the rule
 */
FwRule.prototype.text = function () {
  var targets = {
    from: [],
    to: []
  };

  forEachTarget(this, function (dir, type, name, arr) {
    for (var i in arr) {
      var txt = util.format('%s %s', type, arr[i]);
      if (type == 'wildcard') {
        txt = arr[i];
      }
      targets[dir].push(txt);
    }
  });

  return util.format('FROM %s%s%s TO %s%s%s %s %s %sPORT %s%s',
      targets.from.length > 1 ? '(' : '',
      targets.from.join(' OR '),
      targets.from.length > 1 ? ')' : '',
      targets.to.length > 1 ? '(' : '',
      targets.to.join(' OR '),
      targets.to.length > 1 ? ')' : '',
      this.action.toUpperCase(),
      this.protocol.toLowerCase(),
      this.ports.length > 1 ? '(' : '',
      this.ports.sort().join(' AND PORT '),
      this.ports.length > 1 ? ')' : ''
  );
};


/**
 * Returns the string representation of the rule
 */
FwRule.prototype.toString = function () {
  return util.format('[%s,%s%s] %s', this.uuid, this.enabled,
      (this.owner_uuid ? ',' + this.owner_uuid : ''),
      this.text());
};



// --- Exported functions



/**
 * Creates a new firewall rule from the payload
 */
function createRule(payload) {
  return new FwRule(payload);
}


function generateVersion() {
  return Date.now(0) + '.' + sprintf('%06d', process.pid);
}

module.exports = {
  create: createRule,
  generateVersion: generateVersion,
  DIRECTIONS: DIRECTIONS,
  FwRule: FwRule,
  TARGET_TYPES: TARGET_TYPES
};
