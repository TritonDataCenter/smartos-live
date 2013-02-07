// Copyright 2013 Joyent, Inc.  All rights reserved.

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
        return require('./ufds');
    },
    get Config() {
        return require('./config');
    },
    get IMGAPI() {
        return require('./imgapi');
    },
    get Package() {
        return require('./package');
    },
    get DSAPI() {
        return require('./dsapi');
    },
    get UsageAPI() {
        return require('./usageapi');
    },
    get SAPI() {
        return require('./sapi');
    }
};
