/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

// ---- Internal

var RACK_RE = '(_rack_[A-Z0-9_-]+)?$';
var ADMIN_NAME = 'admin';
var MANTA_NAME = 'manta';
var EXTERNAL_NAME = 'external';
var INTERNAL_NAME = 'internal';

/*
 * TODO: prefer RFD 117 traits
 */
function _fromVmMetadataCommon(vm, what, network) {
    var re = new RegExp('^' + network + RACK_RE, 'i');
    var nics = vm.nics;

    for (var i = 0; i < nics.length; i++) {
        var nictag = nics[i].nic_tag;
        if (re.test(nictag)) {
            return nics[i][what];
        }
    }

    return null;
}

/*
 * TODO: prefer RFD 117 traits
 */
function _isNetNicCommon(nic, network) {
    var re = new RegExp('^' + network + RACK_RE, 'i');

    return re.test(nic.nic_tag);
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
 */
function adminIpFromSysinfo(sysinfo) {
    if (sysinfo['Admin IP']) {
        return sysinfo['Admin IP'];
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
