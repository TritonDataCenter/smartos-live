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
 *
 * fwadm: CLI shared logic
 */

var fs = require('fs');
var tab = require('tab');
var tty = require('tty');
var util = require('util');
var verror = require('verror');



// --- Globals



var DEFAULT_FIELDS = ['uuid', 'enabled', 'rule'];
var DEFAULT_FIELD_WIDTHS = {
    created_by: 10,
    description: 15,
    enabled: 7,
    global: 6,
    owner_uuid: 36,
    rule: 20,
    uuid: 36,
    version: 20
};
// Have we output an error?
var OUTPUT_ERROR = false;
var UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;



// --- Exported functions



/**
 * Displays a list of firewall rules
 */
function displayRules(err, res, opts) {
    if (err) {
        return outputError(err, opts);
    }

    if (opts && opts.json) {
        return console.log(json(res));
    }

    var fields = opts.fields || DEFAULT_FIELDS;
    var tableOpts = {
        columns: [],
        omitHeader: opts.parseable || false,
        rows: []
    };

    if (opts.parseable) {
        tableOpts.columnSeparator = opts.delim || ':';
    }

    fields.forEach(function (f) {
        tableOpts.columns.push({
            align: 'left',
            label: f.toUpperCase(),
            // Parseable output: make all field widths 1, so that
            // there's no whitespace between them
            width: opts.parseable ? 1 : DEFAULT_FIELD_WIDTHS[f]
        });
    });

    res.forEach(function (r) {
        tableOpts.rows.push(fields.map(function (f, i) {
            if (!r[f]) {
                return '-';
            }

            var str = r[f].toString();
            if (tableOpts.columnSeparator) {
                str = str.split(tableOpts.columnSeparator).join(
                    '\\' + tableOpts.columnSeparator);
            }

            if (opts.parseable) {
                // We don't care about fixing the length for parseable
                // output: there's no spacing
                return str;
            }

            var len = str.length;
            if (len > tableOpts.columns[i].width) {
                tableOpts.columns[i].width = len;
            }

            return str;
        }));
    });

    tab.emitTable(tableOpts);
}


/**
 * Output an error and then exit
 */
function exitWithErr(err, opts) {
    outputError(err, opts);
    return process.exit(1);
}


/**
 * Reads the payload from one of: a file, stdin, a text argument
 */
function getPayload(opts, args, callback) {
    var file;
    if (opts && opts.file) {
        file = opts.file;
    }

    // If no file specified, try to find the rule from the commandline args
    if (!file && args.length > 0) {
        var payload = {
            rule: args.join(' ')
        };

        return callback(null, payload);
    }

    if (!file && !tty.isatty(0)) {
        file = '-';
    }

    if (!file) {
        return callback(new verror.VError('Must supply file!'));
    }

    if (file === '-') {
        file = '/dev/stdin';
    }

    fs.readFile(file, function (err, data) {
        if (err) {
            if (err.code === 'ENOENT') {
                return callback(new verror.VError(
                    'File "%s" does not exist.', file));
            }
            return callback(new verror.VError(
                'Error reading "%s": %s', file, err.message));
        }

        return callback(null, JSON.parse(data.toString()));
    });
}


/**
 * Have we output an error so far?
 */
function haveOutputErr() {
    return OUTPUT_ERROR;
}


/**
 * Pretty-print a JSON object
 */
function json(obj) {
    return JSON.stringify(obj, null, 2);
}


/**
 * Outputs an error to the console, displaying all of the error messages
 * if it's a MultiError
 */
function outputError(err, opts) {
    var errs = [ err ];

    OUTPUT_ERROR = true;
    if (err.hasOwnProperty('ase_errors')) {
        errs = err.ase_errors;
    }

    if (opts && opts.json) {
        return console.error(json({
            errors: errs.map(function (e) {
                var j = { message: e.message };
                if (e.hasOwnProperty('code')) {
                    j.code = e.code;
                }

                if (opts.verbose) {
                    j.stack = e.stack;
                }
                return j;
            })
        }));
    }

    errs.forEach(function (e) {
        console.error(e.message);
        if (opts && opts.verbose) {
            console.error(e.stack);
        }
    });
}


/**
 * Outputs one formatted rule line
 */
function ruleLine(r) {
    return util.format('%s %s %s', r.uuid,
        r.enabled ? 'true   ' : 'false  ', r.rule);
}


/**
 * Prints an error and exits if the UUID is invalid
 */
function validateUUID(arg) {
    if (!arg) {
        console.error('Error: missing UUID');
        process.exit(1);
    }
    if (!UUID_REGEX.test(arg)) {
        console.error('Error: invalid UUID "%s"', arg);
        process.exit(1);
    }
    return arg;
}



module.exports = {
    displayRules: displayRules,
    exitWithErr: exitWithErr,
    getPayload: getPayload,
    haveOutputErr : haveOutputErr,
    json: json,
    outputError: outputError,
    ruleLine: ruleLine,
    validateUUID: validateUUID
};
