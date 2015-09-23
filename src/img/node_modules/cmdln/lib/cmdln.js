/*
 * Copyright (c) 2014, Trent Mick. All rights reserved.
 * Copyright 2015 Joyent, Inc.
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

function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}

/**
 * Return a new object that is a shallow merge of all the given objects.
 * Last one wins. Example:
 *
 *  > objMerge({"a":1,"b":2}, {"b":3,"c":4});
 *  { a: 1, b: 3, c: 4 }
 */
function objMerge(/* ... */) {
    var merged = {};
    for (var i = 0; i < arguments.length; i++) {
        var obj = arguments[i];
        var keys = Object.keys(obj);
        for (var k = 0; k < keys.length; k++) {
            merged[keys[k]] = obj[keys[k]];
        }
    }
    return merged;
}


// Replace {{variable}} in `s` with the template data in `d`.
function renderTemplate(s, d) {
    return s.replace(/{{([a-zA-Z]+)}}/g, function (match, key) {
        return d.hasOwnProperty(key) ? d[key] : match;
    });
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
CmdlnError.prototype.name = 'CmdlnError';

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
OptionError.prototype.name = 'OptionError';

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
UnknownCommandError.prototype.name = 'UnknownCommandError';

function NoCommandError() {
    CmdlnError.call(this, {
        message: 'no command given',
        code: 'NoCommand',
        exitStatus: 1
    });
}
util.inherits(NoCommandError, CmdlnError);
NoCommandError.prototype.name = 'NoCommandError';



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
 *      - @param helpBody {String} Extra string content to put at the end of
 *        help output.
 *      - @param helpSubcmds {Array} Control the output of the "Commands:"
 *        section of top-level help output. By default all commands are
 *        listed in the order defined in code. `helpSubcmds` allows one to
 *        specify the order and, optionally, groupings with group headers. E.g.:
 *              helpSubcmds: [
 *                  'help',
 *                  { group: '' },   // an empty group, results in a blank line
 *                  'foo',
 *                  'bar',
 *                  { group: 'Bling' }, // a group header
 *                  'bloom',
 *                  // Use `unmatched: true` to include remaining subcmds.
 *                  { group: 'Other Commands', unmatched: true }
 *              ]
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
 *      - XXX take optional bunyan logger for trace logging
 */
function Cmdln(config) {
    var self = this;
    assert.optionalObject(config, 'config');
    config = config || {};
    assert.optionalString(config.name, 'config.name')
    assert.optionalString(config.desc, 'config.desc')
    assert.optionalArrayOfObject(config.options, 'config.options');
    assert.optionalObject(config.helpOpts, 'config.helpOpts')
    assert.optionalString(config.helpBody, 'config.helpBody')
    assert.optionalObject(config.helpSubcmds, 'config.helpSubcmds');

    this.name = config.name || this.constructor.name.toLowerCase();
    this.desc = config.desc;
    this.options = config.options || DEFAULT_OPTIONS;
    this.helpOpts = config.helpOpts || {};
    this.helpBody = config.helpBody;
    this.helpSubcmds = config.helpSubcmds || null;
    if (!this.helpOpts.indent)
        this.helpOpts.indent = space(4);
    else if (typeof (this.helpOpts.indent) === 'number')
        this.helpOpts.indent = space(this.helpOpts.indent);
    if (!this.helpOpts.groupIndent) {
        var gilen = Math.round(this.helpOpts.indent.length / 2);
        this.helpOpts.groupIndent = space(gilen);
    } else if (typeof (this.helpOpts.groupIndent) === 'number') {
        this.helpOpts.groupIndent = space(this.helpOpts.groupIndent);
    }
    if (!this.helpOpts.maxCol) this.helpOpts.maxCol = 80;
    if (!this.helpOpts.minHelpCol) this.helpOpts.minHelpCol = 20;
    if (!this.helpOpts.maxHelpCol) this.helpOpts.maxHelpCol = 40;

    this.optParser = new dashdash.Parser(
        {options: this.options, interspersed: false});

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
    var enumOrder = [];
    this._handlerFromName = {};
    this._nameFromAlias = {};
    prototypes.forEach(function (proto) {
        Object.keys(proto)
            .filter(function (funcname) { return /^do_/.test(funcname); })
            .forEach(function (funcname) {
                var name = funcname.slice(3).replace(/_/g, '-');
                var func = proto[funcname];
                var allAliases;
                if (func.prototype.__proto__ === Cmdln.prototype) {
                    // XXX doesn't catch multi-level inheritance from `Cmdln`
                    /**
                     * This is a `Cmdln` sub-class. Create the sub-Cmdln
                     * instance and an implicit handler function to call
                     * it appropriately.
                     *
                     * Also validate which properties are allowed to be
                     * set on the *constructor*, e.g.:
                     *      Top.prototype.do_sub = Sub
                     *      Top.prototype.do_sub.<property> = ...
                     * vs. not allowed, because they must be set on the `Sub`
                     * itself:
                     *      function Sub(top) {
                     *          Cmdln.call(this, {name: ..., options: ...})
                     *      }
                     */
                    ['options', 'help'].forEach(function (prop) {
                        if (func.hasOwnProperty(prop)) {
                            throw new Error(format(
                                'cannot set "%s.prototype.do_%s.%s" property '
                                + 'because "do_%s" is a sub-Cmdln handler',
                                self.constructor.name, name, prop, name));
                        }
                    });
                    var subcli = new func(self);
                    var handler = function (subcmd, opts, args, cb) {
                        var argv = ['', ''].concat(args);
                        subcli.main(argv, function (err, subsubcmd) {
                            if (subsubcmd) {
                                subsubcmd = subcmd + ' ' + subsubcmd;
                            }
                            cb(err, subsubcmd);
                        });
                    };
                    for (prop in func) {
                        if (prop === 'super_')
                            continue;
                        handler[prop] = func[prop];
                    }
                    handler.help = function (subcmd, opts, args, cb) {
                        subcli.do_help('help', opts, args.slice(1),
                                function (helpErr) {
                            cb(helpErr || false);
                        });
                    }
                    handler.desc = subcli.desc;
                    self._handlerFromName[name] = handler;
                } else {
                    self._handlerFromName[name] = func;
                }
                if (!self._handlerFromName[name].hidden) {
                    enumOrder.push(name);
                }
                self._nameFromAlias[name] = name;
                allAliases = func.aliases || [];
                if (func.hiddenAliases)
                    allAliases = allAliases.concat(func.hiddenAliases);
                allAliases.forEach(function (alias) {
                    self._nameFromAlias[alias] = name;
                });
            });
    });

    if (self.helpSubcmds !== null) {
        /*
         * Reconcile the provided subcommand order (and group headings) with
         * the discovered options.
         */
        var unmatchedNames = [];
        var matchedNames = [];
        enumOrder.forEach(function (enumName) {
            if (self.helpSubcmds.indexOf(enumName) === -1) {
                unmatchedNames.push(enumName);
            } else {
                matchedNames.push(enumName);
            }
        });

        var unmatchCount = 0;
        self._subcmdOrder = [];
        self.helpSubcmds.forEach(function (sc) {
            if (typeof (sc) === 'object') {
                assert.string(sc.group, 'helpSubcmds.*.group');
                assert.optionalBool(sc.unmatched, 'helpSubcmds.*.unmatched');

                self._subcmdOrder.push(sc);

                if (sc.unmatched) {
                    if (++unmatchCount > 1) {
                        throw (new Error(format('"unmatched" directive used ' +
                            'more than once in "helpSubcmds" option: %j', sc)));
                    }

                    /*
                     * Include all of the unmatched names here:
                     */
                    while (unmatchedNames.length > 0) {
                        self._subcmdOrder.push(unmatchedNames.shift());
                    }
                }
                return;
            }

            /*
             * If this is not a group heading object, it must be the name
             * of a handler to include in the output:
             */
            assert.string(sc);
            if (matchedNames.indexOf(sc) === -1) {
                throw (new Error('command handler included in help order ' +
                    'but not found: ' + sc));
            }
            self._subcmdOrder.push(sc);
        });

        if (unmatchedNames.length > 0) {
            throw (new Error('"helpSubcmds" error: unmatched command ' +
                'handlers found: ' + unmatchedNames.join(', ') + '.'));
        }
    } else {
        self._subcmdOrder = enumOrder;
    }

    // p('_subcmdOrder:', this._subcmdOrder);
    // p('_handlerFromName: ', this._handlerFromName);
    // p('_nameFromAlias: ', this._nameFromAlias);
}


/**
 * Cmdln mainline.
 *
 * @param argv {Array}
 * @param callback {Function} `function (err, subcmd)` where err is an
 *      error object if there was a problem, and subcmd is the sub-command
 *      string (if there is one, i.e. it might be undefined).
 */
Cmdln.prototype.main = function main(argv, callback) {
    assert.arrayOfString(argv, 'argv');
    assert.func(callback, 'callback');

    var self = this;
    try {
        this.opts = this.optParser.parse(argv);
    } catch (e) {
        callback(new OptionError(e));
    }
    var args = this.opts._args;

    debug('-> <%s>.init(%j, %j)', self.name, this.opts, args);
    self.init(this.opts, args, function (initErr) {
        debug('<- <%s>.init(initErr=%s)', self.name, initErr)
        if (initErr) {
            finish(initErr);
            return;
        } else if (initErr === false) {
            //XXX How to handle non-zero exit here? Special error?
            //    StopProcessingError?
            finish();
            return
        }

        if (args.length === 0) {
            self.emptyLine(finish);
            return;
        }

        var subcmdArgv = argv.slice(0, 2).concat(args);
        var subcmd = args.shift();
        try {
            debug('-> <%s>.dispatch(%j, %j)', self.name, subcmd, subcmdArgv);
            self.dispatch(subcmd, subcmdArgv,
                function (dispErr) { finish(dispErr, subcmd); });
        } catch (ex) {
            finish(ex, subcmd);
        }
    });

    function finish(err, subcmd) {
        debug('-> <%s>.fini(%j, <err>)', self.name, subcmd);
        self.fini(subcmd, err, function (finiErr) {
            debug('<- <%s>.fini(finiErr=%s)', self.name, finiErr)
            callback(finiErr || err, subcmd);
        });
    }
};


/**
 * Generate and return Bash completion for this Cmdln subclass instance.
 */
Cmdln.prototype.bashCompletion = function bashCompletion() {
    var self = this;

    var args = namesFromOptions(self.options);
    var commands = {};

    // loop subcommands
    self._subcmdOrder.forEach(function (name, idx) {
        if (typeof (name) !== 'string')
            return;

        var handler = self._handlerFromName[name];
        if (handler.hidden)
            return;

        var opts = namesFromOptions(handler.options);

        var names = [name].concat(handler.aliases || []);
        names.forEach(function (name) {
            if (name === '?') {
                return;
            }
            commands[name] = opts;
            args.push(name);
        });
    });

    // create template
    var data = {
        name: self.name,
        args: args.join('\n'),
        date: new Date(),
    };

    var c = [];
    Object.keys(commands).forEach(function (command) {
        c.push(format('\'%s\') words=(%s);;',
            command, commands[command].join(' ')));
    });
    data.commands = c.join('\n');

    // render template
    var template = fs.readFileSync(
        path.join(__dirname, '../etc/completion.bash.in'), 'utf8');
    return renderTemplate(template, data);


    function namesFromOptions(options) {
        var opts = [];
        (options || []).forEach(function (option) {
            var names = option.names || [];
            if (option.name)
                names.push(option.name);
            names = names.map(function (name) {
                if (name.length === 1)
                    return '-' + name;
                else
                    return '--' + name;
            });
            opts = opts.concat(names);
        });
        return opts;
    }
};


/**
 * Handler called for an empty line of input. By default this prints help
 * output and returns a `NoCommandError` (exitStatus == 1).
 *
 * Dev Note: Equiv to python-cmdln's Cmdln.emptyline.
 *
 * @param callback {Function} `function (err)`
 */
Cmdln.prototype.emptyLine = function emptyLine(callback) {
    this.printHelp(function (helpErr) {
        callback(helpErr || new NoCommandError());
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
 * Hook run after the subcommand handler is run.
 *
 * @param subcmd {String} The name of the subcommand run.
 * @param err {Error} The error being returned, if any.
 * @param callback {Function} `function (err)`.
 */
Cmdln.prototype.fini = function fini(subcmd, err, callback) {
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
    var gindent = helpOpts.groupIndent;

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
    // Automatic command line from `this._handlerFromName`.
    // TODO: same helpCol as for the opts above, textwrap, etc.
    var cmdTemplate = format('%s%%-%ds  %s',
        indent, helpOpts.minHelpCol - indent.length - 2);
    this._subcmdOrder.forEach(function (name, idx) {
        if (typeof (name) === 'object') {
            if (idx > 0) {
                /*
                 * If this is not the first line, print a blank line to
                 * visually separate this group from previous lines.
                 */
                lines.push('');
            }

            /*
             * If the group name is not blank, print the group heading.
             * If it is blank, the caller only wants the separator line
             * printed above.
             */
            assert.string(name.group, 'name.group');
            if (name.group) {
                lines.push(format('%s%s:', gindent, name.group));
            }
            return;
        }

        assert.string(name, 'name');
        var handler = self._handlerFromName[name];
        if (handler.hidden) {
            return;
        }
        var names = name;
        if (handler.aliases) {
            names += sprintf(' (%s)', handler.aliases.join(', '));
        }
        var summary = handler.desc ||
            (typeof (handler.help) === 'string' && handler.help) ||
            '';
        summary = summary.split('\n', 1)[0]; // just leading line
        summary = summary.replace(/{{name}}/g, self.name);
        summary = summary.replace(/{{cmd}}/g, name);
        var line = sprintf(cmdTemplate, names, summary);
        lines.push(line);
    });

    if (this.helpBody) {
        if (lines.slice(-1) !== '\n') {
            lines.push('');
        }
        lines.push(this.helpBody);
    }

    console.log(lines.join('\n'));
    callback();
};


/**
 * Return the handler function for the given sub-command string (aka the
 * subcmd *name*). This returns undefined if there is no handler for that
 * sub-command.
 */
Cmdln.prototype.handlerFromSubcmd = function handlerFromSubcmd(alias) {
    var name = this._nameFromAlias[alias];
    if (!name) {
        return;
    }
    return this._handlerFromName[name];
};


/**
 * Return the help content for the given sub-command string (aka the
 * subcmd *name*).
 *
 * *Limitation*: If the command has a `.help` *function*, then the function is
 * returned. It is up to the caller to call it, if they like. The `.help`
 * function is defined to be async and is *not* defined to return the
 * string, so running it isn't useful here.
 *
 * @param alias {String} The sub-command name or alias.
 * @throws `UnknownCommandError` if there is no such sub-command.
 * @returns The help string, `null` if no help, or the `.help` function if
 *      so defined for that sub-command.
 */
Cmdln.prototype.helpFromSubcmd = function helpFromSubcmd(alias) {
    var handler = this.handlerFromSubcmd(alias);
    if (!handler) {
        throw new UnknownCommandError(alias);
    }

    if (!handler.help) {
        return;
    } else if (typeof (handler.help) === 'function') {
        return handler.help;
    } else {
        var help = handler.help;
        help = help.replace(/{{name}}/g, this.name);
        help = help.replace(/{{cmd}}/g, alias);
        if (~help.indexOf('{{options}}') && handler.options) {
            var parser = new dashdash.Parser({options: handler.options});
            var helpOpts = (handler.helpOpts
                ? objMerge(this.helpOpts, handler.helpOpts) : this.helpOpts);
            help = help.replace('{{options}}',
                'Options:\n' + parser.help(helpOpts));
        }
        help = help.trimRight();
        return help;
    }
};


/**
 * Dispatch to the appropriate "do_SUBCMD" function.
 */
Cmdln.prototype.dispatch = function dispatch(subcmd, argv, callback) {
    var handler = this.handlerFromSubcmd(subcmd);
    if (!handler) {
        callback(new UnknownCommandError(subcmd));
        return;
    }

    var opts = null;
    var args = argv.slice(3);
    if (handler.options) {
        try {
            var parser = new dashdash.Parser({
                options: handler.options,
                interspersed: (handler.interspersedOptions !== undefined
                    ? handler.interspersedOptions : true),
                allowUnknown: (handler.allowUnknownOptions !== undefined
                    ? handler.allowUnknownOptions : false)
            });
            opts = parser.parse(argv, 3);
        } catch (e) {
            callback(new OptionError(e, subcmd));
        }
        args = opts._args;
        debug('-- parse %j opts: %j', subcmd, opts);
    }

    handler.call(this, subcmd, opts, args, callback);
};

Cmdln.prototype.do_help = function do_help(subcmd, opts, args, callback) {
    if (args.length === 0) {
        this.printHelp(callback);
        return;
    }
    var alias = args[0];
    var handler = this.handlerFromSubcmd(alias);
    if (!handler) {
        callback(new UnknownCommandError(alias));
        return;
    }

    try {
        var help = this.helpFromSubcmd(alias);
    } catch (e) {
        callback(e);
    }
    if (!help) {
        callback(new CmdlnError({message: format('no help for "%s"', alias)}));
    } else if (typeof (help) === 'function') {
        help(subcmd, opts, args, callback);
    } else {
        console.log(help);
        callback();
    }
};
Cmdln.prototype.do_help.aliases = ['?'];
Cmdln.prototype.do_help.help = 'Help on a specific sub-command.';



// ---- convenience main function for a script

/**
 * A convenience `main()` for a CLI script using this module. It takes a
 * Cmdln subclass instance, runs it with the current process argv and
 * exits with appropriate error output and status code. This does not have a
 * callback because it calls `process.exit` (with an appropriate exit status).
 *
 * Usage example:
 *
 *      function MyCLI() {
 *          // ...
 *      }
 *      util.inherits(MyCLI, Cmdln);
 *
 *      ...
 *      if (require.main === module) {
 *          var cli = MyCLI();
 *          cmdln.main(cli);
 *      }
 *
 *
 * Note: If one wants more control over process termination then one can
 * manually do:
 *
 *      ...
 *      var cli = MyCLI();
 *      cli.main(process.argv, function (err, subcmd) {
 *          ...
 *      });
 *
 * @param cli {Function} A `Cmdln` subclass instance.
 * @param options {Object}
 *      - `argv` {Array} The argv to process. Optional. Default is
 *        `process.argv`.
 *      - `showErr` {Boolean} Optional. Whether to show (i.e. print via
 *        `console.error(...)` an error. If not set, then `<cli>.showErr`
 *        decides.
 *      - `showCode` {Boolean} Default false. Whether to show the error `code`
 *        in the stderr output, if available on the error objects returned
 *        by subcommands. E.g. with `showCode=false`:
 *              mycli: error: blip blup burp
 *        with `showCode=true`:
 *              mycli: error (BlipBlup): blip blup burp
 *        See the doc on the `CmdlnError` class above for details on the `code`.
 *      - `showNoCommandErr` {Boolean} Optional. Whether to show an error
 *        message on `NoCommandError` -- i.e. when the CLI is called with
 *        no sub-command. Default false.
 *      - `showErrStack` {Boolean} Optional. Whether to show the error stack
 *        when printing an error. If not set, then `<cli>.showErrStack`
 *        decides.
 *
 * Two fields can be set on `<cli>` to control error printing:
 * - Set `<cli>.showErr` to true to suppress printing any error. For
 *   example, one might want to handle printing of the error in the `fini`
 *   method.
 * - Set `<cli>.showErrStack` to true, e.g. in the `init` method based on some
 *   verbose option, to have it show the error stack on error.
 */
function main(cli, options) {
    /*
     * For *backward compat*, support the cmdln v1.x calling style:
     *      cmdln.main(<cmdln-class-ctor>[, <argv>[, <options>]]);
     * and semantics:
     * - showNoCommandErr=true by default
     * - DEBUG=1 envvar will set showErrStack=true
     */
    if (typeof (cli) === 'function') {
        cli = new cli();
        var argv = options;
        if (arguments[2]) {
            assert.object(arguments[2], 'options');
            options = objCopy(arguments[2]);
        } else {
            options = {};
        }
        if (argv) {
            options.argv = argv;
        }
        // Backward compat for `process.DEBUG` resulting in error output
        // including the error stack.
        if (options.showErrStack === undefined && process.env.DEBUG) {
            options.showErrStack = true;
        }
        if (options.showNoCommandErr === undefined) {
            options.showNoCommandErr = true;
        }
    }

    assert.object(cli, 'cli');
    assert.optionalObject(options, 'options');
    options = options ? objCopy(options) : {};
    assert.optionalArrayOfString(options.argv, 'options.argv');
    if (!options.argv) {
        options.argv = process.argv;
    }
    assert.optionalBool(options.showErr, 'options.showErr');
    assert.optionalBool(options.showCode, 'options.showCode');
    assert.optionalBool(options.showNoCommandErr, 'options.showNoCommandErr');
    assert.optionalBool(options.showErrStack, 'options.showErrStack');

    cli.main(options.argv, function (err, subcmd) {
        var exitStatus = (err ? err.exitStatus || 1 : 0);

        // We show (i.e. console.error) an error by default, unless turned
        // off via `options.showErr` or `cli.showErr`.
        var showErr = (options.showErr !== undefined ? options.showErr
            : (cli.showErr !== undefined ? cli.showErr : true));

        if (err && showErr) {
            var code = (err.body ? err.body.code : err.code);
            if (code === 'NoCommand' && !options.showNoCommandErr) {
                /* jsl:pass */
            } else if (!cli.suppressShowErr && err.message !== undefined) {
                /*
                 * If the `err` has no "message" field, then this probably
                 * isn't and Error instance. Let's just not print an error
                 * message. This can happen if the subcmd passes back `true`
                 * or similar to indicate "yes there was an error".
                 */
                var showErrStack = (options.showErrStack === undefined
                        ? cli.showErrStack : options.showErrStack);
                console.error('%s%s: error%s: %s',
                    cli.name,
                    (subcmd ? ' ' + subcmd : ''),
                    (options.showCode && code ? format(' (%s)', code) : ''),
                    (showErrStack ? err.stack : err.message));
            }
        }
        process.exit(exitStatus);
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
