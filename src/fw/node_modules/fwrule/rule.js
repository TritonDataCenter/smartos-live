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
 * Copyright (c) 2019, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: firewall rule model
 */

'use strict';

var mod_net = require('net');
var mod_uuid = require('uuid');
var sprintf = require('extsprintf').sprintf;
var util = require('util');
var validators = require('./validators');
var verror = require('verror');



// --- Globals



var DIRECTIONS = ['to', 'from'];
// Exported fields that can be in the serialized rule:
var FIELDS = [
    'created_by',
    'description',
    'enabled',
    'global',
    'log',
    'owner_uuid',
    'rule',
    'uuid',
    'version'
];
// Maximum number of targets per side:
var MAX_TARGETS_PER_SIDE = 24;
// Maximum number of protocol targets:
var MAX_PROTOCOL_TARGETS = 24;
// Minimum version for using a larger list of protocol targets:
var MINVER_LGPROTOTARG = 4;
// The old maximum number of protocol targets:
var OLD_MAX_PORTS = 8;
var STRING_PROPS = ['created_by', 'description'];
var TARGET_TYPES = ['wildcard', 'ip', 'subnet', 'tag', 'vm'];

var icmpr = /^icmp6?$/;

// --- Internal functions


/**
 * Safely check if an object has a property
 */
function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}


/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
    DIRECTIONS.forEach(function (dir) {
        if (!hasOwnProperty(obj, dir)) {
            return;
        }

        TARGET_TYPES.forEach(function (type) {
            var name = type + 's';
            if (!hasOwnProperty(obj[dir], name)) {
                return;
            }

            callback(dir, type, name, obj[dir][name]);
        });
    });
}


/**
 * Sorts a list of ICMP types (with optional codes)
 */
function icmpTypeSort(types) {
    return types.map(function (type) {
        return type.toString().split(':');
    }).sort(function (a, b) {
        var aTot = (Number(a[0]) << 8) + (a.length === 1 ? 0 : Number(a[1]));
        var bTot = (Number(b[0]) << 8) + (a.length === 1 ? 0 : Number(b[1]));
        return aTot - bTot;
    }).map(function (typeArr) {
        return typeArr.join(':');
    });
}


/**
 * Adds a tag to an object
 */
function addTag(obj, tag, val) {
    if (!hasOwnProperty(obj, tag)) {
        obj[tag] = {};
    }

    if (val === undefined || val === null) {
        obj[tag].all = true;
        return;
    }

    if (!hasOwnProperty(obj[tag], 'values')) {
        obj[tag].values = {};
    }

    obj[tag].values[val] = true;
}


/**
 * Creates a list of tags based on an object populated by addTag() above
 */
function tagList(obj) {
    var tags = [];
    Object.keys(obj).sort().forEach(function (tag) {
        if (hasOwnProperty(obj[tag], 'all')) {
            tags.push(tag);
        } else {
            Object.keys(obj[tag].values).sort().forEach(function (val) {
                tags.push([tag, val]);
            });
        }
    });
    return tags;
}


/**
 * The following characters are allowed to come after an escape, and get
 * escaped when producing rule text.
 *
 * Parentheses don't need to be escaped with newer parsers, but will cause
 * errors with older parsers which expect them to be escaped. We therefore
 * always escape them when generating rule text, to make sure we don't
 * cause issues for older parsers.
 */
var escapes = {
    '"': '"',
    'b': '\b',
    'f': '\f',
    'n': '\n',
    'r': '\r',
    't': '\t',
    '/': '/',
    '(': '(',
    ')': ')',
    '\\': '\\'
};


/**
 * When producing text versions of a rule, we escape Unicode whitespace
 * characters. These characters don't need to be escaped, but we do so
 * to reduce the chance that an operator will look at a rule and mistake
 * any of them for the ASCII space character (\u0020), or not see them
 * because they're non-printing.
 */
