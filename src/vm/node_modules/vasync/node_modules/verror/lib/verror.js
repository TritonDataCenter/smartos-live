/*
 * verror.js: richer JavaScript errors
 */

var mod_assert = require('assert');
var mod_util = require('util');

var mod_extsprintf = require('extsprintf');

/*
 * Public interface
 */
exports.VError = VError;
exports.MultiError = MultiError;

/*
 * Like JavaScript's built-in Error class, but supports a "cause" argument and a
 * printf-style message.  The cause argument can be null.
 */
function VError(cause)
{
	var args, tailmsg;

	if (cause instanceof Error) {
		args = Array.prototype.slice.call(arguments, 1);
	} else {
		args = Array.prototype.slice.call(arguments, 0);
		cause = undefined;
	}

	tailmsg = args.length > 0 ?
	    mod_extsprintf.sprintf.apply(null, args) : '';
	this.jse_shortmsg = tailmsg;

	if (cause) {
		mod_assert.ok(cause instanceof Error);
		this.jse_cause = cause;
		this.jse_summary = tailmsg + ': ' + cause.message;
	} else {
		this.jse_summary = tailmsg;
	}

	this.message = this.jse_summary;
	Error.apply(this, [ this.jse_summary ]);

	if (Error.captureStackTrace)
		Error.captureStackTrace(this, arguments.callee);
}

VError.prototype = new Error();
VError.prototype.constructor = VError;
VError.prototype.name = VError;

VError.prototype.toString = function ()
{
	return (this.jse_summary);
};

VError.prototype.cause = function ()
{
	return (this.jse_cause);
};


/*
 * Represents a collection of errors for the purpose of consumers that generally
 * only deal with one error.  Callers can extract the individual errors
 * contained in this object, but may also just treat it as a normal single
 * error, in which case a summary message will be printed.
 */
function MultiError(errors)
{
	mod_assert.ok(errors.length > 0);
	this.ase_errors = errors;

	VError.call(this, errors[0], 'first of %d error%s',
	    errors.length, errors.length == 1 ? '' : 's');
}

mod_util.inherits(MultiError, VError);
