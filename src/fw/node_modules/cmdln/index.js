/*
 * Copyright 2016 Trent Mick
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

var DEFAULT_SYNOPSES = [
    '{{name}} [OPTIONS] COMMAND [ARGS...]',
    '{{name}} help COMMAND'
];


// ---- internal support stuff

function indent(s, indentation) {
    if (!indentation) {
        indentation = '    ';
    }
    var lines = s.split(/\r?\n/g);
    return indentation + lines.join('\n' + indentation);
}

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


/*
 * An error returned when there is an error parsing a command or subcmd's
 * options.
 */
function OptionError(cause) {
    assert.object(cause, 'cause');
    CmdlnError.call(this, {
        cause: cause,
        message: cause.message,
        code: 'Option',
        exitStatus: 1
    });
}

util.inherits(OptionError, CmdlnError);
OptionError.prototype.name = 'OptionError';

/**
 * Attempt to give an appropriate 'usage: ...' errHelp that shows all
 * the options. E.g.:
 *
 *     $ triton inst tag set -123
 *     triton instance tag set: error (Option): unknown option: "-1" in "-1...
 *     usage: triton instance tag set [-h | --help] [-f FILE | --file=FILE]
 *         [-w | --wait] [--wait-timeout=INT] [-j | --json] [-q | --quiet] ...
 *
 * Notes:
 * - This does NOT use `synopses` because, at least in my current typical
 *   usage, the synopses just show `[OPTIONS]` instead of expliclity listing
 *   all the options.
 * - The above indentation is intentional (as opposed to `git --help`s) in
 *   case the command name is long.
 */
OptionError.prototype.cmdlnErrHelpFromErr = function optionErrHelpFromErr(err) {
    if (!err || !err._cmdlnInst) {
        return '';
    }

    var errHelp = '';

    var options = (err._cmdlnHandler || err._cmdlnInst).options;
    if (options) {
        var lines = [];
        var line = 'usage: ' + nameFromErr(err);
        for (var i = 0; i < options.length; i++) {
            var synopsis = dashdash.synopsisFromOpt(options[i]);
            if (!synopsis) {
                continue;
            } else if (line.length === 0) {
                line += '    ' + synopsis;
            } else if (line.length + synopsis.length + 1 > 80) {
                lines.push(line);
                line = '    ' + synopsis;
            } else {
                line += ' ' + synopsis;
            }
        }
        lines.push(line + ' ...');  // The "..." for the args.
        errHelp = lines.join('\n');
    }


    return errHelp;
};


/*
 * An error returned when there is a subcmd usage error (wrong args).
 *
 *      new UsageError(<message>);
 *      new UsageError(<cause>, <message>);
 */
function UsageError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause, 'cause');
    assert.string(message, 'message');
    CmdlnError.call(this, {
        cause: cause,
        message: message,
        code: 'Usage',
        exitStatus: 1
    });
}

util.inherits(UsageError, CmdlnError);
UsageError.prototype.name = 'UsageError';

/**
 * Show a 'usage: ...' errHelp using the command's `synopses`. E.g.:
 *
 *     $ triton inst list foo
 *     triton instance list: error (Usage): invalid filter: "foo" ...
 *     usage: triton instance list [OPTIONS] [FILTERS...]
 */
UsageError.prototype.cmdlnErrHelpFromErr = function usageErrHelpFromErr(err) {
    if (!err || !err._cmdlnInst) {
        return '';
    }

    var errHelp = '';
    var synopses = err._cmdlnInst.synopsesFromSubcmd(
        err._cmdlnSubcmd || err._cmdlnInst);
    if (synopses.length === 1) {
        errHelp = 'usage: ' + synopses[0];
    } else if (synopses.length > 1) {
        errHelp = 'usage:\n    ' + synopses.join('\n    ');
    }
    return errHelp;
};


function UnknownCommandError(cause, command) {
    if (command === undefined) {
        command = cause;
        cause = undefined;
    }
    assert.string(command, 'command');
    this.command = command;
    CmdlnError.call(this, {
        cause: cause,
        message: sprintf('unknown command: "%s"', command),
        code: 'UnknownCommand',
        exitStatus: 1
    });
}

