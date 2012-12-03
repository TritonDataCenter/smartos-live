/* Jison generated parser */
var parser = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"start":3,"FROM":4,"target_list":5,"TO":6,"action":7,"protocol":8,"port_list":9,"EOF":10,"any":11,"all":12,"(":13,"target_or_list":14,")":15,"target":16,"OR":17,"ip":18,"subnet":19,"tag":20,"machine":21,"ALL":22,"ANY":23,"IP":24,"IPADDR":25,"SUBNET":26,"CIDRSUFFIX":27,"MACHINE":28,"UUID":29,"TAG":30,"TAGTXT":31,"BLOCK":32,"ALLOW":33,"TCP":34,"UDP":35,"port_and_list":36,"port":37,"AND":38,"PORT":39,"PORTNUM":40,"$accept":0,"$end":1},
terminals_: {2:"error",4:"FROM",6:"TO",10:"EOF",13:"(",15:")",17:"OR",22:"ALL",23:"ANY",24:"IP",25:"IPADDR",26:"SUBNET",27:"CIDRSUFFIX",28:"MACHINE",29:"UUID",30:"TAG",31:"TAGTXT",32:"BLOCK",33:"ALLOW",34:"TCP",35:"UDP",38:"AND",39:"PORT",40:"PORTNUM"},
productions_: [0,[3,8],[5,1],[5,1],[5,3],[5,1],[14,1],[14,3],[16,1],[16,1],[16,1],[16,1],[12,1],[12,3],[11,1],[11,3],[18,2],[19,3],[21,2],[20,2],[7,1],[7,1],[8,1],[8,1],[9,3],[9,1],[36,1],[36,3],[37,2]],
performAction: function anonymous(yytext,yyleng,yylineno,yy,yystate,$$,_$) {

var $0 = $$.length - 1;
switch (yystate) {
case 1: return { 'from': $$[$0-6], 'to': $$[$0-4], 'action': $$[$0-3], 'protocol': $$[$0-2], ports: $$[$0-1] }; 
break;
case 4:this.$ = $$[$0-1];
break;
case 7: this.$ = $$[$0-2].concat($$[$0]); 
break;
case 12: this.$ = [ ['wildcard', $$[$0]] ]; 
break;
case 13: this.$ = [ ['wildcard', $$[$0-1]] ]; 
break;
case 14: this.$ = [ ['wildcard', $$[$0]] ]; 
break;
case 15: this.$ = [ ['wildcard', $$[$0-1]] ]; 
break;
case 16: yy.validateIPv4address($$[$0]);
          this.$ = [ ['ip', $$[$0]] ]; 
break;
case 17: yy.validateIPv4subnet($$[$0-1] + $$[$0]);
            this.$ = [ ['subnet', $$[$0-1] + $$[$0]] ]; 
break;
case 18: this.$ = [ ['machine', $$[$0]] ]; 
break;
case 19: this.$ = [ ['tag', $$[$0]] ]; 
break;
case 20: this.$ = $$[$0].toLowerCase() 
break;
case 21: this.$ = $$[$0].toLowerCase() 
break;
case 22: this.$ = $$[$0].toLowerCase() 
break;
case 23: this.$ = $$[$0].toLowerCase() 
break;
case 24:this.$ = $$[$0-1];
break;
case 27: this.$ = $$[$0-2].concat(Number($$[$0])); 
break;
case 28: this.$ = [ Number($$[$0]) ]; 
break;
}
},
table: [{3:1,4:[1,2]},{1:[3]},{5:3,11:4,12:5,13:[1,6],16:7,18:10,19:11,20:12,21:13,22:[1,9],23:[1,8],24:[1,14],26:[1,15],28:[1,17],30:[1,16]},{6:[1,18]},{6:[2,2],32:[2,2],33:[2,2]},{6:[2,3],32:[2,3],33:[2,3]},{14:19,16:22,18:10,19:11,20:12,21:13,22:[1,21],23:[1,20],24:[1,14],26:[1,15],28:[1,17],30:[1,16]},{6:[2,5],32:[2,5],33:[2,5]},{6:[2,14],32:[2,14],33:[2,14]},{6:[2,12],32:[2,12],33:[2,12]},{6:[2,8],15:[2,8],17:[2,8],32:[2,8],33:[2,8]},{6:[2,9],15:[2,9],17:[2,9],32:[2,9],33:[2,9]},{6:[2,10],15:[2,10],17:[2,10],32:[2,10],33:[2,10]},{6:[2,11],15:[2,11],17:[2,11],32:[2,11],33:[2,11]},{25:[1,23]},{25:[1,24]},{31:[1,25]},{29:[1,26]},{5:27,11:4,12:5,13:[1,6],16:7,18:10,19:11,20:12,21:13,22:[1,9],23:[1,8],24:[1,14],26:[1,15],28:[1,17],30:[1,16]},{15:[1,28],17:[1,29]},{15:[1,30]},{15:[1,31]},{15:[2,6],17:[2,6]},{6:[2,16],15:[2,16],17:[2,16],32:[2,16],33:[2,16]},{27:[1,32]},{6:[2,19],15:[2,19],17:[2,19],32:[2,19],33:[2,19]},{6:[2,18],15:[2,18],17:[2,18],32:[2,18],33:[2,18]},{7:33,32:[1,34],33:[1,35]},{6:[2,4],32:[2,4],33:[2,4]},{16:36,18:10,19:11,20:12,21:13,24:[1,14],26:[1,15],28:[1,17],30:[1,16]},{6:[2,15],32:[2,15],33:[2,15]},{6:[2,13],32:[2,13],33:[2,13]},{6:[2,17],15:[2,17],17:[2,17],32:[2,17],33:[2,17]},{8:37,34:[1,38],35:[1,39]},{34:[2,20],35:[2,20]},{34:[2,21],35:[2,21]},{15:[2,7],17:[2,7]},{9:40,13:[1,41],37:42,39:[1,43]},{13:[2,22],39:[2,22]},{13:[2,23],39:[2,23]},{10:[1,44]},{36:45,37:46,39:[1,43]},{10:[2,25]},{40:[1,47]},{1:[2,1]},{15:[1,48],38:[1,49]},{15:[2,26],38:[2,26]},{10:[2,28],15:[2,28],38:[2,28]},{10:[2,24]},{37:50,39:[1,43]},{15:[2,27],38:[2,27]}],
defaultActions: {42:[2,25],44:[2,1],48:[2,24]},
parseError: function parseError(str, hash) {
    throw new Error(str);
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == "undefined")
        this.lexer.yylloc = {};
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === "function")
        this.parseError = this.yy.parseError;
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || 1;
        if (typeof token !== "number") {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == "undefined") {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
        if (typeof action === "undefined" || !action.length || !action[0]) {
            var errStr = "";
            if (!recovering) {
                expected = [];
                for (p in table[state])
                    if (this.terminals_[p] && p > 2) {
                        expected.push("'" + this.terminals_[p] + "'");
                    }
                if (this.lexer.showPosition) {
                    errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                    errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1?"end of input":"'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected});
            }
        }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0)
                    recovering--;
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column};
            if (ranges) {
                yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
            }
            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
            if (typeof r !== "undefined") {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}
};
/* Jison generated lexer */
var lexer = (function(){
var lexer = ({EOF:1,
parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },
setInput:function (input) {
        this._input = input;
        this._more = this._less = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {first_line:1,first_column:0,last_line:1,last_column:0};
        if (this.options.ranges) this.yylloc.range = [0,0];
        this.offset = 0;
        return this;
    },
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) this.yylloc.range[1]++;

        this._input = this._input.slice(1);
        return ch;
    },
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length-len-1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length-1);
        this.matched = this.matched.substr(0, this.matched.length-1);

        if (lines.length-1) this.yylineno -= lines.length-1;
        var r = this.yylloc.range;

        this.yylloc = {first_line: this.yylloc.first_line,
          last_line: this.yylineno+1,
          first_column: this.yylloc.first_column,
          last_column: lines ?
              (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length:
              this.yylloc.first_column - len
          };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        return this;
    },
