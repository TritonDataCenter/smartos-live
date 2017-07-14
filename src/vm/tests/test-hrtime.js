/*
 * Copyright 2017, Joyent, Inc.
 *
 */

var hrtime = require('/usr/vm/node_modules/hrtime');

// this puts test stuff in global, so we need to tell jsl about that:
/* jsl:import ../node_modules/nodeunit-plus/index.js */
require('/usr/vm/node_modules/nodeunit-plus');

test('test pretty hrtime and delta (static time)', function (t) {
    [
        {
            then: [5, 0],
            now: [5, 1],
            delta: [0, 1],
            s: '1ns'
        },
        {
            then: [5, 0],
            now: [5, 1000],
            delta: [0, 1000],
            s: '1us'
        },
        {
            then: [5, 0],
            now: [5, 1000000],
            delta: [0, 1000000],
            s: '1ms'
        },
        {
            then: [5, 0],
            now: [6, 0],
            delta: [1, 0],
            s: '1s'
        },
        {
            then: [5, 0],
            now: [65, 0],
            delta: [60, 0],
            s: '1m'
        }
    ].forEach(function (o) {
        var delta = hrtime.hrtimeDelta(o.now, o.then);
        var s = hrtime.prettyHrtime(delta);

        t.deepEqual(delta, o.delta, 'hrtimeDelta delta: '
            + JSON.stringify(o.delta));
        t.equal(s, o.s, 'prettyHrtime delta: ' + o.s);
    });

    t.end();
});

test('test pretty hrtime (dynamic time)', function (t) {
    var then = process.hrtime();

    setTimeout(function () {
        var now = process.hrtime();
        var delta;
        var s;

        // use hrtimeDelta to calculate the delta
        delta = hrtime.hrtimeDelta(now, then);
        s = hrtime.prettyHrtime(delta);
        t.equal(s, '1s', '1 second hrtimeDelta (using hrtime.hrtimeDelta)');

        // pass the first time to the process.hrtime function to calculate the
        // delta
        delta = process.hrtime(then);
        s = hrtime.prettyHrtime(delta);
        t.equal(s, '1s', '1 second hrtimeDelta (using process.hrtime)');

        t.end();
    }, 1000);
});

test('test hrtime comparator', function (t) {
    var sorted_times = [
        [0, 0],
        [0, 500000000],
        [1, 0],
        [1, 500000000],
        [2, 0],
        [2, 500000000],
        [3, 0],
        [3, 500000000],
        [4, 0]
    ];
    var unsorted_times = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
        [0, 500000000],
        [1, 500000000],
        [2, 500000000],
        [3, 500000000]
    ];

    // sort the unsorted times
    unsorted_times.sort(hrtime.hrtimeComparator);
    t.deepEqual(unsorted_times, sorted_times, 'sorted array of hrtimes');
});

test('assert hrtime', function (t) {
    var hrtimes = [
        [0, 0],
        [0, 1],
        process.hrtime()
    ];
    var non_hrtimes = [
        undefined,
        'foo',
        42,
        [0, 1, 2],
        ['hello', 'world'],
        [new Date(), NaN]
    ];

    hrtimes.forEach(function (hrt) {
        t.doesNotThrow(function () {
            hrtime.assertHrtime(hrt);
        });
    });
    non_hrtimes.forEach(function (non_hrt) {
        t.throws(function () {
            hrtime.assertHrtime(non_hrt);
        });
    });
});

test('hrtime string conversion', function (t) {
    var hrt = process.hrtime();
    var roundtrip = hrtime.stringToHrtime(hrtime.hrtimeToString(hrt));

    t.deepEqual(roundtrip, hrt, 'round trip conversion');
});