util.inherits(UnknownCommandError, CmdlnError);
UnknownCommandError.prototype.name = 'UnknownCommandError';

/**
 * Show an errHelp for possible intended commands, assuming a typo. E.g.:
 *
 *     $ triton ins
 *     triton: error (UnknownCommand): unknown command: "ins"
 *     Did you mean this?
 *         inst
 *         instance
 */
UnknownCommandError.prototype.cmdlnErrHelpFromErr =
        function ucErrHelpFromErr(err) {
    if (!err || !err._cmdlnInst) {
        return '';
    }

    try {
        var FuzzySet = require('fuzzyset.js');
    } catch (requireErr) {
        return '';
    }

    var errHelp = '';
    var aliases = FuzzySet(Object.keys(err._cmdlnInst._nameFromAlias));
    var candidates = aliases.get(this.command); // array of [score, alias];
    var ge50 = [];
    candidates && candidates.forEach(function (candidate) {
        if (candidate[0] >= 0.3) {
            ge50.push(candidate[1]);
        }
    });
    if (ge50.length > 0) {
        errHelp = 'Did you mean this?\n    ' + ge50.join('\n    ');
    }

    return errHelp;
};


function NoCommandError() {
    CmdlnError.call(this, {
        message: 'no command given',
        code: 'NoCommand',
        exitStatus: 1
    });
}
util.inherits(NoCommandError, CmdlnError);
NoCommandError.prototype.name = 'NoCommandError';


/**
 * # errHelp
 *
 * Sometimes, for some CLI errors, it is nice to print brief help info after
 * the error message. E.g.:
 *
 *      $ ls -D
 *      ls: illegal option -- D
 *  >   usage: ls [-ABCFGHLOPRSTUWabcdefghiklmnopqrstuwx1] [file ...]
 *
 *      $ git foo
 *      git: 'foo' is not a git command. See 'git --help'.
 *
 *  >   Did you mean this?
 *  >          fo
 *
 * This module calls that `errHelp`. This function will attempt to determine
 * reasonable errHelp from an `err` returned by `<cmdln>.main()`. By default
 * errHelp is implemented for some of this module's error classes:
 *
 * - OptionError: Show a synopsis of the command's options.
 * - UsageError: Show the command's synopses, if available.
 * - UnknownCommandError: List possible fuzzy matches.
 *
 *
 * # usage
 *
 * 1. Optionally set `synopses` on your `do_SUBCMD` handlers. E.g.:
 *
 *      do_list.synopses = ['{{name}} list [OPTIONS] [FILTERS...]'];
 *
 *    Note that `{{usage}}` in your command help output will expand to these
 *    synopses.
 *
 * 2. Use `cmdln.errHelpFromErr()` in your mainline something like this:
 *
 *      var cmdln = require('cmdln');
 *      var cli = new MyCmdlnSubclass();
 *      cli.main(argv, function (err) {
 *          if (err) {
 *              console.error('%s: error: %s', cli.name, err.message);
 *              var errHelp = cmdln.errHelpFromErr(err);
 *              if (errHelp) {
 *                  console.error(errHelp);
 *              }
 *          }
 *      });
 *
 *    Or use the convenience top-level `cmdln.main()` function, which does
 *    similar.
 *
 *
 * @param {Object} err: Error returned from `<cmdln>.main()`. The main
 *      function adds some cmdln-specific context properties to the returned
 *      err object. This function uses those properties.
 * @returns {String} Error help string, if any, else the empty string.
 */
function errHelpFromErr(err) {
    assert.object(err, 'err');
    var errHelp;

    if (err && typeof (err.cmdlnErrHelpFromErr) === 'function') {
        errHelp = err.cmdlnErrHelpFromErr(err);
    }

    return (errHelp || '');
};


/**
 * Return the full command name (e.g. 'triton instance list') at which the
 * error occurred, from an `err` instance returned by `<cmdln>.main()`.
 */
