/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

'use strict';

var assert = require('assert-plus');
var mod_jsprim = require('jsprim');

var HEX_RE = /^[a-f0-9]$/;

// --- Helpers

function isxdigit(c) {
    return HEX_RE.test(c);
}


var strDefaults = {
    zeroPad: true // Pad with zeros when an octet would print as 1 char
};


function getStrOpt(opts, name) {
    if (opts && opts.hasOwnProperty(name)) {
        return opts[name];
    } else {
        return strDefaults[name];
    }
}


// --- Main class

/**
 * The MAC class wraps a 48-bit integer, and provides several helper
 * methods for manipulating it.
 *
 * It could wrap an array of 6 octets instead, but doing so complicates
 * processing both numeric input and output, without improving string
 * processing in a useful way. (We would be able to remove the bitwise
 * arithmetic in .toString(), but it would just end up in parseLong()
 * instead.)
 *
 * Since the initial motivation for this library was a program that
 * stores MAC addresses as numbers in its database, making numeric
 * processing easier made more sense.
 */
function MAC(value) {
    assert.number(value, 'value');
    this._value = value;
}


MAC.prototype.toString = function toString(opts) {
    assert.optionalObject(opts, 'opts');
    var zeroPad = getStrOpt(opts, 'zeroPad');

    var result = '';
    var fields = [
        /*
         * JavaScript converts numbers to 32-bit integers when doing bitwise
         * arithmetic, so we have to handle the first two parts of the number
         * differently.
         */
        (this._value / 0x010000000000) & 0xff,
        (this._value / 0x000100000000) & 0xff,

        (this._value >>> 24) & 0xff,
        (this._value >>> 16) & 0xff,
        (this._value >>> 8) & 0xff,
        (this._value) & 0xff
    ];

    var octet;

    for (var i = 0; i < fields.length; i++) {
        if (i !== 0) {
            result += ':';
        }

        octet = fields[i].toString(16);
        if (zeroPad && octet.length === 1) {
            result += '0';
        }
        result += octet;
    }

    return result;
};


MAC.prototype.toLong = function toLong() {
    return this._value;
};


MAC.prototype.compare = function compare(other) {
    assert.ok(other instanceof MAC, 'other is a MAC object');

    if (this._value < other._value) {
        return -1;
    } else if (this._value > other._value) {
        return 1;
    } else {
        return 0;
    }
};


// --- Input parsing

function parseString(input) {
    assert.string(input);
    input = input.toLowerCase();
    var pos = 0;
    var value = 0;
    var octet = '';
    var sep = null;
    var chr, tmp;

    /*
     * Test if a character is a valid separator. If we haven't seen a
     * separator yet, and it's one of the allowed separator characters,
     * lock in to that character to prevent using a different value later.
     */
    function issep(s) {
        if (sep !== null) {
            return (s === sep);
        }

        if (s === ':' || s === '-') {
            sep = s;
            return true;
        }

        return false;
    }

    function process() {
        if (octet.length === 0) {
            throw new Error('expected to find a hexadecimal number before ' +
                JSON.stringify(sep));
        } else if (octet.length > 2) {
            throw new Error(
                'too many hexadecimal digits in ' + JSON.stringify(octet));
        } else if (pos < 6) {
            tmp = mod_jsprim.parseInteger(octet, { base: 16 });
            if (tmp instanceof Error) {
                throw tmp;
            }
            value *= 0x100;
            value += tmp;
            pos += 1;
            octet = '';
        } else {
            throw new Error('too many octets in MAC address');
        }
    }

    for (var i = 0; i < input.length; i++) {
        chr = input[i];
        if (issep(chr)) {
            process();
        } else if (isxdigit(chr)) {
            octet += chr;
        } else {
            throw new Error('unrecognized character ' + JSON.stringify(chr));
        }
    }

    if (issep(chr)) {
        throw new Error('trailing ' + JSON.stringify(sep) + ' in MAC address');
    }

    if (pos === 0) {
        if (octet.length !== 12) {
            throw new Error('MAC address is too short');
        }

        value = mod_jsprim.parseInteger(octet, { base: 16 });
        if (value instanceof Error) {
            throw value;
        }
    } else {
        process();

        if (pos !== 6) {
            throw new Error('too few octets in MAC address');
        }
    }

    return new MAC(value);
}


function parseLong(input) {
    assert.number(input);

    if (input !== Math.floor(input)) {
        throw new Error('Value must be an integer');
    }

    if (input < 0 || input > 0xffffffffffff) {
        throw new Error('Value must be 48-bit');
    }

    return new MAC(input);
}


// --- Exports

function macaddrParse(input) {
    var type = typeof (input);

    switch (type) {
    case 'string':
        return parseString(input);
    case 'number':
        return parseLong(input);
    default:
        throw new Error('expected string or integer, but got ' + type);
    }
}


module.exports = {
    parse: macaddrParse
};
