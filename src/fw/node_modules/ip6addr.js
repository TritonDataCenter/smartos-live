/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

var assert = require('assert-plus');
var util = require('util');


///--- Helpers

function ParseError(input, message, index) {
  if (Error.captureStackTrace)
    Error.captureStackTrace(this, ParseError);

  this.input = input;
  this.message = message;
  if (index !== undefined) {
    this.message += ' at index ' + index;
  }
}
util.inherits(ParseError, Error);

function modulo(a, n) {
  return (n + (a % n)) % n;
}

function _arrayToOctetString(input) {
  var out;
  out = (input[0] >> 8) + '.' + (input[0] & 0xff) + '.';
  out += (input[1] >> 8) + '.' + (input[1] & 0xff);
  return out;
}

function _isAddr(addr) {
  if (typeof (addr) === 'object') {
    /* It must resemble an Addr object */
    if (Array.isArray(addr._fields) && typeof (addr._attrs) === 'object') {
      return true;
    }
  }
  return false;
}

function _toAddr(input) {
  if (typeof (input) === 'string') {
    return ip6addrParse(input);
  } else if (_isAddr(input)) {
    return input;
  } else {
    throw new Error('Invalid argument: Addr or parsable string expected');
  }
}

function _arrayToHex(input, zeroElide, zeroPad) {
  var i;
  var elStart = null;
  var elLen = 0;
  if (zeroElide) {
    /* find longest run of zeroes to potentially elide */
    var start = null;
    var len = null;
    for (i = 0; i < input.length; i++) {
      if (input[i] === 0) {
        if (start === null) {
          start = i;
          len = 1;
        } else {
          len++;
        }
      } else if (start !== null) {
        if (len > elLen) {
          elStart = start;
          elLen = len;
        }
        start = null;
      }
    }
    /* capturing last potential zero */
    if (start !== null && len > elLen) {
      elStart = start;
      elLen = len;
    }
  }

  var output = [];
  var num;
  for (i = 0; i < input.length; i++) {
    if (elStart !== null) {
      if (i === elStart) {
        if (elLen === 8) {
          /* all-zeroes is just '::' */
          return ['::'];
        } else if (elStart === 0 || elStart + elLen === input.length) {
          /*
           * For elided zeroes at the beginning/end of the address, an extra
           * ':' is needed during the join step.
           */
          output.push(':');
        } else {
          output.push('');
        }
      }
      if (i >= elStart && i < elStart + elLen) {
        continue;
      }
    }
    num = input[i].toString(16);
    if (zeroPad && num.length != 4) {
      num = '0000'.slice(num.length) + num;
    }
    output.push(num);
  }
  return output;
}

function _ipv4Mapped(input) {
  var comp = [0, 0, 0, 0, 0, 0xffff];
  var i;
  for (i = 0; i < 6; i++) {
    if (input[i] != comp[i])
      return false;
  }
  return true;
}

function _prefixToAddr(len) {
  assert.number(len);
  len = len | 0;
  assert.ok(len <= 128);
  assert.ok(len >= 0);

  var output = new Addr();
  var i;
  for (i = 0; len > 16; i++, len -= 16) {
    output._fields[i] = 0xffff;
  }
  if (len > 0) {
    output._fields[i] = 0xffff - ((1 << (16 - len)) - 1);
  }
  return output;
}

function _toCIDR(input) {
  if (typeof (input) === 'string') {
    return new CIDR(input);
  } else if (input instanceof CIDR) {
    return input;
  } else {
    throw new Error('Invalid argument: CIDR or parsable string expected');
  }
}

var strDefaults = {
  format: 'auto', // Control format of printed address
  zeroElide: true, // Elide longest run of zeros
  zeroPad: false // Pad with zeros when a group would print as < 4 chars
};

function getStrOpt(opts, name) {
  if (opts && opts.hasOwnProperty(name)) {
    return opts[name];
  } else {
    return strDefaults[name];
  }
}

///--- Public Classes

