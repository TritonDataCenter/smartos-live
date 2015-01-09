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
 * Here is how imgadm upgrade is intented to work:
 *
 * - The imgadm config (/var/imgadm/imgadm.conf) has a `upgradedToVer` string.
 * - On `imgadm.init()` we upgrade if necessary, as early as possible via
 *   `upgrade.upgradeIfNecessary(...)`. This basically checks if there is
 *   an upgrader function for a version > config.upgradedToVer.
 * - There is an ordered array of upgraders something like:
 *          var upgraders = [
 *              ['2.0.0', upgradeTo200],
 *              ['2.1.0', upgradeTo210],
 *              ...
 *          ];
 *   Not every version will have an upgrader. Only if a DB upgrade is
 *   necessary for that version.
 *
 * See each `upgradeTo*` function's comment for the how and why of each
 * DB upgrade.
 */

var p = console.log;

var assert = require('assert-plus');
var async = require('async');
var format = require('util').format;
var fs = require('fs');
var path = require('path');
var vasync = require('vasync');

var imgmanifest = require('imgmanifest');
var errors = require('./errors');
var common = require('./common'),
    objCopy = common.objCopy,
    assertUuid = common.assertUuid;



// ---- internal support stuff

function verInfoFromVer(ver) {
    return ver.split(/\./g).map(
        function (v) { return Number(v); });
}



// ---- upgraders

/**
 * Upgrade imgadm to v3.0.0
 *
 * imgadm 2 -> imgadm 3 simply requires a `type` value on each source object
 * (the `sources` array in "/var/imgadm/imgadm.conf"). It must be one
 * of `common.VALID_SOURCE_TYPES`.
 *
 * We use the same logic that was being used on the fly in imgadm v2 and lower:
 * - If the url ends with `/datasets/?`, then `type="dsapi"`.
 * - Else, default to "imgapi".
 */
function upgradeTo300(tool, callback) {
    var log = tool.log.child({upgrade: true, upgradeTo300: true}, true);

    vasync.pipeline({funcs: [
        function upgradeSources(_, next) {
            if (!tool.config.sources) {
                next();
                return;
            }

            log.info({sources: tool.config.sources}, 'config.sources before');
            var changed = false;
            tool.config.sources.forEach(function (s) {
                if (!s.type) {
                    // Per imgadm v1, the old source URL includes the
                    // "/datasets/" subpath. That's not a completely reliable
                    // marker, but we'll use that.
                    var isDsapiUrl = /\/datasets\/?$/;
                    if (isDsapiUrl.test(s.url)) {
                        s.type = 'dsapi';
                    } else {
                        s.type = 'imgapi';
                    }
                    changed = true;
                }
            });

            if (changed) {
                log.info({sources: tool.config.sources},
                    'config.sources updated');
                tool.saveConfig(next);
            } else {
                next();
            }
        },

        function updateConfigVer(_, next) {
            tool.config.upgradedToVer = '3.0.0';
            tool.saveConfig(next);
        }
    ]}, callback);
}



/**
 * Upgrade DB to v2.0.0
 *
 * imgadm <unversioned> -> imgadm 2 was a big re-write. The old datasets
 * API (DSAPI) was replaced by the Images API (IMGAPI). The dataset/image
 * manifest changed quite a bit: URNs were deprecated, etc. The internal data
 * was moved from '/var/db/imgadm' to '/var/imgadm'.
 *
 * @param tool {imgadm.IMGADM}
 * @param callback {Function}
 */
