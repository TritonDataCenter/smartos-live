#!/usr/node/bin/node
//
// json -- a 'json' command for massaging JSON on the command line
//
// See <https://github.com/trentm/json>.
//

var VERSION = "5.1.1";

var util = require('util');
var pathlib = require('path');
var vm = require('vm');
var fs = require('fs');
var warn = console.warn;
var EventEmitter = require('events').EventEmitter;



//--- exports for module usage

exports.main = main;
exports.getVersion = getVersion;
exports.parseLookup = parseLookup;

// As an exported API, these are still experimental:
exports.lookupDatum = lookupDatum;
exports.printDatum = printDatum;



//---- globals and constants

// Output modes.
var OM_JSONY = 1;
var OM_JSON = 2;
var OM_INSPECT = 3;
var OM_COMPACT = 4;
var OM_FROM_NAME = {
  "jsony": OM_JSONY,
  "json": OM_JSON,
  "inspect": OM_INSPECT,
  "compact": OM_COMPACT
}



//---- support functions

function getVersion() {
  return VERSION;
}

/**
 * Return a *shallow* copy of the given object.
 *
 * Only support objects that you get out of JSON, i.e. no functions.
 */
function objCopy(obj) {
  var copy;
  if (Array.isArray(obj)) {
    copy = obj.slice();
  } else if (typeof(obj) === 'object') {
    copy = {};
    Object.keys(obj).forEach(function (k) {
      copy[k] = obj[k];
    });
  } else {
    copy = obj;  // immutable type
  }
  return copy;
}

if (util.format) {
  format = util.format;
} else {
  // From <https://github.com/joyent/node/blob/master/lib/util.js#L22>:
  var formatRegExp = /%[sdj%]/g;
  function format(f) {
    if (typeof f !== 'string') {
      var objects = [];
      for (var i = 0; i < arguments.length; i++) {
        objects.push(util.inspect(arguments[i]));
      }
      return objects.join(' ');
    }
    var i = 1;
    var args = arguments;
    var len = args.length;
    var str = String(f).replace(formatRegExp, function(x) {
      if (i >= len) return x;
      switch (x) {
        case '%s': return String(args[i++]);
        case '%d': return Number(args[i++]);
        case '%j': return JSON.stringify(args[i++]);
        case '%%': return '%';
        default:
          return x;
      }
    });
    for (var x = args[i]; i < len; x = args[++i]) {
      if (x === null || typeof x !== 'object') {
        str += ' ' + x;
      } else {
        str += ' ' + util.inspect(x);
      }
    }
    return str;
  };
}

/**
 * Parse the given string into a JS string. Basically: handle escapes.
 */
