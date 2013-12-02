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
 * The main entry point for an the imgadm CLI.
 */

var util = require('util'),
    format = util.format;
var p = console.warn;
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var os = require('os');
var path = require('path');
var fs = require('fs');
var assert = require('assert-plus');
var async = require('async');
var nopt = require('nopt');
var sprintf = require('extsprintf').sprintf;
var rimraf = require('rimraf');
var bunyan;
if (process.platform === 'sunos') {
    bunyan = require('/usr/node/node_modules/bunyan');
} else {
    bunyan = require('bunyan');
}

var imgadm = require('./imgadm');
var common = require('./common'),
    objCopy = common.objCopy,
    objMerge = common.objMerge,
    NAME = common.NAME,
    pathSlugify = common.pathSlugify,
    assertUuid = common.assertUuid;
var errors = require('./errors');



// ---- globals

var DESCRIPTION = (
    'Manage SmartOS virtual machine images.\n'
);
var SUFFIX = (
    'See `imgadm help <command>` or the imgadm(1m) man page for more details.'
);



// ---- internal support stuff

/**
 * Print a table of the given items.
 *
 * @params items {Array}
 * @params options {Object}
 *      - `columns` {String} of comma-separated field names for columns
 *      - `skipHeader` {Boolean} Default false.
 *      - `sort` {String} of comma-separate fields on which to alphabetically
 *        sort the rows. Optional.
 *      - `validFields` {String} valid fields for `columns` and `sort`
 */
function tabulate(items, options) {
    assert.arrayOfObject(items, 'items');
    assert.object(options, 'options');
    assert.string(options.columns, 'options.columns');
    assert.optionalBool(options.skipHeader, 'options.skipHeader');
    assert.optionalString(options.sort, 'options.sort');
    assert.string(options.validFields, 'options.validFields');

    if (items.length === 0) {
        return;
    }

    // Validate.
    var validFields = options.validFields.split(',');
    var columns = options.columns.split(',');
    var sort = options.sort ? options.sort.split(',') : [];
    columns.forEach(function (c) {
        if (validFields.indexOf(c) === -1) {
            throw new TypeError(format('invalid output field: "%s"', c));
        }
    });
    sort.forEach(function (s) {
        if (validFields.indexOf(s) === -1) {
            throw new TypeError(format('invalid sort field: "%s"', s));
        }
    });

    // Determine columns and widths.
    var widths = {};
    columns.forEach(function (c) { widths[c] = c.length; });
    items.forEach(function (i) {
        columns.forEach(function (c) {
            widths[c] = Math.max(widths[c], (i[c] ? String(i[c]).length : 0));
        });
    });

    var template = '';
    columns.forEach(function (c) {
        template += '%-' + String(widths[c]) + 's  ';
    });
    template = template.trim();

    if (sort.length) {
        function cmp(a, b) {
            for (var i = 0; i < sort.length; i++) {
                var field = sort[i];
                var invert = false;
                if (field[0] === '-') {
                    invert = true;
                    field = field.slice(1);
                }
                assert.ok(field.length,
                    'zero-length sort field: ' + options.sort);
                var a_cmp = Number(a[field]);
                var b_cmp = Number(b[field]);
                if (isNaN(a_cmp) || isNaN(b_cmp)) {
                    a_cmp = a[field];
                    b_cmp = b[field];
                }
                if (a_cmp < b_cmp) {
                    return (invert ? 1 : -1);
                } else if (a_cmp > b_cmp) {
                    return (invert ? -1 : 1);
                }
            }
            return 0;
        }
        items.sort(cmp);
    }

    if (!options.skipHeader) {
        var header = columns.map(function (c) { return c.toUpperCase(); });
        header.unshift(template);
        console.log(sprintf.apply(null, header));
    }
    items.forEach(function (i) {
        var row = columns.map(function (c) {
            var cell = i[c];
            if (cell === null || cell === undefined) {
                return '-';
            } else {
                return String(i[c]);
            }
        });
        row.unshift(template);
        console.log(sprintf.apply(null, row));
    });
}


/**
 * Return an 80-column wrapped string.
 */
function textWrap(text) {
    var width = 80;
    var words = text.split(/\s+/g).reverse();
    var lines = [];
    var line = '';
    while (words.length) {
        var word = words.pop();
        if (line.length + 1 + word.length >= width) {
            lines.push(line);
            line = '';
        }
        if (line.length)
            line += ' ' + word;
        else
            line += word;
    }
    lines.push(line);
    return lines.join('\n');
}



// ---- CLI object

/**
 * Create an imgadm CLI instance.
 */
