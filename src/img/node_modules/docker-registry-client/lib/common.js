/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var fmt = require('util').format;



// --- globals

var DOCKER_REPO_RE = /^([^/:]+)\/([^/:]+)$/;

// [NAMESPACE/]REPO[:TAG]
// E.g. google/python:latest
var DOCKER_REPO_TAG_RE = /^(([^/:]+)\/)?([^/:]+)(:([^/:]+))?$/;



// --- exports

/**
 * Strictly parse a repo string: NAMESPACE/REPO-NAME
 */
function strictParseRepo(repo) {
    var match = DOCKER_REPO_RE.exec(repo);
    if (!match) {
        throw new Error(fmt('"%s" is not a docker repo', repo));
    }
    return {
        ns: match[1],
        name: match[2]
    };
}


/**
 * Parse a docker repo and tag string: REPO[:TAG]
 *
 * The namespace (`ns` field) defaults to "library" if not given.
 * The tag (`tag` field) defaults to "latest" if not given.
 */
function parseRepoAndTag(arg) {
    var match = DOCKER_REPO_TAG_RE.exec(arg);
    if (!match) {
        throw new Error(fmt('"%s" is not a docker repo[:tag]', arg));
    }
    var ns = match[2] || 'library';
    return {
        ns: ns,
        name: match[3],
        repo: fmt('%s/%s', ns, match[3]),
        tag: match[5] || 'latest'
    };
}



module.exports = {
    strictParseRepo: strictParseRepo,
    parseRepoAndTag: parseRepoAndTag
};