/**
 * IPv6/IPv4 address representation.
 *
 * It should not be instantiated directly by library consumers.
 */
function Addr() {
  this._fields = [0, 0, 0, 0, 0, 0, 0, 0];
  this._attrs = {};
}

Addr.prototype.kind = function getKind() {
  if (v4subnet.contains(this)) {
    return 'ipv4';
  } else {
    return 'ipv6';
  }
};

Addr.prototype.toString = function toString(opts) {
  assert.optionalObject(opts, 'opts');
  var format = getStrOpt(opts, 'format');
  var zeroElide = getStrOpt(opts, 'zeroElide');
  var zeroPad = getStrOpt(opts, 'zeroPad');

  assert.string(format, 'opts.format');
  assert.bool(zeroElide, 'opts.zeroElide');
  assert.bool(zeroPad, 'opts.zeroPad');

  // Try to print the address the way it was originally formatted
  if (format === 'auto') {
    if (this._attrs.ipv4Bare) {
      format = 'v4';
    } else if (this._attrs.ipv4Mapped) {
      format = 'v4-mapped';
    } else {
      format = 'v6';
    }
  }

  switch (format) {
  // Print in dotted-quad notation (but only if truly IPv4)
  case 'v4':
    if (!v4subnet.contains(this)) {
        throw new Error('cannot print non-v4 address in dotted quad notation');
    }
    return _arrayToOctetString(this._fields.slice(6));

  // Print as an IPv4-mapped IPv6 address
  case 'v4-mapped':
    if (!v4subnet.contains(this)) {
        throw new Error('cannot print non-v4 address as a v4-mapped address');
    }
    var output = _arrayToHex(this._fields.slice(0, 6), zeroElide, zeroPad);
    output.push(_arrayToOctetString(this._fields.slice(6)));
    return output.join(':');

  // Print as an IPv6 address
  case 'v6':
    return _arrayToHex(this._fields, zeroElide, zeroPad).join(':');

  // Unrecognized formatting method
  default:
    throw new Error('unrecognized format method "' + format + '"');
  }
};

Addr.prototype.toBuffer = function toBuffer(buf) {
  if (buf !== undefined) {
    if (!Buffer.isBuffer(buf)) {
      throw new Error('optional arg must be Buffer');
    }
  } else {
    buf = new Buffer(16);
  }
  var i;
  for (i = 0; i < 8; i++) {
    buf.writeUInt16BE(this._fields[i], i*2);
  }
  return buf;
};

Addr.prototype.toLong = function toLong() {
  if (!v4subnet.contains(this)) {
    throw new Error('only possible for ipv4-mapped addresses');
  }
  return ((this._fields[6] << 16) >>> 0) + this._fields[7];
};

Addr.prototype.clone = function cloneAddr() {
  var out = new Addr();
  out._fields = this._fields.slice();
  for (var k in this._attrs) {
      out._attrs[k] = this._attrs[k];
  }
  return out;
};

Addr.prototype.offset = function offset(num) {
  if (num < -4294967295 || num > 4294967295) {
    throw new Error('offsets should be between -4294967295 and 4294967295');
  }
  var out = this.clone();
  var i, moved;
  for (i = 7; i >= 0; i--) {
    moved = out._fields[i] + num;
    if (moved > 65535) {
      num = moved >>> 16;
      moved = moved & 0xffff;
    } else if (moved < 0) {
      num = Math.floor(moved / (1 << 16));
      moved = modulo(moved, 1 << 16);
    } else {
      num = 0;
    }
    out._fields[i] = moved;

    /* Prevent wrap-around for both ipv6 and ipv4-mapped addresses */
    if (num !== 0) {
      if ((i === 0) || (i === 6 && this._attrs.ipv4Mapped)) {
        return null;
      }
    } else {
      break;
    }
  }
  return out;
};

Addr.prototype.and = function addrAnd(input) {
  input = _toAddr(input);
  var i;
  var output = this.clone();
  for (i = 0; i < 8; i++) {
    output._fields[i] = output._fields[i] & input._fields[i];
  }
  return output;
};

