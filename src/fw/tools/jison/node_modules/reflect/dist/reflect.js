
var parser = require("./parser").parser,
    nodes = require("./nodes"),
    stringify = require("./stringify").stringify;

function JSParser (options) {
    // Create a parser constructor and an instance
    this.parser = new Parser(options||{});
}

JSParser.prototype = {
    parse: function (source) {
        return this.parser.parse(source);
    }
};

var builder = {};

// Define AST nodes
nodes.defineNodes(builder);

function Parser (options) {
    this.yy.source = options.source||null;
    this.yy.startLine = options.line || 1;
    this.yy.noloc = options.loc === false;
    this.yy.builder = options.builder||null;
}

Parser.prototype = parser;

// allow yy.NodeType calls in parser
for (var con in builder) {
    if (builder.hasOwnProperty(con)) {
        parser.yy[con] = function (name){
            return function (a,b,c,d,e,f,g,h) {
                    return builder[name](a,b,c,d,e,f,g,h);
                }
            }(con);
    }
}

// used named arguments to avoid arguments array
parser.yy.Node = function Node (type, a,b,c,d,e,f,g,h) {
    var buildName = type[0].toLowerCase()+type.slice(1);
    if (this.builder && this.builder[buildName]) {
        return this.builder[buildName](a,b,c,d,e,f,g,h);
    } else if (builder[buildName]) {
        return builder[buildName](a,b,c,d,e,f,g,h);
    } else {
        throw 'no such node type: '+type;
    }
};

parser.yy.locComb = function (start, end) {
    start.last_line = end.last_line;
    start.last_column = end.last_column;
    return start;
};

parser.yy.loc = function (loc) {
    if (this.noloc) return null;
    if ("length" in loc) loc = this.locComb(loc[0],loc[1]);

    return { source: this.source
           , start:  { line: this.startLine+loc.first_line - 1
                     , column: loc.first_column }
           , end:    { line: this.startLine+loc.last_line - 1
                     , column: loc.last_column }
           };
};

// Handle parse errors and recover from ASI
parser.yy.parseError = function (err, hash) {
    // don't print error for missing semicolon
    if (!(hash.expected.indexOf("';'") >= 0 && (hash.token === 'CLOSEBRACE' || parser.yy.lineBreak || parser.yy.lastLineBreak || hash.token === 1))) {
        throw new SyntaxError(err);
    }
};

// used to check if last match was a line break (for ; insertion)
var realLex = parser.lexer.lex;
parser.lexer.lex = function () {
    parser.yy.lastLineBreak = parser.yy.lineBreak;
    parser.yy.lineBreak = false;
    return realLex.call(parser.lexer);
};

parser.yy.escapeString = function (s) {
  return s.replace(/\\\n/,'').replace(/\\([^xubfnvrt0\\])/g, '$1');
};

var oldParse = parser.parse;
parser.parse = function (source) {
    parser.yy.lineBreak = false;
    parser.yy.inRegex = false;
    parser.yy.ASI = false;
    return oldParse.call(this,source);
};

exports.Reflect = {
    parse: function (src, options) {
        return new JSParser(options).parse(src);
    },
    stringify: stringify
};

exports.parse = exports.Reflect.parse;
exports.stringify = stringify;
exports.builder = builder;

