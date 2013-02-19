/*
 * example-auto.js: simple example of automatically panicking on crash
 */

var mod_panic = require('panic');

function func1(arg1)
{
	/* include func1 arg in debug state */
	panicDbg.set('func1.arg', arg1);
	func2(arg1 + 10);
}

function func2(arg2)
{
	/* include func2 arg in debug state */
	panicDbg.set('func2.arg', arg2);
	/* crash */
	(undefined).nonexistentMethod();
}

/*
 * Trigger a panic on crash.
 */
mod_panic.enablePanicOnCrash();

/*
 * The following line of code will cause this Node program to exit after dumping
 * debug state to cacore.<pid> (including func1's and func2's arguments).
 */
func1(10);
console.error('cannot get here');
