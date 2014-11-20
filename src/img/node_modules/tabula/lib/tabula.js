/**
 * tabula - A light function for printing a table of data to stdout.
 */

var p = console.log;
var assert = require('assert-plus');
var sprintf = require('extsprintf').sprintf;
var util = require('util');



// ---- internal support stuff

function objCopy(obj) {
    var copy = {};
    Object.keys(obj).forEach(function (k) {
        copy[k] = obj[k];
    });
    return copy;
}



// ---- exports

/**
 * Sort an array of objects (in-place).
 *
 * @param items {Array} The array of objects to sort.
 * @param fields {Array} Array of field names (lookups) on which to sort --
 *      higher priority to fields earlier in the array. The comparison may
 *      be reversed by prefixing the field with '-'. E.g.:
 *          ['-age', 'lastname', 'firstname']
 * @param options {Object} Optional.
 *      - dottedLookup {Boolean}
 */
function sortArrayOfObjects(items, fields, options) {
    assert.optionalObject(options, 'options');
    if (!options) {
        options = {};
    }
    assert.optionalBool(options.dottedLookup, 'options.dottedLookup');
    var dottedLookup = options.dottedLookup;

    function cmp(a, b) {
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var invert = false;
            if (field[0] === '-') {
                invert = true;
                field = field.slice(1);
            }
            assert.ok(field.length, 'zero-length sort field: ' + fields);
            var a_field, b_field;
            if (dottedLookup) {
                // This could be sped up by bring some processing out of `cmp`.
                var lookup = new Function('return this.' + field);
                try {
                    a_field = lookup.call(a);
                } catch(e) {}
                try {
                    b_field = lookup.call(b);
                } catch(e) {}
            } else {
                a_field = a[field];
                b_field = b[field];
            }
            var a_cmp = Number(a_field);
            var b_cmp = Number(b_field);
            if (isNaN(a_cmp) || isNaN(b_cmp)) {
                a_cmp = a_field;
                b_cmp = b_field;
            }
            // Comparing < or > to `undefined` with any value always
            // returns false.
            if (a_cmp === undefined && b_cmp === undefined) {
                // pass
            } else if (a_cmp === undefined) {
                return (invert ? 1 : -1);
            } else if (b_cmp === undefined) {
                return (invert ? -1 : 1);
            } else if (a_cmp < b_cmp) {
                return (invert ? 1 : -1);
            } else if (a_cmp > b_cmp) {
                return (invert ? -1 : 1);
            }
        }
        return 0;
    }
    items.sort(cmp);
}



/**
 * format a table of the given items.
 *
 * @params items {Array} of row objects.
 * @params options {Object}
 *      - `columns` {Array} Optional. Ordered array of table columns. Each
 *        column can be a string or an object. If a string, then it is
 *        the key or lookup (see `dottedLookup` option) into each item, and
 *        the printed column name is the string uppercased. If an object,
 *        then the following fields are supported:
 *          - lookup {String} Required.
 *          - name {String} Optional. Defaults to `lookup.toUpperCase()`.
 *        TODO: support width, align, etc.
 *      - `skipHeader` {Boolean} Optional. Default false.
 *      - `sort` {Array} Optional. Ordered array of field names on which
 *        to sort. A field can be prefixed with '-' to reverse sort on that
 *        field. Note that the given `items` array is sorted *in-place*.
 *      - `validFields` {Array} Optional. Array of valid field names for
 *        `columns` and `sort`. If specified this is used for validating those
 *        inputs. This can be useful if `columns` and `sort` are passed in
 *        directly from user input, e.g. from "-o foo,bar" command line args.
 *      - `dottedLookup` {Boolean} Optional. If true, then fields (in columns
 *        and sort), will lookup sub-fields in row objects using dot notation.
 *        E.g. "foo.bar" will retrieve from `{"foo": {"bar": 42}, ...}`.
 *        Default is false.
 */
