/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * firewall rule parser: entry point
 */

var parser = require('./parser').parser;
var rule = require('./rule');
var validators = require('./validators');
var VError = require('verror').VError;



// --- Globals



var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var portRE = /^[0-9]{1,5}$/;



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
            'IP address "%s" is invalid', ip);
    }
};


parser.yy.validateIPv4subnet = function validateIPv4subnet(subnet) {
    if (!validators.validateIPv4subnet(subnet)) {
        throw new validators.InvalidParamError('rule',
            'Subnet "%s" is invalid (must be in CIDR format)', subnet);
    }
};


parser.yy.validatePortNumber = function validatePortNumber(num) {
    if (isNaN(num) || Number(num) < 1 || Number(num) > 65535) {
        throw new validators.InvalidParamError('rule',
            'Port number "%s" is invalid', num);
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


parser.yy.parseError = function parseError(str, details) {
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



// --- Exports



function parse() {
    return parser.parse.apply(parser, arguments);
}



module.exports = {
    ACTIONS: ['allow', 'block'],
    DIRECTIONS: rule.DIRECTIONS,
    FIELDS: rule.FIELDS,
    create: rule.create,
    FwRule: rule.FwRule,
    generateVersion: rule.generateVersion,
    parse: parse,
    PROTOCOLS: ['tcp', 'udp', 'icmp'],
    TARGET_TYPES: rule.TARGET_TYPES,
    validators: validators
};
