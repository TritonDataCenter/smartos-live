/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015, Joyent, Inc.
 */

var BINDING = require('./zonename_binding.node');

function getzonename() {
    return BINDING.getzonenamebyid(BINDING.getzoneid());
}

module.exports.getzonename = getzonename;
module.exports.getzoneid = BINDING.getzoneid;
module.exports.getzoneidbyname = BINDING.getzoneidbyname;
module.exports.getzonenamebyid = BINDING.getzonenamebyid;
