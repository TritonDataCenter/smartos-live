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
 *
 * The main entry point for an the imgadm CLI.
 *
 * Usage:
 *      var cli = new CLI();
 *      cmdln.main(cli, argv, {showCode: true});
 */

var p = console.warn;

var assert = require('assert-plus');
var async = require('async');
var bunyan = require('/usr/node/node_modules/bunyan');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var Cmdln = require('cmdln').Cmdln;
var fs = require('fs');
var genUuid = require('node-uuid');
var os = require('os');
var path = require('path');
var restify = require('sdc-clients/node_modules/restify');
var rimraf = require('rimraf');
var sprintf = require('extsprintf').sprintf;
var tabula = require('tabula');
var util = require('util'),
    format = util.format;

var imgadm = require('./imgadm');
var common = require('./common'),
    objCopy = common.objCopy,
    objMerge = common.objMerge,
    NAME = common.NAME,
    pathSlugify = common.pathSlugify,
    assertUuid = common.assertUuid;
var errors = require('./errors');



// ---- globals

var pkg = require('../package.json');



// ---- CLI object

/**
 * Create an imgadm CLI instance.
 */
function CLI() {
    Cmdln.call(this, {
        name: NAME,
        desc: pkg.description,
        options: [
            {names: ['help', 'h'], type: 'bool', help: 'Print help and exit.'},
            {name: 'version', type: 'bool', help: 'Print version and exit.'},
            {names: ['verbose', 'v'], type: 'bool',
                help: 'Verbose output: debug logging, stack on error. See '
                    + 'IMGADM_LOG_LEVEL envvar.'},
            {name: 'E', type: 'bool',
                help: 'On error, emit a structured JSON error object as the '
                    + 'last line of stderr output.'},
        ],
        helpOpts: {
            includeEnv: true,
            minHelpCol: 30 /* line up with option help */
        }
    });
}
util.inherits(CLI, Cmdln);


CLI.prototype.init = function init(opts, args, cb) {
    var self = this;

    /*
     * Logging setup.
     *
     * - Log to stderr.
     *   TODO: see sdcadm/vmadm for logging trace-level to separate files
     *   for subsequent rollup and rotation.
     * - By default we log at the 'warn' level. Intentionally that is
     *   almost no logging.
     * - use IMGADM_LOG_LEVEL=trace envvar to set to trace level and enable
     *   source location (src=true) in log records
     * - '-v|--verbose' or IMGADM_LOG_LEVEL=debug to set to debug level
     * - use IMGADM_LOG_LEVEL=<bunyan level> to set to a different level
     * - '-E' to have a possible error be logged as the last single line
     *   of stderr as a raw Bunyan log JSON record with an 'err'. I.e. in a
     *   structured format more useful to automation tooling.
     * - Include a `req_id` in log output. This is the ID for this imgadm
     *   run. If `REQ_ID` envvar is set, then use that.
     *
     * Logging is in Bunyan (JSON) format so one needs to pipe via
     * `bunyan` for readable output (at least until bunyan.js supports
     * doing it inline). Admittedly this is a bit of a pain:
     *
     *      imgadm -v ... 2>&1 | bunyan
     */
    var req_id;
    if (process.env.REQ_ID) {
        req_id = process.env.REQ_ID;
    } else if (process.env.req_id) {
        req_id = process.env.req_id;
    } else {
        req_id = genUuid();
    }
    var log = bunyan.createLogger({
        name: self.name,
        streams: [
            {
                stream: process.stderr,
                level: 'warn'
            }
        ],
        // TODO hack serializers until
        // https://github.com/mcavage/node-restify/pull/501 is fixed
        // serializers: bunyan.stdSerializers,
        serializers: restify.bunyan.serializers,
        req_id: req_id
    });
    var IMGADM_LOG_LEVEL;
    try {
        if (process.env.IMGADM_LOG_LEVEL
            && bunyan.resolveLevel(process.env.IMGADM_LOG_LEVEL))
        {
            IMGADM_LOG_LEVEL = process.env.IMGADM_LOG_LEVEL;
        }
    } catch (e) {
        log.warn('invalid IMGADM_LOG_LEVEL=%s envvar (ignoring)',
            process.env.IMGADM_LOG_LEVEL);
    }
    if (IMGADM_LOG_LEVEL && IMGADM_LOG_LEVEL === 'trace') {
        log.src = true;
        log.level(IMGADM_LOG_LEVEL);
    } else if (opts.verbose) {
        log.level('debug');
    } else if (IMGADM_LOG_LEVEL) {
        log.level(IMGADM_LOG_LEVEL);
    }
    self.log = log;

    // Log the invocation args (trim out dashdash meta vars).
    var trimmedOpts = common.objCopy(opts);
    delete trimmedOpts._args;
    delete trimmedOpts._order;
    this.log.debug({opts: trimmedOpts, args: args, cli: true}, 'cli init');

    // Error printing options.
    if (log.level() <= bunyan.DEBUG) {
        self.showErrStack = true;
    }
    self.structuredErr = opts.E;

    if (opts.version) {
        console.log(self.name + ' ' + common.getVersion());
        cb(false);
        return;
    }

    // Cmdln class handles `opts.help`.
    Cmdln.prototype.init.call(this, opts, args, function (err) {
        if (err || err === false) {
            return cb(err);
        }
        imgadm.createTool({log: self.log}, function (createErr, tool) {
            if (createErr) {
                cb(createErr);
                return;
            }
            self.tool = tool;
            cb();
        });
    });
};


