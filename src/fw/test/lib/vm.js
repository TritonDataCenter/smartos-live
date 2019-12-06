/*
 * Copyright 2019 Joyent, Inc.
 *
 * Test utilities for running vmadm commands
 */

var async = require('async');
var assert = require('assert-plus');
var common = require('./common');
var mod_log = require('./log');
var util = require('util');

var hasKey = require('../../lib/util/obj').hasKey;


// --- Globals



// Set to 'false' to keep VMs around for later inspection
var DELETE_VMS = true;
var IMAGES = {
    smartos: '7b0b4140-6e98-11e5-b1ae-ff68fe257228'
};
var log = mod_log.child({ component: 'vm' });
var LAST_UUID;
var VMS = {};
var VM_NUM = 0;



// --- Exports



/**
 * `vmadm create`
 */
function create(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.optionalObject(opts.params, 'opts.params');
    assert.optionalString(opts.file, 'opts.file');

    var execOpts = {
        cmdName: 'vmadm create'
    };

    if (opts.params) {
        var params = {
            autoboot: true,
            do_not_inventory: true,
            nowait: false,
            ram: 128,
            cpu_cap: 100
        };

        for (var p in opts.params) {
            params[p] = opts.params[p];
        }

        if (!hasKey(params, 'alias')) {
            params.alias = util.format('fwtest-%d-%d', process.pid, VM_NUM++);
        }

        execOpts.cmd = util.format('echo \'%s\' | vmadm create',
            JSON.stringify(params));

        log.info({ params: params }, 'creating VM');
    }

    if (opts.file) {
        execOpts.cmd = util.format('vmadm create -f %s', opts.file);

        log.info({ file: opts.file }, 'creating VM');
    }

    if (!execOpts.cmd) {
        assert.ok(false, 'One of opts.params or opts.file is required!');
    }

    common.exec(t, execOpts, function (err, stdout, stderr) {
        /* JSSTYLED */
        var match = stderr.match(/Successfully created VM ([-a-z0-9]+)\n/);
        if (match && match[1]) {
            LAST_UUID = match[1];
        } else {
            t.equal(stderr, '', 'unexpected output in stderr');
            return common.done(err, null, t, callback);
        }

        opts.uuid = LAST_UUID;
        return get(t, opts, callback);
    });
}


/**
 * `vmadm delete`
 */
function del(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.optionalObject(opts.params, 'opts.params');
    assert.string(opts.uuid, 'opts.uuid');

    var execOpts = {
        cmd: util.format('vmadm delete %s', opts.uuid),
        cmdName: 'vmadm delete'
    };

    log.info('deleting VM %s', opts.uuid);

    if (!DELETE_VMS) {
        t.ok(true, 'DELETE_VMS=false: not deleting VM ' + opts.uuid);
        return common.done(null, null, t, callback);
    }

    common.exec(t, execOpts, function (err, stdout, stderr) {
        if (!err) {
            delete VMS[opts.uuid];
        }

        return common.done(err, null, t, callback);
    });
}


/**
 * Deletes all created VMs
 */
function delAllCreated(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.optionalObject(opts.params, 'opts.params');

    async.forEachSeries(Object.keys(VMS), function _doVMdelete(uuid, cb) {
        del(t, { uuid: uuid }, cb);
    }, function () {
        return common.done(null, null, t, callback);
    });
}


/**
 * `vmadm get`
 */
function get(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.optionalObject(opts.params, 'opts.params');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var execOpts = {
        cmd: util.format('vmadm get %s', opts.uuid),
        cmdName: 'vmadm get'
    };

    common.exec(t, execOpts, function (err, stdout, stderr) {
        if (err) {
            return common.done(err, null, t, callback);
        }

        var res = JSON.parse(stdout);
        VMS[res.uuid] = res;

        if (opts.partialExp) {
            var partialRes = {};
            for (var p in opts.partialExp) {
                partialRes[p] = res[p];
            }

            t.deepEqual(partialRes, opts.partialExp,
                'partial result: vmadm get ' + opts.uuid);
        }

        return common.done(null, res, t, callback);
    });
}


function lastCreated() {
    if (!LAST_UUID) {
        return null;
    }

    return VMS[LAST_UUID];
}


/**
 * `vmadm update`
 */
function update(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalFunc(callback, 'callback');
    assert.object(opts.params, 'opts.params');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var execOpts = {
        cmd: util.format('echo \'%s\' | vmadm update %s',
            JSON.stringify(opts.params), opts.uuid),
        cmdName: 'vmadm update'
    };

    log.info({ params: opts.params, uuid: opts.uuid }, 'updating VM');

    common.exec(t, execOpts, function (err, stdout, stderr) {
        /* JSSTYLED */
        var match = stderr.match(/Successfully updated VM ([-a-z0-9]+)\n/);
        if (!match) {
            t.equal(stderr, '', 'unexpected output in stderr');
            return common.done(err, null, t, callback);
        }

        return get(t, opts, callback);
    });
}


module.exports = {
    get images() {
        return IMAGES;
    },
    get imageUUIDs() {
        return Object.keys(IMAGES).map(function (img) {
            return IMAGES[img];
        });
    },
    create: create,
    del: del,
    delAllCreated: delAllCreated,
    lastCreated: lastCreated,
    update: update
};
