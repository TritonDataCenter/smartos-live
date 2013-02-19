/*
 * example-explicit.js: example of using "panic" directly
 */

var mod_panic = require('panic');

if (process.argv.length >= 3 && process.argv[2] == 'panic')
	mod_panic.panic('panicked on command');

console.log('usage: %s %s panic', process.argv[0], process.argv[1]);
