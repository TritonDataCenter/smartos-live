var _ = require("underscore")._;

module.exports = ArgParser;

// for nomnom.parseArgs()
var argParser = ArgParser();
for(var i in argParser) {
  if(typeof argParser[i] == "function")
    ArgParser[i] = argParser[i];
}

function ArgParser() {

  function opt(arg) {
    // get the specified opt for this parsed arg
    var match = Opt({});
    parser.specs.forEach(function(opt) {
      if(opt.matches(arg))
        match = opt;
    });
    return match;
  };
  
  function setOption(options, arg, value) {
    var option = opt(arg);
    if(option.callback) {
      var message = option.callback(value);
      if(typeof message == "string"){
        parser.print(message);
      }
    }
    options[option.name || arg] = value;
  };
  
  var parser = {
    commands : {},    
    specs: {},

    command : function(name) {
      var command = parser.commands[name] = {
        name: name,
        specs: {}
      };

      // facilitates command('name').opts().callback().help()
      var chain = {
        opts : function(specs) {
          command.specs = specs;
          return chain;
        },
        callback : function(callback) {
          command.callback = callback;
          return chain;
        },
        help : function(help) {
          command.help = help;
          return chain;
        }
      };
      return chain;
    },
    
    globalOpts : function(specs) {
      parser.globalSpecs = specs;
      return parser;
    },
    
    opts : function(specs) {
      parser.specs = specs;
      return parser;
    },
    
    callback : function(fallbackCb) {
      parser.fallbackCb = fallbackCb;
      return parser;
    },
    
    usage : function(usageString) {
      parser.usageString = usageString;
      return parser;
    },
    
    printFunc : function(print) {
      parser.print = print;
      return parser;
    },
    
    scriptName : function(script) {
      parser.script = script;
      return parser;
    },
  
    help : function(helpString) {
      parser.helpString = helpString;
      return parser;
    },
  
    parseArgs : function(argv, parserOpts) {
      var printHelp = true;
      if(argv && (!argv.length || typeof argv[0] != "string")) {
        // using old API
        parserOpts = parserOpts || {};
        parser.specs = argv;
        parser.script = parserOpts.script;
        parser.print = parserOpts.pringFunc;
        printHelp = parserOpts.printHelp;
        if(printHelp == undefined)
          printHelp = true;
        argv = parserOpts.argv;
      }
      parser.print = parser.print || function(str) {
        require("sys").puts(str);
        process.exit(0);
      };
      parser.helpString = parser.helpString || "";
      parser.script = parser.script || process.argv[0] + " "
            + require('path').basename(process.argv[1]);
      
      parser.specs = parser.specs || {};
      var argv = argv || process.argv.slice(2);

      var commandName;
      if(JSON.stringify(parser.commands) != "{}") {
        if(argv.length && Arg(argv[0]).isValue)
          commandName = argv[0];

        if(!commandName) {
          // no command but command expected e.g. 'git --version'
          parser.specs.command = {
            position: 0,
            help: 'one of: ' + _(parser.commands).keys().join(", ")
          }
          _(parser.specs).extend(parser.globalSpecs);
        }
        else {
          // command specified e.g. 'git add -p'
          var command = parser.commands[commandName];
          if(!command)
            parser.print(parser.script + ": no such command '" + commandName + "'");  
          parser.specs = _(command.specs).extend(parser.globalSpecs);  
          parser.script += " " + command.name;
          if(command.help)
            parser.helpString = command.help;
        }
      }

      if(parser.specs.length == undefined) {
        // specs is a hash not an array
        parser.specs = _(parser.specs).map(function(opt, name) {
          opt.name = name;
          return opt;
        });
      }
      parser.specs = parser.specs.map(function(opt) {
        return Opt(opt);
      });

      /* parse the args */
      if(printHelp && (argv.indexOf("--help") != -1
           || argv.indexOf("-h") != -1))
        parser.print(parser.getUsage());

      var options = {};
      parser.specs.forEach(function(opt) {
        options[opt.name] = opt.default;
      });

      args = argv.concat([""]).map(function(arg) {
        return Arg(arg);
      });
      var positionals = [];

      args.reduce(function(arg, val) {
        /* word */
        if(arg.isValue) {
          positionals.push(arg.value);
        }
        /* -c */
        else if(arg.chars) {
          var lastChar = arg.chars.pop();
          
          /* -cfv */
          (arg.chars).forEach(function(ch) {
            setOption(options, ch, true);
          });

          /* -c 3 */
          if(val.isValue && opt(lastChar).expectsValue()) {
            setOption(options, lastChar, val.value);
            return Arg(""); // skip next turn - swallow arg
          }
          else {
            setOption(options, lastChar, true);
          }
        }
        /* --config=tests.json or --debug */
        else if(arg.lg) {
          var value = arg.value;
          /* --debug */
          if(value == undefined)
            value = true;
          setOption(options, arg.lg, value);
        }
        return val;
      });

      positionals.forEach(function(pos, index) {
        setOption(options, index, pos);
      });

      // exit if required arg isn't present
      parser.specs.forEach(function(opt) {
        if(opt.required && !options[opt.name])
          parser.print(opt.name + " argument is required");
      });
    
      if(command && command.callback)
        command.callback(options);
      else if(parser.fallbackCb)
        parser.fallbackCb(options);

      return options;
    },

    getUsage : function() {
      if(parser.usageString)
        return parser.usageString;

      var str = "Usage: " + parser.script;

      var positionals = _(parser.specs).select(function(opt) {
        return opt.position != undefined;
      }).sort(function(opt1, opt2) {
        return opt1.position > opt2.position;
      });      
      var options = _(parser.specs).select(function(opt) {
        return opt.position == undefined;
      });

      // assume there are no gaps in the specified pos. args
      positionals.forEach(function(pos) {
        str += " <" + (pos.name || "arg" + pos.position) + ">"; 
      });
      if(options.length || positionals.length)
        str += " [options]\n\n";

      positionals.forEach(function(pos) {
        str += "<" + pos.name + ">\t\t" + (pos.help || "") + "\n"; 
      });
      if(positionals.length && options.length)
        str += "\n";
      if(options.length)
        str += "options:\n"

      options.forEach(function(opt) {
        str += opt.string + "\t\t" + (opt.help || "") + "\n";
      });
      return str + "\n" + (parser.helpString || "") + "\n";
    }
  }

  return parser;
};

