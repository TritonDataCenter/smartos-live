/*
 * Copyright (c) 2013, Trent Mick. All rights reserved.
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 */

var DEBUG = false;
if (DEBUG) {
    debug = console.warn;
} else {
    debug = function () {};
}

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
var WError = require('verror').WError;
var dashdash = require('dashdash');
var sprintf = require('extsprintf').sprintf;


// ---- globals

var DEFAULT_OPTIONS = [
    {
        names: ['help', 'h'],
        help: 'Show this help message and exit.',
        type: 'bool'
    }
];



// ---- internal support stuff

function space(n) {
    var s = '';
    for (var i = 0; i < n; i++) {
        s += ' ';
    }
    return s;
}

function objCopy(obj) {
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return copy;
}


// ---- Errors

/**
 * Base CmdlnError. Instances (including derived errors) have these attributes:
 *
 * - `message` {String} All errors will have a message.
 * - `code` {String} A CamelCase code string for this type of error. E.g.
 *   'Cmdln' (generic), 'IllegalOption', etc.
 * - `cause` {Error} Optional. An underlying cause error.
 */
function CmdlnError(options) {
    assert.object(options, 'options');
    assert.string(options.message, 'options.message');
    assert.optionalString(options.code, 'options.code');
    if (!options.code) options.code = 'Cmdln';
    assert.optionalObject(options.cause, 'options.cause');
    var self = this;

    var args = [];
    if (options.cause) args.push(options.cause);
    args.push(options.message);
    WError.apply(this, args);

    var extra = Object.keys(options).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = options[k];
    });
}
util.inherits(CmdlnError, WError);

function OptionError(cause, subcmd) {
    assert.object(cause, 'cause');
    assert.optionalString(subcmd, 'subcmd');
    CmdlnError.call(this, {
        cause: cause,
        message: cause.message,
        code: 'Option',
        exitStatus: 1,
        subcmd: subcmd
    });
}
util.inherits(OptionError, CmdlnError);

function UnknownCommandError(cause, command) {
    if (command === undefined) {
        command = cause;
        cause = undefined;
    }
    assert.string(command);
    CmdlnError.call(this, {
        cause: cause,
        message: sprintf('unknown command: "%s"', command),
        code: 'UnknownCommand',
        exitStatus: 1
    });
}
util.inherits(UnknownCommandError, CmdlnError);



// ---- Cmdln object

/**
 * Create a command line tool.
 *
 * @param config {Object} All keys are optional unless otherwise stated
 *      - @param name {String} Tool name. Defaults to lowercase'd constructor
 *        name.
 *      - @param desc {String} Description string to include at the top of
 *        usage information.
 *      - @param helpOpts {Object} Help output formatting options. These
 *        are the same formatting options as for `dashdash.Parser.help`:
 *        indent, maxCol, helpCol, minHelpCol, maxHelpCol (TODO:doc).
 *      - @param options {Array} Custom options (in the format used by
 *        [dashdash](https://github.com/trentm/node-dashdash)). If not
 *        specified, then it defaults to a single -h/--help option.
 *        If custom options are provided, you will often want to
 *        override the base `init(opts, args, callback)` to act on those
 *        options after being parsed.
 *
 * XXX hooks for adding help ? instead of automatic?
 *      - @param helpCmd {Boolean} Whether to include the `help` subcommand.
 *        Default true.
 *      - XXX take optional bunyan logger
 */