var unescapes = {
    // Things that need to be escaped for the fwrule parser
    '"': '"',
    '(': '(',
    ')': ')',
    '\\': '\\',

    // Special ASCII characters we don't want to print
    '\u0000': 'u0000', // null (NUL)
    '\u0001': 'u0001', // start of heading (SOH)
    '\u0002': 'u0002', // start of text (STX)
    '\u0003': 'u0003', // end of text (ETX)
    '\u0004': 'u0004', // end of transmission (EOT)
    '\u0005': 'u0005', // enquiry (ENQ)
    '\u0006': 'u0006', // acknowledgement (ACK)
    '\u0007': 'u0007', // bell (BEL)
    '\u0008': 'b',     // backspace (BS)
    '\u0009': 't',     // horizontal tab (HT)
    '\u000A': 'n',     // newline (NL)
    '\u000B': 'u000B', // vertical tab (VT)
    '\u000C': 'f',     // form feed/next page (NP)
    '\u000D': 'r',     // carriage return (CR)
    '\u000E': 'u000E', // shift out (SO)
    '\u000F': 'u000F', // shift in (SI)
    '\u0010': 'u0010', // data link escape (DLE)
    '\u0011': 'u0011', // device control 1 (DC1)/XON
    '\u0012': 'u0012', // device control 2 (DC2)
    '\u0013': 'u0013', // device control 3 (DC3)/XOFF
    '\u0014': 'u0014', // device control 4 (DC4)
    '\u0015': 'u0015', // negative acknowledgement (NAK)
    '\u0016': 'u0016', // synchronous idle (SYN)
    '\u0017': 'u0017', // end of transmission block (ETB)
    '\u0018': 'u0018', // cancel (CAN)
    '\u0019': 'u0019', // end of medium (EM)
    '\u001A': 'u001A', // substitute (SUB)
    '\u001B': 'u001B', // escape (ESC)
    '\u001C': 'u001C', // file separator (FS)
    '\u001D': 'u001D', // group separator (GS)
    '\u001E': 'u001E', // record separator (RS)
    '\u001F': 'u001F', // unit separator (US)
    '\u007F': 'u007F', // delete (DEL)

    // Unicode whitespace characters
    '\u0085': 'u0085', // next line
    '\u00A0': 'u00A0', // non-breaking space
    '\u1680': 'u1680', // ogham space mark
    '\u180E': 'u180E', // mongolian vowel separator
    '\u2000': 'u2000', // en quad
    '\u2001': 'u2001', // em quad
    '\u2002': 'u2002', // en space
    '\u2003': 'u2003', // em space
    '\u2004': 'u2004', // three-per-em space
    '\u2005': 'u2005', // four-per-em space
    '\u2006': 'u2006', // six-per-em space
    '\u2007': 'u2007', // figure space
    '\u2008': 'u2008', // punctuation space
    '\u2009': 'u2009', // thin space
    '\u200A': 'u200A', // hair space
    '\u200B': 'u200B', // zero width space
    '\u200C': 'u200C', // zero width non-joiner
    '\u200D': 'u200D', // zero width joiner
    '\u2028': 'u2028', // line separator
    '\u2029': 'u2029', // paragraph separator
    '\u202F': 'u202F', // narrow no-break space
    '\u205F': 'u205F', // medium mathematical space
    '\u2060': 'u2060', // word joiner
    '\u3000': 'u3000', // ideographic space
    '\uFEFF': 'uFEFF'  // zero width no-break space
};


/**
 * Unescape a string that's been escaped so that it can be used
 * in a firewall rule.
 */
function tagUnescape(ostr) {
    var nstr = '';
    var len = ostr.length;

    for (var cur = 0; cur < len; cur += 1) {
        var val = ostr[cur];
        if (val === '\\') {
            var escaped = ostr[cur + 1];
            if (escaped === 'u') {
                nstr += String.fromCharCode(
                    parseInt(ostr.substring(cur + 2, cur + 6), 16));
                cur += 5;
            } else if (escapes[escaped] !== undefined) {
                nstr += escapes[escaped];
                cur += 1;
            } else {
                throw new Error('Invalid escape sequence "\\' + escaped + '"!');
            }
        } else {
            nstr += val;
        }
    }

    return nstr;
}


/**
 * Escape a string so that it can be placed, quoted, into a
 * firewall rule.
 */
function tagEscape(ostr) {
    var nstr = '';
    var len = ostr.length;

    for (var cur = 0; cur < len; cur += 1) {
        var val = ostr[cur];
        if (unescapes[val] !== undefined) {
            nstr += '\\' + unescapes[val];
        } else {
            nstr += val;
        }
    }

    return nstr;
}


/**
 * Quotes a string in case it contains non-alphanumeric
 * characters or keywords for firewall rules.
 */
function quote(str) {
    return '"' + tagEscape(str) + '"';
}



// --- Firewall object and methods



/**
 * Firewall rule constructor
 */