CLI.prototype.fini = function fini(subcmd, err, cb) {
    /*
     * We want to log these `cli:true` entry and exits for CLI usage and
     * we want to the exitStatus -- which means some duplication (see
     * `cmdln.main` as well) on pulling it out, unfortunately.
     */
    var exitStatus = (err ? err.exitStatus || 1 : 0);
    this.log.debug({subcmd: subcmd, exitStatus: exitStatus, cli: true},
        'cli exit');

    /*
     * Handle `-E`: last line stderr is a structured JSON object
     * with the error.
     */
    if (err && this.structuredErr) {
        this.log.error(err, err.message);
        this.showErr = false;
    }

    cb();
};


/**
 * Override `Cmdln.printHelp` to have custom output for the commands.
 * Manual, but much nicer.
 */
CLI.prototype.printHelp = function printHelp(cb) {
    var self = this;

    var lines = [];
    if (this.desc) {
        lines.push(this.desc);
    }

    lines = lines.concat([
        '',
        'Usage:',
        '    {{name}} [<options>] <command> [<args>...]',
        '    {{name}} help <command>',
        '',
    ]);
    if (this.optParser.help) {
        lines.push('Options:');
        lines.push(this.optParser.help(this.helpOpts).trimRight());
    }

    lines = lines.concat([
        '',
        'Environment:',
        '    IMGADM_LOG_LEVEL=<level>  Set log level to one of "trace",',
        '                              "debug", "info", "warn" (default)',
        '                              "error", "fatal".'
    ]);

    /* BEGIN JSSTYLED */
    lines = lines.concat([
        '',
        'Commands:',
        '    imgadm help [<command>]                help on commands',
        '',
        '    imgadm sources [<options>]             list and edit image sources',
        '',
        '    imgadm avail                           list available images',
        '    imgadm show <uuid>                     show manifest of an available image',
        '',
        '    imgadm import [-P <pool>] <uuid>       import image from a source',
        '    imgadm install [-P <pool>] -m <manifest> -f <file>',
        '                                           import from local image data',
        '',
        '    imgadm list                            list installed images',
        '    imgadm get [-P <pool>] <uuid>          info on an installed image',
        '    imgadm update [<uuid>...]              update installed images',
        '    imgadm delete [-P <pool>] <uuid>       remove an installed image',
        '',
        '    imgadm create <vm-uuid> [<manifest-field>=<value> ...] ...',
        '                                           create an image from a VM',
        '    imgadm publish -m <manifest> -f <file> <imgapi-url>',
        '                                           publish an image to an image repo',
        '',
        'See `imgadm help <command>` or the imgadm(1m) man page for more details.'
    ]);
    /* END JSSTYLED */

    console.log(lines.join('\n').replace(/{{name}}/g, this.name));
    cb();
};


