/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * firewall rule parser: validation functions
 */

var net = require('net');
var util = require('util');
var VError = require('verror').VError;



// --- Globals



var portRE = /^[0-9]{1,5}$/;
var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Exports



/**
 * Constructor for an invalid parameter error
 */
function InvalidParamError(field) {
    VError.apply(this, Array.prototype.slice.call(arguments, 1));
    this.field = field;
}

util.inherits(InvalidParamError, VError);


/**
 * Returns true if ip is a valid IPv4 address, and not all zeroes or
 * the broadcast address
 */
function validateIPv4address(ip) {
    if (!net.isIPv4(ip) || (ip == '255.255.255.255') || (ip == '0.0.0.0')) {
        return false;
    }

    return true;
}


/**
 * Returns true if subnet is in valid CIDR form
 */
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


/**
 * Returns true if port is a valid port number
 */
function validatePort(port) {
    if (!portRE.exec(port)) {
        return false;
    }

    if (Number(port) > 65535) {
        return false;
    }

    return true;
}


/**
 * Returns true if protocol is one of tcp, udp, icmp (mixing of upper
 * and lower-case allowed)
 */
function validateProtocol(protocol) {
    var protoLC = protocol.toLowerCase();
    if ((protoLC != 'tcp') && (protoLC != 'udp') && (protoLC != 'icmp')) {
        return false;
    }
    return true;
}


/**
 * Returns true if action is a valid firewall action ('allow' or 'block',
 * mixed case allowed)
 */
function validateAction(action) {
    var actionLC = action.toLowerCase();
    if ((actionLC != 'allow') && (actionLC != 'block')) {
        return false;
    }
    return true;
}


/**
 * Returns true if bool is a valid boolean value, false otherwise
 */
function validateBoolean(bool) {
    if (typeof (bool) !== 'boolean' && bool !== 'true' && bool !== 'false') {
        return false;
    }

    return true;
}


/**
 * Throws an InvalidParamError if the string is invalid
 */
function validateString(name, str) {
    if (typeof (str) !== 'string') {
        throw new InvalidParamError(name, name + ' must be a string');
    }

    if (str.length > 255) {
        throw new InvalidParamError(name,
            name + ' must be shorter than 255 characters');
    }
}


/**
 * Returns true if uuid is a valid UUID
 */
function validateUUID(uuid) {
    return UUID_REGEX.test(uuid);
}


module.exports = {
    bool: validateBoolean,
    InvalidParamError: InvalidParamError,
    validateAction: validateAction,
    validateIPv4address: validateIPv4address,
    validateIPv4subnet: validateIPv4subnet,
    validatePort: validatePort,
    validateProtocol: validateProtocol,
    validateString: validateString,
    validateUUID: validateUUID
};
