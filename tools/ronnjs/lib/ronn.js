/* ronn.js version 0.1
 * Copyright : 2010 Jérémy Lal <kapouer@melix.org>
 * License : MIT
 */

var md = require(__dirname + '/ext/markdown');
var sys = require('sys');

/* exports Ronn class
 * usage :
 * var ronn = new Ronn(rofftext, "1.0", "my manual name", "2010-12-25");
 * ronn.roff();
 * ronn.html();
 * ronn.fragment();
 */

exports.Ronn = function(text, version, manual, date) {
	if (!manual) manual = "";
	if (!version) version = "";
	if (!date) date = new Date();
	else date = new Date(date + " GMT");

	var gMD = md.parse(text);
	prepareTree(gMD);
	var gHtml = md.toHTMLTree(gMD);
	//console.log(JSON.stringify(gHtml));

	this.roff = function() {
		return blockFilter("", gHtml, {parent:null, previous:null, position:null}) + "\n";
	};

	this.html = function() {
		return toHTML(gHtml) + "\n";
	};

	this.fragment = function() {
		return toHTMLfragment(gHtml) + "\n";
	};

	function blockFilter(out, node, context) {
		if (typeof node == "string") {
			if (!node.match(/^\s*$/m)) sys.debug("unexpected text: " + node);
			return out;
		}
		var tag = node.shift();	
		var attributes = null;
		if (node.length && typeof node[0] === "object" && !(node[0] instanceof Array)) {
			attributes = node.shift();
		}
		var fParent = context.parent;
		var fPrevious = context.previous;
		context.previous = null;
		context.parent = tag;
		switch (tag) {
			case "html":
				out = comment(out, "Generated with Ronnjs/v0.1");
				out = comment(out, "http://github.com/kapouer/ronnjs/");
				while (node.length) out = blockFilter(out, node.shift(), context);
			break;
			case "h1":
				var fTagline = node.shift();
				var fMatch = /([\w_.\[\]~+=@:-]+)\s*\((\d\w*)\)\s*-+\s*(.*)/.exec(fTagline);
				var fName, fSection;
				if (fMatch != null) {
					fName = fMatch[1];
					fSection = fMatch[2];
					fTagline = fMatch[3];
				} else {
					fMatch = /([\w_.\[\]~+=@:-]+)\s+-+\s+(.*)/.exec(fTagline);
					if (fMatch != null) {
						fName = fMatch[1];
						fTagline = fMatch[2];
					}
				}
				if (fMatch == null) {
					fName = "";
					fSection = "";
					fTagline = "";
				}
				if (fName.length == 0) break;
				out = macro(out, "TH", [
					quote(esc(fName.toUpperCase()))
					, quote(fSection)
					, quote(manDate(date))
					, quote(version)
					, quote(manual)
				]);
				out = macro(out, "SH", quote("NAME"));
				out += "\\fB" + fName + "\\fR";
				if (fTagline.length > 0) out += " \\-\\- " + esc(fTagline);
			break;
			case "h2":
				out = macro(out, "SH", quote(esc(toHTML(node.shift()))));
			break;
			case "h3":
				out = macro(out, "SS", quote(esc(toHTML(node.shift()))));
			break;
			case "h4":
				out = macro(out, "TP");
				out += esc(toHTML(node.shift()));
			break;
			case "hr":
				out = macro(out, "HR");
			break;
			case "p":
				if (fPrevious && fParent && (fParent == "dd" || fParent == "li")) {
					out = macro(out, "IP");
				} else if (fPrevious == "h4") {
					out = out + "\n.";
				// Ronn also has 'h1' here, but its preprocessing removes the
				// first 'h1' on a page -- different than the 'h1' preprocessing
				// in ronnjs -- so the same exclusion doesn't apply here.
				} else if (fPrevious && !(fPrevious == "h2" || fPrevious == "h3")) {
					out = macro(out, "P");
				}
				out = callInlineChildren(out, node, context);
			break;
			case "pre":
				var indent = (fPrevious == null || !(fPrevious == "h2" || fPrevious == "h3"));
				if (indent) out = macro(out, "IP", [quote(""), 4]);
				out = macro(out, "nf");
				out = callInlineChildren(out, node, context);
				out = macro(out, "fi");
				if (indent) out = macro(out, "IP", [quote(""), 0]);
			break;
			case "dl":
				out = macro(out, "TP");
				while (node.length) out = blockFilter(out, node.shift(), context);
			break;
			case "dt":
				if (fPrevious != null) out = macro(out, "TP");
				out = callInlineChildren(out, node, context);
				out += "\n";
			break;
			case "dd":
				if (containsTag(node, {'p':true})) {
					while (node.length) out = blockFilter(out, node.shift(), context);
				} else {
					out = callInlineChildren(out, node, context);
				}
				out += "\n";
			break;
			case "ol":
			case "ul":
				context.position = 0;
				while (node.length) out = blockFilter(out, node.shift(), context);
				context.position = null;
				out = macro(out, "IP", [quote(""), 0]);
			break;
			case "li":
				if (fParent == "ol") {
					context.position += 1;
					out = macro(out, "IP", [quote(context.position), 4]);
				} else if (fParent == "ul") {
					out = macro(out, "IP", [quote("\\(bu"), 4]);
				}
				if (containsTag(node, {"p":true, "ol":true, "ul":true, "dl":true, "div":true})) {
					while (node.length) out = blockFilter(out, node.shift(), context);
				} else {
					out = callInlineChildren(out, node, context);
				}
				out += "\n";
			break;
			case "span":
			case "code":
			case "b":
			case "strong":
			case "kbd":
			case "samp":
			case "var":
			case "em":
			case "i":
			case "u":
			case "br":
			case "a":
				if (attributes != null) node.unshift(attributes);
				node.unshift(tag);
				out = inlineFilter(out, node, context);
			break;
			default:
				sys.debug("unrecognized block tag: " + tag);
			break;
		}
		context.parent = fParent;
		context.previous = tag;
		return out;
	}

	function callInlineChildren(out, node, context) {
		while (node.length) {
			var lChild = node.shift();
			if (node.length > 0) context.hasNext = true;
			else context.hasNext = false;
			out = inlineFilter(out, lChild, context);
		}
		return out;
	}

	function inlineFilter(out, node, context) {
		if (typeof node == "string") {
			if (context.previous) {
				if (context.previous == "br") node = node.replace(/^\n+/gm, '');
				else if (context.previous == "dt" || context.previous == "dd") {
					node = node.trim();
				}
			}
			if (context.parent == "pre") {
				// do nothing
			} else if (context.previous == null && !context.hasNext) {
				// Not sure of the intention here, but this removes desired
				// whitespace separation in man pages,
				// e.g. 'test/cases/blank_lines.ronn'.
				//node = node.replace(/\n+$/gm, '');
			} else {
				// Not sure of the intention here, but this removes desired
				// whitespace separation in man pages,
				// e.g. 'test/cases/blank_lines.ronn'.
				//node = node.replace(/\n+$/gm, ' ');
			}
			out += esc(node);
			return out;
		}
		var tag = node.shift();	
		var attributes = null;
		if (node.length && typeof node[0] === "object" && !(node[0] instanceof Array)) {
			attributes = node.shift();
		}
		var fParent = context.parent;
		var fPrevious = context.previous;
		context.parent = tag;
		context.previous = null;
		switch(tag) {
			case "code":
				if (fParent == "pre") {
					out = callInlineChildren(out, node, context);
				} else {
					out += '\\fB';
					out = callInlineChildren(out, node, context);
					out += '\\fR';
				}
			break;
			case "b":
			case "strong":
			case "kbd":
			case "samp":
				out += '\\fB';
				out = callInlineChildren(out, node, context);
				out += '\\fR';
			break;
			case "var":
			case "em":
			case "i":
			case "u":
				out += '\\fI';
				out = callInlineChildren(out, node, context);
				out += '\\fR';
			break;
			case "br":
				out = macro(out, "br");
			break;
			case "a":
				var fStr = node[0];
				var fHref = attributes['href'];
				if (fHref == fStr || (fHref.length > 0 && fHref[0] == '#') || decodeURI(fHref) == "mailto:" + decodeURI(fStr)) {
					out += '\\fI';
					out = callInlineChildren(out, node, context);
					out += '\\fR';
				} else {
					out = callInlineChildren(out, node, context);
					out += " ";
					out += '\\fI';
					out += esc(fHref);
					out += '\\fR';
				}
			break;
			default:
				sys.debug("unrecognized inline tag: " + tag);
			break;
		}
		context.parent = fParent;
		context.previous = tag;
		return out;
	}

	function containsTag(node, tags) {
		// browse ml tree searching for tags (hash {tag : true, ...})
		if (typeof node == "string") return false;
		var jml = node.slice(0);
		if (jml.length == 0) return false;
		else while (jml.length && jml[0] instanceof Array) {
			if (containsTag(jml.shift(), tags)) return true;
		}
		var tag = jml.shift();
		if (tags[tag] === true) return true;
		if (jml.length && typeof jml[0] === "object" && !(jml[0] instanceof Array)) {
			// skip attributes
			jml.shift();
		}
		// children
		if (jml.length) {
			if (containsTag(jml.shift(), tags)) return true;
		}
		// siblings
		if (jml.length) return containsTag(jml, tags);
	}

	function toHTML(node) {
		// TODO : check double-escapes of & by &amp;
		return md.renderJsonML(node, {root:true, xhtml:true});
	}

	function toHTMLfragment(node) {
		return md.renderJsonML(node, {root:false, xhtml:true});
	}

	function comment(out, str) {
		return writeln(out, '.\\" ' + str);
	}

	function quote(str) {
		return '"' + str + '"';
	}

	function esc(str) {
		// TODO : MARKDOWN CONVERTS ONLY &, <, >
		// so there are no entities to convert, maybe chars if output is not UTF8 ?
		// HTML_ROFF_ENTITIES = {
		// • '&bull;'  => '\(bu',
		// < '&lt;'    => '<',
		// > '&gt;'    => '>',
		// ici un nbsp : ' ', '&nbsp;'  => '\~',
		// © '&copy;'  => '\(co',
		// ” '&rdquo;' => '\(rs',
		// — '&mdash;' => '\(em',
		// ® '&reg;'   => '\(rg',
		// INCONNU '&sec;'   => '\(sc',
		// ≥ '&ge;'    => '\(>=',
		// ≤ '&le;'    => '\(<=',
		// ≠ '&ne;'    => '\(!=',
		// ≡ '&equiv;' => '\(=='
		// }
		// text.gsub!(/&#x([0-9A-Fa-f]+);/) { $1.to_i(16).chr }  # hex entities
		// text.gsub!(/&#(\d+);/) { $1.to_i.chr }                # dec entities
		// text.gsub!('\\', '\e')                                # backslash
		// text.gsub!(/['".-]/) { |m| "\\#{m}" }                 # control chars
		// text.gsub!(/(&[A-Za-z]+;)/) { ent[$1] || $1 }         # named entities
		// text.gsub!('&amp;',  '&')                             # amps
		return str
			.replace(/\\/gm, "\\\\")
			.replace(/-/gm, "\\-")
			.replace(/^\./gm, "\\|.")
			.replace(/\./gm, "\\.")
			.replace(/'/gm, "\\'")
			;
	}

	function writeln(out, str) {
		if (out.length && out[out.length - 1] != "\n") out += "\n";
		out += str + "\n";
		return out;
	}

	function macro(out, name, list) {
		var fText = ".\n." + name;
		if (list != null) {
			if (typeof list == "string") {
				fText += ' ' + list;
			} else {
				for (var i=0, len=list.length; i < len; i++) {
					var item = list[i];
					if (item == null) continue;
					fText += ' ' + item;
				}
			}
		}
		return writeln(out, fText);
	}

	function manDate(pDate) {
		var fMonth = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][pDate.getMonth()];
		return fMonth + " " + pDate.getFullYear();
	}
};

