#!/usr/bin/env node
//
// json -- pipe in your JSON for nicer output and for extracting data bits
//
// See <https://github.com/trentm/json>.
//

var VERSION = "1.3.4";

var sys = require('sys');
var pathlib = require('path');
var runInNewContext;
try {
  runInNewContext = require('vm').runInNewContext;
} catch (ex) {
  runInNewContext = process.binding('evals').Script.runInNewContext;  // node v0.2
}
var warn = console.warn;



//--- exports for module usage

exports.main = main;
exports.getVersion = getVersion;
exports.parseLookup = parseLookup;

// As an exported API, these are still experimental:
exports.processDatum = processDatum;
exports.processDatumExperimental = processDatumExperimental;
exports.printData = printData;



//---- support functions

function getVersion() {
  return VERSION;
}

function printHelp() {
  sys.puts("Usage: <something generating JSON on stdout> | json [options] [lookup]");
  sys.puts("");
  sys.puts("Pipe in your JSON for nicer output. Or supply a `lookup` to extract");
  sys.puts("a subset of the JSON. HTTP header blocks are skipped by default");
  sys.puts("(as from `curl -i`) by default.");
  sys.puts("");
  sys.puts("By default, the output is JSON-y: JSON except for a simple string return");
  sys.puts("value, which is printed without quotes. Use '-j' or '-i' to override.");
  sys.puts("");
  sys.puts("Options:");  
  sys.puts("  -h, --help    print this help info and exit");
  sys.puts("  --version     print version of this command and exit");
  sys.puts("  -q, --quiet   don't warn if input isn't valid JSON");
  sys.puts("  -H            drop any HTTP header block");
  sys.puts("  -i            output using node's `sys.inspect`");
  sys.puts("  -j            output using `JSON.stringfy`, i.e. strict JSON");
  sys.puts("  -x, --experimental");
  sys.puts("                enable experimental features: '*' in lookup");
  sys.puts("");
  sys.puts("Examples:");
  sys.puts("  curl -s http://search.twitter.com/search.json?q=node.js | json");
  sys.puts("  curl -s http://search.twitter.com/search.json?q=node.js | json results");
  sys.puts("");
  sys.puts("See <https://github.com/trentm/json> for more.");
}


// Parse the command-line options and arguments into an object.
//
//    {
//      'lookup': '...'    // the first arg: lookup
//      'extra': [...]     // extra args put here
//      'help': true,      // true if '-h' option given
//      // etc.
//    }
function parseArgv(argv) {
  var parsed = {
    lookup: null,
    extra: [],
    help: false,
    quiet: false,
    dropHeaders: false,
    outputSysInspect: false,
    outputJSON: false,
    experimental: false
  };
  
  // Turn '-iH' into '-i -H'.
  var a = argv.slice(2);  // drop ['node', 'scriptname']
  for (var i = 0; i < a.length; i ++) {
    if (a[i].charAt(0) === "-" && a[i].charAt(1) != '-' && a[i].length > 2) {
      var arg = a[i].replace(/^-+/, "").split("").map(function (a) {
        return "-" + a;
      });
      a.splice.apply(a, [i, 1].concat(arg));
    }
  }

  while (a.length > 0) {
    var arg = a.shift();
    switch(arg) {
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
      case "-i": // output with sys.inspect
        parsed.outputSysInspect = true;
        break;
      case "-j": // output with JSON.stringify
        parsed.outputJSON = true;
        break;
      case "-x":
      case "--experimental":
        parsed.experimental = true;
        break;
      default: // arguments
        if (parsed.lookup === null) {
          parsed.lookup = arg;
        } else {
          parsed.extra.push(arg);
        }
        break;
    } 
  }
  //TODO: '--' handling and error on a first arg that looks like an option.

  return parsed;
}


function isInteger(s) {
  return (s.search(/^-?[0-9]+$/) == 0);
}