more:function () {
        this._more = true;
        return this;
    },
less:function (n) {
        this.unput(this.match.slice(n));
    },
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20)+(next.length > 20 ? '...':'')).replace(/\n/g, "");
    },
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c+"^";
    },
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) this.done = true;

        var token,
            match,
            tempMatch,
            index,
            col,
            lines;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i=0;i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (!this.options.flex) break;
            }
        }
        if (match) {
            lines = match[0].match(/(?:\r\n?|\n).*/g);
            if (lines) this.yylineno += lines.length;
            this.yylloc = {first_line: this.yylloc.last_line,
                           last_line: this.yylineno+1,
                           first_column: this.yylloc.last_column,
                           last_column: lines ? lines[lines.length-1].length-lines[lines.length-1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length};
            this.yytext += match[0];
            this.match += match[0];
            this.matches = match;
            this.yyleng = this.yytext.length;
            if (this.options.ranges) {
                this.yylloc.range = [this.offset, this.offset += this.yyleng];
            }
            this._more = false;
            this._input = this._input.slice(match[0].length);
            this.matched += match[0];
            token = this.performAction.call(this, this.yy, this, rules[index],this.conditionStack[this.conditionStack.length-1]);
            if (this.done && this._input) this.done = false;
            if (token) return token;
            else return;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line '+(this.yylineno+1)+'. Unrecognized text.\n'+this.showPosition(),
                    {text: "", token: null, line: this.yylineno});
        }
    },
