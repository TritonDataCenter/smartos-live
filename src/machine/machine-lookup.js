#!/usr/bin/node
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
 * Copyright (c) 2011 Joyent Inc., All rights reserved.
 *
 * SUMMARY
 *
 * Lookup a machine's zonename using some property.  Currently supported
 * properties are IP Address and MAC Address.
 *
 * EXAMPLE
 *
 * [root@headnode (coal:0) ~]# machine-lookup -m 2:8:20:d2:5d:30; echo "retval: $?"
 * mapi
 * retval: 0
 * [root@headnode (coal:0) ~]# machine-lookup -m 2:8:20:d2:5d:6; echo "retval: $?"
 * retval: 1
 * [root@headnode (coal:0) ~]#
 *
 * EXIT STATUS
 *
 *  0  - at least one machine matched the criteria
 *  1  - no machines matched the criteria
 *  >1 - error checking machines against criteria
 *
 */


var async = require('async');
var cp = require('child_process');
var exec = cp.exec;
var onlyif = require('onlyif');
var sprintf = require('sprintf').sprintf;


function usage()
{
    console.log("Usage:", process.argv[1], "<-m|-i> <key>");
    process.exit(2);
}

function ltrim(str, chars) {
    chars = chars || "\\s";
    str = str || "";
    return str.replace(new RegExp("^[" + chars + "]+", "g"), "");
}

function rtrim(str, chars) {
    chars = chars || "\\s";
    str = str || "";
    return str.replace(new RegExp("[" + chars + "]+$", "g"), "");
}

function trim(str, chars)
{
    return ltrim(rtrim(str, chars), chars);
}

/*
 * This fixes MAC addresses to standard form xx:xx:xx:xx:xx:xx
 * since some SmartOS tools (unfortunately) remove leading zeros.
 *
 */
function fixMac(str)
{
    var octet;
    var octets = str.split(':');
    var fixed = [];

    for (octet in octets) {
        if (octets.hasOwnProperty(octet)) {
            fixed.push(sprintf("%02x", parseInt(octets[octet], 16)));
        }
    }

    return fixed.join(':');
}

function isMac(str)
{
    var pattern;
    pattern = /^[0-9a-fA-F]{1,2}:[0-9a-fA-F]{1,2}:[0-9a-fA-F]{1,2}:[0-9a-fA-F]{1,2}:[0-9a-fA-F]{1,2}:[0-9a-fA-F]{1,2}$/;
    if (str.match(pattern)) {
        return true;
    } else {
        return false;
    }
}

function isIp(str)
{
    var pattern;
    var octet;
    var octets;

    pattern = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
    if (!str.match(pattern)) {
        return false;
    }

    octets = str.split('.');
    for (octet in octets) {
        if (octets.hasOwnProperty(octet)) {
            if (Number(octets[octet]) > 255) {
                return false;
            }
        }
    }

    return true;
}

function forEachMachine(func, callback)
{
    cmd = '/usr/sbin/zoneadm list -c';

    exec(cmd, function (err, stdout, stderr) {
        var idx, zone, zones;
        if (err) {
            return callback(rtrim(stderr));
        }
        zones = rtrim(stdout).split('\n');

        // remove global
        idx = zones.indexOf('global');
        if (idx !== -1) {
            zones.splice(idx, 1);
        }

        async.forEach(zones, func, function(err) {
            return callback(err);
        });
    });
}

function getZoneMacs(zonename, callback)
{
    var mac;
    var cmd = '/usr/sbin/zonecfg -z ' + zonename + ' info net';

    exec(cmd, function (err, stdout, stderr) {
        var line;
        var lines = trim(stdout).split('\n');
        var mac;
        var macs = [];

        for (line in lines) {
            if (lines.hasOwnProperty(line)) {
                line = trim(lines[line]);
                mac = line.match(/^mac-addr: ([0-9a-zA-Z\:]+)$/);
                if (mac) {
                    macs.push(fixMac(mac[1]));
                }
            }
        }
        callback(null, macs);
    });
}

function getZoneIps(zonename, callback)
{
    var ip;
    var cmd = '/usr/sbin/zonecfg -z ' + zonename + ' info net';

    exec(cmd, function (err, stdout, stderr) {
        var line;
        var lines = trim(stdout).split('\n');
        var ip;
        var ips = [];

        for (line in lines) {
            if (lines.hasOwnProperty(line)) {
                line = trim(lines[line]);
                ip = line.match(/^property: \(name=ip,value=\"([^\"]+)\"\)$/);
                if (ip) {
                    ips.push(ip[1]);
                }
            }
        }
        callback(null, ips);
    });
}

function main()
{
    var getter;
    var needle;
    var found = false;

    // TODO: better arg processing
    if ((process.argv.length !== 4) ||
        (['-h', '-i', '-m', '-?'].indexOf(process.argv[2]) === -1)) {
        usage();
    }

    switch (process.argv[2])
    {
    case '-i':
        getter = getZoneIps;
        needle = process.argv[3];
        if (!isIp(needle)) {
            console.log('Bad Input: must supply IP address');
            usage();
        }
        break;
    case '-m':
        getter = getZoneMacs;
        needle = fixMac(process.argv[3]);
        if (!isMac(needle)) {
            console.log('Bad Input: must supply MAC address');
            usage();
        }
        break;
    default:
        console.log('Internal Error:', "don't know how to search for",
            process.argv[2]);
        usage();
        break;
    }

    // console.log('searching for:', needle);

    forEachMachine(
        function (z, callback) {
            getter(z, function (err, values) {
                if (!err && values.indexOf(needle) !== -1)  {
                    // found the needle in zone 'z'!
                    console.log(z);
                    found = true;
                }
                callback();
            });
        },
        function(err) {
            if (err) {
                console.log("Internal Error:", err);
                process.exit(2);
            }
            if (found) {
                process.exit(0);
            }
            process.exit(1);
        }
    );
}

onlyif.rootInSmartosGlobal(function(err) {
    if (err) {
        console.log('Fatal: cannot run because: ' + err);
        process.exit(2);
    }
    main();
});