function Cmdln(config) {
    var self = this;
    assert.optionalObject(config, 'config');
    config = config || {};
    assert.optionalString(config.name, 'config.name')
    assert.optionalString(config.desc, 'config.desc')
    assert.optionalArrayOfObject(config.options, 'config.options');
    assert.optionalObject(config.helpOpts, 'config.helpOpts')

    this.name = config.name || this.constructor.name.toLowerCase();
    this.desc = config.desc;
    this.options = config.options || DEFAULT_OPTIONS;
    this.helpOpts = config.helpOpts || {};
    if (!this.helpOpts.indent)
        this.helpOpts.indent = space(4);
    else if (typeof (this.helpOpts.indent) === 'number')
        this.helpOpts.indent = space(this.helpOpts.indent);
    if (!this.helpOpts.maxCol) this.helpOpts.maxCol = 80;
    if (!this.helpOpts.minHelpCol) this.helpOpts.minHelpCol = 20;
    if (!this.helpOpts.maxHelpCol) this.helpOpts.maxHelpCol = 40;

    // Find the tree of constructors (typically just this and the Cmdln
    // super class) on who's prototype to look for "do_*" and "help_*"
    // methods.
    var prototypes = [];
    var ctor = this.constructor;
    while (ctor) {
        prototypes.push(ctor.prototype);
        ctor = ctor.super_; // presuming `util.inherits` usage
    }
    prototypes.reverse();

    // Load subcmds (do_* methods) and aliases (`do_*.aliases`).
    this.subcmdOrder = [];
    this.subcmds = {};
    this.aliases = {};
    prototypes.forEach(function (proto) {
        Object.keys(proto)
            .filter(function (funcname) { return /^do_/.test(funcname); })
            .forEach(function (funcname) {
                var name = funcname.slice(3);
                var func = proto[funcname];
                self.subcmds[name] = func;
                self.subcmdOrder.push(name);
                self.aliases[name] = name;
                (func.aliases || []).forEach(function (alias) {
                    self.aliases[alias] = name;
                });
            });
    });
    // p('subcmdOrder:', this.subcmdOrder);
    // p('subcmds: ', this.subcmds);
    // p('aliases: ', this.aliases);
}


/**
 * Cmdln mainline.
 *
 * @param argv {Array}
 * @param callback {Function} `function (err)`
 */
Cmdln.prototype.main = function main(argv, callback) {
    var self = this;
    try {
        this.optParser = new dashdash.Parser(
            {options: this.options, interspersed: false});
        this.opts = this.optParser.parse(argv);
    } catch (e) {
        callback(new OptionError(e));
    }
    var args = this.opts._args;

    debug('-> init(%j, %j)', this.opts, args);
    self.init(this.opts, args, function (initErr) {
        debug('<- init(%s)', initErr)
        if (initErr) {
            callback(initErr);
            return;
        } else if (initErr === false) {
            //XXX How to handle non-zero exit here? Special error?
            //    StopProcessingError?
            callback();
            return
        }

        if (args.length === 0) {
            self.printHelp(function (helpErr) { callback(helpErr); });
            return;
        }

        var subcmdArgv = argv.slice(0, 2).concat(args);
        var subcmd = args.shift();
        try {
            debug('-> dispatch(%j, %j)', subcmd, subcmdArgv);
            self.dispatch(subcmd, subcmdArgv,
                function (dispErr) { callback(dispErr); });
        } catch (ex) {
            callback(ex);
        }
    });
};


/**
 * Post-option processing initialization of this Cmdln instance.
 *
 * Often if custom top-level `options` are given to the constructor then
 * you may want to override this to handle those options.
 *
 * @param opts {Object} The parsed options.
 * @param args {Array} The left-over CLI arguments after options have been
 *      parsed out.
 *
 * @param callback {Function} `function (err)` where `err==false` means stop
 *      processing, `err==<error instance>` passes that error back up
 *      `!err` means continue.
 */
Cmdln.prototype.init = function init(opts, args, callback) {
    if (opts.help) {
        this.do_help(args[0], opts, [], function (helpErr) {
            callback(helpErr || false);
        });
        return;
    }
    callback();
};



/**
 * Print top-level tool help.
 *
 * @param callback {Function} `function (err)`.
 */