CLI.prototype.do_sources = function do_sources(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length > 0) {
        cb(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var nActions = 0;
    if (opts.e) nActions++;
    if (opts.a) nActions++;
    if (opts.d) nActions++;
    if (nActions > 1) {
        cb(new errors.UsageError(
            'cannot specify more than one of "-a", "-d" and "-e"'));
        return;
    }
    var skipPingCheck = opts.force === true;
    if (opts.e) {
        var before = self.tool.sources.map(function (s) { return s.url; });
        var beforeText = before.join('\n')
            + '\n\n'
            + '#\n'
            + '# Enter source URLs, one per line.\n'
            + '# Comments beginning with "#" are stripped.\n'
            + '#\n';
        var tmpPath = path.resolve(os.tmpDir(),
            format('imgadm-sources-%s.txt', process.pid));
        fs.writeFileSync(tmpPath, beforeText, 'utf8');

        var vi = spawn('/usr/bin/vi', ['-f', tmpPath], {stdio: 'inherit'});
        vi.on('exit', function (code) {
            if (code) {
                console.warn('Error editing image sources: %s (ignoring)',
                    code);
                cb();
                return;
            }
            var afterText = fs.readFileSync(tmpPath, 'utf8');
            fs.unlinkSync(tmpPath);
            if (afterText === beforeText) {
                console.log('Image sources unchanged');
                cb();
                return;
            }
            var after = afterText.trim().split(/\n/g).filter(function (line) {
                line = line.split('#')[0].trim();
                if (line.length === 0)
                    return false;
                return true;
            });
            if (after.join('\n') === before.join('\n')) {
                console.log('Image sources unchanged');
                cb();
                return;
            }
            self.tool.updateSourceUrls(after, skipPingCheck,
                function (err, changes) {
                    if (err) {
                        cb(err);
                    } else {
                        changes.forEach(function (change) {
                            if (change.type === 'reorder') {
                                console.log('Reordered image sources');
                            } else if (change.type === 'add') {
                                console.log('Added image source "%s"',
                                    change.url);
                            } else if (change.type === 'del') {
                                console.log('Deleted image source "%s"',
                                    change.url);
                            }
                        });
                        cb();
                    }
                });
        });
    } else if (opts.a) {
        this.tool.configAddSource({url: opts.a}, skipPingCheck,
            function (err, changed) {
                if (err) {
                    cb(err);
                } else if (changed) {
                    console.log('Added image source "%s"', opts.a);
                } else {
                    console.log('Already have image source "%s", no change',
                        opts.a);
                }
            }
        );
    } else if (opts.d) {
        this.tool.configDelSourceUrl(opts.d, function (err, changed) {
            if (err) {
                cb(err);
            } else if (changed) {
                console.log('Deleted image source "%s"', opts.d);
            } else {
                console.log('Do not have image source "%s", no change',
                    opts.d);
            }
        });
    } else {
        var sources = this.tool.sources.map(function (s) {
            return s.url;
        });
        if (opts.json) {
            console.log(JSON.stringify(sources, null, 2));
        } else {
            sources.forEach(function (s) {
                console.log(s);
            });
        }
        cb();
    }
};
CLI.prototype.do_sources.help = (
    /* BEGIN JSSTYLED */
    'List and edit image sources.\n'
    + '\n'
    + 'An image source is a URL to a server implementing the IMGAPI.\n'
    + 'The default IMGAPI is + ' + common.DEFAULT_SOURCE.url + '\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} sources [<options>]\n'
    + '\n'
    + '{{options}}'
    /* END JSSTYLED */
);
CLI.prototype.do_sources.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'List sources as JSON'
    },
    {
        names: ['a'],
        type: 'string',
        helpArg: '<source>',
        help: 'Add a source. It is appended to the list of sources.'
    },
    {
        names: ['d'],
        type: 'string',
        helpArg: '<source>',
        help: 'Delete a source.'
    },
    {
        names: ['e'],
        type: 'bool',
        help: 'Edit sources in an editor.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Force no "ping check" on new source URLs. By default'
            + 'a ping check is done against new source URLs to'
            + 'attempt to ensure they are a running IMGAPI server.'
    },
];


var availValidFields = [
    'source',
    'uuid',
    'owner',
    'name',
    'version',
    'state',
    'disabled',
    'public',
    'published',
    'published_at',
    'published_date',
    'type',
    'os',
    'urn',
    'nic_driver',
    'disk_driver',
    'cpu_type',
    'image_size',
    'generate_passwords',
    'description'
    // XXX new fields? tags, etc.  Pull from imgmanifest?
];
CLI.prototype.do_avail = function do_avail(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length) {
        cb(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }

    /* JSSTYLED */
    var columns = opts.o.trim().split(/\s*,\s*/g);
    /* JSSTYLED */
    var sort = opts.s.trim().split(/\s*,\s*/g);

    self.tool.sourcesList(function (err, imagesInfo) {
        // Even if there was an err, we still attempt to return results
        // for working sources.
        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var rows = [];
            imagesInfo.forEach(function (i) {
                var row = i.manifest;
                if (row.published_at) {
                    // Just the date.
                    row.published_date = row.published_at.slice(0, 10);
                    // Normalize on no milliseconds.
                    row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
                }
                row.source = i.source;
                rows.push(row);
            });
            try {
                tabula(rows, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort,
                    validFields: availValidFields
                });
            } catch (e) {
                cb(e);
                return;
            }
        }
        cb(err);
    });
};
CLI.prototype.do_avail.help = (
    'List available images from all sources.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} avail [<options>...]\n'
    + '\n'
    + '{{options}}'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         JSON output\n'
    + '    -H                 Do not print table header row\n'
    + '    -o field1,...      Specify fields (columns) to output. Default is\n'
    + '                       "uuid,name,version,os,published".\n'
    + '    -s field1,...      Sort on the given fields. Default is\n'
    + '                       "published_at,name".\n'
    + '\n'
    + common.textWrap('Valid fields for "-o" and "-s" are: '
        + availValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_avail.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    },
    {
        names: ['H'],
        type: 'bool',
        help: 'Do not print table header row.'
    },
    {
        names: ['o'],
        type: 'string',
        help: 'Specify fields (columns) to output. Default is '
            + '"uuid,name,version,os,published".',
        default: 'uuid,name,version,os,published'
    },
    {
        names: ['s'],
        type: 'string',
        help: 'Sort on the given fields. Default is "published_at,name".',
        default: 'published_at,name'
    }
];
CLI.prototype.do_avail.aliases = ['available'];


