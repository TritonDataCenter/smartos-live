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

var objEmpty = require('./obj').objEmpty;
var VError = require('verror').VError;

function getIPs(n) {
    if (n.hasOwnProperty('ips')) {
        return n.ips.map(function (ip) {
            return ip.split('/')[0];
        });
    } else if (n.hasOwnProperty('ip')) {
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
    rvm.uuid = uuid;

    if (vm.hasOwnProperty('nics')) {
        ipsFromNICs(vm.nics).forEach(function (ip) {
            ips[ip] = 1;
        });
    }

    if (vm.hasOwnProperty('ips')) {
        vm.ips.forEach(function (ip) {
            ips[ip] = 1;
        });
    }

    if (objEmpty(ips)) {
        err = new VError(
            'Remote VM "%s": missing IPs', uuid);
        err.details = vm;
        throw err;
    }

    rvm.ips = Object.keys(ips).sort();

    if (vm.hasOwnProperty('tags') && !objEmpty(vm.tags)) {
        rvm.tags = {};
        for (var t in vm.tags) {
            rvm.tags[t] = vm.tags[t];
        }
    }

    if (vm.hasOwnProperty('owner_uuid')) {
        // XXX: validate UUID
        rvm.owner_uuid = vm.owner_uuid;
    }

    return rvm;
}


module.exports = {
    ipsFromNICs: ipsFromNICs,
    createRemoteVM: createRemoteVM
};
