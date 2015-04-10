/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * mocks for tests
 */

var clone = require('clone');
var fw;
var mockery = require('mockery');
var mod_obj = require('../../lib/util/obj');
var util = require('util');

var createSubObjects = mod_obj.createSubObjects;



// --- Globals



var IPF = '/usr/sbin/ipf';
var VALUES = {};
var LOG = false;
var MOCKS = {
    bunyan: {
        createLogger: createLogger,
        RingBuffer: mockRingBuffer,
        stdSerializers: {
            err: errSerializer
        },
        resolveLevel: resolveLevel
    },
    child_process: {
        execFile: execFile
    },
    fs: {
        readdir: readDir,
        readFile: readFile,
        readFileSync: readFileSync,
        rename: rename,
        unlink: unlink,
        writeFile: writeFile
    },
    mkdirp: mkdirp
};
var ORIG_PROCESS;
var PID;



// --- Internal helper functions



function _ENOENT(path) {
    var err = new Error('ENOENT: ' + path);
    err.code = 'ENOENT';
    return err;
}


function _splitFile(f) {
    return {
        dir: f.substring(0, f.lastIndexOf('/')),
        file: f.substring(f.lastIndexOf('/') + 1)
    };
}



// --- bunyan



function _log(level, num, obj) {
    if (obj && obj[0]) {
        VALUES.bunyan[level].push(Array.prototype.slice.call(obj, 1));
        if (LOG || process.env.LOG) {
            var json = {};
            var msgArgs;

            if (typeof (obj[0]) !== 'string') {
                json = clone(obj[0]);
                msgArgs = Array.prototype.slice.call(obj, 1);
            } else {
                msgArgs = Array.prototype.slice.call(obj);
            }

            json.hostname = 'fw-test';
            json.name = 'fw-test';
            json.pid = process.pid;
            json.v = 0;
            json.msg = util.format.apply(null, msgArgs);
            json.level = num;
            json.time = (new Date());

            console.error(JSON.stringify(json));
        }
    }

    return true;
}


function createLogger() {
    return {
        child: function () { return this; },
        trace: function () { return _log('trace', 10, arguments); },
        debug: function () { return _log('debug', 20, arguments); },
        info: function () { return _log('info', 30, arguments); },
        warn: function () { return _log('warn', 40, arguments); },
        error: function () { return _log('error', 50, arguments); },
        fatal: function () { return _log('fatal', 60, arguments); }
    };
}


function errSerializer(err) {
    return err;
}


function mockRingBuffer(opts) {
    this.opts = opts;
}


function resolveLevel() {
    return 3;
}



// --- child_process



/**
 * Record the IPF state for a zone, keeping track of whether it's enabled,
 * and what's in the active and inactive lists.
 */
function _recordIPFstate(args) {
    var zone = createSubObjects(VALUES.ipf, args[args.length - 1]);

    if (args[0] == '-GD') {
        zone.enabled = false;
        zone.inactive = '';
        zone.active = '';
        return;
    }

    if (args[0] == '-GE') {
        zone.enabled = true;
        zone.inactive = '';
        zone.active = '';
        return;
    }

    if (args[0] == '-GIFa') {
        zone.inactive = '';
        return;
    }

    if (args[1] == '-s') {
        var active = zone.active || '';
        var inactive = zone.inactive || '';
        zone.active = inactive;
        zone.inactive = active;
        return;
    }

    if (args[1] == '-I' && args[2] == '-f') {
        var root = VALUES.fs;
        var p = _splitFile(args[3]);
        if (!root.hasOwnProperty(p.dir)
                || !root[p.dir].hasOwnProperty(p.file)) {
            throw _ENOENT(p.file);
        }

        zone.inactive = root[p.dir][p.file];
        return;
    }
}


function execFile(path, args, opts, cb) {
    var vals = VALUES.child_process[path];
    if (!vals) {
        vals = {
            err: new Error('child_process.execFile mock: no mock data for '
                + path),
            stderr: null,
            stdout: null
        };
    }

    if (cb === undefined) {
        cb = opts;
    }

    if (typeof (vals) == 'function') {
        return vals.apply(null, arguments);
    }

    if (path == IPF) {
        try {
            _recordIPFstate(args);
        } catch (err) {
            vals.err = err;
        }
    }

    return cb(vals.err, vals.stdout, vals.stderr);
}



// --- fs



function readDir(dir, cb) {
    var root = VALUES.fs;
    if (!root.hasOwnProperty(dir)) {
        return cb(_ENOENT(dir));
    }

    return cb(null, Object.keys(root[dir]));
}


function readFile(file, cb) {
    var p = _splitFile(file);
    var root = VALUES.fs;

    if (!root.hasOwnProperty(p.dir)
            || !root[p.dir].hasOwnProperty(p.file)) {
        return cb(_ENOENT(file));
    }

    return cb(null, root[p.dir][p.file]);
}