lex:function lex() {
        var r = this.next();
        if (typeof r !== 'undefined') {
            return r;
        } else {
            return this.lex();
        }
    },
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },
popState:function popState() {
        return this.conditionStack.pop();
    },
_currentRules:function _currentRules() {
        return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;
    },
topState:function () {
        return this.conditionStack[this.conditionStack.length-2];
    },
pushState:function begin(condition) {
        this.begin(condition);
    }});
lexer.options = {};
lexer.performAction = function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START
switch($avoiding_name_collisions) {
case 0:/* skip whitespace */
break;
case 1:return 10;
break;
case 2:return 4;
break;
case 3:return 6;
break;
case 4:return 24;
break;
case 5:return 26;
break;
case 6:return 23;
break;
case 7:return 22;
break;
case 8:return 30;
break;
case 9:return 28;
break;
case 10:return 13;
break;
case 11:return 15;
break;
case 12:return 17;
break;
case 13:return 38;
break;
case 14:return 32;
break;
case 15:return 33;
break;
case 16:return 39;
break;
case 17:return 34;
break;
case 18:return 35;
break;
case 19:return 25;
break;
case 20:return 27
break;
case 21: return yy.tagOrPortOrUUID(this); 
break;
}
};
lexer.rules = [/^(?:\s+)/,/^(?:$)/,/^(?:[Ff][Rr][Oo][Mm])/,/^(?:[Tt][Oo])/,/^(?:ip\b)/,/^(?:subnet\b)/,/^(?:any\b)/,/^(?:all\b)/,/^(?:tag\b)/,/^(?:machine\b)/,/^(?:\()/,/^(?:\))/,/^(?:[Oo][Rr])/,/^(?:[Aa][Nn][Dd])/,/^(?:[Bb][Ll][Oo][Cc][Kk])/,/^(?:[Aa][Ll][Ll][Oo][Ww])/,/^(?:[Pp][Oo][Rr][Tt])/,/^(?:[Tt][Cc][Pp])/,/^(?:[Uu][Dd][Pp])/,/^(?:(([0-9]){1,3})\.(([0-9]){1,3})\.(([0-9]){1,3})\.(([0-9]){1,3}))/,/^(?:\/([0-9])([0-9]))/,/^(?:([-a-zA-Z0-9_])+)/];
lexer.conditions = {"INITIAL":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21],"inclusive":true}};
return lexer;})()
parser.lexer = lexer;
function Parser () { this.yy = {}; }Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = parser;
exports.Parser = parser.Parser;
exports.parse = function () { return parser.parse.apply(parser, arguments); }
exports.main = function commonjsMain(args) {
    if (!args[1])
        throw new Error('Usage: '+args[0]+' FILE');
    var source, cwd;
    if (typeof process !== 'undefined') {
        source = require('fs').readFileSync(require('path').resolve(args[1]), "utf8");
    } else {
        source = require("file").path(require("file").cwd()).join(args[1]).read({charset: "utf-8"});
    }
    return exports.parser.parse(source);
}
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(typeof process !== 'undefined' ? process.argv.slice(1) : require("system").args);
}
}