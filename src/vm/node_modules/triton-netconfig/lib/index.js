/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var ip6addr = require('ip6addr');

// ---- Internal

var RACK_RE = '(_rack_[A-Z0-9_-]+)?$';
var ADMIN_NAME = 'admin';
var MANTA_NAME = 'manta';
var EXTERNAL_NAME = 'external';
var INTERNAL_NAME = 'internal';

/*
 * TODO: prefer RFD 117 traits
 */
function _fromNicsArrayCommon(nics, what, network) {
    for (var i = 0; i < nics.length; i++) {
        var nic = nics[i];
        if (_isNetNicCommon(nic, network)) {
            return nics[i][what];
        }
    }

    return null;
}

/*
 * TODO: prefer RFD 117 traits
 */
function _fromVmMetadataCommon(vm, what, network) {
    return _fromNicsArrayCommon(vm.nics, what, network);
}

/*
 * TODO: prefer RFD 117 traits
 */
function _isNetNicCommon(nic, network) {
    var re = new RegExp('^' + network + RACK_RE, 'i');

    return re.test(nic.nic_tag);
}

function _isValidIpAddress(ip) {
    try {
        ip6addr.parse(ip);
        return true;
    } catch (_) {
        return false;
    }
}

// ---- Exports

/*
 * Returns the NAPI NIC object for the admin NIC.
 *
 * for config-agent process GZNicTags?
 */
function adminNicFromSysinfo(sysinfo) {
    var interfaces;
    var admin_tag = ADMIN_NAME;

    if (sysinfo['Admin NIC Tag']) {
        admin_tag = sysinfo['Admin NIC Tag'];
    }

    interfaces = sysinfo['Network Interfaces'];

    for (var iface in interfaces) {
        if (!interfaces.hasOwnProperty(iface)) {
            continue;
        }

        var nic = interfaces[iface]['NIC Names'];
        if (nic.indexOf(admin_tag) !== -1) {
            return interfaces[iface];
        }
    }

    return null;
}

/*
 * Given a CN's sysinfo in JSON format return the admin IP.
 *
 * The "Admin IP" value can be set to "dhcp", so this first checks if it is a
 * valid IP address, and if not it tries to dig it out of sysinfo.
 */
function adminIpFromSysinfo(sysinfo) {
    var sys_admin_ip = sysinfo['Admin IP'];

    if (sys_admin_ip && _isValidIpAddress(sys_admin_ip)) {
        return sys_admin_ip;
    }

    var nic = adminNicFromSysinfo(sysinfo);

    if (nic) {
        return nic.ip4addr;
    }

    return null;
}

// ---- From VM Metadata

/*
 * Currently only return the singleton 'ip' field.  In the future it may be
 * beneficial to return all of the nics 'ips'.
 */
function adminIpFromVmMetadata(vm) {
    return _fromVmMetadataCommon(vm, 'ip', ADMIN_NAME);
}

function externalIpFromVmMetadata(vm) {
    return _fromVmMetadataCommon(vm, 'ip', EXTERNAL_NAME);
}

// XXX: Unused?
function mantaIpFromVmMetadata(vm) {
    return _fromVmMetadataCommon(vm, 'ip', MANTA_NAME);
}

function adminMacFromVmMetadata(vm) {
    return _fromVmMetadataCommon(vm, 'mac', ADMIN_NAME);
}

// ---- From NICs array (sdc:nics metadata)

function adminIpFromNicsArray(nics) {
    return _fromNicsArrayCommon(nics, 'ip', ADMIN_NAME);
}

// ---- isNic

function isNicAdmin(nic) {
    return _isNetNicCommon(nic, ADMIN_NAME);
}

function isNicExternal(nic) {
    return _isNetNicCommon(nic, EXTERNAL_NAME);
}

// ---- isNet

function isNetAdmin(net) {
    return _isNetNicCommon(net, ADMIN_NAME);
}

function isNetExternal(net) {
    return _isNetNicCommon(net, EXTERNAL_NAME);
}

function isNetInternal(net) {
    return _isNetNicCommon(net, INTERNAL_NAME);
}

module.exports = {
    adminNicFromSysinfo: adminNicFromSysinfo,
    adminIpFromNicsArray: adminIpFromNicsArray,
    adminIpFromSysinfo: adminIpFromSysinfo,
    adminIpFromVmMetadata: adminIpFromVmMetadata,
    externalIpFromVmMetadata: externalIpFromVmMetadata,
    mantaIpFromVmMetadata: mantaIpFromVmMetadata,
    adminMacFromVmMetadata: adminMacFromVmMetadata,
    isNicAdmin: isNicAdmin,
    isNicExternal: isNicExternal,
    isNetAdmin: isNetAdmin,
    isNetExternal: isNetExternal,
    isNetInternal: isNetInternal
};
