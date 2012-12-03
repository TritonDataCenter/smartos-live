/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * firewall rule parser: entry point
 */

var fw = require('./parser').parser;
var validators = require('./validators');
var VError = require('verror').VError;



// --- Globals



var uuidRE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var portRE = /^[0-9]{1,5}$/;



// --- Validation functions



fw.yy.tagOrPortOrUUID = function tagOrPortOrUUID(lexer) {
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


fw.yy.validateIPv4address = function validateIPv4address(ip) {
  if (!validators.validateIPv4address(ip)) {
    throw new VError('IP address "%s" is invalid', ip);
  }
};


fw.yy.validateIPv4subnet = function validateIPv4subnet(subnet) {
  if (!validators.validateIPv4subnet(subnet)) {
    throw new VError('Subnet "%s" is invalid (must be in CIDR format)',
      subnet);
  }
};


fw.yy.parseError = function parseError(str, details) {
  var err = new Error(str);
  err.details = details;
  throw err;
};



// --- Exports



function parse() {
  return fw.parse.apply(fw, arguments);
  // XXX: more validation here, now that we have all of the args
}


module.exports = {
  parse: parse
};
