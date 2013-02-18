/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * firewall rule parser: validation functions
 */

var net = require('net');



// --- Globals



var portRE = /^[0-9]{1,5}$/;



// --- Exports



function validateIPv4address(ip) {
  if (!net.isIPv4(ip) || (ip == '255.255.255.255') || (ip == '0.0.0.0')) {
    return false;
  }
  return true;
}


// Ensure subnet is in valid CIDR form
function validateIPv4subnet(subnet) {
  var parts = subnet.split('/');
  if (!validateIPv4address(parts[0])) {
    return false;
  }

  if (!Number(parts[1]) || (parts[1] < 1) || (parts[1] > 32)) {
    return false;
  }
  return true;
}


function validatePort(port) {
  if (!portRE.exec(port)) {
    return false;
  }
  if (Number(port) > 65536) {
    return false;
  }
  return true;
}


// protocol: tcp, udp, icmp - mixing of upper and lower-case allowed
function validateProtocol(protocol) {
  var protoLC = protocol.toLowerCase();
  if ((protoLC != 'tcp') && (protoLC != 'udp') && (protoLC != 'icmp')) {
    return false;
  }
  return true;
}


function validateAction(action) {
  var actionLC = action.toLowerCase();
  if ((actionLC != 'allow') && (actionLC != 'block')) {
    return false;
  }
  return true;
}


module.exports = {
  validateIPv4address: validateIPv4address,
  validateIPv4subnet: validateIPv4subnet,
  validatePort: validatePort,
  validateProtocol: validateProtocol,
  validateAction: validateAction
};