Addr.prototype.or = function addrOr(input) {
  input = _toAddr(input);
  var i;
  var output = this.clone();
  for (i = 0; i < 8; i++) {
    output._fields[i] = output._fields[i] | input._fields[i];
  }
  return output;
};

Addr.prototype.not = function addrNot() {
  var i;
  var output = this.clone();
  for (i = 0; i < 8; i++) {
    output._fields[i] = (~ output._fields[i]) & 0xffff;
  }
  return output;
};

Addr.prototype.compare = function compareMember(addr) {
  return ip6addrCompare(this, addr);
};

/**
 * CIDR Block
 * @param addr CIDR network address
 * @param prefixLen Length of network prefix
 *
 * The addr parameter can be an Addr object or a parseable string.
 * If prefixLen is omitted, then addr must contain a parseable string in the
 * form '<address>/<prefix>'.
 */
function CIDR(addr, prefixLen) {
  if (prefixLen === undefined) {
    /* OK to pass pass string of "<addr>/<prefix>" */
    assert.string(addr);
    var fields = addr.match(/^([a-fA-F0-9:.]+)\/([0-9]+)$/);
    if (fields === null) {
      throw new Error('Invalid argument: <addr>/<prefix> expected');
    }
    addr = fields[1];
    prefixLen = parseInt(fields[2], 10);
  }
  assert.number(prefixLen);
  prefixLen = prefixLen | 0;
  addr = _toAddr(addr);

  /* Expand prefix to ipv6 length of bare ipv4 address provided */
  if (addr._attrs.ipv4Bare) {
    prefixLen += 96;
  }
  if (prefixLen < 0 || prefixLen > 128) {
    throw new Error('Invalid prefix length');
  }
  this._prefix = prefixLen;
  this._mask = _prefixToAddr(prefixLen);
  this._addr = addr.and(this._mask);
}

CIDR.prototype.contains = function cidrContains(input) {
  input = _toAddr(input);
  return (this._addr.compare(input.and(this._mask)) === 0);
};

CIDR.prototype.first = function cidrFirst(input) {
  if (this._prefix >= 127) {
    /* Support single-address and point-to-point networks */
    return this._addr;
  } else {
    return this._addr.offset(1);
  }
};

CIDR.prototype.last = function cidrLast(input) {
  var ending = this._addr.or(this._mask.not());
  if (this._prefix >= 127) {
    /* Support single-address and point-to-point networks */
    return ending;
  } else {
    if (this._addr._attrs.ipv4Mapped) {
      /* don't include the broadcast for ipv4 */
      return ending.offset(-1);
    } else {
      return ending;
    }
  }
};

CIDR.prototype.broadcast = function getBroadcast() {
  if (!v4subnet.contains(this._addr)) {
    throw new Error('Only IPv4 networks have broadcast addresses');
  }
  return this._addr.or(this._mask.not());
};

CIDR.prototype.compare = function compareCIDR(cidr) {
  return ip6cidrCompare(this, cidr);
};

CIDR.prototype.prefixLength = function getPrefixLength(format) {
  assert.optionalString(format, 'format');
  if (format === undefined || format === 'auto') {
    format = this._addr._attrs.ipv4Bare ? 'v4' : 'v6';
  }

  switch (format) {
  case 'v4':
    if (!v4subnet.contains(this._addr)) {
        throw new Error('cannot return v4 prefix length for non-v4 address');
    }
    return this._prefix - 96;
  case 'v6':
    return this._prefix;
  default:
    throw new Error('unrecognized format method "' + format + '"');
  }
};

CIDR.prototype.address = function getAddressComponent() {
  return this._addr;
};

CIDR.prototype.toString = function cidrString(opts) {
  assert.optionalObject(opts, 'opts');

  var format = getStrOpt(opts, 'format');
  if (format === 'v4-mapped') {
    format = 'v6';
  }

  return this._addr.toString(opts) + '/' + this.prefixLength(format);
};

