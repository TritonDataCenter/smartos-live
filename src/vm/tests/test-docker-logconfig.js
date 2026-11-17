/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright 2026 Edgecast Cloud LLC.
 *
 */

/*
 * Unit tests for docker-logconfig.js: translation of docker json-file log
 * options (docker:logconfig) into zlog_max_size / zlog_keep_rotated.
 */

var dockerLogConfig = require('/usr/vm/node_modules/docker-logconfig');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

var zlogFromLogConfig = dockerLogConfig.zlogFromLogConfig;

/**
 * Runs zlogFromLogConfig on a JSON-encoded config object.
 *
 * @param {Object} cfg - logconfig options
 * @returns {Object} zlogFromLogConfig result
 */
function translate(cfg) {
    return zlogFromLogConfig(JSON.stringify(cfg));
}

test('max-size units are powers of 1000', function (t) {
    [
        ['1', 1],
        ['1000', 1000],
        ['30k', 30000],
        ['30m', 30000000],
        ['2g', 2000000000],
        [5, 5]
    ].forEach(function (tc) {
        var res = translate({'max-size': tc[0]});

        t.equal(res.zlog_max_size, tc[1], 'max-size ' + tc[0]);
        t.deepEqual(res.errors, [], 'no errors for ' + tc[0]);
    });

    t.end();
});

test('max-file maps to max-file - 1, clamped to [1, 1000]', function (t) {
    [
        ['1', 1],
        ['2', 1],
        ['3', 2],
        ['1000', 999],
        ['1001', 1000],
        ['999999999', 1000],
        [4, 3]
    ].forEach(function (tc) {
        var res = translate({'max-file': tc[0]});

        t.equal(res.zlog_keep_rotated, tc[1], 'max-file ' + tc[0]);
        t.deepEqual(res.errors, [], 'no errors for ' + tc[0]);
    });

    t.end();
});

test('keep_rotated is never 0 (unlimited)', function (t) {
    var n;
    var res;

    for (n = 1; n <= 1100; n++) {
        res = translate({'max-file': String(n)});
        t.ok(res.zlog_keep_rotated >= 1 && res.zlog_keep_rotated <= 1000,
            'max-file ' + n + ' -> ' + res.zlog_keep_rotated);
    }

    t.end();
});

test('both options together', function (t) {
    var res = translate({'max-file': '3', 'max-size': '30m'});

    t.deepEqual(res, {
        absent: [],
        errors: [],
        zlog_max_size: 30000000,
        zlog_keep_rotated: 2
    }, 'issue #1187 config');

    t.end();
});

test('missing options produce no settings and are reported', function (t) {
    var both = {absent: ['zlog_max_size', 'zlog_keep_rotated'], errors: []};

    t.deepEqual(translate({}), both, 'empty object');
    t.deepEqual(translate({'labels': 'a'}), both, 'unrelated opt');
    t.deepEqual(translate({'max-file': 'abc'}).absent, ['zlog_max_size'],
        'invalid option is not absent');
    t.equal(zlogFromLogConfig('nope').absent, undefined,
        'no absent list for invalid JSON');

    t.end();
});

test('invalid option values are ignored and reported', function (t) {
    [
        '0', '-1', '+3', '03', ' 3', '3 ', '3.5', '1e3', '0x10', '', 'abc',
        '3m;rm -rf /', '3\n', '30mb', '30M', '9999999999'
    ].forEach(function (v) {
        var res = translate({'max-file': v});

        t.equal(res.zlog_keep_rotated, undefined,
            'max-file ' + JSON.stringify(v) + ' ignored');
        t.equal(res.errors.length, 1, 'one error');
    });

    [
        '0', '0m', '-1m', '1.5m', '1e9', '30M', '30mb', '30 m', 'm', '',
        '1t', '9999999999999999', '9999999999999g', '1m"; set foo="bar'
    ].forEach(function (v) {
        var res = translate({'max-size': v});

        t.equal(res.zlog_max_size, undefined,
            'max-size ' + JSON.stringify(v) + ' ignored');
        t.equal(res.errors.length, 1, 'one error');
    });

    [null, true, {}, [], 3.5, -2].forEach(function (v) {
        var res = translate({'max-file': v, 'max-size': v});

        t.equal(res.zlog_keep_rotated, undefined,
            'max-file ' + JSON.stringify(v) + ' ignored');
        t.equal(res.zlog_max_size, undefined,
            'max-size ' + JSON.stringify(v) + ' ignored');
        t.equal(res.errors.length, 2, 'two errors');
    });

    t.end();
});

test('max-size results stay exact integers', function (t) {
    var res = translate({'max-size': '9007199g'});

    t.equal(res.zlog_max_size, 9007199000000000, 'largest g value kept');
    t.ok(res.zlog_max_size <= 9007199254740991, 'within safe integer');

    res = translate({'max-size': '9007200g'});
    t.equal(res.zlog_max_size, undefined, 'beyond safe integer ignored');

    t.end();
});

test('valid option survives an invalid sibling', function (t) {
    var res = translate({'max-file': 'abc', 'max-size': '1m'});

    t.equal(res.zlog_max_size, 1000000, 'max-size kept');
    t.equal(res.zlog_keep_rotated, undefined, 'max-file ignored');
    t.equal(res.errors.length, 1, 'one error');

    t.end();
});

