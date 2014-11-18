/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

module.exports = {
    get Amon() {
        return require('./amon');
    },
    get CA() {
        return require('./ca');
    },
    get FWAPI() {
        return require('./fwapi');
    },
    get NAPI() {
        return require('./napi');
    },
    get VMAPI() {
        return require('./vmapi');
    },
    get CNAPI() {
        return require('./cnapi');
    },
    get UFDS() {
        return require('ufds');
    },
    get IMGAPI() {
        return require('./imgapi');
    },
    get DSAPI() {
        return require('./dsapi');
    },
    get UsageAPI() {
        return require('./usageapi');
    },
    get SAPI() {
        return require('./sapi');
    },
    get PAPI() {
        return require('./papi');
    }
};
