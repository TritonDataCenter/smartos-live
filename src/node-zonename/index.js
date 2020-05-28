/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var binding = require('./build/Release/zonename');

function getzonename() {
    return binding.getzonenamebyid(binding.getzoneid());
}

exports.getzonename = getzonename;
exports.getzoneid = binding.getzoneid;
exports.getzoneidbyname = binding.getzoneidbyname;
exports.getzonenamebyid = binding.getzonenamebyid;