function nameFromErr(err) {
    assert.object(err, 'err');
    assert.object(err._cmdlnInst, 'err._cmdlnInst');
    var name = err._cmdlnInst.name;
    if (err._cmdlnHandler) {
        if (typeof (err._cmdlnHandler) === 'object') {
            name = err._cmdlnHandler.name;
        } else if (err._cmdlnSubcmd) {
            name += ' ' + err._cmdlnSubcmd;
        }
    }
    return name;
}


// ---- Cmdln object

/**
 * Create a command line tool.
 *
 * @param config {Object} All keys are optional unless otherwise stated
 *      - @param name {String} Tool name. Defaults to lowercase'd constructor
 *        name.
 *      - @param desc {String} Description string to include at the top of
 *        usage information.
 *      - @param synopses {Array} Optional array of synopses for the command.
 *        Synopses are used for the `{{usage}}` template var in help output
 *        and for `errHelp` for `UsageError`s. If not given the default will be:
 *          `['{{name}} [OPTIONS] COMMAND [ARGS...]', '{{name}} help COMMAND']`
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
 * TODO: hooks for adding help ? instead of automatic?
 *      - @param helpCmd {Boolean} Whether to include the `help` subcommand.
 *        Default true.
 * TODO: take optional bunyan logger for trace logging
 */
