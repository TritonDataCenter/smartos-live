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
 * * *
 * imgadm configuration:
 *
 * - `userAgentExtra`: Optional string appended to user-agent used for
 *   remote requests.
 * - `upgradedToVer`: Current imgadm DB version. This is controlled
 *   by "upgrade.js".
 * - `sources`: Array of image source objects. Controlled by "*source*"
 *   methods in "imgadm.js".
 * - `dockerImportSkipUuids`: Optional boolean (default true). If set
 *   false, then calls of `DockerSource.getImportInfo` will not skip
 *   a given argument that is a UUID. This is true by default to avoid
 *   querying a docker source for import info for arguments (UUIDs) that
 *   are almost certainly not Docker image ids. Having this be
 *   configurable is mostly an out in case a valid case come ups with
 *   a docker repo that is a UUID.
 */

var p = console.warn;

var assert = require('assert-plus');
var format = require('util').format;
var fs = require('fs');
var mkdirp = require('mkdirp');
var path = require('path');

var common = require('./common');
var errors = require('./errors');



// ---- globals

var CONFIG_PATH = common.DB_DIR + '/imgadm.conf';

var DEFAULT_CONFIG = {
    dockerImportSkipUuids: true
};



// ---- config routines

/**
 * @param opts {Object}
 *      - log {Bunyan logger}
 * @param cb {Function} `function (err, config)`.
 */
function loadConfig(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    var config = common.objCopy(DEFAULT_CONFIG);
    fs.exists(CONFIG_PATH, function (exists) {
        if (!exists) {
            cb(null, config);
            return;
        }
        opts.log.trace({path: CONFIG_PATH}, 'read config file');
        fs.readFile(CONFIG_PATH, 'utf8', function (err, content) {
            try {
                var fileConfig = JSON.parse(content);
            } catch (e) {
                cb(new errors.ConfigError(e, format(
                    'config file "%s" is not valid JSON', CONFIG_PATH)));
                return;
            }
            Object.keys(fileConfig).forEach(function (k) {
                config[k] = fileConfig[k];
            });
            cb(null, config);
        });
    });
}


/**
 * Save out the current config.
 *
 * Dev Note: This *does* write out `DEFAULT_CONFIG` vars. That should be fine
 * for now.
 *
 * @param opts {Object}
 *      - config {Object} The configuration to save.
 *      - log {Bunyan logger}
 * @param cb {Function} `function (err)`
 */
function saveConfig(opts, cb) {
    assert.object(opts, 'opts');
    assert.object(opts.config, 'opts.config');
    assert.object(opts.log, 'opts.log');
    assert.func(cb, 'cb');

    opts.log.debug({config: opts.config}, 'save config to %s', CONFIG_PATH);
    var configDir = path.dirname(CONFIG_PATH);
    mkdirp(configDir, function (dirErr) {
        if (dirErr) {
            cb(dirErr);
            return;
        }
        var str = JSON.stringify(opts.config, null, 2);
        fs.writeFile(CONFIG_PATH, str, 'utf8', cb);
    });
}



// ---- exports

module.exports = {
    loadConfig: loadConfig,
    saveConfig: saveConfig
};