function FwRule(data, opts) {
    var errs = [];
    var parsed;

    if (!opts) {
        opts = {};
    }

    // -- validation --

    if (!data.rule && !data.parsed) {
        errs.push(new validators.InvalidParamError('rule',
            'No rule specified'));
    } else {
        try {
            parsed = data.parsed || require('./').parse(data.rule, opts);
        } catch (err) {
            errs.push(err);
        }
    }

    if (hasOwnProperty(data, 'uuid')) {
        if (!validators.validateUUID(data.uuid)) {
            errs.push(new validators.InvalidParamError('uuid',
                'Invalid rule UUID'));
        }

        this.uuid = data.uuid;
    } else {
        this.uuid = mod_uuid.v4();
    }

    this.version = data.version || generateVersion();

    if (hasOwnProperty(data, 'owner_uuid')) {
        if (!validators.validateUUID(data.owner_uuid)) {
            errs.push(new validators.InvalidParamError('owner_uuid',
                'Invalid owner UUID'));
        }
        this.owner_uuid = data.owner_uuid;
    } else {
        // No owner: this rule will affect all VMs
        this.global = true;
    }

    if (hasOwnProperty(data, 'enabled')) {
        if (!validators.bool(data.enabled)) {
            errs.push(new validators.InvalidParamError('enabled',
                'enabled must be true or false'));
        }

        this.enabled = data.enabled;
    } else {
        this.enabled = false;
    }

    if (hasOwnProperty(data, 'log')) {
        if (!validators.bool(data.log)) {
            errs.push(new validators.InvalidParamError('log',
                'log must be true or false'));
        }

        this.log = data.log;
    } else {
        this.log = false;
    }


    for (var s in STRING_PROPS) {
        var str = STRING_PROPS[s];
        if (hasOwnProperty(data, str)) {
            try {
                validators.validateString(str, data[str]);
                this[str] = data[str];
            } catch (valErr) {
                errs.push(valErr);
            }
        }
    }

    if (opts.enforceGlobal) {
        if (hasOwnProperty(data, 'global') && !validators.bool(data.global)) {
            errs.push(new validators.InvalidParamError('global',
                'global must be true or false'));
        }

        if (hasOwnProperty(data, 'global') &&
            hasOwnProperty(data, 'owner_uuid') && data.global) {
            errs.push(new validators.InvalidParamError('global',
                'cannot specify both global and owner_uuid'));
        }

        if (!hasOwnProperty(data, 'global') &&
            !hasOwnProperty(data, 'owner_uuid')) {
            errs.push(new validators.InvalidParamError('owner_uuid',
                'owner_uuid required'));
        }
    }

    if (errs.length !== 0) {
        if (errs.length === 1) {
            throw errs[0];
        }

        throw new verror.MultiError(errs);
    }

    // -- translate into the internal rule format --

    var d;
    var dir;

    this.action = parsed.action;
    this.priority = parsed.priority || 0;
    this.protocol = parsed.protocol.name;

    switch (this.protocol) {
    case 'icmp':
    case 'icmp6':
        this.types = icmpTypeSort(parsed.protocol.targets);
        this.protoTargets = this.types;
        break;
    case 'ah':
    case 'esp':
        this.protoTargets = parsed.protocol.targets;
        break;
    case 'tcp':
    case 'udp':
        this.ports = parsed.protocol.targets.sort(function (a, b) {
            var first = hasOwnProperty(a, 'start') ? a.start : a;
            var second = hasOwnProperty(b, 'start') ? b.start : b;
            return Number(first) - Number(second);
        });
        this.protoTargets = this.ports;
        break;
    default:
        throw new validators.InvalidParamError('rule',
            'unknown protocol "%s"', this.protocol);
    }

    if (opts.maxVersion < MINVER_LGPROTOTARG) {
        if (this.protoTargets.length > OLD_MAX_PORTS) {
            throw new validators.InvalidParamError('rule',
                'maximum of %d %s allowed', OLD_MAX_PORTS,
                icmpr.test(this.protocol) ? 'types' : 'ports');
        }
    } else if (this.protoTargets.length > MAX_PROTOCOL_TARGETS) {
        throw new validators.InvalidParamError('rule',
            'maximum of %d %s allowed', MAX_PROTOCOL_TARGETS,
            icmpr.test(this.protocol) ? 'types' : 'ports');
    }

    this.from = {};
    this.to = {};

    this.allVMs = false;
    this.ips = {};
    this.tags = {};
    this.vms = {};
    this.subnets = {};
    this.wildcards = {};

    var dirs = {
        'to': {},
        'from': {}
    };
    var numTargets;

    for (d in DIRECTIONS) {
        dir = DIRECTIONS[d];
        numTargets = 0;
        for (var j in parsed[dir]) {
            var target = parsed[dir][j];
            var targetName;
            var name = target[0] + 's';

            numTargets++;
            if (!hasOwnProperty(dirs[dir], name)) {
                dirs[dir][name] = {};
            }

            if (name === 'tags') {
                var targetVal = null;
                if (typeof (target[1]) === 'string') {
                    targetName = target[1];
                } else {
                    targetName = target[1][0];
                    targetVal = target[1][1];
                }

                addTag(this[name], targetName, targetVal);
                addTag(dirs[dir][name], targetName, targetVal);

            } else {
                targetName = target[1];
                this[name][targetName] = target[1];
                dirs[dir][name][targetName] = target[1];
            }
        }

        if (numTargets > MAX_TARGETS_PER_SIDE) {
            throw new validators.InvalidParamError('rule',
                'maximum of %d targets allowed per side',
                MAX_TARGETS_PER_SIDE);
        }
    }

    // Now dedup and sort
    for (d in DIRECTIONS) {
        dir = DIRECTIONS[d];
        for (var t in TARGET_TYPES) {
            var type = TARGET_TYPES[t] + 's';
            if (hasOwnProperty(dirs[dir], type)) {
                if (type === 'tags') {
                    this[dir][type] = tagList(dirs[dir][type]);

                } else {
                    this[dir][type] = Object.keys(dirs[dir][type]).sort();
                }
            } else {
                this[dir][type] = [];
            }
        }
    }

    this.ips = Object.keys(this.ips).sort();
    this.tags = tagList(this.tags);
    this.vms = Object.keys(this.vms).sort();
    this.subnets = Object.keys(this.subnets).sort();
    this.wildcards = Object.keys(this.wildcards).sort();

    if (this.wildcards.length !== 0 && this.wildcards.indexOf('vmall') !== -1) {
        this.allVMs = true;
    }

    // Check for rules that obviously don't make sense
    if (this.protocol === 'icmp') {
        this.ips.map(function (ip) {
            if (!mod_net.isIPv4(ip)) {
                throw new validators.InvalidParamError('rule',
                    'rule affects ICMPv4 but contains a non-IPv4 address');
            }
        });
        this.subnets.map(function (subnet) {
            if (!mod_net.isIPv4(subnet.split('/')[0])) {
                throw new validators.InvalidParamError('rule',
                    'rule affects ICMPv4 but contains a non-IPv4 subnet');
            }
        });
    } else if (this.protocol === 'icmp6') {
        this.ips.map(function (ip) {
            if (!mod_net.isIPv6(ip)) {
                throw new validators.InvalidParamError('rule',
                    'rule affects ICMPv6 but contains a non-IPv6 address');
            }
        });
        this.subnets.map(function (subnet) {
            if (!mod_net.isIPv6(subnet.split('/')[0])) {
                throw new validators.InvalidParamError('rule',
                    'rule affects ICMPv6 but contains a non-IPv6 subnet');
            }
        });
    }

    // Final check: does this rule actually contain targets that can actually
    // affect VMs?
    if (!this.allVMs && this.tags.length === 0 && this.vms.length === 0) {
        throw new validators.InvalidParamError('rule',
            'rule does not affect VMs');
    }
}