function upgradeTo200(tool, callback) {

    function upgradeManifest(ii, next) {
        assert.object(ii.manifest, 'ii.manifest');
        assert.string(ii.zpool, 'ii.zpool');

        if (ii.manifest.name) {
            // Already have manifest info -- possibly from earlier aborted
            // upgrade, possibly from another source.
            next();
            return;
        }
        var uuid = ii.manifest.uuid;
        var oldPath = format('/var/db/imgadm/%s.json', uuid);
        if (! fs.existsSync(oldPath)) {
            next();
            return;
        }
        try {
            var oldManifest = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
        } catch (ex) {
            console.warn('imgadm: warning: could not load image %s info '
                + 'from %s for upgrade: %s', uuid, oldPath, ex);
            next();
            return;
        }
        assert.string(oldManifest.name, 'oldManifest.name');
        try {
            var manifest = imgmanifest.upgradeManifest(oldManifest);
        } catch (upErr) {
            /* Pass through, because we expect validation to handle it. */
        }
        var imageInfo = {
            manifest: manifest,
            zpool: ii.zpool
        };
        // The old imgadm would cache the source URL here.
        if (oldManifest._url) {
            imageInfo.source = {url: oldManifest._url};
        }
        tool.dbAddImage(imageInfo, function (err) {
            if (err) {
                next(err);
                return;
            }
            // Use 'warn' to put on stderr to hopefully not disrupt the
            // command actually being run.
            console.warn('Upgraded image %s data', uuid);
            next();
        });
    }

    /**
     * For each installed image, get the manifest info (if necessary) from
     * the old imgadm database: "/var/db/imgadm/$uuid.json".
     */
    function upgradeManifests(next) {
        tool.listImages(function (listErr, imagesInfo) {
            if (listErr) {
                next();
                return;
            }
            async.forEachSeries(imagesInfo, upgradeManifest, next);
        });
    }

    /**
     * Import source URLs from the old imgadm database if appropriate.
     */
    function upgradeSources(next) {
        // If we already have configured sources: done. This means that
        // someone has explicitly configured imgadm v2. We don't want to
        // undo that.
        if (tool.config.sources) {
            next();
            return;
        }

        // If no file from which to import: done.
        var oldPath = '/var/db/imgadm/sources.list';
        if (!fs.existsSync(oldPath)) {
            next();
            return;
        }

        // Load the old sources.
        try {
            var sourcesList = fs.readFileSync(oldPath, 'utf8');
        } catch (err) {
            next(err);
            return;
        }
        var oldSources = sourcesList.trim().split(/\n/g).filter(function (ln) {
            ln = ln.split('#')[0].trim();
            if (ln.length === 0)
                return false;
            return true;
        });

        // If the old sources only include the single default, then skip it.
        // The result is that imgadm v2 just uses the new default.
        var OLD_DEFAULT_SOURCE = 'https://datasets.joyent.com/datasets/';
        if (oldSources.length === 1 && oldSources[0] === OLD_DEFAULT_SOURCE) {
            next();
            return;
        }

        // Add each old source.
        // Need to set `tool.sources` for the `configAddSource` code path.
        // Doesn't matter anyway, as the subsequent `tool.init()` will reset
        // it. We are just setting the config file here.
        tool.sources = [];
        async.forEachSeries(
            oldSources,
            function one(oldSource, nextSource) {
                var source = {url: oldSource, type: 'dsapi'};
                if (oldSource === OLD_DEFAULT_SOURCE) {
                    source = common.DEFAULT_SOURCE;
                }
                tool.configAddSource(source, true, function (addErr, changed) {
                    if (addErr) {
                        nextSource(addErr);
                        return;
                    }
                    if (changed) {
                        console.warn('Upgrade: imported image source "%s"',
                            oldSource);
                    }
                    nextSource();
                });
            },
            next
        );
    }

    function updateConfigVer(next) {
        tool.config.upgradedToVer = '2.0.0';
        tool.saveConfig(next);
    }

    async.series([upgradeManifests, upgradeSources, updateConfigVer],
        callback);
}


var upgraders = [
    ['2.0.0', upgradeTo200],
    ['3.0.0', upgradeTo300]
];
var highestUpVer = upgraders[upgraders.length - 1][0];
var highestUpVerInfo = verInfoFromVer(highestUpVer);




// ---- exports

function upgradeIfNecessary(tool, callback) {
    var log = tool.log;
    var currVer = tool.config.upgradedToVer || '1.0.0';
    var currVerInfo = verInfoFromVer(currVer);
    if (currVerInfo > highestUpVerInfo || currVer === highestUpVer) {
        log.trace({currVer: currVer, highestUpVer: highestUpVer},
            'upgrade not necessary');
        callback();
        return;
    }
    log.debug({currVer: currVer, highestUpVer: highestUpVer},
        'upgrade necessary');

    // Find start index in `upgraders`.
    var idx;
    for (var i = 0; i < upgraders.length; i++) {
        var ver = upgraders[i][0];
        var verInfo = verInfoFromVer(ver);
        if (verInfo > currVerInfo) {
            idx = i;
            break;
        }
    }
    if (idx === undefined) {
        callback(new errors.UpgradeError(format(
            'could not determine appropriate upgrader: currVer=%s '
            + 'highestUpVer=%s', currVer, highestUpVer)));
        return;
    }

    var todos = upgraders.slice(idx);
    async.forEachSeries(
        todos,
        function upgradeOne(todo, next) {
            var oneVer = todo[0];
            var upgrader = todo[1];
            log.debug('upgrade to %s', oneVer);
            upgrader(tool, next);
        },
        callback
    );
}

module.exports = {
    upgradeIfNecessary: upgradeIfNecessary
};
