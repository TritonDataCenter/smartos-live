/*
 * example-loop.js: example of using "ncore" tool to generate a node core
 */

var mod_panic = require('panic');

function func()
{
	for (var ii = 0; ; ii++)
		panicDbg.set('func-iter', ii);
}

console.log('starting infinite loop; use "ncore" tool to generate core');
func();