var listValidFields = [
    'source',
    'uuid',
    'owner',
    'name',
    'version',
    'state',
    'disabled',
    'public',
    'published',
    'published_at',
    'type',
    'os',
    'urn',
    'origin',
    'nic_driver',
    'disk_driver',
    'cpu_type',
    'image_size',
    'generate_passwords',
    'description',
    'clones',
    'zpool'
    //XXX should merge this list with availValidFields above? pull from imgmanfiest?
];
CLI.prototype.do_list = function do_list(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length) {
        cb(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var log = self.log;
    log.debug({opts: opts}, 'list');

    /* JSSTYLED */
    var columns = opts.o.trim().split(/\s*,\s*/g);
    /* JSSTYLED */
    var sort = opts.s.trim().split(/\s*,\s*/g);

    self.tool.listImages(function (err, imagesInfo) {
        log.debug({err: err, imagesInfo: imagesInfo}, 'listImages');
        if (err) {
            cb(err);
            return;
        }

        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var rows = [];
            imagesInfo.forEach(function (i) {
                var row = i.manifest;
                if (row.published_at) {
                    // Just the date.
                    row.published_date = row.published_at.slice(0, 10);
                    // Normalize on no milliseconds.
                    row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
                }
                row.source = i.source;
                row.clones = i.clones;
                row.zpool = i.zpool;
                rows.push(row);
            });
            try {
                tabula(rows, {
                    skipHeader: opts.H,
                    columns: columns,
                    sort: sort,
                    validFields: listValidFields
                });
            } catch (e) {
                cb(e);
                return;
            }
            cb();
        }
    });
};
CLI.prototype.do_list.help = (
    'List locally installed images.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} list [<options>...]\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + common.textWrap('Valid fields for "-o" and "-s" are: '
        + listValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_list.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'JSON output.'
    },
    {
        names: ['H'],
        type: 'bool',
        help: 'Do not print table header row.'
    },
    {
        names: ['o'],
        type: 'string',
        help: 'Specify fields (columns) to output. Default is '
            + '"uuid,name,version,os,published".',
        default: 'uuid,name,version,os,published'
    },
    {
        names: ['s'],
        type: 'string',
        help: 'Sort on the given fields. Default is "published_at,name".',
        default: 'published_at,name'
    }
];


CLI.prototype.do_show = function do_show(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var getOpts = {
        uuid: uuid,
        ensureActive: false
    };
    self.tool.sourcesGet(getOpts, function (err, imageInfo) {
        if (err) {
            cb(err);
            return;
        }
        if (!imageInfo) {
            err = new errors.ImageNotFoundError(uuid);
        } else {
            console.log(JSON.stringify(imageInfo.manifest, null, 2));
        }
        cb(err);
    });
};
CLI.prototype.do_show.help = (
    'Show the manifest for an available image.\n'
    + '\n'
    + 'This searches each imgadm source for an available image with this UUID\n'
    + 'and prints its manifest.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} show <uuid>\n'
    + '\n'
    + '{{options}}'
);
CLI.prototype.do_show.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    }
];


CLI.prototype.do_get = function do_get(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.P || common.DEFAULT_ZPOOL;
    var getOpts = {uuid: uuid, zpool: zpool, children: opts.r};
    self.tool.getImage(getOpts, function (err, imageInfo) {
        if (err) {
            cb(err);
            return;
        }
        if (!imageInfo) {
            cb(new errors.ImageNotInstalledError(zpool, uuid));
            return;
        }
        console.log(JSON.stringify(imageInfo, null, 2));
        cb();
    });
};
CLI.prototype.do_get.help = (
    'Get information for an installed image.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} get <uuid>\n'
    + '\n'
    + '{{options}}'
);
CLI.prototype.do_get.aliases = ['info'];
CLI.prototype.do_get.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['P'],
        type: 'string',
        helpArg: '<pool>',
        help: 'Name of zpool in which to look for the image. Default is "'
            + common.DEFAULT_ZPOOL + '".'
    },
    {
        names: ['r'],
        type: 'bool',
        help: 'Recursively gather children (child snapshots and dependent '
            + 'clones).'
    }
];


/**
 * `imgadm delete <uuid>`
 */
CLI.prototype.do_delete = function do_delete(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.P || common.DEFAULT_ZPOOL;

    self.tool.deleteImage({uuid: uuid, zpool: zpool}, function (err) {
        if (err) {
            cb(err);
            return;
        }
        console.log('Deleted image %s', uuid);
    });
};
CLI.prototype.do_delete.help = (
    /* BEGIN JSSTYLED */
    'Delete an image from the local zpool.\n'
    + '\n'
    + 'The removal can only succeed if the image is not actively in use by a VM.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} delete <uuid>\n'
    + '\n'
    + '{{options}}'
    /* END JSSTYLED */
);
CLI.prototype.do_delete.aliases = ['destroy'];
CLI.prototype.do_delete.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['P'],
        type: 'string',
        helpArg: '<pool>',
        help: 'Name of zpool in which to look for the image. Default is "'
            + common.DEFAULT_ZPOOL + '".'
    }
];


