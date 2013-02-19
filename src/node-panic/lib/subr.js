/*
 * subr.js: common routines
 */

var mod_assert = require('assert');
var mod_sys = require('util');

/*
 * Formats a date using a reasonable format string.
 */
function caFormatDate(now)
{
	return (caSprintf('%4d-%02d-%02d %02d:%02d:%02d.%03d UTC',
	    now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
	    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(),
	    now.getUTCMilliseconds()));
}

/*
 * Removes circular references from "obj".  This modifies the original object.
 */
function caRemoveCircularRefs(obj)
{
	var key, marker, circular;

	marker = 'caRemoveCircular';
	circular = '<circular>';

	if (typeof (obj) != typeof ({}))
		return;

	if (obj === null)
		return;

	mod_assert.ok(!(marker in obj));
	obj[marker] = true;

	/*
	 * The following works for both arrays and general objects.
	 */
	for (key in obj) {
		if (typeof (obj[key]) == typeof ({}) &&
		    obj[key] !== null && obj[key][marker]) {
			obj[key] = circular;
			continue;
		}

		caRemoveCircularRefs(obj[key]);
	}

	delete (obj[marker]);
}

/*
 * caRunStages is given an array "stages" of functions, an initial argument
 * "arg", and a callback "callback".  Each stage represents some task,
 * asynchronous or not, which should be completed before the next stage is
 * started.  Each stage is invoked with the result of the previous stage and can
 * abort this process if it encounters an error.  When all stages have
 * completed, "callback" is invoked with the error and results of the last stage
 * that was run.
 *
 * More precisely: the first function of "stages" may be invoked during
 * caRunStages or immediately after (asynchronously).  Each stage is invoked as
 * stage(arg, callback), where "arg" is the result of the previous stage (or
 * the "arg" specified to caRunStages, for the first stage) and "callback"
 * should be invoked when the stage is complete.  "callback" should be invoked
 * as callback(err, result), where "err" is a non-null instance of Error iff an
 * error was encountered and null otherwise, and "result" is an arbitrary object
 * to be passed to the next stage.  The "callback" given to caRunStages is
 * invoked after the last stage has been run with the arguments given to that
 * stage's completion callback.
 */
function caRunStages(stages, arg, callback)
{
	var stage, next;

	next = function (err, result) {
		var nextfunc;

		if (err)
			return (callback(err, result));

		nextfunc = stages[stage++];
		if (!nextfunc)
			return (callback(null, result));

		return (nextfunc(result, next));
	};

	stage = 0;
	next(null, arg);
}

/*
 * Stripped down version of s[n]printf(3c).  We make a best effort to throw an
 * exception when given a format string we don't understand, rather than
 * ignoring it, so that we won't break existing programs if/when we go implement
 * the rest of this.
 *
 * This implementation currently supports specifying
 *	- field alignment ('-' flag),
 * 	- zero-pad ('0' flag)
 *	- always show numeric sign ('+' flag),
 *	- field width
 *	- conversions for strings, decimal integers, and floats (numbers).
 *	- argument size specifiers.  These are all accepted but ignored, since
 *	  Javascript has no notion of the physical size of an argument.
 *
 * Everything else is currently unsupported, most notably precision, unsigned
 * numbers, non-decimal numbers, and characters.
 */
function caSprintf(fmt)
{
	var regex = [
	    '([^%]*)',				/* non-special */
	    '%',				/* start of format */
	    '([\'\\-+ #0]*?)',			/* flags (optional) */
	    '([1-9]\\d*)?',			/* width (optional) */
	    '(\\.([1-9]\\d*))?',		/* precision (optional) */
	    '[lhjztL]*?',			/* length mods (ignored) */
	    '([diouxXfFeEgGaAcCsSp%jr])'	/* conversion */
	].join('');

	var re = new RegExp(regex);
	var args = Array.prototype.slice.call(arguments, 1);
	var flags, width, precision, conversion;
	var left, pad, sign, arg, match;
	var ret = '';
	var argn = 1;

	mod_assert.equal('string', typeof (fmt));

	while ((match = re.exec(fmt)) !== null) {
		ret += match[1];
		fmt = fmt.substring(match[0].length);

		flags = match[2] || '';
		width = match[3] || 0;
		precision = match[4] || '';
		conversion = match[6];
		left = false;
		sign = false;
		pad = ' ';

		if (conversion == '%') {
			ret += '%';
			continue;
		}

		if (args.length === 0)
			throw (new Error('too few args to sprintf'));

		arg = args.shift();
		argn++;

		if (flags.match(/[\' #]/))
			throw (new Error(
			    'unsupported flags: ' + flags));

		if (precision.length > 0)
			throw (new Error(
			    'non-zero precision not supported'));

		if (flags.match(/-/))
			left = true;

		if (flags.match(/0/))
			pad = '0';

		if (flags.match(/\+/))
			sign = true;

		switch (conversion) {
		case 's':
			if (arg === undefined || arg === null)
				throw (new Error('argument ' + argn +
				    ': attempted to print undefined or null ' +
				    'as a string'));
			ret += doPad(pad, width, left, arg);
			break;

		case 'd':
			arg = Math.floor(arg);
			/*jsl:fallthru*/
		case 'f':
			sign = sign && arg > 0 ? '+' : '';
			ret += sign + doPad(pad, width, left,
			    arg.toString());
			break;

		case 'j': /* non-standard */
			if (width === 0)
				width = 10;
			ret += mod_sys.inspect(arg, false, width);
			break;

		case 'r': /* non-standard */
			ret += dumpException(arg);
			break;

		default:
			throw (new Error('unsupported conversion: ' +
			    conversion));
		}
	}

	ret += fmt;
	return (ret);
}

function doPad(chr, width, left, str)
{
	var ret = str;

	while (ret.length < width) {
		if (left)
			ret += chr;
		else
			ret = chr + ret;
	}

	return (ret);
}

function dumpException(ex)
{
	var ret;

	if (!(ex instanceof Error))
		throw (new Error(caSprintf('invalid type for %%r: %j', ex)));

	/*
	 * Note that V8 prepends "ex.stack" with ex.toString().
	 */
	ret = 'EXCEPTION: ' + ex.constructor.name + ': ' + ex.stack;

	if (!ex.cause)
		return (ret);

	for (ex = ex.cause(); ex; ex = ex.cause ? ex.cause() : null)
		ret += '\nCaused by: ' + dumpException(ex);

	return (ret);
}

exports.caFormatDate = caFormatDate;
exports.caRemoveCircularRefs = caRemoveCircularRefs;
exports.caRunStages = caRunStages;
exports.caSprintf = caSprintf;