var v4subnet = new CIDR('::ffff:0:0', 96);

function ip6cidrCompare(a, b) {
  a = _toCIDR(a);
  b = _toCIDR(b);

  /*
   * We compare first on the address component, and then on the prefix length,
   * such that the network with the smaller prefix length (the larger subnet)
   * is greater than the network with the smaller prefix (the smaller subnet).
   * This is the same ordering used in Postgres.
   */
  var cmp = ip6addrCompare(a._addr, b._addr);
  return cmp === 0 ? b._prefix - a._prefix : cmp;
}

/**
 * Range of addresses.
 * @param begin Beginning address of the range
 * @param end Ending address of the range
 *
 * Parameters can be Addr objects or parsable address strings.
 */
function AddrRange(begin, end) {
  begin = _toAddr(begin);
  end = _toAddr(end);

  if (begin.compare(end) > 0) {
    throw new Error('begin address must be <= end address');
  }

  this._begin = begin;
  this._end = end;
}

AddrRange.prototype.contains = function addrRangeContains(input) {
  input = _toAddr(input);
  return (this._begin.compare(input) <= 0 && this._end.compare(input) >= 0);
};

AddrRange.prototype.first = function addrRangeFirst() {
  return this._begin;
};

AddrRange.prototype.last = function addrRangeLast() {
  return this._end;
};


///--- Public Functions

function ip6addrParse(input) {
  if (typeof (input) === 'string') {
    return parseString(input);
  } else if (typeof (input) === 'number') {
    return parseLong(input);
  } else if (typeof (input) === 'object' && _isAddr(input)) {
    return input;
  } else {
    throw new Error('Invalid argument: only string|number allowed');
  }
}