/**
 * `imgadm import <uuid>`
 */
CLI.prototype.do_import = function do_import(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.P || common.DEFAULT_ZPOOL;

    // 1. Ensure we don't already have this UUID installed.
    self.tool.getImage({uuid: uuid, zpool: zpool}, function (getErr, ii) {
        if (getErr) {
            cb(getErr);
            return;
        }
        if (ii) {
            var extra = '';
            if (ii.manifest.name) {
                extra = format(' (%s %s)', ii.manifest.name,
                    ii.manifest.version);
            }
            console.log('Image %s%s is already installed, skipping',
                ii.manifest.uuid, extra);
            cb();
            return;
        }

        // 2. Find this image in the sources.
        var getOpts = {
            uuid: uuid,
            ensureActive: true
        };
        self.tool.sourcesGet(getOpts, function (sGetErr, imageInfo) {
            if (sGetErr) {
                cb(sGetErr);
                return;
            } else if (!imageInfo) {
                cb(new errors.ActiveImageNotFoundError(uuid));
                return;
            }
            self.log.trace({imageInfo: imageInfo},
                'found source for image %s', uuid);
            console.log('Importing image %s (%s@%s) from "%s"', uuid,
                imageInfo.manifest.name, imageInfo.manifest.version,
                imageInfo.source.url);

            // 3. Import it.
            var importOpts = {
                manifest: imageInfo.manifest,
                source: imageInfo.source,
                zpool: zpool,
                quiet: opts.quiet,
                logCb: console.log
            };
            self.tool.importImage(importOpts, function (importErr) {
                if (importErr) {
                    cb(importErr);
                    return;
                }
                cb();
            });
        });
    });
};
CLI.prototype.do_import.help = (
    'Import an image from a source IMGAPI.\n'
    + '\n'
    + 'This finds the image with the given UUID in the configured sources\n'
    + 'and imports it into the local system.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} import <uuid>\n'
    + '\n'
    + '{{options}}'
);
CLI.prototype.do_import.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Disable progress bar.'
    },
    {
        names: ['P'],
        type: 'string',
        helpArg: '<pool>',
        help: 'Name of zpool in which to look for the image. Default is "'
            + common.DEFAULT_ZPOOL + '".'
    }
];



/**
 * `imgadm install -m <manifest> -f <file>`
 */
CLI.prototype.do_install = function do_install(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 0) {
        cb(new errors.UsageError(format(
            'unexpected args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    assert.string(opts.m, '-m <manifest>');
    assert.string(opts.f, '-f <file>');
    assert.optionalString(opts.P, '-P <zpool>');
    var zpool = opts.P || common.DEFAULT_ZPOOL;

    // 1. Validate args.
    //    If `published_at` is not defined in the manifest (e.g. if from
    //    `imgadm create ...`) then they are generated as part of the
    //    install.
    if (!fs.existsSync(opts.m)) {
        cb(new errors.UsageError(format(
            'manifest path does not exist: "%s"', opts.m)));
        return;
    }
    if (!fs.existsSync(opts.f)) {
        cb(new errors.UsageError(format(
            'file path does not exist: "%s"', opts.f)));
        return;
    }
    try {
        var manifest = JSON.parse(fs.readFileSync(opts.m, 'utf8'));
    } catch (err) {
        cb(new errors.InvalidManifestError(err));
        return;
    }
    var uuid = manifest.uuid;
    assertUuid(uuid, 'manifest.uuid');
    if (!manifest.published_at) {
        manifest.published_at = (new Date()).toISOString();
    }

    // 2. Ensure we don't already have this UUID installed.
    self.tool.getImage({uuid: uuid, zpool: zpool}, function (getErr, ii) {
        if (getErr) {
            cb(getErr);
            return;
        }
        if (ii) {
            var extra = '';
            if (ii.manifest.name) {
                extra = format(' (%s %s)', ii.manifest.name,
                    ii.manifest.version);
            }
            console.log('Image %s%s is already installed, skipping',
                ii.manifest.uuid, extra);
            cb();
            return;
        }

        // 3. Install it.
        console.log('Installing image %s (%s %s)', uuid, manifest.name,
            manifest.version);
        var installOpts = {
            manifest: manifest,
            zpool: zpool,
            file: opts.f,
            logCb: console.log
        };
        self.tool.installImage(installOpts, function (installErr) {
            if (installErr) {
                cb(installErr);
                return;
            }
            cb();
        });
    });
};
CLI.prototype.do_install.help = (
    /* BEGIN JSSTYLED */
    'Install an image from local manifest and image data files.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} install [<options>] -m <manifest> -f <file>\n'
    + '\n'
    + '{{options}}'
    /* END JSSTYLED */
);
CLI.prototype.do_install.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['m'],
        type: 'string',
        helpArg: '<manifest>',
        help: 'Required. Path to the image manifest file to import.'
    },
    {
        names: ['f'],
        type: 'string',
        helpArg: '<file>',
        help: 'Required. Path to the image file to import.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Disable progress bar.'
    },
    {
        names: ['P'],
        type: 'string',
        helpArg: '<pool>',
        help: 'Name of zpool in which to look for the image. Default is "'
            + common.DEFAULT_ZPOOL + '".'
    }
];


/**
 * `imgadm update`
 */
CLI.prototype.do_update = function do_update(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    var options = {
        dryRun: opts.dry_run
    };
    if (args.length) {
        options.uuids = args;
    }
    this.tool.updateImages(options, cb);
};
CLI.prototype.do_update.help = (
    'Update currently installed images, if necessary.\n'
    + '\n'
    + 'Images that are installed without "imgadm" (e.g. via "zfs recv")\n'
    + 'may not have cached image manifest information. Also, images installed\n'
    + 'prior to imgadm version 2.0.3 will not have a "@final" snapshot\n'
    + '(preferred for provisioning and require for incremental image\n'
    + 'creation, via "imgadm create -i ..."). This command will attempt\n'
    + 'to retrieve manifest information and to ensure images have the correct\n'
    + '"@final" snapshot, using info from current image sources.\n'
    + '\n'
    + 'If no "<uuid>" is given, then update is run for all installed images.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} update [<uuid>...]\n'
    + '\n'
    + '{{options}}'
);
CLI.prototype.do_update.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dry-run', 'n'],
        type: 'bool',
        help: 'Do a dry-run (do not actually make changes).'
    }
];