function CLI() {
    var self = this;
    this.name = NAME;
    this.description = DESCRIPTION;
    this.suffix = SUFFIX;
    this.envopts = [];

    // Load subcmds.
    this.subcmds = {};
    this.aliases = {};
    Object.keys(this.constructor.prototype)
        .filter(function (funcname) { return /^do_/.test(funcname); })
        .sort()
        .forEach(function (funcname) {
            var name = funcname.slice(3);
            var func = self.constructor.prototype[funcname];
            self.subcmds[name] = func;
            self.aliases[name] = name;
            (func.aliases || []).forEach(function (alias) {
                self.aliases[alias] = name;
            });
        });

    this.helpcmds = {};
    Object.keys(this.constructor.prototype)
        .filter(function (funcname) { return /^help_/.test(funcname); })
        .sort()
        .forEach(function (funcname) {
            var name = funcname.slice(5);
            var func = self.constructor.prototype[funcname];
            self.helpcmds[name] = func;
        });
}


/* BEGIN JSSTYLED */
/**
 * If an `err` is given, then log and print the error.
 *
 * By default a single line for an error is printed:
 *      imgadm: error (UnknownCommand): unknown command: "bogus"
 *
 * With the '-v, --verbose' option a traceback is printed:
 *      imgadm: error (UnknownCommand): unknown command: "bogus"
 *
 *      UnknownCommandError: unknown command: "bogus"
 *          at CLI.dispatch (/usr/img/lib/cli.js:456:18)
 *          at CLI.main (/usr/img/lib/cli.js:319:22)
 *          at /usr/img/lib/imgadm.js:1732:9
 *          at _asyncMap (/usr/img/node_modules/async/lib/async.js:190:13)
 *          at async.forEachSeries.iterate (/usr/img/node_modules/async/lib/async.js:116:25)
 *          at _asyncMap (/usr/img/node_modules/async/lib/async.js:187:17)
 *          at async.series.results (/usr/img/node_modules/async/lib/async.js:491:34)
 *          at doneSources (/usr/img/lib/imgadm.js:430:17)
 *          at async.forEachSeries.iterate (/usr/img/node_modules/async/lib/async.js:116:25)
 *          at IMGADM._addSource (/usr/img/lib/imgadm.js:520:9)
 *
 * If '-E' is specified the error will be a Bunyan log record (single-line
 * of JSON) with an `err` field.
 */
/* END JSSTYLED */
CLI.prototype.printErr = function printErr(err, msg) {
    var self = this;
    if (err) {
        if (self.structuredErr) {
            self.log.error(err, msg);
        } else {
            if (err.code) {
                console.error(format('%s: error (%s): %s', self.name,
                    err.code, err.message));
            } else {
                console.error(format('%s: error: %s', self.name,
                    err.message || err));
            }
            if (self.verbose && err.stack) {
                console.error('\n' + err.stack);
            }
        }
    }
};


/**
 * CLI mainline.
 *
 * @param argv {Array}
 * @param options {Object}
 *      - `log` {Bunyan Logger}
 * @param callback {Function} `function (err, printErr)`
 *      Where `printErr` indicates whether and how to print a possible `err`.
 *      It is one of `false` (don't print it), `true` (print it), or
 *      Where `verbose` is a boolean indicating if verbose output was
 *      requested by user options.
 */
