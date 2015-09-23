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
var bunyan = require('bunyan');
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var Cmdln = require('cmdln').Cmdln;
var fs = require('fs');
var genUuid = require('node-uuid');
var os = require('os');
var path = require('path');
var restify = require('restify');
var rimraf = require('rimraf');
var sprintf = require('extsprintf').sprintf;
var tabula = require('tabula');
var util = require('util'),
    format = util.format;
var vasync = require('vasync');

var imgadm = require('./imgadm');
var common = require('./common'),
    objCopy = common.objCopy,
    objMerge = common.objMerge,
    NAME = common.NAME,
    pathSlugify = common.pathSlugify,
    assertUuid = common.assertUuid;
var docker = require('./sources/docker');
var errors = require('./errors');



// ---- globals

var pkg = require('../package.json');



// ---- internal support functions

/**
 * Take CLI input args of the form FIELD=VALUE (or similar) and transform
 * to an object of `filters` which can be used with `filterImagesInfo`.
 */
function filtersFromArgs(args) {
    assert.arrayOfString(args, 'args');

    var filters = {};
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        var idx = arg.indexOf('=');
        if (idx === -1) {
            throw new errors.UsageError(format(
                'invalid filter: "%s" (must be of the form "field=value")',
                arg));
        }
        var argVal = arg.slice(idx + 1);
        if (argVal === 'true') {
            argVal = true;
        } else if (argVal === 'false') {
            argVal = false;
        }
        filters[arg.slice(0, idx)] = argVal;
    }
    return filters;
}

/**
 * Return a "row" with the manifest fields and a number of calculate
 * convenience fields to be used for filtering and listing.
 *
 * Dev Note: Update the `do_list.help` docs below when changing row fields.
 *
 * Dev Note: this modifies `imageInfo.manifest` in-place.
 */
function rowFromImageInfo(imageInfo) {
    assert.object(imageInfo, 'imageInfo');

    var row = imageInfo.manifest;
    if (row.published_at) {
        // Just the date.
        row.published_date = row.published_at.slice(0, 10);
        // Normalize on no milliseconds.
        row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
    }
    row.source = imageInfo.source;
    row.clones = imageInfo.clones;
    row.zpool = imageInfo.zpool;
    if (row.files && row.files[0]) {
        row.size = row.files[0].size;
    }

    if (row.type === 'docker') {
        row.docker_id = row.tags['docker:id'];
        row.docker_short_id = row.docker_id.slice(0, 12);
        row.docker_repo = row.tags['docker:repo'];
        row.docker_tags = Object.keys(row.tags).filter(function (t) {
            return t.slice(0, 11) === 'docker:tag:';
        }).map(function (t) { return t.slice(11); });
    }

    return row;
}

/* BEGIN JSSTYLED */
var rowFieldsHelp = (
      '    Any of the manifest fields (see `imgadm {{cmd}} -j` output) plus the\n'
    + '    following computed fields for convenience.\n'
    + '\n'
    + '    published_date            just the date part of `published_at`\n'
    + '    published                 `published_at` with the milliseconds removed\n'
    + '    source                    the source URL, if available\n'
    + '    clones                    the number of clones (dependent images and VMs)\n'
    + '    size                      the size, in bytes, of the image file\n'
    + '\n'
    + '    In addition if this is a docker image, then the following:\n'
    + '\n'
    + '    docker_id                 the full docker id string\n'
    + '    docker_short_id           the short 12 character docker id\n'
    + '    docker_repo               the docker repo from which this image\n'
    + '                              originates, if available\n'
    + '    docker_tags               a JSON array of docker repo tags, if available\n');
/* END JSYSTYLED */


