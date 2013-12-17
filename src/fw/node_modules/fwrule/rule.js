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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * fwadm: firewall rule model
 */

var mod_uuid = require('node-uuid');
var parser = require('./parser');
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
    'owner_uuid',
    'rule',
    'uuid',
    'version'
];
// Maximum number of targets per side:
var MAX_TARGETS_PER_SIDE = 24;
// Maximum number of ports:
var MAX_PORTS = 8;
var STRING_PROPS = ['created_by', 'description'];
var TARGET_TYPES = ['wildcard', 'ip', 'subnet', 'tag', 'vm'];



// --- Internal functions



/**
 * Calls callback for all of the firewall target types
 */
function forEachTarget(obj, callback) {
    DIRECTIONS.forEach(function (dir) {
        if (!obj.hasOwnProperty(dir)) {
            return;
        }

        TARGET_TYPES.forEach(function (type) {
            var name = type + 's';
            if (!obj[dir].hasOwnProperty(name)) {
                return;
            }

            callback(dir, type, type, obj[dir][name]);
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
    if (!obj.hasOwnProperty(tag)) {
        obj[tag] = {};
    }

    if (val === undefined || val === null) {
        obj[tag].all = true;
        return;
    }

    if (!obj[tag].hasOwnProperty('values')) {
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
        if (obj[tag].hasOwnProperty('all')) {
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
 * Quotes a string if it contains non-alphanumeric characters
 */
function quote(str) {
    var WORD_RE = /[^-a-zA-Z0-9_]/;
    if (str.search(WORD_RE) !== -1) {
        return '"' + str + '"';
    }

    return str;
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
            parsed = data.parsed || parser.parse(data.rule);
        } catch (err) {
            errs.push(err);
        }
    }

    if (data.hasOwnProperty('uuid')) {
        if (!validators.validateUUID(data.uuid)) {
            errs.push(new validators.InvalidParamError('uuid',
                'Invalid rule UUID'));
        }

        this.uuid = data.uuid;
    } else {
        this.uuid = mod_uuid.v4();
    }

    this.version = data.version || generateVersion();

    if (data.hasOwnProperty('owner_uuid')) {
        if (!validators.validateUUID(data.owner_uuid)) {
            errs.push(new validators.InvalidParamError('owner_uuid',
                'Invalid owner UUID'));
        }
        this.owner_uuid = data.owner_uuid;
    } else {
        // No owner: this rule will affect all VMs
        this.global = true;
    }

    if (data.hasOwnProperty('enabled')) {
        if (!validators.bool(data.enabled)) {
            errs.push(new validators.InvalidParamError('enabled',
                'enabled must be true or false'));
        }

        this.enabled = data.enabled;
    } else {
        this.enabled = false;
    }

    for (var s in STRING_PROPS) {
        var str = STRING_PROPS[s];
        if (data.hasOwnProperty(str)) {
            try {
                validators.validateString(str, data[str]);
                this[str] = data[str];
            } catch (valErr) {
                errs.push(valErr);
            }
        }
    }

    if (opts.enforceGlobal) {
        if (data.hasOwnProperty('global') && !validators.bool(data.global)) {
            errs.push(new validators.InvalidParamError('global',
                'global must be true or false'));
        }

        if (data.hasOwnProperty('global')
            && data.hasOwnProperty('owner_uuid') && data.global) {
            errs.push(new validators.InvalidParamError('global',
                'cannot specify both global and owner_uuid'));
        }

        if (!data.hasOwnProperty('global')
            && !data.hasOwnProperty('owner_uuid')) {
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
    this.protocol = parsed.protocol.name;

    if (this.protocol === 'icmp') {
        this.types = icmpTypeSort(parsed.protocol.targets);
        this.protoTargets = this.types;
    } else {
        this.ports = parsed.protocol.targets.sort(function (a, b) {
            return Number(a) - Number(b);
        });
        this.protoTargets = this.ports;
    }

    if (this.protoTargets.length > MAX_PORTS) {
        throw new validators.InvalidParamError('rule',
            'maximum of %d %s allowed',
            MAX_TARGETS_PER_SIDE,
            this.protocol == 'icmp' ? 'types' : 'ports');
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
            if (!dirs[dir].hasOwnProperty(name)) {
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
            if (dirs[dir].hasOwnProperty(type)) {
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
        from: this.from,
        protocol: this.protocol,
        to: this.to,
        uuid: this.uuid,
        version: this.version
    };

    if (this.owner_uuid) {
        raw.owner_uuid = this.owner_uuid;
    }

    if (this.protocol === 'icmp') {
        raw.types = this.types;
    } else {
        raw.ports = this.ports;
    }

    for (var s in STRING_PROPS) {
        var str = STRING_PROPS[s];
        if (this.hasOwnProperty(str)) {
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
            if (this.hasOwnProperty(field)) {
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
    var protoTxt;
    var targets = {
        from: [],
        to: []
    };

    forEachTarget(this, function (dir, type, name, arr) {
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
    if (this.protocol === 'icmp') {
        protoTxt = util.format('%sTYPE %s%s',
            this.types.length > 1 ? '(' : '',
            this.types.map(function (type) {
                return type.toString().split(':');
            }).map(function (code) {
                return code[0] + (code.length === 1 ? '' : ' CODE ' + code[1]);
            }).join(' AND TYPE '),
            this.types.length > 1 ? ')' : ''
        );
    } else {
        protoTxt = util.format('%sPORT %s%s',
            this.ports.length > 1 ? '(' : '',
            this.ports.join(' AND PORT '),
            this.ports.length > 1 ? ')' : ''
        );
    }

    return util.format('FROM %s%s%s TO %s%s%s %s %s',
            targets.from.length > 1 ? '(' : '',
            targets.from.join(' OR '),
            targets.from.length > 1 ? ')' : '',
            targets.to.length > 1 ? '(' : '',
            targets.to.join(' OR '),
            targets.to.length > 1 ? ')' : '',
            this.action.toUpperCase(),
            this.protocol.toLowerCase(),
            protoTxt
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
    DIRECTIONS: DIRECTIONS,
    FIELDS: FIELDS,
    FwRule: FwRule,
    TARGET_TYPES: TARGET_TYPES
};
