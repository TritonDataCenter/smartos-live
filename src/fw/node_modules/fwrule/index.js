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



// --- Validation functions



parser.yy.tagOrPortOrUUID = function tagOrPortOrUUID(lexer) {
  if (uuidRE.exec(lexer.yytext)) {
    return 'UUID';
  }

  if (portRE.exec(lexer.yytext)) {
    if (Number(lexer.yytext) > 65536) {
      throw new VError('Invalid port number "%s"', lexer.yytext);
    }
    return 'PORTNUM';
  }
  return 'TAGTXT';
};


parser.yy.validateIPv4address = function validateIPv4address(ip) {
  if (!validators.validateIPv4address(ip)) {
    throw new VError('IP address "%s" is invalid', ip);
  }
};


parser.yy.validateIPv4subnet = function validateIPv4subnet(subnet) {
  if (!validators.validateIPv4subnet(subnet)) {
    throw new VError('Subnet "%s" is invalid (must be in CIDR format)',
      subnet);
  }
};


parser.yy.parseError = function parseError(str, details) {
  var err = new Error(str);
  err.details = details;
  throw err;
};



// --- Exports



function parse() {
  return parser.parse.apply(parser, arguments);
  // XXX: more validation here, now that we have all of the args
}


module.exports = {
  ACTIONS: ['allow', 'block'],
  DIRECTIONS: rule.DIRECTIONS,
  create: rule.create,
  FwRule: rule.FwRule,
  generateVersion: rule.generateVersion,
  parse: parse,
  PROTOCOLS: ['tcp', 'udp', 'icmp'],
  TARGET_TYPES: rule.TARGET_TYPES
};
