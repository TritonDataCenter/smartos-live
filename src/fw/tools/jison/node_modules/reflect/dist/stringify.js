// by Jason Orendorff
// https://bugzilla.mozilla.org/show_bug.cgi?id=590755
(function () {
"use strict";

var indentChar = "    ";

function assertEq (val, expected) {
    if (val !== expected)
        throw new Error(val +' not equeal to '+ expected);
}

function values(arr, fun) {
    var vals = [];
    for (var i = 0; i < arr.length; i++)
        vals.push(fun ? fun(arr[i]) : arr[i]);
    return vals;
}

function unexpected(n) {
    var pos = n.loc ? " at " + n.loc.source + ":" + n.loc.start.line : "";
    var s = "Unexpected parse node type: " + n.type + pos +
        " (" + Object.getOwnPropertyNames(n).toString() + ")";
    throw new TypeError(s);
}

// Wrap the expression s in parentheses if needed.
// xprec is the precedence of the topmost operator in the expression itself.
// cprec is the precedence of the immediately enclosing expression
// ("context precedence"). We need parentheses if xprec <= cprec.
//
// The precedence numbers agree with jsopcode.tbl. More-positive numbers
// indicate tighter precedence.
//
function wrapExpr(s, cprec, xprec) {
    assertEq(arguments.length, 3);
    assertEq(typeof cprec, 'number');
    assertEq(cprec === cprec, true);
    return (xprec > cprec) ? s : "(" + s + ")";
}

// Decompile the statement n, indenting it and spacing it to be pasted into
// an enclosing statement.
//
// Blocks are treated specially so that their braces can be cuddled up with
// neighboring keywords. The code below that implements this reads like a
// disgusting hack, but it produces more conventional JS output.
//
// If `more` is true, this substatement will be followed by the "while" of
// a do-while loop or the "else" of an if-statement. So return a specially
// hacked string that the subsequent keyword can just be added onto.
//
function substmt(n, indent, more) {
    if (n.type === "BlockStatement") {
        var body = stmt(n, indent);
        if (more)
            body = body.substring(indent.length, body.length - 1) + " ";
        else
            body = body.substring(indent.length);
        return " " + body;
    }
    return "\n" + stmt(n, indent + indentChar) + (more ? indent : "");
}

function params(arr, indent) {
    return "(" + values(arr, function (x){return expr(x, '####', 18, false)}).join(", ") + ")";
}

function args(arr, indent) {
    return "(" + values(arr, function (x){return expr(x, indent, 2, false)}).join(", ") + ")";
}

function functionDeclaration(init, id, n, indent) {
    // name is ordinarily an identifier, but literals are also legal for
    // getters and setters: ({get 1() {}})
    var name = (id === null) ? "" : expr(id, '####', 18, false);

    var body;
    if (n.expression) {
        body = expr(n.body, indent, 2, false);
        if (body.charAt(0) === '{')
            body = " (" + body + ")";
        else
            body = " " + body;
    } else {
        body = substmt(n.body, indent).trimRight();
    }

    return init + " " + name + params(n.params, indent) + body;
}

function identifierName(n) {
    assertEq(n.type, "Identifier");
    return n.name;
}

var precedence = {
    "||": 5,
    "&&": 6,
    "|": 7,
    "^": 8,
    "&": 9,
    "==": 10,
    "!=": 10,
    "===": 10,
    "!==": 10,
    "<": 11,
    "<=": 11,
    ">": 11,
    ">=": 11,
    "in": 11,
    "instanceof": 11,
    "<<": 12,
    ">>": 12,
    ">>>": 12,
    "+": 13,
    "-": 13,
    "*": 14,
    "/": 14,
    "%": 14,
};

function forHead(n, indent) {
    var lhs;
    if (n.left.type == "VariableDeclaration")
        lhs = n.left.kind + " " + declarators(n.left.declarations, indent, true);
    else
        lhs = expr(n.left, indent, 0, true);

    return "for " + (n.each ? "each " : "") + "(" + lhs + " in " +  expr(n.right, indent, 0, false) + ")";
}

function comprehension(n, indent) {
    var s = expr(n.body, indent, 2, false);
    for (var i = 0; i < n.blocks.length; i++)
        s += " " + forHead(n.blocks[i], indent);
    if (n.filter)
        s += " if (" + expr(n.filter, indent, 0, false) + ")";
    return s;
}

function xmlTagContents(contents, indent) {
    // The junk we get in the .contents of an XML tag is pretty junky.
    // This is heuristic.
    var str = xmlData(contents[0], indent);
    var wantAttr = false;
    for (var i = 1; i < contents.length; i++) {
        str += (wantAttr ? '=' : ' ');
        str += xmlData(contents[i], indent);
        if (contents[i].type === "XMLText") {
            if (i === contents.length - 1)
                str = str.replace(/\/>$/, ""); // HACK - weirdness from Reflect.parse
            // Guess if this XMLText leaves us wanting an attribute.
            wantAttr = !/^(?:[^ ]*=(?:"[^"]*"|'[^']*')\s*)*$/.test(str); // " <-- matching quote, emacs
        } else {
            wantAttr = !wantAttr;
        }
    }
    return str;
}

function xmlData(n, indent) {
    var temp = [];
    switch (n.type) {
    case "XMLElement":
        for (var x in n.contents)
            temp.push(xmlData(x, indent));
        return temp.join('');

    case "XMLStartTag":
        return "<" + xmlTagContents(n.contents, indent) + ">";

    case "XMLEndTag":
        return "</" + xmlTagContents(n.contents, indent) + ">";

    case "XMLPointTag":
        return "<" + xmlTagContents(n.contents, indent) + "/>";

    case "XMLEscape":
        return "{" + expr(n.expression, indent, 0, false) + "}";

    case "XMLText":
        return n.text;

    case "XMLName":
        if (typeof n.contents == "string")
            return n.contents;
        for (var x in n.contents)
            temp.push(xmlData(x, indent));
        return temp.join('');

    case "XMLAttribute":
        return '"' + n.value + '"';

    case "XMLCdata":
        return "<![CDATA[" + n.contents + "]]>";

    case "XMLComment":
        return "<!--" + n.contents + "-->";

    case "XMLProcessingInstruction":
        return "<?" + n.target + (n.contents ? " " + n.contents : "") + "?>";

    default:
        return unexpected(n);
    }
}

function isBadIdentifier(n) {
    return n.type === "Identifier" && !n.name.match(/^[_$A-Za-z][_$A-Za-z0-9]*$/);
}

// Convert an expression object to a string.
// cprec is the context precedence. If it is high, but n has low
// precedence, n is automatically wrapped in parentheses.
// if noIn is true, wrap in-expressions in parentheses.
function expr(n, indent, cprec, noIn) {
    assertEq(arguments.length, 4);
    assertEq(noIn, noIn && cprec <= 11);

    switch (n.type) {
    case "ArrayExpression":
    case "ArrayPattern":
        {
            var s = '[';
            var e = n.elements;
            var len = e.length;
            for (var i = 0; i < len; i++) {
                if (i in e) {
                    if (i != 0)
                        s += ' ';
                    s += expr(e[i], indent, 2, false);
                }
                if (i != len - 1 || !(i in e))
                    s += ',';
            }
            return s + ']';
        }

    case "ObjectExpression":
        {
            var p = n.properties, s = [];
            for (var i = 0; i < p.length; i++) {
                var prop = p[i];
                switch (prop.kind) {
                case "init":
                    s[i] = expr(prop.key, indent, 18, false) + ": " + expr(prop.value, indent, 2, false);
                    break;
                case "get":
                case "set":
                    s[i] = functionDeclaration(prop.kind, prop.key, prop.value, indent);
                    break;
                default:
                    s[i] = unexpected(prop);
                }
            }
            return "{" + s.join(", ") + "}";
        }

    case "GraphExpression":
        return "#" + n.index + "=" + expr(n.expression, indent, 18, false);

    case "GraphIndexExpression":
        return "#" + n.index + "#";

    case "LetExpression":
        return wrapExpr("var (" + declarators(n.head, indent, false) + ") " +
                          expr(n.body, indent, 2, false),
                        cprec, 3);

    case "GeneratorExpression":
        return "(" + comprehension(n, indent) + ")";

    case "ComprehensionExpression":
        return "[" + comprehension(n, indent) + "]";

    case "YieldExpression":
        // `yield a, b` is a SyntaxError; it must be parenthesized
        // `(yield a), b` or `yield (a, b)`.
        return wrapExpr("yield" + (n.argument ? " " + expr(n.argument, indent, 2, false) : ""),
                        cprec, 1);

    case "SequenceExpression":
        {
            var s = [];
            var arr = n.expressions;
            for (var i = 0; i < arr.length; i++)
                s[i] = expr(arr[i], indent, 2, noIn);
            return wrapExpr(s.join(", "), cprec, 2);
        }

    case "ConditionalExpression":
        return wrapExpr(expr(n.test, indent, 4, noIn) +
                          "?" + expr(n.consequent, indent, 0, noIn) +
                          ":" + expr(n.alternate, indent, 3, noIn),
                        cprec, 4);

    case "Identifier":
        return n.name;

    case "Literal":
        // Do not stringify NaN or Infinities as names. Also do not
        // stringify Infinity as "1 / 0", since ({1e999: 0}) is ok
        // meaning ({"Infinity": 0}). ({1 / 0: 0}) is a SyntaxError.
        if (n.value !== n.value) {
            return wrapExpr("0 / 0", cprec, 14);
        } else if (n.value === 1e999) {
            return wrapExpr("1e999", cprec, 19);
        } else if (n.value === -1e999) {
            return wrapExpr("-1e999", cprec, 15);
        } else {
            var s = JSON.stringify(n.value);
            if (cprec === 17 && s.match(/\d+/))
                s = "(" + s + ")";  // grammar quirk: 50.toString() --> (50).toString()
            return s;
        }

    case "CallExpression":
        return wrapExpr(expr(n.callee, indent, 17, false) +
                         args(n.arguments, indent),
                        cprec, 18);

    case "NewExpression":
        return (n.arguments.length == 0
                ? wrapExpr("new " + expr(n.callee, indent, 18, false), cprec, 17)
                : wrapExpr("new " + expr(n.callee, indent, 18, false) + args(n.arguments, indent),
                           cprec, 17));

    case "ThisExpression":
        return "this";

    case "MemberExpression":
        return wrapExpr(expr(n.object, indent, 17, false) +
                         (n.computed
                          ? "[" + expr(n.property, indent, 0, false) + "]"
                          : isBadIdentifier(n.property)
                          ? "[" + JSON.stringify(n.property.name) + "]"
                          : "." + expr(n.property, indent, 18, false)),
                        cprec, 18);

    case "UnaryExpression":
    case "UpdateExpression":
        {
            var op = n.operator;
            if (op == 'typeof' || op == 'void' || op == 'delete')
                op += ' ';
            var s = expr(n.argument, indent, 15, false);
            return wrapExpr(n.prefix ? op + s : s + op, cprec, 15);
        }

    case "LogicalExpression":
    case "BinaryExpression":
        if (n.operator == "..") {
            var left = expr(n.left, indent, 17, false), right;
            if (n.right.type == "Literal") {
                assertEq(typeof n.right.value, "string");
                assertEq(n.right.value.indexOf(" "), -1);
                right = n.right.value;
            } else {
                // XMLAnyName, XMLAttributeSelector, etc.
                right = expr(n.right, indent, 18, false);
            }
            return wrapExpr(left + ".." + right, cprec, 18);
        } else {
            // Note that in the case of an expression like (a+b+c+d+e+...)
            // this is basically a linked list via n.left. Recursing on n.left
            // when the chain has a few thousand nodes gives us an InternalError.
            // So do the slightly more complicated thing and iterate.

            var op = n.operator;
            var prec = precedence[op];
            assertEq(typeof prec, "number");

            // If we're going to parenthesize this whole expression, set
            // noIn to false, so as not to parenthesize subexpressions too.
            var parens = (op == "in" && noIn) || cprec >= prec;
            if (parens)
                noIn = false;

            var a = [expr(n.right, indent, prec, noIn && prec <= 11), op];
            var x;
            for (x = n.left; x.type === n.type && precedence[x.operator] === prec; x = x.left) {
                a.push(expr(x.right, indent, prec, noIn && prec <= 11));
                a.push(x.operator);
            }
            a.push(expr(x, indent, prec - 1, noIn && prec - 1 <= 11));
            var s = a.reverse().join(' ');
            return parens ? '(' + s + ')' : s;
        }

    case "AssignmentExpression":
        return wrapExpr(expr(n.left, indent, 3, noIn) + " " + n.operator + " " +
                          expr(n.right, indent, 2, noIn),
                        cprec, 3);

    case "FunctionExpression":
        return wrapExpr(functionDeclaration("function", n.id, n, indent),
                        cprec, n.expression ? 3 : 19);

    // These Patterns appear as function parameters, assignment and
    // declarator left-hand sides, and as the left-hand side in a for-in
    // head.
    case "ObjectPattern":
        {
            var s = [];
            for (var i = 0; i < n.properties.length; i++) {
                var p = n.properties[i];
                s[i] = expr(p.key, '####', 18, false) + ": " + expr(p.value, indent, 2, false);
            }
            return "{" + s.join(", ") + "}";
        }

    /* E4X */
    case "XMLAnyName":
        return "*";

    case "XMLQualifiedIdentifier":
        return expr(n.left, indent, 18, false) + "::" + (n.computed
                                                         ? "[" + expr(n.right, indent, 0, false) + "]"
                                                         : expr(n.right, indent, 17, false));

    case "XMLFunctionQualifiedIdentifier":
        return "function::" + (n.computed
                               ? "[" + expr(n.right, indent, 0, false) + "]"
                               : expr(n.right, indent, 17, false));

    case "XMLAttributeSelector":
        return "@" + (n.computed
                      ? "[" + expr(n.attribute, indent, 0, false) + "]"
                      : expr(n.attribute, indent, 18, false));

    case "XMLFilterExpression":
        return wrapExpr(expr(n.left, indent, 17, false) + ".(" +
                          expr(n.right, indent, 0, false) + ")",
                        cprec, 18);

    case "XMLElement":
    case "XMLPointTag":
    case "XMLCdata":
    case "XMLComment":
    case "XMLProcessingInstruction":
        return xmlData(n, indent);

    case "XMLList":
        var temp = [];
        for (var x in n.contents)
            temp.push(xmlData(x, indent));
        return "<>" + temp.join('') + "</>";

    default:
        return unexpected(n);
    }
}

function declarators(arr, indent, noIn) {
    var s = [];
    for (var i = 0; i < arr.length; i++) {
        var n = arr[i];

        if (n.type === "VariableDeclarator") {
            var patt = expr(n.id, '####', 3, false);
            s[i] = n.init === null ? patt : patt + " = " + expr(n.init, indent, 2, noIn);
        } else {
            s[i] = unexpected(n);
        }
    }
    return s.join(", ");
}

var stmt = sourceElement;

function sourceElement(n, indent) {
    if (indent === void 0)
        indent = "";

    switch (n.type) {
    case "BlockStatement":
        return (indent + "{\n" +
                values(n.body, function (x){return stmt(x, indent + indentChar)}).join("") +
                indent + "}\n");

    case "VariableDeclaration":
        return indent + n.kind + " " + declarators(n.declarations, indent, false) + ";\n";

    case "EmptyStatement":
        return indent + ";\n";

    case "ExpressionStatement":
        {
            var s = expr(n.expression, indent, 0, false);
            if (s.match(/^(?:function |var |{)/))
                s = "(" + s + ")";
            return indent + s + ";\n";
        }

    case "LetStatement":
        return indent + "var (" + declarators(n.head, indent) + ")" + substmt(n.body, indent);

    case "IfStatement":
        {
            var gotElse = n.alternate !== null;
            var s = indent + "if (" + expr(n.test, indent, 0, false) + ")" +
                    substmt(n.consequent, indent, gotElse);
            if (gotElse)
                s += "else" + substmt(n.alternate, indent);
            return s;
        }

    case "WhileStatement":
        return indent + "while (" + expr(n.test, indent, 0, false) + ")" + substmt(n.body, indent);

    case "ForStatement":
        {
            var s = indent + "for (";
            if (n.init) {
                if (n.init.type == "VariableDeclaration")
                    s += n.init.kind + " " + declarators(n.init.declarations, indent, true);
                else
                    s += expr(n.init, indent, 0, true);
            }
            s += ";";
            if (n.test)
                s += " " + expr(n.test, indent, 0, false);
            s += ";";
            if (n.update)
                s += " " + expr(n.update, indent, 0, false);
            s += ")";
            return s + substmt(n.body, indent);
        }

    case "ForInStatement":
        return indent + forHead(n, indent) + substmt(n.body, indent);

    case "DoWhileStatement":
        {
            var body = substmt(n.body, indent, true);
            return (indent + "do" + body + "while (" + expr(n.test, indent, 0, false) + ");\n");
        }

    case "ContinueStatement":
        return indent + "continue" + (n.label ? " " + n.label.name : "") + ";\n";

    case "BreakStatement":
        return indent + "break" + (n.label ? " " + n.label.name : "") + ";\n";

    case "ReturnStatement":
        return (indent + "return" +
                (n.argument ? " " + expr(n.argument, indent, 0, false) : "") +
                ";\n");

    case "WithStatement":
        return (indent + "with (" + expr(n.object, indent, 0, false) + ")" +
                substmt(n.body, indent));

    case "LabeledStatement":
        return n.label.name + ": " + stmt(n.body, indent);

    case "SwitchStatement":
        {
            var cases = n.cases;
            var s = indent + "switch (" + expr(n.discriminant, indent, 0, false) + ") {\n";
            var deeper = indent + indentChar;
            for (var j = 0; j < n.cases.length; j++) {
                var scase = cases[j];
                s += indent;
                s += (scase.test ? "case " + expr(scase.test, indent, 0, false) : "default");
                s += ":\n";
                var stmts = scase.consequent;
                for (var i = 0; i < stmts.length; i++)
                    s += stmt(stmts[i], deeper);
            }
            return s + indent + "}\n";
        }

    case "ThrowStatement":
        return indent + "throw " + expr(n.argument, indent, 0, false) + ";\n";

    case "TryStatement":
        {
            var s = indent + "try" + substmt(n.block, indent, true);
            var h = n.handler;
            var handlers = h === null ? [] : "length" in h ? h : [h];
            for (var i = 0; i < handlers.length; i++) {
                var c = handlers[i];
                s += 'catch (' + expr(c.param, '####', 0, false);
                if (c.guard !== null)
                    s +=  " if (" + expr(c.guard, indent, 0, false) + ")";
                var more = (n.finalizer !== null || i !== handlers.length - 1);
                s += ")" + substmt(c.body, indent, more);
            }
            if (n.finalizer)
                s += "finally" + substmt(n.finalizer, indent, false);
            return s;
        }

    case "DebuggerStatement":
        return indent + "debugger;";

    case "FunctionDeclaration":
        assertEq(n.id.type, "Identifier");
        return (indent +
                functionDeclaration("function", n.id, n, indent) +
                (n.expression ? ";\n" : "\n"));

    case "XMLDefaultDeclaration":
        return indent + "default xml namespace = " + expr(n.namespace, indent, 0, false) + ";\n";

    default:
        return unexpected(n);
    }
}

function stringify(n, newIndentChar) {
    if (n.type != "Program")
        throw new TypeError("argument must be a Program parse node");
    if (newIndentChar) indentChar = newIndentChar;
    return values(n.body, function (x){return sourceElement(x, "")}).join("");
}

exports.stringify = stringify;

})();