/**
 * Returns the internal representation of the rule
 */
FwRule.prototype.raw = function () {
    var raw = {
        action: this.action,
        enabled: this.enabled,
        log: this.log,
        from: this.from,
        priority: this.priority,
        protocol: this.protocol,
        to: this.to,
        uuid: this.uuid,
        version: this.version
    };

    if (this.owner_uuid) {
        raw.owner_uuid = this.owner_uuid;
    }

    switch (this.protocol) {
    case 'icmp':
    case 'icmp6':
        raw.types = this.types;
        break;
    case 'ah':
    case 'esp':
        break;
    case 'tcp':
    case 'udp':
        raw.ports = this.ports;
        break;
    default:
        throw new Error('unknown protocol: ' + this.protocol);
    }

    for (var s in STRING_PROPS) {
        var str = STRING_PROPS[s];
        if (hasOwnProperty(this, str)) {
            raw[str] = this[str];
        }
    }

    return raw;
};


/**
 * Returns the serialized version of the rule, suitable for storing
 *
 * @param fields {Array}: fields to return (optional)
 */
FwRule.prototype.serialize = function (fields) {
    var ser = {};
    if (!fields) {
        fields = FIELDS;
    }

    for (var f in fields) {
        var field = fields[f];
        if (field === 'rule') {
            ser.rule = this.text();
        } else if (field === 'global') {
            // Only display the global flag if true
            if (this.global) {
                ser.global = true;
            }
        } else {
            if (hasOwnProperty(this, field)) {
                ser[field] = this[field];
            }
        }
    }

    return ser;
};