test('malformed logconfig never throws', function (t) {
    [
        '', 'not json', '{', '"3"', '3', 'null', '[]', '["max-file"]',
        'true', '{"max-file":"3"', '{"__proto__":{"max-file":"3"}}',
        '{"constructor":{"max-file":"3"}}'
    ].forEach(function (s) {
        var res;

        t.doesNotThrow(function () {
            res = zlogFromLogConfig(s);
        }, 'no throw for ' + JSON.stringify(s));
        t.equal(res.zlog_keep_rotated, undefined,
            'no keep_rotated for ' + JSON.stringify(s));
        t.equal(res.zlog_max_size, undefined,
            'no max_size for ' + JSON.stringify(s));
    });

    t.end();
});

test('options next to a hostile hasOwnProperty key', function (t) {
    var res;

    t.doesNotThrow(function () {
        res = zlogFromLogConfig('{"hasOwnProperty":1,"max-file":"3"}');
    }, 'no throw');
    t.equal(res.zlog_keep_rotated, 2, 'max-file still read');
    t.deepEqual(res.absent, ['zlog_max_size'], 'max-size absent');

    t.end();
});

/*
 * zlogPropsForPayload
 */

var zlogPropsForPayload = dockerLogConfig.zlogPropsForPayload;
var VMOBJ_BOTH = {docker: true, zlog_max_size: 2000000, zlog_keep_rotated: 1};

test('payload: create derives both', function (t) {
    var res = zlogPropsForPayload({docker: true, internal_metadata: {
        'docker:logconfig': '{"max-file":"3","max-size":"30m"}'
    }}, null, 'json-file');

    t.deepEqual(res, {props: {zlog_max_size: 30000000, zlog_keep_rotated: 2},
        errors: []}, 'derived');

    t.end();
});

test('payload: nothing for non-docker or other drivers', function (t) {
    var md = {'docker:logconfig': '{"max-file":"3"}'};

    t.deepEqual(zlogPropsForPayload({internal_metadata: md}, null,
        'json-file').props, {}, 'not docker');
    t.deepEqual(zlogPropsForPayload({docker: true, internal_metadata: md},
        null, 'syslog').props, {}, 'syslog');
    t.deepEqual(zlogPropsForPayload({docker: true}, null, 'json-file').props,
        {}, 'no logconfig');

    t.end();
});

test('payload: explicit properties win', function (t) {
    var res = zlogPropsForPayload({zlog_keep_rotated: 7,
        set_internal_metadata: {'docker:logconfig': '{"max-file":"3"}'}},
        VMOBJ_BOTH, 'json-file');

    t.deepEqual(res.props, {zlog_max_size: 0},
        'keep_rotated explicit; absent max-size cleared');

    t.end();
});

test('payload: option dropped from logconfig clears it', function (t) {
    var res = zlogPropsForPayload({set_internal_metadata: {
        'docker:logconfig': '{"max-size":"50m"}'
    }}, VMOBJ_BOTH, 'json-file');

    t.deepEqual(res.props, {zlog_max_size: 50000000, zlog_keep_rotated: 0},
        'max-file dropped');

    res = zlogPropsForPayload({set_internal_metadata: {
        'docker:logconfig': '{"max-size":"50m"}'
    }}, {docker: true, zlog_max_size: 1}, 'json-file');
    t.deepEqual(res.props, {zlog_max_size: 50000000},
        'nothing to clear when VM lacks the property');

    t.end();
});

test('payload: removed logconfig clears both', function (t) {
    var res = zlogPropsForPayload({
        remove_internal_metadata: ['docker:logconfig']
    }, VMOBJ_BOTH, 'json-file');

    t.deepEqual(res.props, {zlog_max_size: 0, zlog_keep_rotated: 0},
        'cleared');

    res = zlogPropsForPayload({remove_internal_metadata: ['docker:tty']},
        VMOBJ_BOTH, 'json-file');
    t.deepEqual(res.props, {}, 'other key removed: unchanged');

    t.end();
});

test('payload: invalid input leaves properties unchanged', function (t) {
    ['nope', '[]', '{"max-file":"abc","max-size":"x"}'].forEach(function (c) {
        var res = zlogPropsForPayload({set_internal_metadata: {
            'docker:logconfig': c
        }}, VMOBJ_BOTH, 'json-file');

        t.deepEqual(res.props, {}, 'unchanged for ' + JSON.stringify(c));
        t.ok(res.errors.length > 0, 'errors for ' + JSON.stringify(c));
    });

    t.deepEqual(zlogPropsForPayload({set_internal_metadata: {
        'docker:logconfig': 3
    }}, VMOBJ_BOTH, 'json-file').props, {}, 'non-string logconfig');

    t.end();
});

test('payload: hostile hasOwnProperty keys never throw', function (t) {
    var md = {'hasOwnProperty': 1, 'docker:logconfig': '{"max-file":"3"}'};
    var res;

    t.doesNotThrow(function () {
        res = zlogPropsForPayload({hasOwnProperty: 1, docker: true,
            set_internal_metadata: md}, {hasOwnProperty: 1, docker: true,
            zlog_max_size: 5}, 'json-file');
    }, 'no throw');
    t.deepEqual(res.props, {zlog_keep_rotated: 2, zlog_max_size: 0},
        'derived');

    t.end();
});

test('payload: docker:true in the same update counts', function (t) {
    var res = zlogPropsForPayload({docker: true, set_internal_metadata: {
        'docker:logconfig': '{"max-file":"2"}'
    }}, {docker: false}, 'json-file');

    t.deepEqual(res.props, {zlog_keep_rotated: 1}, 'derived');

    t.end();
});
