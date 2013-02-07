/*
 * test/basic.js: tests jsprim functions
 */

var mod_assert = require('assert');
var jsprim = require('../lib/jsprim');

/* deepCopy */
var obj = {
    'family': 'simpson',
    'children': [ 'bart', 'lisa', 'maggie', 'hugo' ],
    'home': true,
    'income': undefined,
    'dignity': null,
    'nhomes': 1
};

var copy = jsprim.deepCopy(obj);

mod_assert.deepEqual(copy, obj);
copy['home'] = false;
mod_assert.ok(obj['home'] === true);

/* isEmpty */
mod_assert.ok(jsprim.isEmpty({}));
mod_assert.ok(!jsprim.isEmpty({ 'foo': 'bar' }));

/* forEachKey */
var keys = [];
jsprim.forEachKey(obj, function (key, val) {
	mod_assert.deepEqual(obj[key], val);
	keys.push(key);
});
keys.sort();
mod_assert.deepEqual(keys,
    [ 'children', 'dignity', 'family', 'home', 'income', 'nhomes' ]);

/* startsWith */
mod_assert.ok(jsprim.startsWith('foobar', 'f'));
mod_assert.ok(jsprim.startsWith('foobar', 'foo'));
mod_assert.ok(jsprim.startsWith('foobar', 'foobar'));
mod_assert.ok(jsprim.startsWith('foobars', 'foobar'));
mod_assert.ok(!jsprim.startsWith('foobar', 'foobars'));
mod_assert.ok(!jsprim.startsWith('hofoobar', 'foo'));
mod_assert.ok(!jsprim.startsWith('hofoobar', 'bar'));

/* endsWith */
mod_assert.ok(!jsprim.endsWith('foobar', 'f'));
mod_assert.ok(jsprim.endsWith('foobar', 'r'));
mod_assert.ok(jsprim.endsWith('foobar', 'bar'));
mod_assert.ok(jsprim.endsWith('foobar', 'foobar'));
mod_assert.ok(jsprim.endsWith('sfoobar', 'foobar'));
mod_assert.ok(!jsprim.endsWith('foobar', 'foobars'));
mod_assert.ok(!jsprim.endsWith('foobar', 'sfoobar'));
mod_assert.ok(!jsprim.endsWith('hofoobar', 'foo'));

/* iso8601 */
var d = new Date(1339194063451);
mod_assert.equal(jsprim.iso8601(d), '2012-06-08T22:21:03.451Z');

/* randElt */
var a = [];
mod_assert.throws(function () {
	jsprim.randElt(a);
}, /must be a non-empty array/);

a = [ 10 ];
var r = jsprim.randElt(a);
mod_assert.equal(r, 10);
r = jsprim.randElt(a);
mod_assert.equal(r, 10);

var v = {};
a = [ 'alpha', 'bravo', 'charlie', 'oscar' ];
for (var i = 0; i < 10000; i++) {
	r = jsprim.randElt(a);
	if (!v.hasOwnProperty(r))
		v[r] = 0;
	v[r]++;
}

mod_assert.deepEqual(Object.keys(v).sort(),
    [ 'alpha', 'bravo', 'charlie', 'oscar' ]);
jsprim.forEachKey(v, function (_, value) { mod_assert.ok(value > 0); });