function filterImagesInfo(imagesInfo, filters) {
    assert.arrayOfObject(imagesInfo, 'imagesInfo');
    assert.object(filters, 'filters');

    var fields = Object.keys(filters);
    if (fields.length === 0) {
        return imagesInfo;
    }

    var filtered = [];
    for (var j = 0; j < imagesInfo.length; j++) {
        var row = rowFromImageInfo(imagesInfo[j]);
        var keep = true;
        for (var f = 0; f < fields.length; f++) {
            var field = fields[f];
            var val = filters[field];
            var lookups = field.split(/\./g);
            var actual = row;
            for (var k = 0; k < lookups.length; k++) {
                actual = actual[lookups[k]];
                if (actual === undefined) {
                    break;
                }
            }
            if (actual === undefined) {
                keep = false;
                break;
            } else if (typeof (val) === 'boolean') {
                if (val !== actual) {
                    keep = false;
                    break;
                }
            } else if (val[0] === '~') {
                if (actual.indexOf(val.slice(1)) === -1) {
                    keep = false;
                    break;
                }
            } else {
                if (String(actual) !== val) {
                    keep = false;
                    break;
                }
            }
        }
        if (keep) {
            filtered.push(imagesInfo[j]);
        }
    }
    return filtered;
}


function listImagesInfo(imagesInfo, opts) {
    assert.arrayOfObject(imagesInfo, 'imagesInfo');
    assert.optionalObject(opts, 'opts');
    if (!opts) {
        opts = {};
    }
    assert.optionalBool(opts.json, 'opts.json');
    assert.optionalBool(opts.skipHeader, 'opts.skipHeader');
    assert.optionalBool(opts.docker, 'opts.docker');
    assert.optionalArrayOfString(opts.columns, 'opts.columns');
    assert.optionalArrayOfString(opts.sort, 'opts.sort');

    if (opts.json) {
        console.log(JSON.stringify(imagesInfo, null, 2));
    } else {
        var rows = imagesInfo.map(
            function (imageInfo) { return rowFromImageInfo(imageInfo); });

        /**
         * `docker images`-like output:
         * - only docker images
         * - one row per *tag*
         * - skip "non-head" images (see docker/graph/list.go)
         */
        if (opts.docker) {
            var i, row;
            var isOriginFromUuid = {};
            for (i = 0; i < rows.length; i++) {
                row = rows[i];
                if (isOriginFromUuid[row.uuid] === undefined) {
                    isOriginFromUuid[row.uuid] = false;
                }
                if (row.origin) {
                    isOriginFromUuid[row.origin] = true;
                }
            }
            var dRows = [];
            for (i = 0; i < rows.length; i++) {
                row = rows[i];
                if (row.type !== 'docker') {
                    continue;
                }
                var isHead = !isOriginFromUuid[row.uuid];
                if (!isHead) {
                    continue;
                }
                (row.docker_tags.length ? row.docker_tags : [null]).forEach(
                    function (dTag) {
                        var dRow = objCopy(row);
                        dRow.docker_tag = dTag;
                        dRows.push(dRow);
                    });
            }
            rows = dRows;

            // Override display opts.
            opts.columns = [
                {name: 'UUID', lookup: 'uuid'},
                {name: 'REPOSITORY', lookup: 'docker_repo'},
                {name: 'TAG', lookup: 'docker_tag'},
                {name: 'IMAGE_ID', lookup: 'docker_short_id'},
                {name: 'CREATED', lookup: 'published'}
            ];
            opts.sort = ['published_at'];
        }

        tabula(rows, {
            skipHeader: opts.skipHeader,
            columns: opts.columns,
            sort: opts.sort
        });
    }
}



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
                help: 'Verbose output: trace-level logging, stack on error. '
                    + 'See IMGADM_LOG_LEVEL envvar.'},
            {name: 'E', type: 'bool',
                help: 'On error, emit a structured JSON error object as the '
                    + 'last line of stderr output.'}
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
     * - '-v|--verbose' or IMGADM_LOG_LEVEL=trace to set to trace-level
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
    if (opts.verbose) {
        log.level('trace');
        log.src = true;
    } else if (IMGADM_LOG_LEVEL) {
        log.level(IMGADM_LOG_LEVEL);
        if (IMGADM_LOG_LEVEL === 'trace') {
            log.src = true;
        }
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
            cb(err);
            return;
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
    var lines = [];
    if (this.desc) {
        lines.push(this.desc);
    }

    lines = lines.concat([
        '',
        'Usage:',
        '    {{name}} [<options>] <command> [<args>...]',
        '    {{name}} help <command>',
        ''
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
        '    imgadm avail [<filters>]               list available images',
        '    imgadm show <uuid|docker-repo-tag>     show manifest of an available image',
        '',
        '    imgadm import [-P <pool>] <image-id>   import image from a source',
        '    imgadm install [-P <pool>] -m <manifest> -f <file>',
        '                                           import from local image data',
        '',
        '    imgadm list [<filters>]                list installed images',
        '    imgadm get [-P <pool>] <uuid>          info on an installed image',
        '    imgadm update [<uuid>...]              update installed images',
        '    imgadm delete [-P <pool>] <uuid>       remove an installed image',
        '    imgadm ancestry [-P <pool>] <uuid>     show ancestry of an installed image',
        '    imgadm vacuum [-n] [-f]                delete unused images',
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
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length > 0) {
        cb(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }

    if (opts.add_docker_hub) {
        opts.a = 'https://docker.io';
        opts.type = 'docker';
    }

    var nActions = 0;
    if (opts.e) nActions++;
    if (opts.a) nActions++;
    if (opts.d) nActions++;
    if (opts.check) nActions++;
    if (nActions > 1) {
        cb(new errors.UsageError(
            'cannot specify more than one of "-a", "-d", "-e", and "-c"'));
        return;
    }
    var skipPingCheck = opts.force === true;

    if (opts.e) {
        var before = self.tool.sources.map(function (s) {
            return s.toJSON();
        });

        var width = 0;
        self.tool.sources.forEach(function (s) {
            width = Math.max(width, s.url.length);
        });
        var template = format('%%-%ds  %%-%ds  %%s', Math.min(width, 50), 6);
        var beforeText = before.map(function (s) {
                var options = [];
                if (s.insecure) {
                    options.push('insecure');
                }
                return sprintf(template, s.url, s.type, options.join(','))
                    .trimRight();
            }).join('\n')
            + '\n\n'
            + '#\n'
            + '# Enter sources, one per line, as follows:\n'
            + '#\n'
            + '#   URL TYPE [OPTIONS]\n'
            + '#\n'
            + '# where "TYPE" is one of "imgapi" (the default), "docker", or\n'
            + '# "dsapi" (deprecated); and where "OPTIONS" is the literal\n'
            + '# string "insecure" to skip TLS server certificate checking\n'
            + '# for this source.\n'
            + '#\n'
            + '# Comments beginning with "#" are stripped.\n'
            + '#\n';
        var tmpPath = path.resolve(os.tmpDir(),
            format('imgadm-sources-%s.txt', process.pid));
        fs.writeFileSync(tmpPath, beforeText, 'utf8');

        function sourcesInfoFromText(text) {
            return text.trim().split(/\n/g)
                .map(function (line) {
                    return line.split('#')[0].trim();  // drop comments
                }).filter(function (line) {
                    return line.length;  // drop blank lines
                }).map(function (line) {
                    var parts = line.split(/\s+/g);
                    if (!parts[1]) {
                        parts[1] = 'imgapi'; // default type
                    }
                    var s = {url: parts[0], type: parts[1]};
                    if (parts[2]) {
                        // JSSTYLED
                        var options = parts[2].trim().split(/,/g);
                        for (var i = 0; i < options.length; i++) {
                            switch (options[i]) {
                            case 'insecure':
                                s.insecure = true;
                                break;
                            default:
                                throw new errors.UsageError('unknown source '
                                    + 'option: ' + options[i]);
                            }
                        }
                    }
                    return s;
                });
        }

        // TODO: re-editing if error adding (e.g. typo in type or whtaever)
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
            try {
                var after = sourcesInfoFromText(afterText);
            } catch (ex) {
                cb(ex);
                return;
            }
            if (JSON.stringify(after) === JSON.stringify(before)) {
                console.log('Image sources unchanged');
                cb();
                return;
            }

            self.log.info({after: after}, 'update sources');
            self.tool.updateSources(after, skipPingCheck,
                    function (err, changes) {
                if (err) {
                    cb(err);
                } else {
                    changes.forEach(function (change) {
                        if (change.type === 'reorder') {
                            console.log('Reordered image sources');
                        } else if (change.type === 'add') {
                            console.log('Added %s', change.source);
                        } else if (change.type === 'del') {
                            console.log('Deleted %s', change.source);
                        }
                    });
                    cb();
                }
            });
        });

    } else if (opts.a) {
        var addOpts = {
            url: opts.a,
            type: opts.type,
            insecure: opts.insecure
        };
        this.tool.configAddSource(addOpts, skipPingCheck,
            function (err, changed, source) {
                if (err) {
                    cb(err);
                } else if (changed) {
                    console.log('Added %s', source);
                    cb();
                } else {
                    console.log('Already have %s, no change', source);
                    cb();
                }
            }
        );

    } else if (opts.d) {
        this.tool.configDelSourceUrl(opts.d, function (err, deleted) {
            if (err) {
                cb(err);
            } else if (deleted) {
                deleted.forEach(function (s) {
                    console.log('Deleted %s', s);
                });
                cb();
            } else {
                console.log('Do not have image source "%s", no change',
                    opts.d);
                cb();
            }
        });

    } else if (opts.check) {
        var rows = [];
        vasync.forEachParallel({
            inputs: this.tool.sources,
            func: function pingCheck(source, next) {
                source.ping(function (pingErr) {
                    var row = {url: source.url, type: source.type};
                    if (pingErr) {
                        row.ok = false;
                        row.error = pingErr.toString();
                    } else {
                        row.ok = true;
                    }
                    rows.push(row);
                    next(null);
                });
            }
        }, function donePingChecks(err) {
            if (err) {
                cb(err);
                return;
            }
            tabula(rows, {columns: ['url', 'type', 'ok', 'error']});
            cb();
        });

    } else {
        // The default flat list of source *urls*.
        var sources = this.tool.sources.map(function (s) {
            return {url: s.url, type: s.type, insecure: s.insecure};
        });
        if (opts.json) {
            console.log(JSON.stringify(sources, null, 2));
        } else if (opts.verbose) {
            tabula(sources, {columns: ['url', 'type', 'insecure']});
        } else {
            // The default flat list of source *urls*.
            sources.forEach(function (s) {
                console.log(s.url);
            });
        }
        cb();
    }
};
CLI.prototype.do_sources.help = (
    /* BEGIN JSSTYLED */
    'List and edit image sources.\n'
    + '\n'
    + 'An image source is a URL to a server implementing the IMGAPI, or\n'
    + 'the Docker Registry API. The default IMGAPI is ' + common.DEFAULT_SOURCE.url + '\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} sources [--verbose|-v] [--json|-j]  # list sources\n'
    + '    {{name}} sources -a <url> [-t <type>]        # add a source\n'
    + '    {{name}} sources -d <url>                    # delete a source\n'
    + '    {{name}} sources -e                          # edit sources\n'
    + '    {{name}} sources -c                          # check current sources\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Examples:\n'
    + '    # Joyent\'s primary public image repository (defaults to "imgapi")\n'
    + '    {{name}} sources -a https://images.joyent.com\n'
    + '    # Docker Hub\n'
    + '    {{name}} sources -a https://docker.io -t docker\n'
    + '    # Legacy SDC 6.5 DSAPI (deprecated)\n'
    + '    {{name}} sources -a https://datasets.joyent.com/datasets -t dsapi\n'
    /* END JSSTYLED */
);
CLI.prototype.do_sources.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['verbose', 'v'],
        type: 'bool',
        help: 'Verbose output. List source URL and TYPE.'
    },
    {
        names: ['json', 'j'],
        type: 'bool',
        help: 'List sources as JSON.'
    },
    {
        group: ''
    },
    {
        names: ['a'],
        type: 'string',
        helpArg: '<source>',
        help: 'Add a source. It is appended to the list of sources.'
    },
    {
        names: ['add-docker-hub'],
        type: 'bool',
        help: 'A shortcut for "imgadm sources -t docker -a https://docker.io".'
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
        names: ['check', 'c'],
        type: 'bool',
        help: 'Ping check all sources.'
    },
    {
        group: ''
    },
    {
        names: ['type', 't'],
        type: 'string',
        default: 'imgapi',
        helpArg: '<type>',
        help: 'The source type for an added source. One of "imgapi" (the '
            + 'default), "docker", or "dsapi" (deprecated).'
    },
    {
        names: ['insecure', 'k'],
        type: 'bool',
        help: 'Allow insecure (no server certificate checking) access '
            + 'to the added HTTPS source URL.'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Force no "ping check" on new source URLs. By default '
            + 'a ping check is done against new source URLs to '
            + 'attempt to ensure they are a running IMGAPI server.'
    }
];