function tabulaFormat(items, options) {
    assert.arrayOfObject(items, 'items');
    assert.optionalObject(options, 'options');
    options = options || {};
    assert.optionalBool(options.skipHeader, 'options.skipHeader');
    assert.optionalArrayOfString(options.sort, 'options.sort');
    assert.optionalArrayOfString(options.validFields, 'options.validFields');
    assert.optionalBool(options.dottedLookup, 'options.dottedLookup');

    if (items.length === 0) {
        return '';
    }
    var cols = [];
    (options.columns || Object.keys(items[0])).forEach(function (col) {
        if (typeof(col) === 'string') {
            cols.push({
                lookup: col,
                name: col.toUpperCase()
            });
        } else {
            // TODO: nice assert on col format
            col = objCopy(col);
            if (!col.hasOwnProperty('name')) {
                col.name = col.lookup.toUpperCase()
            }
            cols.push(col);
        }
    });

    // Validate.
    var validFields = options.validFields;
    sort = options.sort || [];
    if (validFields) {
        cols.forEach(function (c) {
            if (validFields.indexOf(c.lookup) === -1) {
                throw new TypeError(sprintf('invalid output field: "%s"',
                    c.lookup));
            }
        });
    }
    sort.forEach(function (s) {
        if (s[0] === '-') s = s.slice(1);
        if (validFields && validFields.indexOf(s) === -1) {
            throw new TypeError(sprintf('invalid sort field: "%s"', s));
        }
    });

    // Function to lookup each column field in a row.
    var colFuncs = cols.map(function (c) {
        var getCell = '    var cell = this["' + c.lookup + '"];\n';
        if (options.dottedLookup) {
            // Avoid any code execution.
            getCell = '    var cell = this["'
                + c.lookup.split('.').join('"]["') + '"];\n';
        }
        return new Function(
            'try {\n' +
            getCell +
            '    if (typeof(cell) === "string"\n' +
            '        || typeof(cell) === "number"\n' +
            '        || cell === null\n' +
            '        || cell === undefined) {\n' +
            '        return cell;\n' +
            '    } else if (typeof(cell) === "function") {\n' +
            '        return (cell.name \n' +
            '            ? "[Function: "+cell.name+"]" : "[Function]")\n' +
            '    } else {\n' +
            '        return JSON.stringify(cell);\n' +
            '    }\n' +
            '} catch (e) { }');
    });

    // Determine columns and widths.
    var widths = [];
    for (var i = 0; i < cols.length; i++) {
        widths[i] = cols[i].name.length;
    }
    items.forEach(function (item) {
        for (var i = 0; i < cols.length; i++) {
            var col = cols[i];
            var cell = colFuncs[i].call(item);
            if (cell === null || cell === undefined) {
                continue;
            }
            widths[i] = Math.max(
                widths[i], (cell ? String(cell).length : 0));
        }
    });

    var template = '';
    for (var i = 0; i < cols.length; i++) {
        if (i === cols.length - 1) {
            // Last column, don't have trailing whitespace.
            template += '%s';
        } else {
            template += '%-' + String(widths[i]) + 's  ';
        }
    }

    if (sort.length) {
        sortArrayOfObjects(items, sort, {dottedLookup: options.dottedLookup});
    }

    var lines = [];
    if (!options.skipHeader) {
        var header = cols.map(function (c) { return c.name; });
        header.unshift(template);
        lines.push(sprintf.apply(null, header));
    }
    items.forEach(function (item) {
        var row = [];
        for (var j = 0; j < colFuncs.length; j++) {
            var cell = colFuncs[j].call(item);
            if (cell === null || cell === undefined) {
                row.push('-');
            } else {
                row.push(String(cell));
            }
        }
        row.unshift(template);
        lines.push(sprintf.apply(null, row));
    });

    return lines.join('\n') + '\n';
}


function tabulaPrint(items, options) {
    process.stdout.write(tabulaFormat(items, options));
}



// ---- exports

module.exports = tabulaPrint;
module.exports.format = tabulaFormat;
module.exports.sortArrayOfObjects = sortArrayOfObjects;