/**
 * Returns the text of the rule
 */
FwRule.prototype.text = function () {
    var containsRange;
    var ports;
    var protoTxt;
    var prioTxt = '';
    var targets = {
        from: [],
        to: []
    };

    forEachTarget(this, function (dir, type, _, arr) {
        for (var i in arr) {
            var txt;
            if (type === 'tag') {
                txt = util.format('%s %s', type,
                    typeof (arr[i]) === 'string' ? quote(arr[i])
                    : (quote(arr[i][0]) + ' = ' + quote(arr[i][1])));
            } else {
                txt = util.format('%s %s', type, arr[i]);
            }

            if (type === 'wildcard') {
                txt = arr[i] === 'vmall' ? 'all vms' : arr[i];
            }
            targets[dir].push(txt);
        }
    });

    // Protocol-specific text: different for ICMP rather than TCP/UDP
    switch (this.protocol) {
    case 'icmp':
    case 'icmp6':
        protoTxt = util.format(' %sTYPE %s%s',
            this.types.length > 1 ? '(' : '',
            this.types.map(function (type) {
                return type.toString().split(':');
            }).map(function (code) {
                return code[0] + (code.length === 1 ? '' : ' CODE ' + code[1]);
            }).join(' AND TYPE '),
            this.types.length > 1 ? ')' : ''
        );
        break;
    case 'ah':
    case 'esp':
        protoTxt = '';
        break;
    case 'tcp':
    case 'udp':
        ports = this.ports.map(function (port) {
            if (hasOwnProperty(port, 'start') &&
                hasOwnProperty(port, 'end')) {
                /*
                 * We only output PORTS when we have a range, since we don't
                 * distinguish PORTS 1, 2 from (PORT 1 AND PORT 2) after
                 * parsing.
                 */
                containsRange = true;
                return port.start + ' - ' + port.end;
            } else {
                return port;
            }
        });
        if (containsRange) {
            protoTxt = util.format(' PORTS %s', ports.join(', '));
        } else {
            protoTxt = util.format(' %sPORT %s%s',
                ports.length > 1 ? '(' : '',
                ports.join(' AND PORT '),
                ports.length > 1 ? ')' : ''
            );
        }
        break;
    default:
        throw new Error('unknown protocol: ' + this.protocol);
    }

    if (this.priority > 0) {
        prioTxt += ' PRIORITY ' + this.priority.toString();
    }

    return util.format('FROM %s%s%s TO %s%s%s %s %s%s%s',
            targets.from.length > 1 ? '(' : '',
            targets.from.join(' OR '),
            targets.from.length > 1 ? ')' : '',
            targets.to.length > 1 ? '(' : '',
            targets.to.join(' OR '),
            targets.to.length > 1 ? ')' : '',
            this.action.toUpperCase(),
            this.protocol.toLowerCase(),
            protoTxt,
            prioTxt
    );
};


/**
 * Returns the string representation of the rule
 */
FwRule.prototype.toString = function () {
    return util.format('[%s,%s%s] %s', this.uuid, this.enabled,
            (this.owner_uuid ? ',' + this.owner_uuid : ''),
            this.text());
};



// --- Exported functions



/**
 * Creates a new firewall rule from the payload
 */
function createRule(payload, opts) {
    return new FwRule(payload, opts);
}


function generateVersion() {
    return Date.now(0) + '.' + sprintf('%06d', process.pid);
}

module.exports = {
    create: createRule,
    generateVersion: generateVersion,
    tagEscape: tagEscape,
    tagUnescape: tagUnescape,
    DIRECTIONS: DIRECTIONS,
    FIELDS: FIELDS,
    FwRule: FwRule,
    TARGET_TYPES: TARGET_TYPES
};
