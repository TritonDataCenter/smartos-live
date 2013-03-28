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
var validators = require('./validators');
var verror = require('verror');



// --- Globals



var DIRECTIONS = ['to', 'from'];
var TARGET_TYPES = ['wildcard', 'ip', 'subnet', 'tag', 'vm'];



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


/**
 * Sorts a list of ICMP types (with optional codes)
 */
function icmpTypeSort(types) {
  return types.map(function (type) {
    return type.toString().split(':');
  }).sort(function (a, b) {
    var aTot = (Number(a[0]) << 8) + (a.length === 1 ? 0 : Number(a[1]));
    var bTot = (Number(b[0]) << 8) + (a.length === 1 ? 0 : Number(b[1]));
    return aTot - bTot;
  }).map(function (typeArr) {
    return typeArr.join(':');
  });
}



// --- Firewall object and methods



/**
 * Firewall rule constructor
 */
function FwRule(data) {
  var errs = [];
  var parsed;

  // -- validation --

  if (!data.rule && !data.parsed) {
    errs.push(new validators.InvalidParamError('rule', 'No rule specified!'));
  } else {
    try {
      parsed = data.parsed || parser.parse(data.rule);
    } catch (err) {
      errs.push(err);
    }
  }

  if (data.hasOwnProperty('uuid')) {
    if (!validators.validateUUID(data.uuid)) {
      errs.push(new validators.InvalidParamError('uuid',
            'Invalid rule UUID "%s"', data.uuid));
    }

    this.uuid = data.uuid;
  } else {
    this.uuid = mod_uuid.v4();
  }

  this.version = data.version || generateVersion();

  if (data.hasOwnProperty('owner_uuid')) {
    if (!validators.validateUUID(data.owner_uuid)) {
      errs.push(new validators.InvalidParamError('owner_uuid',
        'Invalid owner UUID "%s"', data.owner_uuid));
    }
    this.owner_uuid = data.owner_uuid;
  }

  if (data.hasOwnProperty('enabled')) {
    if (typeof (data.enabled) !== 'boolean' && data.enabled !== 'true'
      && data.enabled !== 'false') {
      errs.push(new validators.InvalidParamError('enabled',
        'enabled must be true or false'));
    }

    this.enabled = data.enabled;
  } else {
    this.enabled = false;
  }

  if (errs.length !== 0) {
    if (errs.length === 1) {
      throw errs[0];
    }

    throw new verror.MultiError(errs);
  }

  // -- translate into the internal rule format --

  var d;
  var dir;

  this.action = parsed.action;
  this.protocol = parsed.protocol.name;

  if (this.protocol === 'icmp') {
    this.types = icmpTypeSort(parsed.protocol.targets);
    this.protoTargets = this.types;
  } else {
    this.ports = parsed.protocol.targets.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    this.protoTargets = this.ports;
  }

  this.from = {};
  this.to = {};

  this.allVMs = false;
  this.ips = {};
  this.tags = {};
  this.vms = {};
  this.subnets = {};
  this.wildcards = {};

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
  this.wildcards = Object.keys(this.wildcards).sort();

  if (this.wildcards.length !== 0 && this.wildcards.indexOf('vmall') !== -1) {
    this.allVMs = true;
  }
}


/**
 * Returns the internal representation of the rule
 */
FwRule.prototype.raw = function () {
  var raw = {
    'action': this.action,
    'enabled': this.enabled,
    'from': this.from,
    'protocol': this.protocol,
    'to': this.to,
    'uuid': this.uuid,
    'version': this.version
  };

  if (this.owner_uuid) {
    raw.owner_uuid = this.owner_uuid;
  }

  if (this.protocol === 'icmp') {
    raw.types = this.types;
  } else {
    raw.ports = this.ports;
  }

  return raw;
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
  var protoTxt;
  var targets = {
    from: [],
    to: []
  };

  forEachTarget(this, function (dir, type, name, arr) {
    for (var i in arr) {
      var txt = util.format('%s %s', type, arr[i]);
      if (type == 'wildcard') {
        txt = arr[i] === 'vmall' ? 'all vms' : arr[i];
      }
      targets[dir].push(txt);
    }
  });

  // Protocol-specific text: different for ICMP rather than TCP/UDP
  if (this.protocol === 'icmp') {
    protoTxt = util.format('%sTYPE %s%s',
      this.types.length > 1 ? '(' : '',
      this.types.map(function (type) {
        return type.toString().split(':');
      }).map(function (code) {
        return code[0] + (code.length === 1 ? '' : ' CODE ' + code[1]);
      }).join(' AND TYPE '),
      this.types.length > 1 ? ')' : ''
    );
  } else {
    protoTxt = util.format('%sPORT %s%s',
      this.ports.length > 1 ? '(' : '',
      this.ports.join(' AND PORT '),
      this.ports.length > 1 ? ')' : ''
    );
  }

  return util.format('FROM %s%s%s TO %s%s%s %s %s',
      targets.from.length > 1 ? '(' : '',
      targets.from.join(' OR '),
      targets.from.length > 1 ? ')' : '',
      targets.to.length > 1 ? '(' : '',
      targets.to.join(' OR '),
      targets.to.length > 1 ? ')' : '',
      this.action.toUpperCase(),
      this.protocol.toLowerCase(),
      protoTxt
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