function parseString(input) {
  assert.string(input);
  input = input.toLowerCase();
  var result = new Addr();

  var ip6Fields = []; // hold unparsed hex fields
  var ip4Fields = []; // hold unparsed decimal fields
  var expIndex = null; // field index of '::' delimiter
  var value = '';  // accumulate unparsed hex/dec field
  var i, c;

  /*
   * No valid ipv6 is longer than 39 characters.
   * An extra character of leeway is there to tolerate some :: funny business.
   */
  if (input.length > 40) {
    throw new ParseError(input, 'Input too long');
  }

  for (i = 0; i < input.length; i++) {
    c = input[i];
    if (c === ':') {
      if ((i+1) < input.length && input[i+1] === ':') {
        /*
         * Variable length '::' delimiter.
         * Multiples would be ambiguous
         */
        if (expIndex !== null) {
          throw new ParseError(input, 'Multiple :: delimiters', i);
        }

        /*
         * The value buffer can be empty for cases where the '::' delimiter is
         * the first portion of the address.
         */
        if (value !== '') {
          ip6Fields.push(value);
          value = '';
        }
        expIndex = ip6Fields.length;
        i++;
      } else {
        /*
         * Standard ':' delimiter
         * The value buffer cannot be empty since that would imply an illegal
         * pattern such as ':::' or ':.'.
         */
        if (value === '') {
          throw new ParseError(input, 'illegal delimiter', i);
        }
        ip6Fields.push(value);
        value = '';
      }
    } else if (c === '.') {
      /*
       * Handle dotted quad notation for ipv4 and ipv4-mapped addresses.
       */
      ip4Fields.push(value);
      value = '';
    } else {
      value = value + c;
    }
  }
  /* Handle the last stashed value */
  if (value !== '') {
    if (ip4Fields.length !== 0) {
      ip4Fields.push(value);
    } else {
      ip6Fields.push(value);
    }
    value = '';
  } else {
    /* With no stashed value, the address must end with '::'. */
    if (expIndex !== ip6Fields.length || ip4Fields.length > 0) {
      throw new ParseError(input, 'Cannot end with delimiter besides ::');
    }
  }

  /* With values collected, ensure we don't have too many/few */
  if (ip4Fields.length === 0) {
    if (ip6Fields.length > 8) {
      throw new ParseError(input, 'Too many fields');
    } else if (ip6Fields.length < 8 && expIndex === null) {
      throw new ParseError(input, 'Too few fields');
    }
  } else {
    if (ip4Fields.length !== 4) {
      throw new ParseError(input, 'IPv4 portion must have 4 fields');
    }
    /* If this is a bare IP address, implicitly convert to IPv4 mapped */
    if (ip6Fields.length === 0 && expIndex === null) {
      result._attrs.ipv4Bare = true;
      ip6Fields = ['ffff'];
      expIndex = 0;
    }

    if (ip6Fields.length > 6) {
      throw new ParseError(input, 'Too many fields');
    } else if (ip6Fields.length < 6 && expIndex === null) {
      throw new ParseError(input, 'Too few fields');
    }
  }

  /* Parse integer values */
  var field, num;
  for (i = 0; i < ip6Fields.length; i++) {
    field = ip6Fields[i];
    num = Number('0x' + field);
    if (isNaN(num) || num < 0 || num > 65535) {
      throw new ParseError(input, 'Invalid field value: ' + field);
    }
    ip6Fields[i] = num;
  }
  for (i = 0; i < ip4Fields.length; i++) {
    field = ip4Fields[i];
    num = Number(field);
    if (parseInt(field, 10) !== num || num < 0 || num > 255) {
      throw new ParseError(input, 'Invalid field value: ' + field);
    }
    ip4Fields[i] = num;
  }

  /* Collapse IPv4 portion, if necessary */
  if (ip4Fields.length !== 0) {
    ip6Fields.push((ip4Fields[0]*256) + ip4Fields[1]);
    ip6Fields.push((ip4Fields[2]*256) + ip4Fields[3]);
  }

  /* Expand '::' delimiter into implied 0s */
  if (ip6Fields.length < 8 && expIndex !== null) {
    var filler = [];
    for (i = 0; i < (8 - ip6Fields.length); i++) {
      filler.push(0);
    }
    ip6Fields = Array.prototype.concat(
      ip6Fields.slice(0, expIndex),
      filler,
      ip6Fields.slice(expIndex)
    );
  }

  /*
   * If dotted-quad notation was used, ensure the input was either a bare ipv4
   * address or a valid ipv4-mapped address.
   */
  if (ip4Fields.length !== 0) {
    if (!_ipv4Mapped(ip6Fields)) {
      throw new ParseError(input, 'invalid dotted-quad notation');
    } else {
      result._attrs.ipv4Mapped = true;
    }
  }

  result._fields = ip6Fields;

  return result;
}

function parseLong(input) {
  assert.number(input);
  if (input !== Math.floor(input)) {
    throw new Error('Value must be integer');
  }
  if (input < 0 || input > 0xffffffff) {
    throw new Error('Value must be 32 bit');
  }
  var out = new Addr();
  out._fields[7] = input & 0xffff;
  out._fields[6] = (input >>> 16);
  /* this is ipv4-mapped */
  out._fields[5] = 0xffff;
  out._attrs.ipv4Bare = true;
  out._attrs.ipv4Mapped = true;
  return out;
}

/**
 * Compare Addr objects in a manner suitable for Array.sort().
 */
function ip6addrCompare(a, b) {
  a = _toAddr(a);
  b = _toAddr(b);

  var i;
  for (i = 0; i < 8; i++) {
    if (a._fields[i] < b._fields[i]) {
      return -1;
    } else if (a._fields[i] > b._fields[i]) {
      return 1;
    }
  }
  return 0;
}


///--- Exports

module.exports = {
  parse: ip6addrParse,
  compare: ip6addrCompare,
  createCIDR: function (addr, len) {
    return new CIDR(addr, len);
  },
  compareCIDR: ip6cidrCompare,
  createAddrRange: function (begin, end) {
    return new AddrRange(begin, end);
  }
};