CLI.prototype.main = function main(argv, options, callback) {
    var self = this;
    assert.arrayOfString(argv, 'argv');
    assert.object(options, 'options');
    assert.optionalObject(options.log, 'options.log');
    assert.func(callback, 'callback');

    this.handleArgv(argv, this.envopts, function (argvErr, opts) {
        if (argvErr) {
            callback(argvErr);
            return;
        }

        /*
         * Logging setup.
         *
         * - If no `options.log` is given, we log to stderr.
         * - By default we log at the 'warn' level. Intentionally that is
         *   almost no logging.
         * - use IMGADM_LOG_LEVEL=trace envvar to set to trace level and enable
         *   source location (src=true) in log records
         * - '-v|--verbose' or IMGADM_LOG_LEVEL=debug to set to debug level
         * - use IMGADM_LOG_LEVEL=<bunyan level> to set to a different level
         * - '-E' to have a possible error be logged as the last single line
         *   of stderr as a raw Bunyan log JSON record with an 'err'. I.e. in a
         *   structured format more useful to automation tooling.
         *
         * Logging is in Bunyan (JSON) format so one needs to pipe via
         * `bunyan` for readable output (at least until bunyan.js supports
         * doing it inline). Admittedly this is a bit of a pain:
         *
         *      imgadm -v ... 2>&1 | bunyan
         */
        var log = options.log || bunyan.createLogger({
            name: self.name,
            streams: [
                {
                    stream: process.stderr,
                    level: 'warn'
                }
            ],
            serializers: bunyan.stdSerializers
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
        self.verbose = Boolean(opts.verbose);
        self.structuredErr = opts.E;

        // Handle top-level args and opts.
        self.log.trace({opts: opts, argv: argv}, 'parsed argv');
        var args = opts.argv.remain;
        if (opts.version) {
            console.log(self.name + ' ' + common.getVersion());
            callback(null);
            return;
        }
        if (args.length === 0) {
            self.printHelp(function (helpErr) {
                self.printErr(helpErr, 'help error');
                callback(helpErr);
            });
            return;
        } else if (opts.help) {
            // We want `cli foo -h` to show help for the 'foo' subcmd.
            if (args[0] !== 'help') {
                self.do_help(args[0], opts, args, callback);
                return;
            }
        }

        // Dispatch subcommands.
        imgadm.createTool({log: self.log}, function (createErr, tool) {
            if (createErr) {
                callback(createErr);
                return;
            }
            self.tool = tool;

            var subcmd = args.shift();
            try {
                self.dispatch(subcmd, argv, function (dispErr) {
                    self.printErr(dispErr,
                        'error with "' + subcmd + '" subcmd');
                    callback(dispErr);
                });
            } catch (ex) {
                self.printErr(ex, subcmd + ' exception');
                callback(ex);
            }
        });
    });
};


/**
 * Process options.
 *
 * @param argv {Array}
 * @param envopts {Array} Array or 2-tuples mapping envvar name to option for
 *      which it is a fallback.
 * @param callback {Function} `function (err, opts)`.
 */
CLI.prototype.handleArgv = function handleArgv(argv, envopts, callback) {
    var longOpts = this.longOpts = {
        'help': Boolean,
        'version': Boolean,
        'verbose': Boolean,
        'E': Boolean
    };
    var shortOpts = this.shortOpts = {
        'h': ['--help'],
        'v': ['--verbose']
    };

    var opts = nopt(longOpts, shortOpts, argv, 2);

    // envopts
    (envopts || []).forEach(function (envopt) {
        var envname = envopt[0];
        var optname = envopt[1];
        if (process.env[envname] && !opts[optname]) {
            // console.log('set `opts.%s = "%s" from %s envvar',
            //     optname, process.env[envname], envname);
            opts[optname] = process.env[envname];
        }
    });

    callback(null, opts);
};

CLI.prototype.printHelp = function printHelp(callback) {
    var self = this;

    var lines = [];
    if (this.description) {
        lines.push(this.description);
    }

    lines = lines.concat([
        'Usage:',
        '    %s [<options>] <command> [<args>...]',
        '    %s help <command>',
        '',
        'Options:',
        '    -h, --help          Show this help message and exit.',
        '    --version           Show version and exit.',
        '    -v, --verbose       Verbose logging (debug level). See also',
        '                        IMGADM_LOG_LEVEL=<level> envvar.'
    ]);

    if (self.envopts && self.envopts.length) {
        var envTemplate = '    %-23s  %s';
        lines.push('');
        lines.push('Environment:');
        self.envopts.forEach(function (envopt) {
            var envname = envopt[0];
            var optname = envopt[1];
            lines.push(sprintf(envTemplate, envname,
                'Fallback for --' + optname));
        });
    }

    lines = lines.concat([
        '',
        'Commands:'
    ]);
    if (false) {
        // Automatic command line from `this.subcmds`.
        var cmdTemplate = '    %-18s  %s';
        Object.keys(this.subcmds).forEach(function (name) {
            var func = self.subcmds[name];
            if (func.hidden) {
                return;
            }
            var names = name;
            if (func.aliases) {
                names += sprintf(' (%s)', func.aliases.join(', '));
            }
            var desc = (func.description ?
                func.description.split('\n', 1)[0] : '');
            desc = desc.replace(/\$NAME/g, self.name);
            var line = sprintf(cmdTemplate, names, desc);
            lines.push(line);
        });
    } else {
        /* BEGIN JSSTYLED */
        // Manually written, but nicer, command summary.
        lines = lines.concat([
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
            '                                           publish an image to an image repo'
        ]);
        /* END JSSTYLED */
    }
    if (this.suffix) {
        lines.push('');
        lines.push(this.suffix);
    }

    console.log(lines.join('\n').replace(/%s/g, this.name));
    callback();
};

/**
 * Dispatch to the appropriate "do_SUBCMD" function.
 */
CLI.prototype.dispatch = function dispatch(subcmd, argv, callback) {
    var self = this;
    var name = this.aliases[subcmd];
    if (!name) {
        callback(new errors.UnknownCommandError(subcmd));
        return;
    }
    var func = this.subcmds[name];

    // Reparse the whole argv with merge global and subcmd options. This
    // is the only way (at least with `nopt`) to correctly parse subcmd opts.
    // It has the bonus of allowing *boolean* subcmd options before the
    // subcmd name, if that is helpful. E.g.:
    //      `joyent-imgadm -u trentm -j images`
    var longOpts = objCopy(this.longOpts);
    if (func.longOpts) {
        Object.keys(func.longOpts).forEach(
            function (k) { longOpts[k] = func.longOpts[k]; });
    }
    var shortOpts = objCopy(this.shortOpts);
    if (func.shortOpts) {
        Object.keys(func.shortOpts).forEach(
            function (k) { shortOpts[k] = func.shortOpts[k]; });
    }
    var opts = nopt(longOpts, shortOpts, argv, 2);
    self.log.trace({opts: opts, argv: argv}, 'parsed subcmd argv');

    // Die on unknown opts.
    var extraOpts = objCopy(opts);
    delete extraOpts.argv;
    Object.keys(longOpts).forEach(function (o) { delete extraOpts[o]; });
    extraOpts = Object.keys(extraOpts);
    if (extraOpts.length) {
        callback(new errors.UnknownOptionError(extraOpts.join(', ')));
        return;
    }

    var args = opts.argv.remain;
    delete opts.argv;
    assert.equal(subcmd, args.shift());
    func.call(this, subcmd, opts, args, callback);
};

CLI.prototype.do_help = function do_help(subcmd, opts, args, callback) {
    var self = this;
    if (args.length === 0) {
        this.printHelp(callback);
        return;
    }
    var alias = args[0];
    var name = this.aliases[alias];
    if (!name) {
        callback(new errors.UnknownCommandError(alias));
        return;
    }

    // If there is a `.help_NAME`, use that.
    var helpfunc = this.helpcmds[name];
    if (helpfunc) {
        helpfunc.call(this, alias, callback);
        return;
    }

    var func = this.subcmds[name];
    if (func.description) {
        var desc = func.description.replace(/\$NAME/g, self.name).trimRight();
        console.log(desc);
        callback();
    } else {
        callback(new errors.ImgapiCliError(format('no help for "%s"', alias)));
    }
};
CLI.prototype.do_help.aliases = ['?'];
CLI.prototype.do_help.description
    = 'Give detailed help on a specific sub-command.';

CLI.prototype.help_help = function help_help(subcmd, callback) {
    this.printHelp(callback);
};


CLI.prototype.do_sources = function do_sources(subcmd, opts, args, callback) {
    var self = this;
    if (args.length > 0) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var nActions = 0;
    if (opts.edit) nActions++;
    if (opts.add) nActions++;
    if (opts.del) nActions++;
    if (nActions > 1) {
        callback(new errors.UsageError(
            'cannot specify more than one of "-a", "-d" and "-e"'));
        return;
    }
    var skipPingCheck = opts.force === true;
    if (opts.edit) {
        var before = self.tool.sources.map(function (s) { return s.url; });
        var beforeText = before.join('\n')
            + '\n\n'
            + '#\n'
            + '# Enter source URLs, on per line.\n'
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
                callback();
                return;
            }
            var afterText = fs.readFileSync(tmpPath, 'utf8');
            fs.unlinkSync(tmpPath);
            if (afterText === beforeText) {
                console.log('Image sources unchanged');
                callback();
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
                callback();
                return;
            }
            self.tool.updateSourceUrls(after, skipPingCheck,
                function (err, changes) {
                    if (err) {
                        callback(err);
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
                        callback();
                    }
                });
        });
    } else if (opts.add) {
        this.tool.configAddSource({url: opts.add}, skipPingCheck,
            function (err, changed) {
                if (err) {
                    callback(err);
                } else if (changed) {
                    console.log('Added image source "%s"', opts.add);
                } else {
                    console.log('Already have image source "%s", no change',
                        opts.add);
                }
            }
        );
    } else if (opts.del) {
        this.tool.configDelSourceUrl(opts.del, function (err, changed) {
            if (err) {
                callback(err);
            } else if (changed) {
                console.log('Deleted image source "%s"', opts.del);
            } else {
                console.log('Do not have image source "%s", no change',
                    opts.del);
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
        callback();
    }
};
CLI.prototype.do_sources.description = (
    /* BEGIN JSSTYLED */
    'List and edit image sources.\n'
    + '\n'
    + 'An image source is a URL to a server implementing the IMGAPI.\n'
    + 'The default IMGAPI is + ' + common.DEFAULT_SOURCE.url + '\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME sources [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         List sources as JSON.\n'
    + '    -a SOURCE          Add a source. It is appended to the list of sources.\n'
    + '    -d SOURCE          Delete a source.\n'
    + '    -e                 Edit sources in an editor.\n'
    + '    -f                 Force no "ping check" on new source URLs. By default\n'
    + '                       a ping check is done against new source URLs to\n'
    + '                       attempt to ensure they are a running IMGAPI server.\n'
    /* END JSSTYLED */
);
CLI.prototype.do_sources.longOpts = {
    'json': Boolean,
    'add': String,
    'del': String,
    'edit': Boolean,
    'force': Boolean
};
CLI.prototype.do_sources.shortOpts = {
    'j': ['--json'],
    'a': ['--add'],
    'd': ['--del'],
    'e': ['--edit'],
    'f': ['--force']
};


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
];
CLI.prototype.do_avail = function do_avail(subcmd, opts, args, callback) {
    var self = this;
    if (args.length) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    self.tool.sourcesList(function (err, imagesInfo) {
        // Even if there was an err, we still attempt to return results
        // for working sources.
        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var table = [];
            imagesInfo.forEach(function (i) {
                var row = i.manifest;
                if (row.published_at) {
                    // Just the date.
                    row.published_date = row.published_at.slice(0, 10);
                    // Normalize on no milliseconds.
                    row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
                }
                row.source = i.source;
                table.push(row);
            });
            try {
                tabulate(table, {
                    skipHeader: opts.skipHeader,
                    columns: opts.output || 'uuid,name,version,os,published',
                    sort: opts.sort || 'published_at,name',
                    validFields: availValidFields.join(',')
                });
            } catch (e) {
                callback(e);
                return;
            }
        }
        callback(err);
    });
};
CLI.prototype.do_avail.description = (
    'List available images from all sources.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME avail [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         JSON output\n'
    + '    -H                 Do not print table header row\n'
    + '    -o field1,...      Specify fields (columns) to output. Default is\n'
    + '                       "uuid,name,version,os,published".\n'
    + '    -s field1,...      Sort on the given fields. Default is\n'
    + '                       "published_at,name".\n'
    + '\n'
    + textWrap('Valid fields for "-o" and "-s" are: '
        + availValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_avail.longOpts = {
    'json': Boolean,
    'skipHeader': Boolean,
    'output': String,
    'sort': String
};
CLI.prototype.do_avail.shortOpts = {
    'j': ['--json'],
    'H': ['--skipHeader'],
    'o': ['--output'],
    's': ['--sort']
};
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
    'nic_driver',
    'disk_driver',
    'cpu_type',
    'image_size',
    'generate_passwords',
    'description',
    'clones',
    'zpool'
];
CLI.prototype.do_list = function do_list(subcmd, opts, args, callback) {
    var self = this;
    if (args.length) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var log = self.log;
    log.debug({opts: opts}, 'list');
    self.tool.listImages(function (err, imagesInfo) {
        log.debug({err: err, imagesInfo: imagesInfo}, 'listImages');
        if (err) {
            callback(err);
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var table = [];
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
                table.push(row);
            });
            try {
                tabulate(table, {
                    skipHeader: opts.skipHeader,
                    columns: opts.output || 'uuid,name,version,os,published',
                    sort: opts.sort || 'published_at,name',
                    validFields: listValidFields.join(',')
                });
            } catch (e) {
                callback(e);
                return;
            }
            callback();
        }
    });
};
CLI.prototype.do_list.description = (
    'List locally installed images.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME list [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         JSON output\n'
    + '    -H                 Do not print table header row\n'
    + '    -o field1,...      Specify fields (columns) to output. Default is\n'
    + '                       "uuid,name,version,os,published".\n'
    + '    -s field1,...      Sort on the given fields. Default is\n'
    + '                       "published_at,name".\n'
    + '\n'
    + textWrap('Valid fields for "-o" and "-s" are: '
        + listValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_list.longOpts = {
    'json': Boolean,
    'skipHeader': Boolean,
    'output': String,
    'sort': String
};
CLI.prototype.do_list.shortOpts = {
    'j': ['--json'],
    'H': ['--skipHeader'],
    'o': ['--output'],
    's': ['--sort']
};


CLI.prototype.do_show = function do_show(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    self.tool.sourcesGet(uuid, false, function (err, imageInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (!imageInfo) {
            err = new errors.ImageNotFoundError(uuid);
        } else {
            console.log(JSON.stringify(imageInfo.manifest, null, 2));
        }
        callback(err);
    });
};
CLI.prototype.do_show.description = (
    'Show the manifest for an available image.\n'
    + '\n'
    + 'This searches each imgadm source for an available image with this UUID\n'
    + 'and prints its manifest.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME show <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
);


CLI.prototype.do_get = function do_get(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;
    var getOpts = {uuid: uuid, zpool: zpool, children: opts.children};
    self.tool.getImage(getOpts, function (err, imageInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (!imageInfo) {
            callback(new errors.ImageNotInstalledError(zpool, uuid));
            return;
        }
        console.log(JSON.stringify(imageInfo, null, 2));
        callback();
    });
};
CLI.prototype.do_get.description = (
    'Get information for an installed image.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME get <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -r                 Recursively gather children (child snapshots\n'
    + '                       and dependent clones).\n'
    + '    -P <pool>          Name of zpool in which to look for the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
);
CLI.prototype.do_get.aliases = ['info'];
CLI.prototype.do_get.longOpts = {
    'zpool': String,
    'children': Boolean
};
CLI.prototype.do_get.shortOpts = {
    'P': ['--zpool'],
    'r': ['--children']
};


/**
 * `imgadm delete <uuid>`
 */
CLI.prototype.do_delete = function do_delete(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    self.tool.deleteImage({uuid: uuid, zpool: zpool}, function (err) {
        if (err) {
            callback(err);
            return;
        }
        console.log('Deleted image %s', uuid);
    });
};
CLI.prototype.do_delete.description = (
    /* BEGIN JSSTYLED */
    'Delete an image from the local zpool.\n'
    + '\n'
    + 'The removal can only succeed if the image is not actively in use by a VM.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME delete <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -P <pool>          Name of zpool from which to delete the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    /* END JSSTYLED */
);
CLI.prototype.do_delete.aliases = ['destroy'];
CLI.prototype.do_delete.longOpts = {
    'zpool': String
};
CLI.prototype.do_delete.shortOpts = {
    'P': ['--zpool']
};


/**
 * `imgadm import <uuid>`
 */
CLI.prototype.do_import = function do_import(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    // 1. Ensure we don't already have this UUID installed.
    self.tool.getImage({uuid: uuid, zpool: zpool}, function (getErr, ii) {
        if (getErr) {
            callback(getErr);
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
            callback();
            return;
        }

        // 2. Find this image in the sources.
        self.tool.sourcesGet(uuid, true, function (sGetErr, imageInfo) {
            if (sGetErr) {
                callback(sGetErr);
                return;
            } else if (!imageInfo) {
                callback(new errors.ActiveImageNotFoundError(uuid));
                return;
            }
            self.log.trace({imageInfo: imageInfo},
                'found source for image %s', uuid);
            console.log('Importing image %s (%s %s) from "%s"', uuid,
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
                    callback(importErr);
                    return;
                }
                console.log('Imported image %s to "%s/%s".', uuid, zpool, uuid);
                callback();
            });
        });
    });
};
CLI.prototype.do_import.description = (
    'Import an image from a source IMGAPI.\n'
    + '\n'
    + 'This finds the image with the given UUID in the configured sources\n'
    + 'and imports it into the local system.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME import <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -P <pool>          Name of zpool in which to import the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    + '    -q, --quiet        Disable progress bar.\n'
);
CLI.prototype.do_import.longOpts = {
    'zpool': String,
    'quiet': Boolean
};
CLI.prototype.do_import.shortOpts = {
    'P': ['--zpool'],
    'q': ['--quiet']
};