/* an opt is what's specified by the user in opts hash */
Opt = function(opt) {
  var string = opt.string || (opt.name ? "--" + opt.name : "");
  var matches = /^(?:\-(\w+?)(?:\s+([^-][^\s]*))?)?\,?\s*(?:\-\-(.+?)(?:=(.+))?)?$/
                .exec(string);
  var sh = matches[1],   // e.g. v from -v
      lg = matches[3], // e.g. verbose from --verbose
      metavar = matches[2] || matches[4];   // e.g. PATH from '--config=PATH'
  
  opt = _(opt).extend({
    name: opt.name || lg || sh,
    string: string,
    sh: sh,
    lg: lg,
    metavar: metavar,
    matches: function(arg) {
      return opt.lg == arg || opt.sh == arg || opt.position == arg;
    },
    expectsValue: function() {
      return opt.metavar || opt.default;
    }
  });
  
  return opt;
}

/* an arg is an item that's actually parsed from the command line 
   e.g. "-l", "log.txt", or "--logfile=log.txt" */
Arg = function(str) {  
  var shRegex = /^\-(\w+?)$/,
      lgRegex = /^\-\-(no\-)?(.+?)(?:=(.+))?$/,
      valRegex = /^[^\-].*/;
      
  var charMatch = shRegex.exec(str);
  var chars = charMatch && charMatch[1].split("");
  
  var lgMatch = lgRegex.exec(str);
  var lg = lgMatch && lgMatch[2];
  
  var val = valRegex.test(str) && str;
  var value = val || (lg && (lgMatch[1] ? false : lgMatch[3]));
  try { // try to infer type by JSON parsing the string
    value = JSON.parse(value)
  } catch(e) {}
  
  return {
    chars: chars,
    lg: lg,
    value: value,
    lastChar: str[str.length - 1],
    isValue: str && valRegex.test(str)
  }
}