Cmdln.prototype.printHelp = function printHelp(callback) {
    assert.func(callback, 'callback');
    var self = this;
    var helpOpts = this.helpOpts;
    var indent = helpOpts.indent;

    var lines = [];
    if (this.desc) {
        lines.push(this.desc);
        if (this.desc.slice(-1) !== '\n') {
            lines.push('');
        }
    }

    lines = lines.concat([
        'Usage:',
        format('%s%s [OPTIONS] COMMAND [ARGS...]', indent, self.name),
        format('%s%s help COMMAND', indent, self.name),
        ''
    ]);
    if (this.optParser.help) {
        lines.push('Options:');
        lines.push(this.optParser.help(helpOpts));
    }

    lines = lines.concat([
        'Commands:'
    ]);
    // Automatic command line from `this.subcmds`.
    // TODO: same helpCol as for the opts above, textwrap, etc.
    var cmdTemplate = format('%s%%-%ds  %s',
        indent, helpOpts.minHelpCol - indent.length - 2);
    this.subcmdOrder.forEach(function (name) {
        var func = self.subcmds[name];
        if (func.hidden) {
            return;
        }
        var names = name;
        if (func.aliases) {
            names += sprintf(' (%s)', func.aliases.join(', '));
        }
        var desc = (func.help || '').split('\n', 1)[0];
        desc = desc.replace(/{{name}}/g, self.name);
        var line = sprintf(cmdTemplate, names, desc);
        lines.push(line);
    });

    console.log(lines.join('\n'));
    callback();
};

/**
 * Dispatch to the appropriate "do_SUBCMD" function.
 */
Cmdln.prototype.dispatch = function dispatch(subcmd, argv, callback) {
    var name = this.aliases[subcmd];
    if (!name) {
        callback(new UnknownCommandError(subcmd));
        return;
    }
    var func = this.subcmds[name];

    var opts = null;
    var args = argv.slice(3);
    if (func.options) {
        try {
            var parser = new dashdash.Parser({options: func.options});
            opts = parser.parse(argv, 3);
        } catch (e) {
            callback(new OptionError(e, subcmd));
        }
        args = opts._args;
        debug('-- parse %j opts: %j', subcmd, opts);
    }

    func.call(this, subcmd, opts, args, callback);
};

Cmdln.prototype.do_help = function do_help(subcmd, opts, args, callback) {
    var self = this;
    if (args.length === 0) {
        this.printHelp(callback);
        return;
    }
    var alias = args[0];
    var name = this.aliases[alias];
    if (!name) {
        callback(new UnknownCommandError(alias));
        return;
    }

    var func = this.subcmds[name];
    if (func.help) {
        var help = func.help;
        help = help.replace('{{name}}', name);
        if (~help.indexOf('{{options}}')) {
            var parser = new dashdash.Parser({options: func.options});
            help = help.replace('{{options}}',
                'Options:\n' + parser.help(this.helpOpts));
        }
        console.log(help.trimRight());
        callback();
    } else {
        callback(new CmdlnError({message: format('no help for "%s"', alias)}));
    }
};
Cmdln.prototype.do_help.aliases = ['?'];
Cmdln.prototype.do_help.help = 'Help on a specific sub-command.';

Cmdln.prototype.help_help = function help_help(subcmd, callback) {
    this.printHelp(callback);
};



// ---- convenience main function for a script

/**
 * Mainline for a Cmdln-using tool. E.g.,
 *
 *      function MyTool() {
 *          // ...
 *      }
 *      util.inherits(MyTool, Cmdln);
 *
 *      ...
 *      if (require.main === module) {
 *          cmdln.main(MyTool);
 *      }
 *
 * @param cmdClass {Function} The Cmdln subclass ctor.
 * @param argv {Array} The argv to process. Optional. Default is `process.argv`.0
 */
function main(cmdClass, argv) {
    assert.func(cmdClass, 'cmdClass');
    assert.optionalArrayOfString(argv, 'argv');
    if (!argv) argv = process.argv;

    var cli = new cmdClass();
    cli.main(argv, function (err) {
        if (err) {
            console.error('%s%s: error%s: %s',
                cli.name,
                (err.subcmd ? ' ' + err.subcmd : ''),
                (false && err.code ? format(' (%s)', err.code) : ''),
                (process.env.DEBUG ? err.stack : err.message));
            process.exit(err.exitStatus || 1);
        }
        process.exit(0);
    });
}


// ---- exports

module.exports = {
    Cmdln: Cmdln,
    CmdlnError: CmdlnError,
    OptionError: OptionError,
    UnknownCommandError: UnknownCommandError,
    main: main
};