/**
 * `imgadm install -m <manifest> -f <file>`
 */
CLI.prototype.do_install = function do_install(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 0) {
        callback(new errors.UsageError(format(
            'unexpected args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    assert.string(opts.manifest, '-m <manifest>');
    assert.string(opts.file, '-f <file>');
    assert.optionalString(opts.zpool, '-P <zpool>');
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    // 1. Validate args.
    //    If `published_at` is not defined in the manifest (e.g. if from
    //    `imgadm create ...`) then they are generated as part of the
    //    install.
    if (!fs.existsSync(opts.manifest)) {
        callback(new errors.UsageError(format(
            'manifest path does not exist: "%s"', opts.manifest)));
        return;
    }
    if (!fs.existsSync(opts.file)) {
        callback(new errors.UsageError(format(
            'file path does not exist: "%s"', opts.file)));
        return;
    }
    try {
        var manifest = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
    } catch (err) {
        callback(new errors.InvalidManifestError(err));
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
            callback(getErr);
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
            callback();
            return;
        }

        // 3. Install it.
        console.log('Installing image %s (%s %s)', uuid, manifest.name,
            manifest.version);
        var installOpts = {
            manifest: manifest,
            zpool: zpool,
            file: opts.file,
            logCb: console.log
        };
        self.tool.installImage(installOpts, function (installErr) {
            if (installErr) {
                callback(installErr);
                return;
            }
            console.log('Installed image %s to "%s/%s".', uuid, zpool, uuid);
            callback();
        });
    });
};
CLI.prototype.do_install.description = (
    /* BEGIN JSSTYLED */
    'Install an image from local manifest and image data files.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME install [<options>] -m <manifest> -f <file>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -m <manifest>      Required. Path to the image manifest file to import.\n'
    + '    -f <file>          Required. Path to the image file to import.\n'
    + '    -P <pool>          Name of zpool in which to import the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    + '    -q, --quiet        Disable progress bar.\n'
    /* END JSSTYLED */
);
CLI.prototype.do_install.longOpts = {
    'manifest': String,
    'file': String,
    'zpool': String,
    'quiet': Boolean
};
CLI.prototype.do_install.shortOpts = {
    'm': ['--manifest'],
    'f': ['--file'],
    'P': ['--zpool'],
    'q': ['--quiet']
};


/**
 * `imgadm update`
 */
CLI.prototype.do_update = function do_update(subcmd, opts, args, callback) {
    var options = {
        dryRun: opts.dryRun
    };
    if (args.length) {
        options.uuids = args;
    }
    this.tool.updateImages(options, callback);
};
CLI.prototype.do_update.description = (
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
    + '    $NAME update [<uuid>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -n                 Do a dry-run (do not actually make changes).\n'
);
CLI.prototype.do_update.longOpts = {
    // WARNING: When I switch option processing to dashdash, the '--camelCase'
    //  spellings will be replaced with either no long opt or '--this-style'.
    'dryRun': Boolean
};
CLI.prototype.do_update.shortOpts = {
    'n': ['--dryRun']
};


/**
 * `imgadm create [<options>] <vm-uuid> [<manifest-field>=<value> ...]`
 */
CLI.prototype.do_create = function do_create(subcmd, opts, args, callback) {
    var self = this;
    if (args.length < 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var vmUuid = args[0];
    assertUuid(vmUuid);
    if (opts.compression
        && !~common.VALID_COMPRESSIONS.indexOf(opts.compression))
    {
        callback(new errors.UsageError(format(
            'invalid -c|--compression "%s": must be one of "%s"',
            opts.compression, common.VALID_COMPRESSIONS.join('", "'))));
        return;
    }
    if (opts['output-template'] && opts.publish) {
        callback(new errors.UsageError(
            'cannot specify both -o/--output-template and -p/--publish'));
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
        if (!opts.manifest) {
            manifest = {};
            next(null, objMerge(manifest, argFields));
        } else if (opts.manifest === '-') {
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
            var input = fs.readFileSync(opts.manifest);
            try {
                manifest = JSON.parse(input);
            } catch (ex) {
                next(new errors.UsageError(format(
                    'invalid manifest JSON in "%s": %s', opts.manifest, ex)));
                return;
            }
            next(null, objMerge(manifest, argFields));
        }
    }

    gatherManifestData(function (manErr, manifest) {
        if (manErr) {
            callback(manErr);
            return;
        }
        self.log.debug({manifest: manifest}, 'gathered manifest data');

        // Choose the dir/file-prefix to which to save.
        var savePrefix = '';
        if (opts.publish) {
            savePrefix = format('/var/tmp/.imgadm-create-%s-%s',
                Date.now(), process.pid);
        } else if (!opts['output-template']) {
            savePrefix = format('%s-%s', pathSlugify(String(manifest.name)),
                pathSlugify(String(manifest.version)));
        } else {
            var stats;
            try {
                stats = fs.statSync(opts['output-template']);
            } catch (e) {}
            if (stats && stats.isDirectory()) {
                savePrefix = path.join(opts['output-template'],
                    format('%s-%s', pathSlugify(String(manifest.name)),
                        pathSlugify(String(manifest.version))));
            } else {
                savePrefix = opts['output-template'];
            }
        }

        var createOpts = {
            vmUuid: vmUuid,
            manifest: manifest,
            compression: opts.compression,
            incremental: opts.incremental,
            prepareScript: opts['prepare-script']
                && fs.readFileSync(opts['prepare-script'], 'utf8'),
            savePrefix: savePrefix,
            logCb: console.log,
            quiet: opts.quiet
        };
        self.tool.createImage(createOpts, function (createErr, imageInfo) {
            if (createErr) {
                callback(createErr);
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
                            callback(pErr);
                        }
                    );
                });
            } else {
                callback();
            }
        });
    });
};
CLI.prototype.do_create.description = (
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
    + '    $NAME create [<options>] <vm-uuid> [<manifest-field>=<value> ...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help     Print this help and exit.\n'
    + '    -m <manifest>  Path to image manifest data (as JSON) to\n'
    + '                   include in the created manifest. Specify "-"\n'
    + '                   to read manifest JSON from stdin.\n'
    + '    -o <path>, --output-template <path>\n'
    + '                   Path prefix to which to save the created manifest\n'
    + '                   and image file. By default "NAME-VER.imgmanifest\n'
    + '                   and "NAME-VER.zfs[.EXT]" are saved to the current\n'
    + '                   dir. If "PATH" is a dir, then the files are saved\n'
    + '                   to it. If the basename of "PATH" is not a dir,\n'
    + '                   then "PATH.imgmanifest" and "PATH.zfs[.EXT]" are\n'
    + '                   created.\n'
    + '    -c <comp>      One of "none", "gz" or "bzip2" for the compression\n'
    + '                   to use on the image file, if any. Default is "none".\n'
    + '    -i             Build an incremental image (based on the "@final"\n'
    + '                   snapshot of the source image for the VM).\n'
    + '\n'
    + '    -s <prepare-image-path>\n'
    + '                   Path to a script that is run inside the VM to\n'
    + '                   prepare it for imaging. Specifying this triggers the\n'
    + '                   full snapshot/prepare-image/create-image/rollback\n'
    + '                   automatic image creation process (see notes above).\n'
    + '                   There is a contract with "imgadm" that a \n'
    + '                   prepare-image script must follow. See the "PREPARE\n'
    + '                   IMAGE SCRIPT" section in "man imgadm".\n'
    + '\n'
    + '    -p <url>, --publish <url>\n'
    + '                   Publish directly to the given image source\n'
    + '                   (an IMGAPI server). You may not specify both\n'
    + '                   "-p" and "-o".\n'
    + '    -q, --quiet    Disable progress bar in upload.\n'
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
CLI.prototype.do_create.longOpts = {
    'manifest': String,
    'compression': String,
    'output-template': String,
    'incremental': Boolean,
    'prepare-script': String,
    'publish': String,
    'quiet': Boolean
};
CLI.prototype.do_create.shortOpts = {
    'm': ['--manifest'],
    'c': ['--compression'],
    'o': ['--output-template'],
    'i': ['--incremental'],
    's': ['--prepare-script'],
    'p': ['--publish'],
    'q': ['--quiet']
};


/**
 * `imgadm publish -m <manifest> -f <file> <imgapi-url>`
 */
CLI.prototype.do_publish = function do_publish(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    assert.string(opts.manifest, '-m <manifest>');
    assert.string(opts.file, '-f <file>');
    assert.optionalBool(opts.quiet, '-q');
    var url = args[0];
    assert.string(url, '<imgapi-url>');

    // 1. Validate args.
    if (!fs.existsSync(opts.manifest)) {
        callback(new errors.UsageError(format(
            'manifest path does not exist: "%s"', opts.manifest)));
        return;
    }
    if (!fs.existsSync(opts.file)) {
        callback(new errors.UsageError(format(
            'file path does not exist: "%s"', opts.file)));
        return;
    }
    try {
        var manifest = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
    } catch (err) {
        callback(new errors.InvalidManifestError(err));
        return;
    }

    var pubOpts = {
        file: opts.file,
        manifest: manifest,
        url: url,
        quiet: opts.quiet
    };
    self.tool.publishImage(pubOpts, function (pubErr) {
        if (pubErr) {
            callback(pubErr);
        } else {
            console.log('Successfully published image %s to %s',
                manifest.uuid, url);
            callback();
        }
    });
};
CLI.prototype.do_publish.description = (
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
    + '    $NAME publish [<options>] -m <manifest> -f <file> <imgapi-url>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -m <manifest>      Required. Path to the image manifest to import.\n'
    + '    -f <file>          Required. Path to the image file to import.\n'
    + '    -q, --quiet        Disable progress bar.\n'
    /* END JSSTYLED */
);
CLI.prototype.do_publish.longOpts = {
    'manifest': String,
    'file': String,
    'quiet': Boolean
};
CLI.prototype.do_publish.shortOpts = {
    'm': ['--manifest'],
    'f': ['--file'],
    'q': ['--quiet']
};



// ---- exports

module.exports = CLI;
