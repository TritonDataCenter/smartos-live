/*
 * Copyright (c) 2014 Joyent, Inc.  All rights reserved.
 */

/*
 * 'example' is a native C module that provides a partial implementation of
 * an unsigned 64-bit integer type.  This is a simple consumer that
 * demonstrates creation and manipulation of these objects, which should be
 * self-explanatory.  See example.c for the implementation.
 */

var example = require('./example');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var e = example.create();
var f = example.create('8000000000');

try {
	example.static_object('throw!');
} catch (e) {
	console.log('got exception: ' + e.name + ' (' + e.message + ')');
	console.log(util.inspect(e, false, null));
}

console.log('e = ' + e.toString());
console.log('f = ' + f.toString());

e.add(132);
console.log('e = ' + e.toString());

try {
	e.set(0x1111111111111111);
} catch (e) {
	console.log('got exception: ' + e.name + ' (' + e.message + ')');
	console.log(util.inspect(e, false, null));
}

e.set('0x1111111111111111');
console.log('e = ' + e.toString());

e.multiply(5);
console.log('e = ' + e.toString());

try {
	e.toString(33, 'fred');
} catch (e) {
	console.log('got exception: ' + e.name + ' (' + e.message + ')');
	console.log(util.inspect(e, false, null));
}

e.set(50000000);
f.set(22222222);
e.multiply(f.toString());
console.log('e = ' + e.toString());
console.log('f = ' + f.toString());

e.set(33);
e.multiplyAsync(100, function () {
	console.log('background e = ' + e.toString());
});

example.static_multiplyAsync(2345, 6789, function (r) {
	console.log('background multiply 2345 * 6789 = ' + r.toString());
});

function
Wrapper(ex)
{
	var self = this;

	ex.__emit = function (name) {
		var args = Array.prototype.slice.call(arguments);
		self.emit.apply(self, args);
	};
}

util.inherits(Wrapper, EventEmitter);

var g = example.create('543');
var gw = new Wrapper(g);

gw.on('add', function () {
	console.log('someone added something');
});

g.add(200);
g.add(300);
g.add(400);

console.log('1000000000000000000 + 3333333333333333333 = ' +
    example.static_add('1000000000000000000', '3333333333333333333'));

console.log(example.static_object());

example.static_exception(function () {
	throw new Error('test.js exception');
});
