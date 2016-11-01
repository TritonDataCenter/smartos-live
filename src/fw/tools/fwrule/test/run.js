// Copyright 2014 Patrick Mooney.  All rights reserved.

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

function runTests(directory) {
    fs.readdir(directory, function (err, files) {
        assert.ifError(err);
        files.filter(function (f) {
            return (/\.test\.js$/.test(f));
        }).map(function (f) {
            return (path.join(directory, f));
        }).forEach(require);
    });
}

// --- Run All Tests

(function main() {
    runTests(__dirname);
})();