CLI.prototype.do_avail = function do_avail(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }

    try {
        var filters = filtersFromArgs(args);
    } catch (e) {
        cb(e);
        return;
    }
    self.log.debug({filters: filters}, 'avail filters');

    /* JSSTYLED */
    var columns = opts.o.trim().split(/\s*,\s*/g);
    /* JSSTYLED */
    var sort = opts.s.trim().split(/\s*,\s*/g);

    self.tool.sourcesList(function (err, imagesInfo) {
        // Even if there was an err, we still attempt to return results
        // for working sources.
        try {
            imagesInfo = filterImagesInfo(imagesInfo, filters);

            listImagesInfo(imagesInfo, {
                json: opts.json,
                columns: columns,
                sort: sort,
                skipHeader: opts.H
            });
        } catch (e) {
            cb(e);
            return;
        }
        cb(err);
    });
};
CLI.prototype.do_avail.help = (
    'List available images from all sources.\n'
    + 'This is not supported for Docker sources.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} avail [<options>...]\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Fields for "-o" and "-s":\n'
    + rowFieldsHelp
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
        helpArg: 'FIELD,...',
        help: 'Specify fields (columns) to output. Default is '
            + '"uuid,name,version,os,published".',
        default: 'uuid,name,version,os,published'
    },
    {
        names: ['s'],
        type: 'string',
        helpArg: 'FIELD,...',
        help: 'Sort on the given fields. Default is "published_at,name".',
        default: 'published_at,name'
    }
];
CLI.prototype.do_avail.aliases = ['available'];