function _parseString(s) {
  var quoted = '"' + s.replace(/\\"/, '"').replace('"', '\\"') + '"';
  return eval(quoted);
}

// json_parse.js (<https://github.com/douglascrockford/JSON-js>)
// START json_parse
var json_parse=function(){"use strict";var a,b,c={'"':'"',"\\":"\\","/":"/",b:"\b",f:"\f",n:"\n",r:"\r",t:"\t"},d,e=function(b){throw{name:"SyntaxError",message:b,at:a,text:d}},f=function(c){return c&&c!==b&&e("Expected '"+c+"' instead of '"+b+"'"),b=d.charAt(a),a+=1,b},g=function(){var a,c="";b==="-"&&(c="-",f("-"));while(b>="0"&&b<="9")c+=b,f();if(b==="."){c+=".";while(f()&&b>="0"&&b<="9")c+=b}if(b==="e"||b==="E"){c+=b,f();if(b==="-"||b==="+")c+=b,f();while(b>="0"&&b<="9")c+=b,f()}a=+c;if(!isFinite(a))e("Bad number");else return a},h=function(){var a,d,g="",h;if(b==='"')while(f()){if(b==='"')return f(),g;if(b==="\\"){f();if(b==="u"){h=0;for(d=0;d<4;d+=1){a=parseInt(f(),16);if(!isFinite(a))break;h=h*16+a}g+=String.fromCharCode(h)}else if(typeof c[b]=="string")g+=c[b];else break}else g+=b}e("Bad string")},i=function(){while(b&&b<=" ")f()},j=function(){switch(b){case"t":return f("t"),f("r"),f("u"),f("e"),!0;case"f":return f("f"),f("a"),f("l"),f("s"),f("e"),!1;case"n":return f("n"),f("u"),f("l"),f("l"),null}e("Unexpected '"+b+"'")},k,l=function(){var a=[];if(b==="["){f("["),i();if(b==="]")return f("]"),a;while(b){a.push(k()),i();if(b==="]")return f("]"),a;f(","),i()}}e("Bad array")},m=function(){var a,c={};if(b==="{"){f("{"),i();if(b==="}")return f("}"),c;while(b){a=h(),i(),f(":"),Object.hasOwnProperty.call(c,a)&&e('Duplicate key "'+a+'"'),c[a]=k(),i();if(b==="}")return f("}"),c;f(","),i()}}e("Bad object")};return k=function(){i();switch(b){case"{":return m();case"[":return l();case'"':return h();case"-":return g();default:return b>="0"&&b<="9"?g():j()}},function(c,f){var g;return d=c,a=0,b=" ",g=k(),i(),b&&e("Syntax error"),typeof f=="function"?function h(a,b){var c,d,e=a[b];if(e&&typeof e=="object")for(c in e)Object.prototype.hasOwnProperty.call(e,c)&&(d=h(e,c),d!==undefined?e[c]=d:delete e[c]);return f.call(a,b,e)}({"":g},""):g}}();
// END json_parse

function printHelp() {
  util.puts("Usage:");
  util.puts("  <something generating JSON on stdout> | json [OPTIONS] [LOOKUPS...]");
  util.puts("  json -f FILE [OPTIONS] [LOOKUPS...]");
  util.puts("");
  util.puts("Pipe in your JSON for pretty-printing, JSON validation, filtering, ");
  util.puts("and modification. Supply one or more `LOOKUPS` to extract a ");
  util.puts("subset of the JSON. HTTP header blocks are skipped by default.");
  util.puts("Roughly in order of processing, features are:");
  util.puts("");
  util.puts("Grouping:");
  util.puts("  Use '-g' or '--group' to group objects or arrays separated ");
  util.puts("  by no space or by a newline. This can be helpful for, e.g.: ");
  util.puts("     $ cat *.json | json -g ... ");
  util.puts("  and similar.");
  util.puts("");
  util.puts("Execution:");
  util.puts("  Use the '-e CODE' option to execute code on the input JSON.");
  util.puts("     $ echo '{\"name\":\"trent\",\"age\":38}' | json -e 'age++'");
  util.puts("     {");
  util.puts("       \"name\": \"trent\",");
  util.puts("       \"age\": 39");
  util.puts("     }");
  util.puts("  If input is an array, this will automatically process each");
  util.puts("  item separately.");
  util.puts("");
  util.puts("Conditional filtering:");
  util.puts("  Use the '-c CODE' option to filter the input JSON.");
  util.puts("     $ echo '[{\"age\":38},{\"age\":4}]' | json -c 'age>21'");
  util.puts("     [{\"age\":38}]");
  util.puts("  If input is an array, this will automatically process each");
  util.puts("  item separately.");
  util.puts("");
  util.puts("Lookups:");
  util.puts("  Use lookup arguments to extract particular values:");
  util.puts("     $ echo '{\"name\":\"trent\",\"age\":38}' | json name");
  util.puts("     trent");
  util.puts("");
  util.puts("  Use '-a' for *array processing* of lookups and *tabular output*:");
  util.puts("     $ echo '{\"name\":\"trent\",\"age\":38}' | json name age");
  util.puts("     trent");
  util.puts("     38");
  util.puts("     $ echo '[{\"name\":\"trent\",\"age\":38},");
  util.puts("              {\"name\":\"ewan\",\"age\":4}]' | json -a name age");
  util.puts("     trent 38");
  util.puts("     ewan 4");
  util.puts("");
  util.puts("Pretty-printing:");
  util.puts("  Output is 'jsony' by default: 2-space indented JSON, except a");
  util.puts("  single string value is printed without quotes.");
  util.puts("     $ echo '{\"name\": \"trent\", \"age\": 38}' | json");
  util.puts("     {");
  util.puts("       \"name\": \"trent\",");
  util.puts("       \"age\": 38");
  util.puts("     }");
  util.puts("     $ echo '{\"name\": \"trent\", \"age\": 38}' | json name");
  util.puts("     trent");
  util.puts("");
  util.puts("  Use '-j' or '-o json' for explicit JSON, '-o json-N' for N-space indent:");
  util.puts("     $ echo '{\"name\": \"trent\", \"age\": 38}' | json -o json-0");
  util.puts("     {\"name\":\"trent\",\"age\":38}");
  util.puts("");
  util.puts("Options:");
  util.puts("  -h, --help    Print this help info and exit.");
  util.puts("  --version     Print version of this command and exit.");
  util.puts("  -q, --quiet   Don't warn if input isn't valid JSON.");
  util.puts("");
  util.puts("  -f FILE       Path to a file to process. If not given, then");
  util.puts("                stdin is used.");
  util.puts("");
  util.puts("  -H            Drop any HTTP header block (as from `curl -i ...`).");
  util.puts("  -g, --group   Group adjacent objects or arrays into an array.");
  util.puts("  --merge       Merge adjacent objects into one. Keys in last ");
  util.puts("                object win.");
  util.puts("  --deep-merge  Same as '--merge', but will recurse into objects ");
  util.puts("                under the same key in both.")
  util.puts("  -a, --array   Process input as an array of separate inputs");
  util.puts("                and output in tabular form.");
  util.puts("  -A            Process input as a single object, i.e. stop");
  util.puts("                '-e' and '-c' automatically processing each");
  util.puts("                item of an input array.");
  util.puts("  -d DELIM      Delimiter char for tabular output (default is ' ').");
  util.puts("  -D DELIM      Delimiter char between lookups (default is '.'). E.g.:");
  util.puts("                  $ echo '{\"a.b\": {\"b\": 1}}' | json -D / a.b/b");
  util.puts("");
  util.puts("  -e CODE       Execute the given code on the input. If input is an");
  util.puts("                array, then each item of the array is processed");
  util.puts("                separately (use '-A' to override).");
  util.puts("  -c CODE       Filter the input with `CODE`. If `CODE` returns");
  util.puts("                false-y, then the item is filtered out. If input");
  util.puts("                is an array, then each item of the array is ");
  util.puts("                processed separately (use '-A' to override).");
  util.puts("");
  util.puts("  -k, --keys    Output the input object's keys.");
  util.puts("  --validate    Just validate the input (no processing or output).");
  util.puts("                Use with '-q' for silent validation (exit status).");
  util.puts("");
  util.puts("  -o, --output MODE   Specify an output mode. One of");
  util.puts("                  jsony (default): JSON with string quotes elided");
  util.puts("                  json: JSON output, 2-space indent");
  util.puts("                  json-N: JSON output, N-space indent, e.g. 'json-4'");
  util.puts("                  inspect: node.js `util.inspect` output");
  util.puts("  -i            shortcut for `-o inspect`");
  util.puts("  -j            shortcut for `-o json`");
  util.puts("");
  util.puts("See <http://trentm.com/json> for more docs and ");
  util.puts("<https://github.com/trentm/json> for project details.");
}


/**
 * Parse the command-line options and arguments into an object.
 *
 *    {
 *      'args': [...]       // arguments
 *      'help': true,       // true if '-h' option given
 *       // etc.
 *    }
 *
 * @return {Object} The parsed options. `.args` is the argument list.
 * @throws {Error} If there is an error parsing argv.
 */
function parseArgv(argv) {
  var parsed = {
    args: [],
    help: false,
    quiet: false,
    dropHeaders: false,
    exeSnippets: [],
    condSnippets: [],
    outputMode: OM_JSONY,
    jsonIndent: 2,
    array: null,
    delim: ' ',
    lookupDelim: '.',
    outputKeys: false,
    group: false,
    merge: null,    // --merge -> "shallow", --deep-merge -> "deep"
    inputFiles: [],
    validate: false
  };

  // Turn '-iH' into '-i -H', except for argument-accepting options.
  var args = argv.slice(2);  // drop ['node', 'scriptname']
  var newArgs = [];
  var optTakesArg = {'d': true, 'o': true, 'D': true};
  for (var i = 0; i < args.length; i++) {
    if (args[i].charAt(0) === "-" && args[i].charAt(1) !== '-' && args[i].length > 2) {
      var splitOpts = args[i].slice(1).split("");
      for (var j = 0; j < splitOpts.length; j++) {
        newArgs.push('-' + splitOpts[j])
        if (optTakesArg[splitOpts[j]]) {
          var optArg = splitOpts.slice(j+1).join("");
          if (optArg.length) {
            newArgs.push(optArg);
          }
          break;
        }
      }
    } else {
      newArgs.push(args[i]);
    }
  }
  args = newArgs;

  endOfOptions = false;
  while (args.length > 0) {
    var arg = args.shift();
    switch(arg) {
      case "--":
        endOfOptions = true;
        break;
      case "-h": // display help and exit
      case "--help":
        parsed.help = true;
        break;
      case "--version":
        parsed.version = true;
        break;
      case "-q":
      case "--quiet":
        parsed.quiet = true;
        break;
      case "-H": // drop any headers
        parsed.dropHeaders = true;
        break;
      case "-o":
      case "--output":
        var name = args.shift();
        if (!name) {
          throw new Error("no argument given for '-o|--output' option");
        }
        var idx = name.lastIndexOf('-');
        if (idx !== -1) {
          var indent = Number(name.slice(idx+1));
          if (! isNaN(indent)) {
            parsed.jsonIndent = indent;
            name = name.slice(0, idx);
          }
        }
        parsed.outputMode = OM_FROM_NAME[name];
        if (parsed.outputMode === undefined) {
          throw new Error("unknown output mode: '"+name+"'");
        }
        break;
      case "-i": // output with util.inspect
        parsed.outputMode = OM_INSPECT;
        break;
      case "-j": // output with JSON.stringify
        parsed.outputMode = OM_JSON;
        break;
      case "-a":
      case "--array":
        parsed.array = true;
        break;
      case "-A":
        parsed.array = false;
        break;
      case "-d":
        parsed.delim = _parseString(args.shift());
        break;
      case "-D":
        parsed.lookupDelim = args.shift();
        if (parsed.lookupDelim.length !== 1) {
          throw new Error(format(
            "invalid lookup delim '%s' (must be a single char)",
            parsed.lookupDelim));
        }
        break;
      case "-e":
        parsed.exeSnippets.push(args.shift());
        break;
      case "-c":
        parsed.condSnippets.push(args.shift());
        break;
      case "-k":
      case "--keys":
        parsed.outputKeys = true;
        break;
      case "-g":
      case "--group":
        parsed.group = true;
        break;
      case "--merge":
        parsed.merge = "shallow";
        break;
      case "--deep-merge":
        parsed.merge = "deep";
        break;
      case "-f":
        parsed.inputFiles.push(args.shift());
        break;
      case "--validate":
        parsed.validate = true;
        break;
      default: // arguments
        if (!endOfOptions && arg.length > 0 && arg[0] === '-') {
          throw new Error("unknown option '"+arg+"'");
        }
        parsed.args.push(arg);
        break;
    }
  }

  if (parsed.group && parsed.merge) {
    throw new Error("cannot use -g|--group and --merge options together");
  }
  if (parsed.outputKeys && parsed.args.length > 0) {
    throw new Error("cannot use -k|--keys option and lookup arguments together");
  }

  return parsed;
}



/**
 * Streams chunks from given file paths or stdin.
 *
 * @param opts {Object} Parsed options.
 * @returns {Object} An emitter that emits 'chunk', 'error', and 'end'.
 *    - `emit('chunk', chunk, [obj])` where chunk is a complete block of JSON
 *       ready to parse. If `obj` is provided, it is the already parsed
 *       JSON.
 *    - `emit('error', error)` when an underlying stream emits an error
 *    - `emit('end')` when all streams are done
 */
function chunkEmitter(opts) {
  var emitter = new EventEmitter();
  var streaming = true;
  var chunks = [];
  var leftover = '';
  var finishedHeaders = false;

  function stripHeaders(s) {
    // Take off a leading HTTP header if any and pass it through.
    while (true) {
      if (s.slice(0,5) === "HTTP/") {
        var index = s.indexOf('\r\n\r\n');
        var sepLen = 4;
        if (index == -1) {
          index = s.indexOf('\n\n');
          sepLen = 2;
        }
        if (index != -1) {
          if (! opts.dropHeaders) {
            emit(s.slice(0, index+sepLen));
          }
          var is100Continue = (s.slice(0, 21) === "HTTP/1.1 100 Continue");
          s = s.slice(index+sepLen);
          if (is100Continue) {
            continue;
          }
          finishedHeaders = true;
        }
      } else {
        finishedHeaders = true;
      }
      break;
    }
    //console.warn("XXX stripHeaders done, finishedHeaders=%s", finishedHeaders)
    return s;
  }

  function emitChunks(block, emitter) {
    //console.warn("XXX emitChunks start: block='%s'", block)
    var splitter = /(})(\s*\n\s*)?({\s*")/;
    var leftTrimmedBlock = block.trimLeft();
    if (leftTrimmedBlock && leftTrimmedBlock[0] !== '{') {
      // Currently (at least), only support streaming consecutive *objects*.
      streaming = false;
      chunks.push(block);
      return '';
    }
    /* Example:
     * > '{"a":"b"}\n{"a":"b"}\n{"a":"b"}'.split(/(})(\s*\n\s*)?({\s*")/)
     * [ '{"a":"b"',
     *   '}',
     *   '\n',
     *   '{"',
     *   'a":"b"',
     *   '}',
     *   '\n',
     *   '{"',
     *   'a":"b"}' ]
     */
    var bits = block.split(splitter);
    //console.warn("XXX emitChunks: bits (length %d): %j", bits.length, bits);
    if (bits.length === 1) {
      /*
       * An unwanted side-effect of using a regex to find newline-separated
       * objects *with a regex*, is that we are looking for the end of one
       * object leading into the start of a another. That means that we
       * can end up buffering a complete object until a subsequent one
       * comes in. If the input stream has large delays between objects, then
       * this is unwanted buffering.
       *
       * One solution would be full stream parsing of objects a la
       * <https://github.com/creationix/jsonparse>. This would nicely also
       * remove the artibrary requirement that the input stream be newline
       * separated. jsonparse apparently has some issues tho, so I don't
       * want to use it right now. It also isn't *small* so not sure I
       * want to inline it (`json` doesn't have external deps).
       *
       * An alternative: The block we have so far one of:
       * 1. some JSON that we don't support grouping (e.g. a stream of
       *    non-objects),
       * 2. a JSON object fragment, or
       * 3. a complete JSON object (with a possible trailing '{')
       *
       * If #3, then we can just emit this as a chunk right now.
       *
       * TODO(PERF): Try out avoiding the first more complete regex split
       * for a presumed common case of single-line newline-separated JSON
       * objects (e.g. a bunyan log).
       */
      // An object must end with '}'. This is an early out to avoid
      // `JSON.parse` which I *presuming* is slower.
      var trimmed = block.split(/\s*\r?\n/)[0];
      //console.warn("XXX trimmed: '%s'", trimmed);
      if (trimmed[trimmed.length - 1] === '}') {
        var obj;
        try {
          obj = JSON.parse(block);
        } catch (e) {
          /* pass through */
        }
        if (obj !== undefined) {
          // Emit the parsed `obj` to avoid re-parsing it later.
          emitter.emit('chunk', block, obj);
          block = '';
        }
      }
      return block;
    } else {
      var n = bits.length - 2;
      emitter.emit('chunk', bits[0] + bits[1]);
      for (var i = 3; i < n; i += 4) {
        emitter.emit('chunk', bits[i] + bits[i+1] + bits[i+2]);
      }
      return bits[n] + bits[n+1];
    }
  }

  function addDataListener(stream) {
    stream.on('data', function (chunk) {
      var s = leftover + chunk;
      if (!finishedHeaders) {
        s = stripHeaders(s);
      }
      if (!finishedHeaders) {
        leftover = s;
      } else {
        if (!streaming) {
          chunks.push(chunk);
          return;
        }
        leftover = emitChunks(s, emitter);
        //console.warn("XXX leftover: '%s'", leftover)
      }
    });
  }

  if (opts.inputFiles.length > 0) {
    // Stream each file in order.
    var i = 0;
    function addErrorListener(file) {
      file.on('error', function (err) {
        emitter.emit(
          'error',
          format('could not read "%s": %s', opts.inputFiles[i], e)
        );
      });
    }
    function addEndListener(file) {
      file.on('end', function () {
        if (i < opts.inputFiles.length) {
          var next = opts.inputFiles[i++];
          var nextFile = fs.createReadStream(next, {encoding: 'utf8'});
          addErrorListener(nextFile);
          addEndListener(nextFile);
          addDataListener(nextFile);
        } else {
          if (!streaming) {
            emitter.emit('chunk', chunks.join(''));
          } else if (leftover) {
            leftover = emitChunks(leftover, emitter);
            emitter.emit('chunk', leftover);
          }
          emitter.emit('end');
        }
      });
    }
    var first = fs.createReadStream(opts.inputFiles[i++], {encoding: 'utf8'});
    addErrorListener(first);
    addEndListener(first);
    addDataListener(first);
  } else {
    // Streaming from stdin.
    var stdin = process.openStdin();
    stdin.setEncoding('utf8');
    addDataListener(stdin);
    stdin.on('end', function () {
      if (!streaming) {
        emitter.emit('chunk', chunks.join(''));
      } else if (leftover) {
        leftover = emitChunks(leftover, emitter);
        emitter.emit('chunk', leftover);
      }
      emitter.emit('end');
    });
  }
  return emitter;
}

/**
 * Get input from either given file paths or stdin.
 *
 * @param opts {Object} Parsed options.
 * @param callback {Function} `function (err, callback)` where err is an
 *    error string if there was a problem.
 */
function getInput(opts, callback) {
  if (opts.inputFiles.length === 0) {
    // Read from stdin.
    var chunks = [];

    var stdin = process.openStdin();
    stdin.setEncoding('utf8');
    stdin.on('data', function (chunk) {
      chunks.push(chunk);
    });

    stdin.on('end', function () {
      callback(null, chunks.join(''));
    });
  } else {
    // Read input files.
    var i = 0;
    var chunks = [];
    try {
      for (; i < opts.inputFiles.length; i++) {
        chunks.push(fs.readFileSync(opts.inputFiles[i], 'utf8'));
      }
    } catch (e) {
      return callback(
        format('could not read "%s": %s', opts.inputFiles[i], e));
    }
    callback(null, chunks.join(''));
  }
}


function isInteger(s) {
  return (s.search(/^-?[0-9]+$/) == 0);
}


// Parse a lookup string into a list of lookup bits. E.g.:
//    "a.b.c" -> ["a","b","c"]
//    "b['a']" -> ["b","['a']"]
// Optionally receives an alternative lookup delimiter (other than '.')
function parseLookup(lookup, lookupDelim) {
  //var debug = console.warn;
  var debug = function () {};

  var bits = [];
  debug("\n*** "+lookup+" ***")

  bits = [];
  lookupDelim = lookupDelim || ".";
  var bit = "";
  var states = [null];
  var escaped = false;
  var ch = null;
  for (var i=0; i < lookup.length; ++i) {
    var escaped = (!escaped && ch === '\\');
    var ch = lookup[i];
    debug("-- i="+i+", ch="+JSON.stringify(ch)+" escaped="+JSON.stringify(escaped))
    debug("states: "+JSON.stringify(states))

    if (escaped) {
      bit += ch;
      continue;
    }

    switch (states[states.length-1]) {
    case null:
      switch (ch) {
      case '"':
      case "'":
        states.push(ch);
        bit += ch;
        break;
      case '[':
        states.push(ch);
        if (bit !== "") {
          bits.push(bit);
          bit = ""
        }
        bit += ch;
        break;
      case lookupDelim:
        if (bit !== "") {
          bits.push(bit);
          bit = ""
        }
        break;
      default:
        bit += ch;
        break;
      }
      break;

    case '[':
      bit += ch;
      switch (ch) {
      case '"':
      case "'":
      case '[':
        states.push(ch);
        break;
      case ']':
        states.pop();
        if (states[states.length-1] === null) {
          bits.push(bit);
          bit = ""
        }
        break;
      }
      break;

    case '"':
      bit += ch;
      switch (ch) {
      case '"':
        states.pop();
        if (states[states.length-1] === null) {
          bits.push(bit);
          bit = ""
        }
        break;
      }
      break;

    case "'":
      bit += ch;
      switch (ch) {
      case "'":
        states.pop();
        if (states[states.length-1] === null) {
          bits.push(bit);
          bit = ""
        }
        break;
      }
      break;
    }
    debug("bit: "+JSON.stringify(bit))
    debug("bits: "+JSON.stringify(bits))
  }

  if (bit !== "") {
    bits.push(bit);
    bit = ""
  }

  debug(JSON.stringify(lookup)+" -> "+JSON.stringify(bits))
  return bits
}


/**
 * Parse the given stdin input into:
 *  {
 *    "error": ... error object if there was an error ...,
 *    "datum": ... parsed object if content was JSON ...
 *   }
 *
 * @param buffer {String} The text to parse as JSON.
 * @param obj {Object} Optional. Some streaming code paths will provide
 *    this, an already parsed JSON object. Use this to avoid reparsing.
 * @param group {Boolean} Default false. If true, then non-JSON input
 *    will be attempted to be "arrayified" (see inline comment).
 * @param merge {Boolean} Default null. Can be "shallow" or "deep". An
 *    attempt will be made to interpret the input as adjacent objects to
 *    be merged, last key wins. See inline comment for limitations.
 */
function parseInput(buffer, obj, group, merge) {
  if (obj) {
    return {datum: obj};
  } else if (group) {
    // Special case: Grouping (previously called auto-arrayification)
    // of unjoined list of objects:
    //    {"one": 1}{"two": 2}
    // and auto-concatenation of unjoined list of arrays:
    //    ["a", "b"]["c", "d"]
    //
    // This can be nice to process a stream of JSON objects generated from
    // multiple calls to another tool or `cat *.json | json`.
    //
    // Rules:
    // - Only JS objects and arrays. Don't see strong need for basic
    //   JS types right now and this limitation simplifies.
    // - The break between JS objects has to include a newline:
    //      {"one": 1}
    //      {"two": 2}
    //   or no spaces at all:
    //      {"one": 1}{"two": 2}
    //   I.e., not this:
    //      {"one": 1}  {"two": 2}
    //   This condition should be fine for typical use cases and ensures
    //   no false matches inside JS strings.
    var newBuffer = buffer;
    [/(})\s*\n\s*({)/g, /(})({")/g].forEach(function (pat) {
      newBuffer = newBuffer.replace(pat, "$1,\n$2");
    });
    [/(\])\s*\n\s*(\[)/g, /(\])(\[)/g].forEach(function (pat) {
      newBuffer = newBuffer.replace(pat, ",\n");
    });
    newBuffer = newBuffer.trim();
    if (newBuffer[0] !== '[') {
      newBuffer = '[\n' + newBuffer;
    }
    if (newBuffer.slice(-1) !== ']') {
      newBuffer = newBuffer + '\n]\n';
    }
    try {
      return {datum: JSON.parse(newBuffer)};
    } catch (e2) {
      return {error: e2};
    }
  } else if (merge) {
    // See the "Rules" above for limitations on boundaries for "adjacent"
    // objects: KISS.
    var newBuffer = buffer;
    [/(})\s*\n\s*({)/g, /(})({")/g].forEach(function (pat) {
      newBuffer = newBuffer.replace(pat, "$1,\n$2");
    });
    newBuffer = '[\n' + newBuffer + '\n]\n';
    var objs;
    try {
      objs = JSON.parse(newBuffer);
    } catch(e) {
      return {error: e};
    }
    var merged = objs[0];
    if (merge === "shallow") {
      for (var i = 1; i < objs.length; i++) {
        var obj = objs[i];
        Object.keys(obj).forEach(function (k) {
          merged[k] = obj[k];
        });
      }
    } else if (merge === "deep") {
      function deepExtend(a, b) {
        Object.keys(b).forEach(function (k) {
          if (a[k] && b[k] && toString.call(a[k]) === '[object Object]'
              && toString.call(b[k]) === '[object Object]') {
            deepExtend(a[k], b[k])
          } else {
            a[k] = b[k];
          }
        });
      }
      for (var i = 1; i < objs.length; i++) {
        deepExtend(merged, objs[i]);
      }
    } else {
      throw new Error(format('unknown value for "merge": "%s"', merge));
    }
    return {datum: merged};
  } else {
    try {
      return {datum: JSON.parse(buffer)};
    } catch(e) {
      return {error: e};
    }
  }
}


/**
 * Apply a lookup to the given datum.
 *
 * @argument datum {Object}
 * @argument lookup {Array} The parsed lookup (from
 *    `parseLookup(<string>, <string>)`). Might be empty.
 * @returns {Object} The result of the lookup.
 */
function lookupDatum(datum, lookup) {
  // Put it back together with some convenience transformations.
  var lookupCode = "";
  var isJSIdentifier = /^[$A-Za-z_][0-9A-Za-z_]*$/;
  var isNegArrayIndex = /^-\d+$/;
  for (var i=0; i < lookup.length; i++) {
    var bit = lookup[i];
    if (bit[0] === '[') {
      lookupCode += bit;
    // Support Python-style negative array indexing.
    } else if (bit === '-1') {
      lookupCode += '.slice(-1)[0]';
    } else if (isNegArrayIndex.test(bit)) {
      lookupCode += format('.slice(%s, %d)[0]', bit, Number(bit) + 1);
    } else if (! isJSIdentifier.test(bit)) {
      // Allow a non-JS-indentifier token, e.g. `json foo-bar`. This also
      // works for array index lookups: `json 0` becomes a `["0"]` lookup.
      lookupCode += '["' + bit.replace(/"/g, '\\"') + '"]';
    } else {
      lookupCode += '.' + bit;
    }
  }
  try {
    return vm.runInNewContext("(" + JSON.stringify(datum) + ")" + lookupCode);
  } catch (e) {
    if (e.name === 'TypeError') {
      // Skip the following for a lookup 'foo.bar' where 'foo' is undefined:
      //    TypeError: Cannot read property 'bar' of undefined
      // TODO: Are there other potential TypeError's in here to avoid?
      return undefined;
    }
    throw e;
  }
}



/**
 * Print out a single result, considering input options.
 */
function printDatum(datum, opts, sep, alwaysPrintSep) {
  var output = null;
  switch (opts.outputMode) {
  case OM_INSPECT:
    output = util.inspect(datum, false, Infinity, process.stdout.isTTY);
    break;
  case OM_JSON:
    if (typeof datum !== 'undefined') {
      output = JSON.stringify(datum, null, opts.jsonIndent);
    }
    break;
  case OM_COMPACT:
    // Dev Note: A still relatively experimental attempt at a more
    // compact ouput somewhat a la Python's repr of a dict. I.e. try to
    // fit elements on one line as much as reasonable.
    if (datum === undefined) {
      // pass
    } else if (Array.isArray(datum)) {
      var bits = ['[\n'];
      datum.forEach(function (d) {
        bits.push('  ')
        bits.push(JSON.stringify(d, null, 0).replace(/,"(?![,:])/g, ', "'));
        bits.push(',\n');
      });
      bits.push(bits.pop().slice(0, -2) + '\n')  // drop last comma
      bits.push(']');
      output = bits.join('');
    } else {
      output = JSON.stringify(datum, null, 0);
    }
    break;
  case OM_JSONY:
    if (typeof datum === 'string') {
      output = datum;
    } else if (typeof datum !== 'undefined') {
      output = JSON.stringify(datum, null, opts.jsonIndent);
    }
    break;
  default:
    throw new Error("unknown output mode: "+opts.outputMode);
  }
  if (output && output.length) {
    emit(output);
    emit(sep);
  } else if (alwaysPrintSep) {
    emit(sep);
  }
}


var stdoutFlushed = true;
function emit(s) {
  // TODO:PERF If this is try/catch is too slow (too granular): move up to
  //    mainline and be sure to only catch this particular error.
  try {
    stdoutFlushed = process.stdout.write(s);
  } catch (e) {
    // Handle any exceptions in stdout writing in the "error" event above.
  }
}

process.stdout.on("error", function (err) {
  if (err.code === "EPIPE") {
    // See <https://github.com/trentm/json/issues/9>.
    drainStdoutAndExit(0);
  } else {
    warn(err)
    drainStdoutAndExit(1);
  }
});


/**
 * A hacked up version of "process.exit" that will first drain stdout
 * before exiting. *WARNING: This doesn't stop event processing.* IOW,
 * callers have to be careful that code following this call isn't
 * accidentally executed.
 *
 * In node v0.6 "process.stdout and process.stderr are blocking when they
 * refer to regular files or TTY file descriptors." However, this hack might
 * still be necessary in a shell pipeline.
 */
function drainStdoutAndExit(code) {
  process.stdout.on('drain', function () {
    process.exit(code);
  });
  if (stdoutFlushed) {
    process.exit(code);
  }
}




//---- mainline

function main(argv) {
  var opts;
  try {
    opts = parseArgv(argv);
  } catch (e) {
    warn("json: error: %s", e.message)
    return drainStdoutAndExit(1);
  }
  //warn(opts);
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.version) {
    util.puts("json " + getVersion());
    return;
  }
  var lookupStrs = opts.args;

  if (opts.group && opts.array && opts.outputMode !== OM_JSON) {
    // streaming
    var chunker = chunkEmitter(opts);
    chunker.on('error', function(error) {
        warn("json: error: %s", err);
        return drainStdoutAndExit(1);
    });
    chunker.on('chunk', parseChunk);
  } else {
    // not streaming
    getInput(opts, function (err, buffer) {
      if (err) {
        warn("json: error: %s", err)
        return drainStdoutAndExit(1);
      }
      // Take off a leading HTTP header if any and pass it through.
      while (true) {
        if (buffer.slice(0,5) === "HTTP/") {
          var index = buffer.indexOf('\r\n\r\n');
          var sepLen = 4;
          if (index == -1) {
            index = buffer.indexOf('\n\n');
            sepLen = 2;
          }
          if (index != -1) {
            if (! opts.dropHeaders) {
              emit(buffer.slice(0, index+sepLen));
            }
            var is100Continue = (buffer.slice(0, 21) === "HTTP/1.1 100 Continue");
            buffer = buffer.slice(index+sepLen);
            if (is100Continue) {
              continue;
            }
          }
        }
        break;
      }
      parseChunk(buffer);
    });
  }

  /**
   * Parse a single chunk of JSON. When not streaming, this will just be
   * called once.
   *
   * @param chunk {String} The JSON-encoded string.
   * @param obj {Object} Optional. For some code paths while streaming `obj`
   *    will be provided. This is an already parsed JSON object.
   */
  function parseChunk(chunk, obj) {
    // Expect the chunk to be JSON.
    if (! chunk.length) {
      return;
    }
    // parseInput() -> {datum: <input object>, error: <error object>}
    var input = parseInput(chunk, obj, opts.group, opts.merge);
    if (input.error) {
      // Doesn't look like JSON. Just print it out and move on.
      if (! opts.quiet) {
        // Use JSON-js' "json_parse" parser to get more detail on the
        // syntax error.
        var details = "";
        var normBuffer = chunk.replace(/\r\n|\n|\r/, '\n');
        try {
          json_parse(normBuffer);
          details = input.error;
        } catch(err) {
          // err.at has the position. Get line/column from that.
          var at = err.at - 1;  // `err.at` looks to be 1-based.
          var lines = chunk.split('\n');
          var line, col, pos = 0;
          for (line = 0; line < lines.length; line++) {
            pos += lines[line].length + 1;
            if (pos > at) {
              col = at - (pos - lines[line].length - 1);
              break;
            }
          }
          var spaces = '';
          for (var i=0; i<col; i++) {
            spaces += '.';
          }
          details = err.message+" at line "+(line+1)+", column "+(col+1)
            + ":\n        "+lines[line]+"\n        "+spaces+"^";
        }
        warn("json: error: input is not JSON: %s", details);
      }
      if (!opts.validate) {
        emit(chunk);
        if (chunk.length && chunk[chunk.length-1] !== "\n") {
          emit('\n');
        }
      }
      return drainStdoutAndExit(1);
    }
    if (opts.validate) {
      return drainStdoutAndExit(0);
    }
    var data = input.datum;

    // Process: executable (-e).
    var i, j;
    var exeScripts = [];
    for (i = 0; i < opts.exeSnippets.length; i++) {
      exeScripts[i] = vm.createScript(opts.exeSnippets[i]);
    }
    if (!exeScripts.length) {
      /* pass */
    } else if (opts.array || (opts.array === null && Array.isArray(data))) {
      var arrayified = false;
      if (!Array.isArray(data)) {
        arrayified = true;
        data = [data];
      }
      for (i = 0; i < data.length; i++) {
        var datum = data[i];
        for (j = 0; j < exeScripts.length; j++) {
          exeScripts[j].runInNewContext(datum);
        }
      }
      if (arrayified) {
        data = data[0];
      }
    } else {
      for (j = 0; j < exeScripts.length; j++) {
        exeScripts[j].runInNewContext(data);
      }
    }

    // Process: conditionals (-c).
    var condScripts = [];
    for (i = 0; i < opts.condSnippets.length; i++) {
      condScripts[i] = vm.createScript(opts.condSnippets[i]);
    }
    if (!condScripts.length) {
      /* pass */
    } else if (opts.array || (opts.array === null && Array.isArray(data))) {
      var arrayified = false;
      if (!Array.isArray(data)) {
        arrayified = true;
        data = [data];
      }
      var filtered = [];
      for (i = 0; i < data.length; i++) {
        var datum = data[i];
        var datumCopy = objCopy(datum);
        var keep = true;
        for (j = 0; j < condScripts.length; j++) {
          if (! condScripts[j].runInNewContext(datumCopy)) {
            keep = false;
            break;
          }
        }
        if (keep) {
          filtered.push(datum);
        }
      }
      if (arrayified) {
        data = (filtered.length ? filtered[0] : []);
      } else {
        data = filtered;
      }
    } else {
      var keep = true;
      var dataCopy = objCopy(data);
      for (j = 0; j < condScripts.length; j++) {
        if (! condScripts[j].runInNewContext(dataCopy)) {
          keep = false;
          break;
        }
      }
      if (!keep) {
        data = undefined;
      }
    }

    // Process: lookups
    var lookupsAreIndeces = false;
    var lookups = lookupStrs.map(function(lookup) {
        return parseLookup(lookup, opts.lookupDelim);
    });
    if (lookups.length) {
      if (opts.array) {
        if (!Array.isArray(data)) data = [data];
        var table = [];
        for (j=0; j < data.length; j++) {
          var datum = data[j];
          var row = {};
          for (i=0; i < lookups.length; i++) {
            var lookup = lookups[i];
            var value = lookupDatum(datum, lookup);
            if (value !== undefined) {
              row[lookup.join('.')] = value;
            }
          }
          table.push(row);
        }
        data = table;
      } else {
        // Special case handling: Note if the "lookups" are indeces into an
        // array. This may be used below to change the output representation.
        if (Array.isArray(data)) {
          lookupsAreIndeces = true;
          for (i = 0; i < lookups.length; i++) {
            if (lookups[i].length !== 1 || isNaN(Number(lookups[i]))) {
              lookupsAreIndeces = false;
              break;
            }
          }
        }
        var row = {};
        for (i = 0; i < lookups.length; i++) {
          var lookup = lookups[i];
          var value = lookupDatum(data, lookup);
          if (value !== undefined) {
            row[lookup.join('.')] = value;
          }
        }
        data = row;
      }
    }

    // --keys
    if (opts.outputKeys) {
      var data = Object.keys(data);
    }

    // Output
    if (opts.outputMode === OM_JSON) {
      if (lookups.length === 1 && !opts.array) {
        // Special case: For JSON output of a *single* lookup, *don't* use
        // the full table structure, else there is no way to get string
        // quoting for a single value:
        //      $ echo '{"a": [], "b": "[]"}' | json -j a
        //      []
        //      $ echo '{"a": [], "b": "[]"}' | json -j b
        //      "[]"
        // See <https://github.com/trentm/json/issues/35> for why.
        data = data[lookups[0].join('.')];
      } else if (lookupsAreIndeces) {
        // Special case: Lookups that are all indeces into an input array
        // are more likely to be wanted as an array of selected items rather
        // than a "JSON table" thing that we use otherwise.
        var flattened = [];
        for (i = 0; i < lookups.length; i++) {
          var lookupStr = lookups[i].join('.');
          if (data.hasOwnProperty(lookupStr)) {
            flattened.push(data[lookupStr])
          }
        }
        data = flattened;
      }
      // If JSON output mode, then always just output full set of data to
      // ensure valid JSON output.
      printDatum(data, opts, '\n', false);
    } else if (lookups.length) {
      if (opts.array) {
        // Output `data` as a "table" of lookup results.
        for (j = 0; j < data.length; j++) {
          var row = data[j];
          for (i = 0; i < lookups.length-1; i++) {
            printDatum(row[lookups[i].join('.')], opts, opts.delim, true);
          }
          printDatum(row[lookups[i].join('.')], opts, '\n', true);
        }
      } else {
        for (i = 0; i < lookups.length; i++) {
          printDatum(data[lookups[i].join('.')], opts, '\n', false);
        }
      }
    } else if (opts.array) {
      if (!Array.isArray(data)) data = [data];
      for (j = 0; j < data.length; j++) {
        printDatum(data[j], opts, '\n', false);
      }
    } else {
      // Output `data` as is.
      printDatum(data, opts, '\n', false);
    }
  }
}

if (require.main === module) {
  // HACK guard for <https://github.com/trentm/json/issues/24>.
  // We override the `process.stdout.end` guard that core node.js puts in
  // place. The real fix is that `.end()` shouldn't be called on stdout
  // in node core. Hopefully node v0.6.9 will fix that. Only guard
  // for v0.6.0..v0.6.8.
  var nodeVer = process.versions.node.split('.').map(Number);
  if ([0,6,0] <= nodeVer && nodeVer <= [0,6,8]) {
    var stdout = process.stdout;
    stdout.end = stdout.destroy = stdout.destroySoon = function() {
      /* pass */
    };
  }

  main(process.argv);
}