/**
 * `imgadm create [<options>] <vm-uuid> [<manifest-field>=<value> ...]`
 */
CLI.prototype.do_create = function do_create(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length < 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var vmUuid = args[0];
    assertUuid(vmUuid);
    if (opts.compression
        && !~common.VALID_COMPRESSIONS.indexOf(opts.compression))
    {
        cb(new errors.UsageError(format(
            'invalid -c,--compression "%s": must be one of "%s"',
            opts.compression, common.VALID_COMPRESSIONS.join('", "'))));
        return;
    }
    if (opts.output_template && opts.publish) {
        cb(new errors.UsageError(
            'cannot specify both -o,--output-template and -p,--publish'));
        return;
    }
    if (opts.max_origin_depth !== undefined
        && Number(opts.max_origin_depth) < 2) {
        cb(new errors.UsageError(format(
            'invalid max-origin-depth "%s": must be greater than 1',
            opts.max_origin_depth)));
        return;
    }

    function gatherManifestData(next) {
        // Pick up fields from the CLI argv.
        var argFields = {};
        for (var i = 1; i < args.length; i++) {
            var arg = args[i];
            var idx = arg.indexOf('=');
            if (idx === -1) {
                return next(new errors.UsageError(format(
                    'invalid manifest field arg "%s": must match '
                    + '"<field>=<value>"', arg)));
            }
            var key = arg.slice(0, idx);
            var value = arg.slice(idx + 1);
            // TODO: imgmanifest.FIELDS should define those for this a JSON
            // parse is reasonable. Exclude string fields from this.
            try {
                value = JSON.parse(value);
            } catch (e) {}
            argFields[key] = value;
        }

        var manifest;
        if (!opts.m) {
            manifest = {};
            next(null, objMerge(manifest, argFields));
        } else if (opts.m=== '-') {
            var stdin = '';
            process.stdin.resume();
            process.stdin.on('data', function (chunk) {
                stdin += chunk;
            });
            process.stdin.on('end', function () {
                try {
                    manifest = JSON.parse(stdin);
                } catch (ex) {
                    next(new errors.UsageError(
                        format('invalid manifest JSON on stdin: %s', ex)));
                    return;
                }
                next(null, objMerge(manifest, argFields));
            });
        } else {
            var input = fs.readFileSync(opts.m);
            try {
                manifest = JSON.parse(input);
            } catch (ex) {
                next(new errors.UsageError(format(
                    'invalid manifest JSON in "%s": %s', opts.m, ex)));
                return;
            }
            next(null, objMerge(manifest, argFields));
        }
    }

    gatherManifestData(function (manErr, manifest) {
        if (manErr) {
            cb(manErr);
            return;
        }
        self.log.debug({manifest: manifest}, 'gathered manifest data');

        // Choose the dir/file-prefix to which to save.
        var savePrefix = '';
        if (opts.publish) {
            savePrefix = format('/var/tmp/.imgadm-create-%s-%s',
                Date.now(), process.pid);
        } else if (!opts.output_template) {
            savePrefix = format('%s-%s', pathSlugify(String(manifest.name)),
                pathSlugify(String(manifest.version)));
        } else {
            var stats;
            try {
                stats = fs.statSync(opts.output_template);
            } catch (e) {}
            if (stats && stats.isDirectory()) {
                savePrefix = path.join(opts.output_template,
                    format('%s-%s', pathSlugify(String(manifest.name)),
                        pathSlugify(String(manifest.version))));
            } else {
                savePrefix = opts.output_template;
            }
        }

        var createOpts = {
            vmUuid: vmUuid,
            manifest: manifest,
            compression: opts.compression,
            incremental: opts.i,
            prepareScript: opts.s && fs.readFileSync(opts.s, 'utf8'),
            savePrefix: savePrefix,
            logCb: console.log,
            quiet: opts.quiet,
            maxOriginDepth: opts.max_origin_depth
        };
        self.tool.createImage(createOpts, function (createErr, imageInfo) {
            if (createErr) {
                cb(createErr);
            } else if (opts.publish) {
                // If '-p URL' given, publish and delete the temp created
                // image and manifest files.
                var pOpts = {
                    manifest: imageInfo.manifestPath,
                    file: imageInfo.filePath,
                    url: opts.publish,
                    quiet: opts.quiet
                };
                var pArgs = [opts.publish];
                self.do_publish('publish', pOpts, pArgs, function (pErr) {
                    async.forEach(
                        [imageInfo.manifestPath, imageInfo.filePath],
                        rimraf,
                        function (rmErr) {
                            if (rmErr) {
                                console.warn('Error removing temporary '
                                    + 'created image file: %s', rmErr);
                            }
                            cb(pErr);
                        }
                    );
                });
            } else {
                cb();
            }
        });
    });
};
CLI.prototype.do_create.help = (
    /* BEGIN JSSTYLED */
    'Create an image from the given VM and manifest data.\n'
    + '\n'
    + 'There are two basic calling modes: (1) a prepare-image script is\n'
    + 'provided (via "-s") to have imgadm automatically run the script inside the\n'
    + 'VM before image creation; or (2) the given VM is already "prepared" and\n'
    + 'shutdown.\n'
    + '\n'
    + 'The former involves snapshotting the VM, running the prepare-image script\n'
    + '(via the SmartOS mdata operator-script facility), creating the image,\n'
    + 'rolling back to the pre-prepared state. This is preferred because it is (a)\n'
    + 'easier (fewer steps to follow for imaging) and (b) safe (gating with\n'
    + 'snapshot/rollback ensures the VM is unchanged by imaging -- the preparation\n'
    + 'script is typically destructive.\n'
    + '\n'
    + 'With the latter, one first creates a VM from an existing image, customizes\n'
    + 'it, runs "sm-prepare-image" (or equivalent for KVM guest OSes), shuts it\n'
    + 'down, runs this "imgadm create" to create the image file and manifest, and\n'
    + 'finally destroys the "proto" VM.\n'
    + '\n'
    + 'With either calling mode, the image can optionally be published directly\n'
    + 'to a given image repository (IMGAPI) via "-p URL". This can also be\n'
    + 'done separately via "imgadm publish".\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} create [<options>] <vm-uuid> [<manifest-field>=<value> ...]\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Arguments:\n'
    + '    <uuid>         The UUID of the prepared and shutdown VM\n'
    + '                   from which to create the image.\n'
    + '    <manifest-field>=<value>\n'
    + '                   Zero or more manifest fields to include in\n'
    + '                   in the created manifest. The "<value>" is\n'
    + '                   first interpreted as JSON, else as a string.\n'
    + '                   E.g. \'disabled=true\' will be a boolean true\n'
    + '                   and both \'name=foo\' and \'name="true"\'\n'
    + '                   will be strings.\n'
    + '\n'
    + 'Examples:\n'
    + '    # Create an image from VM 5f7a53e9-fc4d-d94b-9205-9ff110742aaf.\n'
    + '    echo \'{"name": "foo", "version": "1.0.0"}\' \\\n'
    + '        | imgadm create -m - -s /path/to/prepare-image \\\n'
    + '            5f7a53e9-fc4d-d94b-9205-9ff110742aaf\n'
    + '    \n'
    + '    # Specify manifest data as arguments.\n'
    + '    imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \\\n'
    + '        name=foo version=1.0.0\n'
    + '    \n'
    + '    # Write the manifest and image file to "/var/tmp".\n'
    + '    imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \\\n'
    + '        name=foo version=1.0.0 -o /var/tmp\n'
    + '    \n'
    + '    # Publish directly to an image repository (IMGAPI server).\n'
    + '    imgadm create -s prep-image 5f7a53e9-fc4d-d94b-9205-9ff110742aaf \\\n'
    + '        name=foo version=1.0.0 --publish https://images.example.com\n'
    + '    \n'
    + '    # Create an image from the prepared and shutdown VM\n'
    + '    # 5f7a53e9-fc4d-d94b-9205-9ff110742aaf, using some manifest JSON\n'
    + '    # data from stdin.\n'
    + '    echo \'{"name": "foo", "version": "1.0.0"}\' \\\n'
    + '        | imgadm create -m - 5f7a53e9-fc4d-d94b-9205-9ff110742aaf\n'
    /* END JSSTYLED */
);
CLI.prototype.do_create.helpOpts = {
    helpCol: 19
};
CLI.prototype.do_create.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['m'],
        type: 'string',
        helpArg: '<manifest>',
        help: 'Path to image manifest data (as JSON) to include in the '
            + 'created manifest. Specify "-" to read manifest JSON from stdin.'
    },
    {
        names: ['output-template', 'o'],
        type: 'string',
        helpArg: '<path>',
        help: 'Path prefix to which to save the created manifest '
            + 'and image file. By default "NAME-VER.imgmanifest '
            + 'and "NAME-VER.zfs[.EXT]" are saved to the current '
            + 'dir. If "PATH" is a dir, then the files are saved '
            + 'to it. If the basename of "PATH" is not a dir, '
            + 'then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are '
            + 'created.'
    },
    {
        names: ['compression', 'c'],
        type: 'string',
        helpArg: '<comp>',
        help: 'One of "none", "gz" or "bzip2" for the compression '
            + 'to use on the image file, if any. Default is "none".'
    },
    {
        names: ['i'],
        type: 'bool',
        help: 'Build an incremental image (based on the "@final" '
            + 'snapshot of the source image for the VM).'
    },
    {
        group: ''
    },
    {
        names: ['max-origin-depth'],
        type: 'positiveInteger',
        helpArg: '<num>',
        help: 'Maximum origin depth to allow when creating '
            + 'incremental images. E.g. a value of 3 means that '
            + 'the image will only be created if there are no more '
            + 'than 3 parent images in the origin chain.'
    },
    {
        group: ''
    },
    {
        names: ['s'],
        type: 'string',
        helpArg: '<prepare-image-path>',
        help: 'Path to a script that is run inside the VM to '
            + 'prepare it for imaging. Specifying this triggers the '
            + 'full snapshot/prepare-image/create-image/rollback '
            + 'automatic image creation process (see notes above). '
            + 'There is a contract with "imgadm" that a  '
            + 'prepare-image script must follow. See the "PREPARE '
            + 'IMAGE SCRIPT" section in "man imgadm".'
    },
    {
        group: ''
    },
    {
        names: ['publish', 'p'],
        type: 'string',
        helpArg: '<url>',
        help: 'Publish directly to the given image source '
            + '(an IMGAPI server). You may not specify both '
            + '"-p" and "-o".'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Disable progress bar in upload.'
    },
];


