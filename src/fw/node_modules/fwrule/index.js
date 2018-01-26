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
 * Copyright 2017, Joyent, Inc. All rights reserved.
 *
 *
 * firewall rule parser: entry point
 */

'use strict';

var mod_net = require('net');
var parser = require('./parser').parser;
var rule = require('./rule');
var validators = require('./validators');



// --- Globals



var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/**
 * The fwrule language is versioned so that use of new features can be
 * restricted. These versions are:
 *
 * 1 - Initial version of language
 * 2 - PORTS keyword & support for ranges of ports
 * 3 - Support for IPv6 targets, the ICMPv6 protocol, and the TYPE ALL keyword
 */
var CURR_VERSION = 3;


// --- Internal helper functions


/**
 * Translates an internal parser name (usually all one word, all caps, for
 * brevity), to a friendlier user-facing name
 */
function translateParserNames(name) {
    var translated;
    switch (name) {
        case '\'ALL\'':
        case '\'ANY\'':
        case '\'IP\'':
        case '\'SUBNET\'':
        case '\'TAG\'':
        case '\'VM\'':
        case 'WORD':
            translated = name.toLowerCase();
            break;
        default:
            translated = name;
            break;
    }

    return translated;
}



// --- Parser extension methods



parser.yy.validateIPv4address = function validateIPv4address(ip) {
    if (!validators.validateIPv4address(ip)) {
        throw new validators.InvalidParamError('rule',
            'IPv4 address "%s" is invalid', ip);
    }
};


parser.yy.validateIPv6address = function validateIPv6address(ip) {
    if (!mod_net.isIPv6(ip)) {
        throw new validators.InvalidParamError('rule',
            'IPv6 address "%s" is invalid', ip);
    }
};


parser.yy.validateSubnet = function validateSubnet(input) {
    validators.validateSubnet('rule', input, parser.yy.enforceSubnetMask);
};


parser.yy.validatePortNumber = function validatePortNumber(num) {
    if (isNaN(num) || Number(num) < 1 || Number(num) > 65535) {
        throw new validators.InvalidParamError('rule',
            'Port number "%s" is invalid', num);
    }
};

parser.yy.validateRangeOrder = function validateRangeOrder(start, end) {
    if (Number(end) < Number(start)) {
        throw new validators.InvalidParamError('rule',
            'The end of the range (%s) cannot be less than the start (%s)',
            end, start);
    }
};

parser.yy.createMaybePortRange = function createMaybePortRange(num) {
    var range = num.split('-');

    switch (range.length) {
    case 1:
            parser.yy.validatePortNumber(range[0]);
            return Number(range[0]);
    case 2:
            parser.yy.validatePortNumber(range[0]);
            parser.yy.validatePortNumber(range[1]);
            parser.yy.validateRangeOrder(range[0], range[1]);
            return { 'start': Number(range[0]), 'end': Number(range[1]) };
    default:
            throw new validators.InvalidParamError('rule',
                '"%s" is not a valid port number or range', num);
    }
};


parser.yy.validateICMPcode = function validateICMPcode(num) {
    if (isNaN(num) || Number(num) < 0 || Number(num) > 255) {
        throw new validators.InvalidParamError('rule',
            'ICMP code "%s" is invalid', num);
    }
};


parser.yy.validateICMPtype = function validateICMPtype(num) {
    if (isNaN(num) || Number(num) < 0 || Number(num) > 255) {
        throw new validators.InvalidParamError('rule',
            'ICMP type "%s" is invalid', num);
    }
};


parser.yy.validateUUID = function validateUUID(text) {
    if (!uuidRE.test(text)) {
        throw new validators.InvalidParamError('rule',
            'UUID "%s" is invalid', text);
    }
};

parser.yy.validateOKVersion = function validateOKVersion(ver, feature) {
    if (ver > parser.yy.maxVersion) {
        throw new validators.InvalidParamError('rule',
            'The rule uses a feature (%s) newer than this API allows', feature);
    }
};


parser.yy.parseError = function parseError(_, details) {
    var err;
    if (details.token === null) {
        var pre = this.yy.lexer.pastInput();
        var post = this.yy.lexer.upcomingInput();
        err = new validators.InvalidParamError('rule',
            'Error at character %d: \'%s\', found: unexpected text',
            pre.length, post);
        err.details = details;
        throw err;
    }

    if (details.text === '') {
        err = new validators.InvalidParamError('rule',
            'Error at character 0: \'\', expected: \'FROM\', found: '
            + 'empty string');
        err.details = details;
        throw err;
    }

    err = new validators.InvalidParamError('rule',
        'Error at character %d: \'%s\', expected: %s, found: %s',
        details.loc.last_column,
        details.text,
        details.expected.map(function (exp) {
            return translateParserNames(exp);
        }).join(', '),
        translateParserNames(details.token));

    err.details = details;
    throw err;
};


parser.yy.tagUnescape = rule.tagUnescape;


// --- Exports



function parse(input, opts) {
    if (!opts) {
        opts = {};
    }

    // If a version hasn't been specified, use most recent
    parser.yy.maxVersion = opts.maxVersion || CURR_VERSION;

    // Whether we should check if CIDRs have bits set past mask
    parser.yy.enforceSubnetMask = !!opts.enforceSubnetMask;

    return parser.parse(input);
}



module.exports = {
    ACTIONS: ['allow', 'block'],
    DIRECTIONS: rule.DIRECTIONS,
    FIELDS: rule.FIELDS,
    create: rule.create,
    FwRule: rule.FwRule,
    generateVersion: rule.generateVersion,
    parse: parse,
    PROTOCOLS: ['tcp', 'udp', 'icmp', 'icmp6'],
    TARGET_TYPES: rule.TARGET_TYPES,
    validators: validators
};