function Cmdln(config) {
    var self = this;
    assert.optionalObject(config, 'config');
    config = config || {};
    assert.optionalString(config.name, 'config.name')
    assert.optionalString(config.desc, 'config.desc')
    assert.optionalArrayOfObject(config.options, 'config.options');
    assert.optionalArrayOfString(config.synopses, 'config.synopses');
    assert.optionalObject(config.helpOpts, 'config.helpOpts')
    assert.optionalString(config.helpBody, 'config.helpBody')
    assert.optionalObject(config.helpSubcmds, 'config.helpSubcmds');

    this.name = config.name || this.constructor.name.toLowerCase();
    this.desc = config.desc;
    this.synopses = config.synopses || DEFAULT_SYNOPSES;
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
                var name = self.subcmdFromFuncname(funcname);
                var func = proto[funcname];
                var allAliases;
                if (func.prototype.__proto__ === Cmdln.prototype) {
                    /**
                     * This is a `Cmdln` sub-class. Create the sub-Cmdln
                     * instance and use that as the handler.
                     *
                     * Limitation: This doesn't catch multi-level inheritance
                     * from `Cmdln`.
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
                    var handler = new func(self);
                    // Copy class properies like 'alias', 'hidden', etc.
                    for (prop in func) {
                        if (prop === 'super_')
                            continue;
                        handler[prop] = func[prop];
                    }
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
                    if (self._nameFromAlias[alias]) {
                        throw new Error(format('ambiguous alias "%s": ' +
                            'refers to commands "%s" and "%s"', alias,
                            name, self._nameFromAlias[alias]));
                    }
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
 * @param cb {Function} `function (err)` where err is an error object if
 *      there was a problem. The following properties are added to a
 *      returned `err`. These add context used by `errHelpFromErr`
 *      and `nameFromErr`.
 *
 * Dev Notes: The relevant *private* members added for this context are:
 * - `err._cmdlnInst`: The Cmdln instance on which the error occurred.
 *   For single-level subcommands, this will always be the top Cmdln
 *   instance on which `main` was called. However for tools with
 *   nested Cmdln's (e.g. `mytool some-subcmd some-subsubcmd`) it
 *   might be that nested Cmdln.
 * - `err._cmdlnSubcmd` and `err._cmdlnHandler`: If appropriate, this is
 *   the subcmd handler on which the error occurred. This might be a
 *   `do_SUBCMD` handler *function* or a Cmdln subcmd handler *object*.
 *   If the error happened before a subcmd handler was selected, then
 *   this isn't set.
 */
Cmdln.prototype.main = function cmdlnMain(argv, cb) {
    var self = this;
    assert.arrayOfString(argv, 'argv');
    assert.func(cb, 'cb');

    var decoErrAndCb = function (err) {
        if (err && !err._cmdlnInst) {
            err._cmdlnInst = self;
        }
        cb(err);
    };

    var finiAndCb = function (err, subcmd) {
        debug('-> <%s>.fini(%j, err=%s)', self.name, subcmd, err);
        self.fini(subcmd, err, function (finiErr) {
            debug('<- <%s>.fini: finiErr=%s', self.name, finiErr);
            decoErrAndCb(finiErr || err);
        });
    }

    try {
        this.opts = this.optParser.parse(argv);
    } catch (e) {
        decoErrAndCb(new OptionError(e));
        return;
    }
    var args = this.opts._args;

    debug('-> <%s>.init(%j, %j)', self.name, this.opts, args);
    self.init(this.opts, args, function (initErr) {
        debug('<- <%s>.init: initErr=%s', self.name, initErr)
        if (initErr) {
            finiAndCb(initErr);
            return;
        } else if (initErr === false) {
            // TODO: How to handle non-zero exit here? Special error?
            // StopProcessingError?
            finiAndCb();
            return
        }

        if (args.length === 0) {
            self.emptyLine(finiAndCb);
            return;
        }

        var subcmdArgv = argv.slice(0, 2).concat(args);
        var subcmd = args.shift();
        try {
            debug('-> <%s>.dispatch({subcmd: %j, argv: %j})',
                self.name, subcmd, subcmdArgv);
            self.dispatch({subcmd: subcmd, argv: subcmdArgv},
                function (dispErr) {
                    debug('<- <%s>.dispatch: dispErr=%s',
                        self.name, dispErr);
                    /*
                     * Do in nextTick to assure that we do not callback twice
                     * if (a) dispatch returns synchronously and (b) there is
                     * an exception raised during `finiAndCb`.
                     */
                    process.nextTick(function () {
                        finiAndCb(dispErr, subcmd);
                    });
                });
        } catch (ex) {
            debug('<- <%s>.dispatch crash: ex=%s', self.name, ex);
            finiAndCb(ex, subcmd);
        }
    });

};


/* BEGIN JSSTYLED */
/**
 * Return a Bash completion "spec" for this CLI.
 *
 * The Bash completion "spec" is the var that gets interpolated into the
 * "dashdash.bash_completion.in" template. It is Bash code that defines the
 * CLI options and subcmds for the template's completion code. It looks
 * something like this:
 *
 *      # Top-level.
 *      local cmd_shortopts="-J ..."
 *      local cmd_longopts="--help ..."
 *      local cmd_optargs="-p=tritonprofile ..."
 *      local cmd_subcmds="account create list ..."
 *      local cmd_allsubcmds="account hiddensub create list ..."
 *
 *      # The "TOOL instance ..." subcommand.
 *      local cmd__instance_shortopts="-h"
 *      local cmd__instance_longopts="--help"
 *      local cmd__instance_optargs=""
 *      local cmd__instance_subcmds="help list ls get ..."
 *      local cmd__instance_allsubcmds="help list ls get ..."
 *
 *      # The "TOOL instance list" sub-subcommand.
 *      local cmd__instance__list_shortopts="-h -H -o -l -s -j"
 *      local cmd__instance__list_longopts="--help --long --json"
 *      local cmd__instance__list_optargs="-o= -s="
 *
 *      # ...
 *
 *      # Optional completion functions for types referenced in "optargs" vars.
 *      # There is no requirement to have a completion function for every
 *      # type.
 *      function complete_tritonprofile {
 *          local word="$1"
 *          local candidates
 *          candidates=$(ls -1 ~/.triton/profiles.d/*.json 2>/dev/null \
 *              | sed -E 's/^.*\/([ \/]+)\.json$/\1/')
 *          compgen $compgen_opts -W "$candidates" -- "$word"
 *      }
 *
 * @param opts.context {String} Optional context string for the "local cmd*"
 *      vars. For example, for the "instance" subcommand above,
 *      `context="__instance"`.
 * @param opts.includeHidden {Boolean} Optional. Default false. By default
 *      hidden options and subcmds are "excluded". Here excluded means they
 *      won't be offered as a completion, but if used, their argument type
 *      will be completed. "Hidden" options and subcmds are ones with the
 *      `hidden: true` attribute to exclude them from default help output.
 */
/* END JSSTYLED */
Cmdln.prototype.bashCompletionSpec = function bashCompletionSpec(opts) {
    var self = this;
    if (!opts) {
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.optionalString(opts.context, 'opts.context');
    assert.optionalBool(opts.includeHidden, 'opts.includeHidden');

    var spec = [];
    var context = opts.context || '';
    var includeHidden = (opts.includeHidden === undefined
        ? false : opts.includeHidden);

    // Top-level.
    spec.push(dashdash.bashCompletionSpecFromOptions({
        options: self.options,
        context: context,
        includeHidden: includeHidden
    }));

    var aliases = [];
    var allAliases = [];
    Object.keys(this._nameFromAlias).sort().forEach(function (alias) {
        if (alias === '?') {
            // '?' as a Bash completion is painful. Also, '?' as a default
            // alias for 'help' should die.
            return;
        }

        var name = self._nameFromAlias[alias];
        var handler = self._handlerFromName[name];

        if (includeHidden || !handler.hidden) {
            aliases.push(alias);
        }
        allAliases.push(alias);
    });
    spec.push(format('local cmd%s_subcmds="%s"', context, aliases.join(' ')));
    spec.push(format('local cmd%s_allsubcmds="%s"', context,
        allAliases.join(' ')));

    // Subcmds.
    // We include completion info even for "hidden" subcmds, so that once
    // one has specified a hidden subcmd you get full completion under it.
    Object.keys(this._nameFromAlias).sort().forEach(function (alias) {
        if (alias === '?') {
            return;
        }
        spec.push('');
        var context_ = context + '__' + alias.replace(/-/g, '_');
        var name = self._nameFromAlias[alias];
        var handler = self._handlerFromName[name];

        if (typeof (handler.bashCompletionSpec) === 'function') {
            // This is a `Cmdln` subclass, i.e. a sub-CLI.
            var subspec = handler.bashCompletionSpec({context: context_});
            if (subspec) {
                spec.push(subspec);
            }
        } else {
            if (handler.completionArgtypes) {
                assert.arrayOfString(handler.completionArgtypes,
                    'do_' + name + '.completionArgtypes');
                spec.push(format('local cmd%s_argtypes="%s"',
                    context_, handler.completionArgtypes.join(' ')));
            }
            spec.push(dashdash.bashCompletionSpecFromOptions({
                options: handler.options || [],
                context: context_,
                includeHidden: includeHidden
            }));
        }
    });

    return spec.join('\n');
}

/**
 * Generate and return Bash completion for this Cmdln subclass instance.
 *
 * @param opts.specExtra {String} Optional. Extra Bash code content to add
 *      to the end of the "spec". Typically this is used to append Bash
 *      "complete_TYPE" functions for custom option types. See
 *      "node-dashdash/examples/ddcompletion.js" for an example.
 */
Cmdln.prototype.bashCompletion = function bashCompletion(opts) {
    if (!opts) {
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.optionalString(opts.specExtra, 'opts.specExtra');

    // Gather template data.
    var data = {
        name: this.name,
        date: new Date(),
        spec: this.bashCompletionSpec()
    };
    if (opts.specExtra) {
        data.spec += '\n\n' + opts.specExtra;
    }

    // Render template.
    var template = fs.readFileSync(
        dashdash.BASH_COMPLETION_TEMPLATE_PATH, 'utf8');
    return renderTemplate(template, data);
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
 * @param callback {Function} `function (err)` where `err===false` means stop
 *      processing, `err==<error instance>` passes that error back up, and
 *      no `err` means continue.
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
 * @param err {Error} The error being returned to the `main` caller, if any.
 * @param callback {Function} `function (finiErr)` where `finiErr` is an
 *      error from finalization handling. Note that this `fini()` method
 *      cannot abort `err`.
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
        this._renderHelp('{{usage}}', this),
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
        summary = self._renderTemplate(summary, name);
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


Cmdln.prototype.subcmdFromFuncname = function subcmdFromFuncname(funcname) {
    return funcname.slice(3).replace(/_/g, '-');
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
 * *Limitation*: If the command has a help *function*, then the function is
 * returned. It is up to the caller to call it, if they like. The help
 * function is defined to be async and is *not* defined to return the
 * string, so running it isn't useful here.
 *
 * @param alias {String} The sub-command name or alias.
 * @throws `UnknownCommandError` if there is no such sub-command.
 * @returns The help string, a help *function* (see the "Limitation" note
 *      above), or `null` if no help.
 */
Cmdln.prototype.helpFromSubcmd = function helpFromSubcmd(alias) {
    var handler = this.handlerFromSubcmd(alias);
    if (!handler) {
        throw new UnknownCommandError(alias);
    }

    if (handler.help) {
        if (typeof (handler.help) === 'function') {
            return handler.help;
        } else {
            return this._renderHelp(handler.help, handler, alias);
        }
    } else if (handler.do_help) {
        // This is likely a `Cmdln` subclass.
        return function subCliHelp(subcmd, opts, args, cb) {
            handler.do_help('help', opts, args.slice(1), function (helpErr) {
                cb(helpErr || false);
            });
        }
    } else {
        return null;
    }
};


Cmdln.prototype._renderHelp = function _renderHelp(template, handler, alias) {
    assert.string(template, 'template');
    assert.optionalString(alias, 'alias');

    var help = this._renderTemplate(template, alias);
    if (~help.indexOf('{{usage}}')) {
        var synopses = this.synopsesFromSubcmd(alias || handler);
        if (synopses.length) {
            help = help.replace('{{usage}}',
                'Usage:\n' + indent(synopses.join('\n')));
        }
    }
    if (~help.indexOf('{{options}}') && handler.options) {
        var parser = new dashdash.Parser({options: handler.options});
        var helpOpts = (handler.helpOpts
            ? objMerge(this.helpOpts, handler.helpOpts)
            : this.helpOpts);
        help = help.replace('{{options}}',
            'Options:\n' + parser.help(helpOpts));
    }
    help = help.trimRight();
    return help;
};

Cmdln.prototype._renderTemplate = function _renderTemplate(template, alias) {
    assert.string(template, 'template');
    assert.optionalString(alias, 'alias');

    var s = template;
    s = s.replace(/{{name}}/g, this.name);
    if (alias) {
        s = s.replace(/{{cmd}}/g, alias);
    }
    return s;
};

/**
 * A Cmdln subcmd handler (i.e. the `do_SUBCMD` function) can define a
 * `synopses` array of usage summaries. E.g.:
 *
 *      CLI.prototype.do_foo.synopses = ['{{name}} foo [OPTIONS] ...'];
 *
 * Synopses can use the following template vars:
 *      {{name}}        The cmdln name, e.g. 'mycmd'.
 *      {{cmd}}         The sub-command name.
 *
 * @param {String|Function|Object} subcmd: The subcommand name/alias or the
 *      subcmd handler (a `do_SUBCMD` function or sub-Cmdln instance).
 * @returns {Array} of synopsis strings, if any.
 * @throws {UnknownCommandError} if `alias` doesn't correspond to a command.
 */
Cmdln.prototype.synopsesFromSubcmd = function synopsesFromSubcmd(subcmd) {
    assert.ok(['function', 'string', 'object'].indexOf(typeof (subcmd)) !== -1);

    var name, handler;
    if (typeof (subcmd) === 'function') {
        handler = subcmd;
        name = this.subcmdFromFuncname(handler.name);
    } else if (typeof (subcmd) === 'object') {
        name = subcmd.name;
        handler = subcmd;
    } else {
        name = subcmd;
        handler = this.handlerFromSubcmd(subcmd);
        if (!handler) {
            throw new UnknownCommandError(subcmd);
        }
    }

    var synopses = [];
    if (handler.synopses) {
        for (var i = 0; i < handler.synopses.length; i++) {
            synopses.push(this._renderTemplate(handler.synopses[i], name));
        }
    }

    return synopses;
};


/**
 * Dispatch to the appropriate "do_SUBCMD" function.
 *
 * Old call signature:
 *      function dispatch(subcmd, argv, callback)
 *
 * New call signature:
 *      function dispatch(dispatchOpts, callback)
 *
 * where `argv` is the raw argv array, e.g. ['node', 'foo.js', 'arg1', 'arg2'].
 *
 * @param dispatchOpts {Object}
 *      - @param dispatchOpts.subcmd {String} Required.
 *      - @param dispatchOpts.argv {Array}
 *      - @param dispatchOpts.opts {Object}
 *      - @param dispatchOpts.args {Array}
 *        One must provide either `argv` *or* both `opts` and `args`. In the
 *        former, more common case, the option processing has not yet been done
 *        on the argv. This is equiv to the "old call signature". In the latter,
 *        dashdash option processing *has* been done. This can be useful for
 *        subcmds that are modified or shortcut versions of other ones.
 * @param callback {Function}
 */
Cmdln.prototype.dispatch = function dispatch(dispatchOpts, callback) {
    // Sort out input params.
    var subcmd, argv, opts, args;
    if (typeof (callback) === 'function') {
        // New call signature.
        assert.string(dispatchOpts.subcmd, 'dispatchOpts.subcmd');
        assert.optionalArrayOfString(dispatchOpts.argv, 'dispatchOpts.argv');
        assert.optionalObject(dispatchOpts.opts, 'dispatchOpts.opts');
        assert.optionalArrayOfString(dispatchOpts.args, 'dispatchOpts.args');
        subcmd = dispatchOpts.subcmd;
        argv = dispatchOpts.argv;
        opts = dispatchOpts.opts;
        args = dispatchOpts.args;
    } else {
        // Old call signature.
        assert.string(arguments[0], 'subcmd');
        assert.arrayOfString(arguments[1], 'argv');
        subcmd = arguments[0];
        argv = arguments[1];
        callback = arguments[2];
    }
    assert.func(callback, 'callback');
    assert.ok((argv && !opts && !args) || (!argv && opts && args),
        'must specify only one of "argv" *or* "opts/args"');
    var self = this;

    var finish = function (err) {
        if (err) {
            if (!err._cmdlnInst) err._cmdlnInst = self;
            if (!err._cmdlnSubcmd && subcmd) err._cmdlnSubcmd = subcmd;
            if (!err._cmdlnHandler && handler) err._cmdlnHandler = handler;
        }
        callback(err);
    }

    var handler = this.handlerFromSubcmd(subcmd);
    if (!handler) {
        finish(new UnknownCommandError(subcmd));
        return;
    }

    if (argv) {
        opts = {};
        args = argv.slice(3);
    }

    if (typeof (handler.main) === 'function') {
        // This is likely a `Cmdln` subclass instance, i.e. a subcli.
        (function callCmdlnHandler(subcmd, opts, args, cb) {
            var argv = ['', ''].concat(args);
            handler.main(argv, cb);
        }).call(this, subcmd, opts, args, finish);
    } else {
        // This is a vanilla `do_SUBCMD` function on the Cmdln class.

        // Skip optional processing if given `opts` -- i.e. it was already done.
        if (argv && handler.options) {
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
                finish(new OptionError(e));
                return;
            }
            args = opts._args;
            debug('-- parse %j opts: %j', subcmd, opts);
        }
        handler.call(this, subcmd, opts, args, finish);
    }
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
 *      // ...
 *
 *      if (require.main === module) {
 *          var cli = MyCLI();
 *          cmdln.main(cli);
 *      }
 *
 * If one wants more control over process termination, err printing or whatever,
 * the gist of this convenience function is:
 *
 *      var cli = MyCLI();
 *      cli.main(process.argv, function (err) {
 *          // handle `err`, if any
 *      });
 *
 * @param cli {Function} A `Cmdln` subclass instance.
 * @param options {Object}
 *      - `argv` {Array} The argv to process. Optional. Default is
 *        `process.argv`.
 *      - `finale` {String} Optional, default 'softexit'. What to do when
 *        done. Options are 'softexit' (set `process.exitCode` if supported,
 *        else call `process.exit()`), 'exit' (call `process.exit()` which
 *        can result in std handles not being flushed), 'callback' (call
 *        the given `options.callback`), or 'none'.
 *      - `callback` {Function} Optional. A function called `function (err)`
 *        if `options.finale === "callback"`.
 *      - `showErr` {Boolean} Optional. Whether to show (i.e. print via
 *        `console.error(...)` an error. If not set, then `<cli>.showErr`
 *        decides. Default true.
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
 *        decides. Default false.
 *      - `showErrHelp` {Boolean} Optional. Whether to show error help
 *        (see comment on `errHelpFromErr()` and the CHANGES.md entry for
 *        version 4.0.0) after an error is printed and if error help is
 *        available. Typically only this module's own error classes support
 *        error help. Default true.
 *
 * Some fields can be set on the Cmdln instance, `<cli>`, to control error
 * printing. One might want to set these dynamically based, e.g., on top-level
 * options like `--quiet` or `--verbose`.
 * - `<cli>.showErr`
 * - `<cli>.showErrStack`
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
    assert.optionalBool(options.showErrHelp, 'options.showErrHelp');

    var VALID_FINALES = ['softexit', 'exit', 'callback', 'none'];
    var finale;
    if (options.hasOwnProperty('finale')) {
        assert.ok(VALID_FINALES.indexOf(options.finale) !== -1,
            format('invalid options.finale "%s": valid values are "%s"',
                options.finale, '", "'.join(VALID_FINALES)));
        finale = options.finale
    } else {
        finale = 'softexit';
    }
    if (options.hasOwnProperty('callback')) {
        assert.func(options.callback, 'options.callback');
        assert.equal(finale, 'callback',
            'options.callback provided, but options.finale is not "callback"');
    }

    cli.main(options.argv, function (err) {
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
                 * isn't an Error instance. Let's just not print an error
                 * message. This can happen if the subcmd passes back `true`
                 * or similar to indicate "yes there was an error".
                 */
                var showErrStack = (options.showErrStack === undefined
                        ? cli.showErrStack : options.showErrStack);
                console.error('%s: error%s: %s',
                    nameFromErr(err),
                    (options.showCode && code ? format(' (%s)', code) : ''),
                    (showErrStack ? err.stack : err.message));
                var showErrHelp = (options.showErrHelp === undefined
                    ? true : options.showErrHelp);
                if (showErrHelp) {
                    var errHelp = errHelpFromErr(err);
                    if (errHelp) {
                        console.error(errHelp);
                    }
                }
            }
        }

        if (finale === 'exit') {
            process.exit(exitStatus);
        } else if (finale === 'softexit') {
            /*
             * We'd like to NOT use `process.exit` because node then doesn't in
             * general allow std handles to flush. For some node versions it
             * *will* flush if stdout is a TTY. However, you are then screwed
             * when piping output to anything. IOW, that is no help.
             *
             * In node 0.12, `process.exitCode` provided a way to set the exit
             * code without the hard immediate `process.exit()`.
             *
             * Note: A side-effect of avoiding `process.exit()` if we can
             * manage it, is that a node tool using this that still has active
             * handles will hang instead of exiting. If that is you, use
             * `finale: "exit"`.
             */
            var supportsProcessExitCode = true;
            var nodeVer = process.versions.node.split('.').map(Number);
            if (nodeVer[0] === 0 && nodeVer[1] <= 10) {
                supportsProcessExitCode = false;
            }

            if (supportsProcessExitCode) {
                process.exitCode = exitStatus;
            } else if (exitStatus !== 0) {
                process.exit(exitStatus);
            }
        } else if (finale === 'callback') {
            if (options.callback) {
                options.callback(err);
            }
        }
    });
}



// ---- exports

module.exports = {
    Cmdln: Cmdln,
    main: main,

    CmdlnError: CmdlnError,
    UsageError: UsageError,
    OptionError: OptionError,
    UnknownCommandError: UnknownCommandError,
    errHelpFromErr: errHelpFromErr,
    nameFromErr: nameFromErr,

    // Expose this to allow calling code to `cmdln.dashdash.addOptionType`.
    dashdash: dashdash
};
