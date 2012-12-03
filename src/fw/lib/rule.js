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
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * fwadm: firewall rule model
 */

var mod_uuid = require('node-uuid');
var parser = require('./parser');
var util = require('util');
var VError = require('verror').VError;



// --- Globals



var DIRECTIONS = ['to', 'from'];
// var TARGET_TYPES = ['wildcard', 'ip', 'machine', 'subnet', 'tag'];
var UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Firewall object and methods



/**
 * Firewall rule constructor
 */
function FwRule(data) {
  if (!data.rule) {
    throw new Error('No rule specified!');
  }

  var parsed = parser.parse(data.rule);
  // XXX: more validation here, now that we have all of the args
  var d;
  var dir;

  this.parsed = parsed;
  this.ruleTxt = data.rule; // XXX
  this.enabled = data.hasOwnProperty('enabled') ? data.enabled : false;
  this.ports = parsed.ports;
  this.action = parsed.action;
  this.protocol = parsed.protocol;
  this.from = {};
  this.to = {};

  this.ips = {};
  this.tags = {};
  this.machines = {};
  this.subnets = {};

  if (data.uuid) {
    if (!UUID_REGEX.test(data.uuid)) {
      throw new VError('Invalid rule UUID "%s"', data.uuid);
    }
    this.uuid = data.uuid;
  } else {
    this.uuid = mod_uuid.v4();
  }

  this.version = data.version || '<unknown>';

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
    for (var type in dirs[dir]) {
      this[dir][type] = Object.keys(dirs[dir][type]).sort();
    }
  }

  this.ips = Object.keys(this.ips).sort();
  this.tags = Object.keys(this.tags).sort();
  this.machines = Object.keys(this.machines).sort();
  this.subnets = Object.keys(this.subnets).sort();
}


/**
 * Returns the internal representation of the rule
 */
FwRule.prototype.raw = function () {
  return {
    'uuid': this.uuid,
    'from': this.from,
    'to': this.to,
    'ports': this.ports,
    'action': this.action,
    'protocol': this.protocol,
    'enabled': this.enabled
  };
};


/**
 * Returns the serialized version of the rule, suitable for storing
 */
FwRule.prototype.serialize = function () {
  var ser = {
    enabled: this.enabled,
    rule: this.text(),
    uuid: this.uuid
  };

  if (this.version && this.version !== '<unknown>') {
    ser.version = this.version;
  }

  if (this.owner_uuid) {
    ser.owner_uuid = this.owner_uuid;
  }

  return ser;
};


/**
 * Returns the text of the rule
 */
FwRule.prototype.text = function () {
  return this.ruleTxt; // XXX: regenerate this!
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


module.exports = {
  create: createRule
};