function readFileSync(file, cb) {
    var p = _splitFile(file);
    var root = VALUES.fs;

    if (!root.hasOwnProperty(p.dir)
            || !root[p.dir].hasOwnProperty(p.file)) {
        throw _ENOENT(file);
    }

    return root[p.dir][p.file];
}


function rename(before, after, cb) {
    readFile(before, function (err, res) {
        if (err) {
            return cb(err);
        }

        writeFile(after, res, function (err2, res2) {
            if (err2) {
                return cb(err2);
            }

            return unlink(before, cb);
        });
    });
}


function unlink(file, cb) {
    var p = _splitFile(file);
    var root = VALUES.fs;

    if (!root.hasOwnProperty(p.dir)
            || !root[p.dir].hasOwnProperty(p.file)) {
        return cb(_ENOENT(file));
    }

    delete root[p.dir][p.file];
    return cb();
}


function writeFile(f, data, cb) {
    // TODO: be able to return an error here
    var p = _splitFile(f);

    var root = VALUES.fs;
    if (!root.hasOwnProperty(p.dir)) {
        root[p.dir] = {};
    }

    root[p.dir][p.file] = data;
    return cb();
}



// --- mkdirp



function mkdirp(dir, cb) {
    if (!VALUES.fs.hasOwnProperty(dir)) {
        VALUES.fs[dir] = {};
    }
    return cb();
}


mkdirp.sync = function mkdirpSync(dir) {
    if (!VALUES.fs.hasOwnProperty(dir)) {
        VALUES.fs[dir] = {};
    }
    return;
};



// --- path



function basename(file) {
    return file;
}



// --- Setup / Teardown



/**
 * Initialize VALUES to a clean state for each mock
 */
function resetValues(opts) {
    VALUES = {};

    VALUES.bunyan = {
        trace: [],
        debug: [],
        error: [],
        warn: [],
        info: []
    };

    VALUES.child_process = {};
    VALUES.child_process[IPF] = {
        err: null,
        stderr: null,
        stdout: ['ipf: IP Filter: v4.1.9 (592)',
            'Kernel: IP Filter: v4.1.9',
            'Running: yes',
            'Log Flags: 0 = none set',
            'Default: nomatch -> block all, Logging: available',
            'Active list: 0',
            'Feature mask: 0x107'
        ].join('\n')
    };

    VALUES.fs = {};

    VALUES.ipf = {};

    if (opts && opts.initialValues) {
        // As a convenience, allow fs values to be full paths
        if (opts.initialValues.hasOwnProperty('fs')) {
            for (var f in opts.initialValues.fs) {
                var p = _splitFile(f);
                mkdirp.sync(p.dir);
                VALUES.fs[p.dir][p.file] = opts.initialValues.fs[f];
            }

            for (var i in opts.initialValues) {
                if (i == 'fs') {
                    continue;
                }

                VALUES[i] = opts.initialValues[i];
            }
        }
    }
}


/**
 * Mock setup:
 *   * Initialize VALUES, populating with values in opts.initialValues if
 *     present
 *   * Create mocks, overriding / adding to the list with mocks in opts.mocks
 *     if present
 *   * If opts.allowed is present, add all mocks in the list to mockery's
 *     allowed modules
 *   * Enable all of the mocks
 *
 * Returns a newly-require()'d fw.js with most external modules mocked out.
 */
function setup(opts) {
    if (fw) {
        return fw;
    }

    var m;

    if (!opts) {
        opts = {};
    }
    if (!opts.mocks) {
        opts.mocks = {};
    }

    resetValues(opts);

    mockery.enable();
    for (m in opts.mocks) {
        MOCKS[m] = opts.mocks[m];
    }

    for (m in MOCKS) {
        mockery.registerMock(m, MOCKS[m]);
    }

    var allowed = [
        'assert',
        'assert-plus',
        'clone',
        'events',
        'extsprintf',
        'fwrule',
        'net',
        'node-uuid',
        'path',
        'stream',
        'vasync',
        'verror',
        'util',
        './clonePrototype.js',
        './filter',
        './ipf',
        './obj',
        './parser',
        './pipeline',
        './rule',
        './rvm',
        './util/errors',
        './util/log',
        './util/obj',
        './util/vm',
        './validators',
        '../../lib/fw'
    ];

    if (opts.allowed) {
        allowed = allowed.concat(opts.allowed);
    }

    allowed.forEach(function (mod) {
        mockery.registerAllowable(mod);
    });

    fw = require('../../lib/fw');
    return fw;
}


/**
 * Disable all of the mocks
 */
function teardown() {
    mockery.disable();
}



// --- Exports



module.exports = {
    get fw() {
        return fw;
    },
    get mocks() {
        return MOCKS;
    },
    get values() {
        return VALUES;
    },
    reset: resetValues,
    setup: setup,
    teardown: teardown
};
