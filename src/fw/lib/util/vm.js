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
 * Copyright (c) 2016, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: shared VM logic
 */

var mod_net = require('net');
var mod_obj = require('./obj');
var VError = require('verror').VError;


var objEmpty = mod_obj.objEmpty;
var hasKey = mod_obj.hasKey;


var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;


function validUUID(uuid) {
    return UUID_REGEX.test(uuid);
}


function getIPs(n) {
    if (hasKey(n, 'ips')) {
        return n.ips.map(function (ip) {
            return ip.split('/')[0];
        });
    } else if (hasKey(n, 'ip')) {
        return [n.ip];
    } else {
        return [];
    }
}

function concat(acc, curr) {
    return acc.concat(curr);
}

function notAuto(i) {
    return (i !== 'dhcp') && (i !== 'addrconf');
}



// --- Exports

/**
 * Get all of the IP addresses on the provided NICs
 */
function ipsFromNICs(nics) {
    return nics.map(getIPs).reduce(concat, []).filter(notAuto);
}


/**
 * Creates a remote VM object based on a VM.js VM object
 */
function createRemoteVM(vm) {
    var err;
    var ips = {};
    var rvm = {};
    var uuid = vm.uuid;

    if (!uuid) {
        err = new VError('Remote VM must have UUID');
        err.details = vm;
        throw err;
    }

    if (!validUUID(uuid)) {
        err = new VError('Invalid Remote VM UUID: %s', uuid);
        err.details = vm;
        throw err;
    }

    rvm.uuid = uuid;

    if (hasKey(vm, 'nics')) {
        ipsFromNICs(vm.nics).forEach(function (ip) {
            ips[ip] = 1;
        });
    }

    if (hasKey(vm, 'ips')) {
        vm.ips.forEach(function (ip) {
            ips[ip] = 1;
        });
    }

    rvm.ips = Object.keys(ips).sort();

    rvm.ips.forEach(function (ip) {
        if (!mod_net.isIPv4(ip) && !mod_net.isIPv6(ip)) {
            err = new VError('Invalid IP address: %s', ip);
            err.details = vm;
            throw err;
        }
    });

    if (hasKey(vm, 'tags') && !objEmpty(vm.tags)) {
        rvm.tags = {};
        for (var t in vm.tags) {
            rvm.tags[t] = vm.tags[t];
        }
    }

    if (hasKey(vm, 'owner_uuid')) {
        if (!validUUID(vm.owner_uuid)) {
            err = new VError('Invalid owner UUID: %s', vm.owner_uuid);
            err.details = vm;
            throw err;
        }
        rvm.owner_uuid = vm.owner_uuid;
    }

    return rvm;
}


module.exports = {
    ipsFromNICs: ipsFromNICs,
    createRemoteVM: createRemoteVM
};
