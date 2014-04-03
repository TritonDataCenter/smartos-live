/*
 * Copyright (c) 2014 Robert Gulewich. All rights reserved.
 *
 * Template generation
 */

var fs = require('fs');
var hogan = require('hogan.js');
var path = require('path');
var util = require('util');



// --- Globals



// configurable with -p wrap=<number>:
var WRAP_LIMIT = 80;



// --- Internal



/**
 * Indent lines and optionall wrap them at 80 characters
 */
function doIndent(sectionText, wrap) {
    // Remove the initial newline
    var text = sectionText.replace(/^\n/, '');
    var initialIndent = getIndent(text);

    // For variables that have newlines in them, we need to indent each
    // line in that variable the initial amount
    var templateVars = {};
    for (var v in this) {
        if (typeof (this[v]) === 'string') {
            templateVars[v] = this[v].split('\n').join('\n' + initialIndent);
        }
    }

    // The post-rendered string is needed to do the line wrapping
    var expanded = render(text, templateVars);

    if (!wrap || WRAP_LIMIT === 0) {
        return expanded;
    }

    var after = [];
    expanded.split('\n').forEach(function (line) {
        if (line.length <= WRAP_LIMIT) {
            after.push(line);
            return;
        }

        // Continuation lines for commands: add " \" at the end of the line,
        // and all subsequent lines have the same indent + 4 spaces
        var indent = getIndent(line) + '    ';
        while (line.length > WRAP_LIMIT) {
            var lastSpace = line.substr(0, WRAP_LIMIT - 2).lastIndexOf(' ');
            after.push(line.substr(0, lastSpace) + ' \\');
            line = indent + line.substr(lastSpace);
        }

        after.push(line);
    });

    return after.join('\n');
}


/**
 * Returns the indent portion of a line
 */
function getIndent(line) {
    return line.substr(0, /[^ ]/.exec(line).index);
}


/**
 * Render a hogan.js template, converting HTML escaped text back into plain
 * text (for the charaters we care about, anyway)
 */
function render(templateText, data) {
    var template = hogan.compile(templateText);
    return template.render(data);
}


/**
 * Read a directory of files, and add their contents to templateData
 */
function readDir(dir, templateData) {
    var files;
    files = fs.readdirSync(dir);
    files.forEach(function (file) {
        if (templateData.hasOwnProperty(file)) {
            return;
        }

        templateData[file] = fs.readFileSync(path.join(
            dir, file)).toString().replace(/\n$/, '');
    });
}


/**
 * Read a JSON file
 */
function readFile(file, templateData) {
    var fileData = JSON.parse(fs.readFileSync(file).toString());

    for (var f in fileData) {
        if (!templateData.hasOwnProperty(f)) {
            templateData[f] = fileData[f];
        }
    }
}



// --- hogan.js section tags



/**
 * Indent lines by the amount that the initial section tag is at.
 */
function indent(text) {
    return doIndent.call(this, text, false);
}


/**
 * Wrap lines at 80 characters with a "\" at the end, indenting the leftover
 * text by 4 spaces.
 */
function indentAndWrap(text) {
    return doIndent.call(this, text, true);
}



// --- Exports



function generateFile(opts) {
    var inFile;
    var templateData = {
        indent: indent,
        indent_and_wrap: indentAndWrap
    };

    inFile = fs.readFileSync(opts.inFile).toString();

    if (opts.file) {
        readFile(opts.file, templateData);
    }

    if (opts.dir) {
        readDir(opts.dir, templateData);
    }

    if (opts.params.hasOwnProperty('wrap')) {
        WRAP_LIMIT = opts.params.wrap;
    }

    var result = render(inFile, templateData);
    if (opts.outFile) {
        fs.writeFileSync(opts.outFile, result);
    } else {
        console.log(result);
    }
}



module.exports = {
    generateFile: generateFile
};