CLI.prototype.do_list = function do_list(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    var log = self.log;
    log.debug({opts: opts}, 'list');

    try {
        var filters = filtersFromArgs(args);
    } catch (e) {
        cb(e);
        return;
    }
    if (opts.docker) {
        filters['type'] = 'docker';
    }
    if (args) {
        log.debug({filters: filters}, 'list filters');
    }

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

        try {
            imagesInfo = filterImagesInfo(imagesInfo, filters);

            listImagesInfo(imagesInfo, {
                json: opts.json,
                columns: columns,
                sort: sort,
                skipHeader: opts.H,
                docker: opts.docker
            });
        } catch (e) {
            cb(e);
            return;
        }
        cb();
    });
};
CLI.prototype.do_list.help = (
    'List locally installed images.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} list [<options>...] [<filters>]\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Filters:\n'
    + '    FIELD=VALUE               exact string match\n'
    + '    FIELD=true|false          boolean match\n'
    + '    FIELD=~SUBSTRING          substring match\n'
    + '\n'
    + 'Fields for filtering, "-o" and "-s":\n'
    + rowFieldsHelp
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
        helpArg: 'FIELD,...',
        help: 'Specify fields (columns) to output. Default is '
            + '"uuid,name,version,os,published".',
        default: 'uuid,name,version,os,published'
    },
    {
        names: ['s'],
        type: 'string',
        helpArg: 'FIELD,...',
        help: 'Sort on the given fields. Default is "published_at,name".',
        default: 'published_at,name'
    },
    {
        names: ['docker'],
        type: 'bool',
        help: 'Limit and format list similar to `docker images`'
    }
];


