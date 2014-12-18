/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var registry_client = require('./registry-client');
var common = require('./common');

module.exports = {
    createIndexClient: require('./index-client').createIndexClient,
    createRegistryClient: registry_client.createRegistryClient,
    createRegistrySession: registry_client.createRegistrySession,

    parseRepoAndTag: common.parseRepoAndTag
};