// Parse a lookup string into a list of lookup bits. E.g.:
//    "a.b.c" -> ["a","b","c"]
//    "b['a']" -> ["b","['a']"]
function parseLookup(lookup) {
  //var debug = console.warn;
  var debug = function() {};
  
  var bits = [];
  debug("\n*** "+lookup+" ***")

  bits = [];
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
      case '.':
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
 * Process the input JSON object.
 *
 * @argument datum {Object}  The parsed JSON object.
 * @argument args {Object} Command-line args from parseArgv.
 * @returns {Array} Array of filtered data.
 */
//TODO: s/args/lookup/
function processDatum(datum, args) {
  if (args.lookup) {
    var bits = parseLookup(args.lookup);

    // Put it back together with some convenience transformations.
    lookup = "";
    var isJSIdentifier = /^[$A-Za-z_][0-9A-Za-z_]*$/;
    for (var i=0; i < bits.length; i++) {
      var bit = bits[i];
      if (bit[0] === '[') {
        lookup += bit;
      } else if (! isJSIdentifier.exec(bits[i])) {
        // Allow a non-JS-indentifier token, e.g. `json foo-bar`.
        lookup += '["' + bits[i].replace('"', '\\"') + '"]';
      } else {
        lookup += '.' + bits[i];
      }
    }

    datum = runInNewContext("(" + JSON.stringify(datum) + ")" + lookup);
  }
  
  return [datum];
}

/**
 * Experimenal processing of the input JSON object.
 * This is turned on by the "-x|--experimental" switch.
 *
 * - add support for '*' in lookup
 *
 * @argument datum {Object}  The parsed JSON object.
 * @argument args {Object} Command-line args from parseArgv.
 * @returns {Array} Array of filtered data.
 */
function processDatumExperimental(datum, args) {
  var data = [datum];
  if (args.lookup) {
    var bits = parseLookup(args.lookup);

    var isJSIdentifier = /^[$A-Za-z_][0-9A-Za-z_]*$/;
    var i = 0;
    var lookup = "";
    while (i < bits.length) {
      var bit = bits[i];
      if (bit === '*') {
        if (lookup) {
          data = data.map(function(d) {
              return runInNewContext("(" + JSON.stringify(d) + ")" + lookup);
            }).filter(function(d) { return d !== undefined });
          lookup = "";
        }
        var newdata = [];
        data.forEach(function(d) {
          newdata = newdata.concat(d);
        });
        data = newdata;
      } else if (bit[0] === '[') {
        lookup += bit;
      } else if (! isJSIdentifier.exec(bits[i])) {
        // Allow a non-JS-indentifier token, e.g. `json foo-bar`.
        lookup += '["' + bits[i].replace('"', '\\"') + '"]';
      } else {
        lookup += '.' + bits[i];
      }
      i++;
    }
    if (lookup) {
      data = data.map(function(d) {
            return runInNewContext("(" + JSON.stringify(d) + ")" + lookup);
          }).filter(function(d) { return d !== null });
    }
    return data;
  }
}


/**
 * TODO: doc this
 */
function printData(data, args) {
  // Print out results.
  data.forEach(function(d) {
    var output = null;
    if (args.outputSysInspect) {
      output = sys.inspect(d, false, Infinity, true);
    } else if (args.outputJSON) {
      if (typeof d !== 'undefined') {
        output = JSON.stringify(d, null, 2);
      }
    } else {
      if (typeof d === 'string') {
        output = d;
      } else if (typeof d !== 'undefined') {
        output = JSON.stringify(d, null, 2);
      }
    }
    if (output && output.length) {
      process.stdout.write(output);
      process.stdout.write('\n');
    }
  })
}


//---- minimatch
// Make a regex for a given fnmatch-like string that git uses for .gitignore.
// See `man 5 gitignore`.
//
// (This is `makeRe` from
// <https://github.com/isaacs/npm/blob/master/lib/utils/minimatch.js>
// at Isaac's suggestion.)

function makeMinimatchRe (pattern) {
  var braceDepth = 0
    , re = ""
    , escaping = false
    , oneStar = "[^\\/]*?"
    , twoStar = ".*?"
    , reSpecials = "().*{}+?[]^$/\\"
    , patternListStack = []
    , stateChar
    , negate = false
    , negating = false

  for ( var i = 0, len = pattern.length, c
      ; (i < len) && (c = pattern.charAt(i))
      ; i ++ ) {

    switch (c) {
      case "\\":
        if (escaping) {
          re += "\\\\" // must match literal \
          escaping = false
        } else {
          escaping = true
        }
        continue

      case "!":
        if (i === 0 || negating) {
          negate = !negate
          negating = true
          break
        }
        // fallthrough
      case "+":
      case "@":
      case "*":
      case "?":
        negating = false
        if (escaping) {
          re += "\\" + c
          escaping = false
        } else {
          if (c === "*" && stateChar === "*") { // **
            re += twoStar
            stateChar = false
          } else {
            stateChar = c
          }
        }
        continue

      case "(":
        if (escaping) {
          re += "\\("
          escaping = false
        } else if (stateChar) {
          plType = stateChar
          patternListStack.push(plType)
          re += stateChar === "!" ? "(?!" : "(:?"
          stateChar = false
        } else {
          re += "\\("
        }
        continue

      case ")":
        if (escaping) {
          re += "\\)"
          escaping = false
        } else if (patternListStack.length) {
          re += ")"
          plType = patternListStack.pop()
          switch (plType) {
            case "?":
            case "+":
            case "*": re += plType
            case "!":
            case "@": break
          }
        } else {
          re += "\\)"
        }
        continue

      case "|":
        if (escaping) {
          re += "\\|"
          escaping = false
        } else if (patternListStack.length) {
          re += "|"
        } else {
          re += "\\|"
        }
        continue

      // turns out these are the same in regexp and glob :)
      case "]":
      case "[":
        if (escaping) {
          re += "\\" + c
          escaping = false
        } else {
          re += c
        }
        continue

      case "{":
        if (escaping) {
          re += "\\{"
          escaping = false
        } else {
          re += "(:?"
          braceDepth ++
        }
        continue

      case "}":
        if (escaping || braceDepth === 0) {
          re += "\\}"
          escaping = false
        } else {
          re += ")"
          braceDepth --
        }
        continue

      case ",":
        if (escaping || braceDepth === 0) {
          re += ","
          escaping = false
        } else {
          re += "|"
        }
        continue

      default:
        if (stateChar) {
          // we had some state-tracking character
          // that wasn't consumed by this pass.
          switch (stateChar) {
            case "*":
              re += oneStar
              break
            case "?":
              re += "."
              break
            default:
              re += "\\"+stateChar
              break
          }
          stateChar = false
        }
        if (escaping) {
          // no need
          escaping = false
        } else if (reSpecials.indexOf(c) !== -1) {
          re += "\\"
        }
        re += c
    } // switch

    if (negating && c !== "!") negating = false

  } // for

  // handle trailing things that only matter at the very end.
  if (stateChar) {
    // we had some state-tracking character
    // that wasn't consumed by this pass.
    switch (stateChar) {
      case "*":
        re += oneStar
        break
      case "?":
        re += "."
        break
      default:
        re += "\\"+stateChar
        break
    }
    stateChar = false
  } else if (escaping) {
    re += "\\\\"
  }

  // must match entire pattern
  // ending in a * or ** will make it less strict.
  re = "^" + re + "$"

  // fail on the pattern, but allow anything otherwise.
  if (negate) re = "^(!?" + re + ").*$"

  return new RegExp(re)
}



//---- mainline

function main(argv) {
  var args = parseArgv(argv);
  //warn(args);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    sys.puts("json " + getVersion());
    return;
  }
  if (args.extra.length) {
    sys.puts("json: error: too many arguments: extra="+args.extra);
    process.exit(1);
  }
  
  var buffer = "";
  
  var stdin = process.openStdin();
  stdin.setEncoding('utf8');
  stdin.on('data', function (chunk) {
      buffer += chunk;
  });
  
  stdin.on('end', function () {
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
          if (! args.dropHeaders) {
            process.stdout.write(buffer.slice(0, index+sepLen));
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

    // Expect the remainder to be JSON.
    if (! buffer.length) {
      return;
    }
    var datum;
    try {
      datum = JSON.parse(buffer);
    } catch(ex) {
      // Doesn't look like JSON. Just print it out and move on.
      if (! args.quiet) {
        warn("json: error: doesn't look like JSON: "+ex+" (buffer="+JSON.stringify(buffer)+")");
      }
      process.stdout.write(buffer);
      if (buffer.length && buffer[buffer.length-1] !== "\n") {
        process.stdout.write('\n');
      }
      process.stdout.flush();
      process.exit(1);
    }
    
    // Process the JSON data.
    if (args.experimental) {
      var outputData = processDatumExperimental(datum, args);
    } else {
      var outputData = processDatum(datum, args);
    }
    
    // Emit the filtered data.
    printData(outputData, args);
  });

  process.on('exit', function () {
    process.stdout.flush();
  });
}

if (require.main === module) {
  main(process.argv);
}