CLI.prototype.do_show = function do_show(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }

    var getOpts = {
        arg: args[0],
        ensureActive: false
    };
    self.tool.sourcesGetImportInfo(getOpts, function (err, importInfo) {
        if (err) {
            cb(err);
            return;
        } else if (!importInfo) {
            cb(new errors.ImageNotFoundError(getOpts.arg));
            return;
        } else if (importInfo.manifest) {
            // IMGAPI/DSAPI return the manifest with source.getImportInfo().
            console.log(JSON.stringify(importInfo.manifest, null, 2));
            cb();
            return;
        }

        importInfo.source.getImgMeta(importInfo, function (metaErr, imgMeta) {
            if (metaErr) {
                cb(metaErr);
                return;
            }
            console.log(JSON.stringify(imgMeta.manifest, null, 2));
            cb();
        });
    });
};
CLI.prototype.do_show.help = (
    'Show the manifest for an available image.\n'
    + '\n'
    + 'This searches each imgadm source for the given image and prints its\n'
    + 'its manifest.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} show <uuid|docker-repo-tag>\n'
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
        self.do_help('help', {}, [subcmd], cb);
        return;
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
 * `imgadm ancestry <uuid>`
 */
CLI.prototype.do_ancestry = function do_ancestry(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assert.uuid(uuid, 'uuid');
    var zpool = opts.P || common.DEFAULT_ZPOOL;
    /* JSSTYLED */
    var columns = opts.o.trim().split(/\s*,\s*/g);
    var log = self.log;
    log.debug({opts: opts, zpool: zpool, uuid: uuid}, 'ancestry');

    var ancestry = [];
    getNextAncestor(uuid);


    function getNextAncestor(aUuid) {
        var getOpts = {uuid: aUuid, zpool: zpool};
        self.tool.getImage(getOpts, function (err, imageInfo) {
            if (err) {
                cb(err);
                return;
            }
            if (!imageInfo) {
                cb(new errors.ImageNotInstalledError(zpool, aUuid));
                return;
            }
            ancestry.push(imageInfo);
            if (imageInfo.manifest.origin) {
                getNextAncestor(imageInfo.manifest.origin);
            } else {
                finish();
            }
        });
    }

    function finish() {
        try {
            listImagesInfo(ancestry, {
                json: opts.json,
                columns: columns,
                skipHeader: opts.H
            });
        } catch (e) {
            cb(e);
            return;
        }
        cb();
    }
};
CLI.prototype.do_ancestry.help = (
    'List the ancestry (the "origin" chain) for the given incremental image.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} ancestry [<options>...] <uuid>\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'Fields for "-o":\n'
    + rowFieldsHelp
);
CLI.prototype.do_ancestry.options = [
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
        helpArg: 'FIELD,...',
        help: 'Specify fields (columns) to output. Default is '
            + '"uuid,name,version,published".',
        default: 'uuid,name,version,published'
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
 * `imgadm delete <uuid>`
 */
CLI.prototype.do_delete = function do_delete(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
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
 * `imgadm import <uuid>` for imgapi/dsapi imports
 * `imgadm import <repo>[:<tag>]` for docker imports
 */
CLI.prototype.do_import = function do_import(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    if (args.length !== 1) {
        cb(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var arg = args[0];
    var log = self.log;
    var zpool = opts.P || common.DEFAULT_ZPOOL;

    vasync.pipeline({arg: {}, funcs: [
        function validateArg(ctx, next) {
            if (common.UUID_RE.test(arg)) {
                ctx.uuid = arg;
            } else if (docker.isDockerPullArg(arg)) {
                ctx.dockerId = arg;
            } else {
                next(new errors.UsageError(format(
                    'invalid image-id arg: %j', arg)));
                return;
            }
            log.info({uuid: ctx.uuid, dockerId: ctx.dockerId, arg: arg},
                'image-id validated');
            next();
        },

        function checkIfUuidInstalled(ctx, next) {
            if (!ctx.uuid) {
                next();
                return;
            }

            var getOpts = {uuid: ctx.uuid, zpool: zpool};
            self.tool.getImage(getOpts, function (getErr, ii) {
                if (getErr) {
                    next(getErr);
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
                    next(true);
                } else {
                    next();
                }
            });
        },

        function getImportInfo(ctx, next) {
            var getOpts = { arg: arg };
            if (opts.source) {
                getOpts.sources = opts.source.map(function (s) {
                    return self.tool.sourceFromInfo({
                        url: s,
                        type: 'imgapi'
                    });
                });
            }
            self.tool.sourcesGetImportInfo(getOpts, function (err, info) {
                if (err) {
                    next(err);
                    return;
                } else if (!info) {
                    next(new errors.ActiveImageNotFoundError(arg));
                    return;
                }
                self.log.info({importInfo: info, arg: arg},
                    'found source for import');
                ctx.importInfo = info;
                next();
            });
        },

        /*
         * If the `arg` was a uuid, then we were able to check if it was
         * already installed before consulting the source API. If `arg` *wasn't*
         * we now have a UUID that we can check.
         */
        function checkIfImageInstalled(ctx, next) {
            if (ctx.uuid) {
                next();
                return;
            }
            assert.uuid(ctx.importInfo.uuid, 'ctx.importInfo.uuid');

            var getOpts = {
                uuid: ctx.importInfo.uuid,
                zpool: zpool
            };
            self.tool.getImage(getOpts, function (getErr, ii) {
                if (getErr) {
                    next(getErr);
                    return;
                } else if (ii) {
                    var extra1 = '';
                    if (ii.manifest.name) {
                        extra1 = format(' (%s@%s)', ii.manifest.name,
                            ii.manifest.version);
                    }
                    var extra2 = '';
                    if (ii.source) {
                        extra2 = ' from ' + ii.source;
                    }
                    console.log('Image %s%s is already installed%s',
                        ii.manifest.uuid, extra1, extra2);
                    next(true); // early abort
                } else {
                    next();
                }
            });
        },

        function importIt(ctx, next) {
            self.tool.importImage({
                importInfo: ctx.importInfo,
                zpool: zpool,
                zstream: opts.zstream,
                quiet: opts.quiet,
                logCb: console.log
            }, next);
        }

    ]}, function finish(err) {
        if (err === true) { // Early abort.
            err = null;
        }
        cb(err);
    });
};
CLI.prototype.do_import.help = (
    'Import an image from a source IMGAPI.\n'
    + '\n'
    + 'This finds the image with the given UUID (or repository name and tag,\n'
    + 'for Docker sources) in the configured sources and imports it into\n'
    + 'the local system.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} import <uuid|docker repo:tag>\n'
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
    },
    {
        names: ['source', 'S'],
        type: 'arrayOfString',
        helpArg: '<source>',
        help: 'An image source (url) from which to import. If given, then '
            + 'this source is used instead of the configured sources.'
    },
    {
        names: ['zstream'],
        type: 'bool',
        help: 'Indicate that the source will send a raw ZFS dataset stream for '
            + 'the image file data. Typically this is used in conjunction '
            + 'with -S, so the source is known, and with a source that '
            + 'stores images in ZFS (e.g. a SmartOS peer node).'
    }
];



/**
 * `imgadm install -m <manifest> -f <file>`
 */
CLI.prototype.do_install = function do_install(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
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
        console.log('Installing image %s (%s@%s)', uuid, manifest.name,
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
        self.do_help('help', {}, [subcmd], cb);
        return;
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
    + 'This does not yet support images from a "docker" source.\n'
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


// TODO: option to exclude images with a very recent create/import time
//      imgadm vacuum -t 2d
// TODO: option to exclude given uuids:  imgadm vacuum -x uuid,uuid
CLI.prototype.do_vacuum = function do_vacuum(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
    }
    var options = {
        logCb: console.log,
        dryRun: opts.dry_run,
        force: opts.force
    };
    if (args.length) {
        cb(new errors.UsageError('unexpected arguments: ' + args.join(' ')));
    }
    this.tool.vacuumImages(options, cb);
};
CLI.prototype.do_vacuum.help = (
    'Remove unused images -- i.e. not used for any VMs or child images.\n'
    + '\n'
    + 'Usage:\n'
    + '    {{name}} vacuum [<options>]\n'
    + '\n'
    + '{{options}}'
);
CLI.prototype.do_vacuum.options = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Show this help.'
    },
    {
        names: ['dry-run', 'n'],
        type: 'bool',
        help: 'Do a dry-run (do not actually make changes).'
    },
    {
        names: ['force', 'f'],
        type: 'bool',
        help: 'Force deletion without prompting for confirmation.'
    }
];



/**
 * `imgadm create [<options>] <vm-uuid> [<manifest-field>=<value> ...]`
 */
CLI.prototype.do_create = function do_create(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
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
        } else if (opts.m === '-') {
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
            incremental: opts.incremental,
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
                    m: imageInfo.manifestPath,
                    f: imageInfo.filePath,
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
        names: ['incremental', 'i'],
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
    }
];


/**
 * `imgadm publish -m <manifest> -f <file> <imgapi-url>`
 */
CLI.prototype.do_publish = function do_publish(subcmd, opts, args, cb) {
    var self = this;
    if (opts.help) {
        self.do_help('help', {}, [subcmd], cb);
        return;
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
    }
];



// ---- exports

module.exports = CLI;