/**
 * `imgadm publish -m <manifest> -f <file> <imgapi-url>`
 */
CLI.prototype.do_publish = function do_publish(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        return self.do_help('help', {}, [subcmd], cb);
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    assert.string(opts.m, '-m <manifest>');
    assert.string(opts.f, '-f <file>');
    assert.optionalBool(opts.quiet, '-q');
    var url = args[0];
    assert.string(url, '<imgapi-url>');

    // 1. Validate args.
    if (!fs.existsSync(opts.m)) {
        cb(new errors.UsageError(format(
            'manifest path does not exist: "%s"', opts.m)));
        return;
    }
    if (!fs.existsSync(opts.f)) {
        cb(new errors.UsageError(format(
            'file path does not exist: "%s"', opts.f)));
        return;
    }
    try {
        var manifest = JSON.parse(fs.readFileSync(opts.m, 'utf8'));
    } catch (err) {
        cb(new errors.InvalidManifestError(err));
        return;
    }

    var pubOpts = {
        file: opts.f,
        manifest: manifest,
        url: url,
        quiet: opts.quiet
    };
    self.tool.publishImage(pubOpts, function (pubErr) {
        if (pubErr) {
            cb(pubErr);
        } else {
            console.log('Successfully published image %s to %s',
                manifest.uuid, url);
            cb();
        }
    });
};
CLI.prototype.do_publish.help = (
    /* BEGIN JSSTYLED */
    'Publish an image (local manifest and data) to a remote IMGAPI repo.\n'
    + '\n'
    + 'Typically the local manifest and image file are created with\n'
    + '"imgadm create ...". Note that "imgadm create" supports a\n'
    + '"-p/--publish" option to publish directly in one step.\n'
    + 'Limitation: This does not yet support *authentication* that some\n'
    + 'IMGAPI image repositories require.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} publish [<options>] -m <manifest> -f <file> <imgapi-url>\n'
    + '\n'
    + '{{options}}'
    /* END JSSTYLED */
);
CLI.prototype.do_publish.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['m'],
        type: 'string',
        helpArg: '<manifest>',
        help: 'Required. Path to the image manifest to import.'
    },
    {
        names: ['f'],
        type: 'string',
        helpArg: '<file>',
        help: 'Required. Path to the image file to import.'
    },
    {
        names: ['quiet', 'q'],
        type: 'bool',
        help: 'Disable progress bar in upload.'
    },
];



// ---- exports

module.exports = CLI;
