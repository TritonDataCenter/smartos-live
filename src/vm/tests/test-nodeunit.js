/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

require('nodeunit-plus');

/*
 * Because of https://github.com/joyent/node/issues/7161, we needed to patch
 * nodeunit's lib/assert.js. This test is here to ensure we notice if someone
 * updates nodeunit for vmadm and doesn't reapply the patch (it's really simple
 * to reapply any time).
 */

test('ensure t.deepEqual is not insane', function (t) {
    t.deepEqual({a: 1}, {a: 1}, '{a: 1} === {a: 1}');
    t.notDeepEqual({a: 1}, {a: "1"}, '{a: 1} !== {a: "1"}');
    t.notDeepEqual({a: 1}, {a: true}, '{a: 1} !== {a: true}');
    t.notDeepEqual({a: {b: [1, 42]}}, {a: {b: ["1", "42"]}},
        '{a: {b: [1, 42]}} !== {a: {b: ["1", "42"]}');
    t.end();
});