function getAttributes(jml) {
	return jml instanceof Array && jml.length > 1 && typeof jml[1] === "object" && !(jml[1] instanceof Array) ? jml[1] : undefined;
}

function getInnerText(jml) {
	if (jml == null || typeof(jml) == "string") return jml;
	var fStr = "";
	var fTag = jml[0];
	var fAtt = null;
	var fIndex = 1;
	if (1 < jml.length && typeof jml[1] === "object" && !(jml[1] instanceof Array)) {
		fAtt = jml[1];
		fIndex += 1;
	}
	while (fIndex < jml.length) {
		fStr += getInnerText(jml[fIndex++]);
	}
	return fStr;
}

function prepareTree(pJml) {
	var fAtts = getAttributes(pJml);
	if (!fAtts) {
		fAtts = {};
		pJml.splice(1, 0, fAtts);
	}
	var fRefs = null;
	if (!fAtts.references) {
		fRefs = {};
		fAtts.references = fRefs;
	} else {
		fRefs = fAtts.references;
	}

	forEachTag(pJml, ["header"], function(pTag, pAtt, pIndex) {
		if (pAtt['level'] < 2 || pAtt.id) return;
		var fText = getInnerText(this);
		pAtt.id = fText.replace(/\W+/gm, "-").replace(/(^-+|-+$)/gm, '');
		var fRef = {href: '#' + pAtt.id};
		fRefs[fText.toLowerCase()] = fRef;
	});
}

function forEachML(jml, callback) {
	// walk through jml tree, call function for each node
	// callback can access jml through `this`, and can return an integer indicating the new current index
	if (jml == null || typeof(jml) == "string") return;
	var fTag = jml[0];
	var fAtt = null;
	var fIndex = 1;
	if (1 < jml.length && typeof jml[1] === "object" && !(jml[1] instanceof Array)) {
		fAtt = jml[1];
		fIndex += 1;
	}
	var fRet = callback.call(jml, fTag, fAtt, fIndex);
	if (!isNaN(parseInt(fRet))) fIndex = fRet;
	while (fIndex < jml.length) {
		forEachML(jml[fIndex++], callback);
	}
}

function forEachTag(jml, tags, callback) {
	forEachML(jml, function(pTag, pAtt, pIndex) {
		if (tags.indexOf(pTag) >= 0) return callback.call(this, pTag, pAtt, pIndex);
	});
}
