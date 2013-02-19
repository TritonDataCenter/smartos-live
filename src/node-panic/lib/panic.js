/*
 * panic.js: postmortem debugging for JavaScript
 *
 * A postmortem debugging facility is critical for root-causing issues that
 * occur in production from the artifacts of a single failure.  Without such a
 * facility, tracking down problems in production becomes a tedious process of
 * adding logging, trying to reproduce the problem, and repeating until enough
 * information is gathered to root-cause the issue.  For reproducible problems,
 * this process is merely painful for developers, administrators, and customers
 * alike.  For unreproducible problems, this is untenable.
 *
 * Like most dynamic environments, JavaScript under Node/V8 has no built-in
 * postmortem debugging facility, so we implement our own here.  The basic idea
 * is to maintain a global object that references all of the internal state we
 * would want for debugging.  Then when our application crashes, we dump this
 * state to a file, and then exit.
 *
 * Note that while the program is panicking, we don't invoke any code inside
 * other components; modules must register objects *before* the panic in order
 * to have them saved during the panic.  This is reasonable because we're only
 * storing references, so consumers can continue modifying their objects after
 * registering them.  This is necessary to minimize the amount of code that must
 * work correctly during the panic.
 */

var mod_fs = require('fs');
var mod_subr = require('./subr');

var caPanicSkipDump = false;
var caPanicAbort = false;

/*
 * Configures the current program to dump saved program state before crashing.
 * The following options may be specified:
 *
 *     abortOnPanic	On panic, uses process.abort() (which is abort(3C)) to
 *     			exit the program.  On some systems, this causes the OS
 *     			to save a core file that can be used to read JavaScript-
 *     			level state.  If process.abort isn't available, SIGABRT
 *     			will be used instead.
 *
 *     skipDump		On panic, skips attempting to dump JavaScript-level
 *     			state in JavaScript.  This is mostly useful if you've
 *     			also set abortOnPanic, in which case you expect to
 *     			extract JavaScript-level state from the OS core dump and
 *     			don't want node-panic to even try to serialize state
 *     			separatley.
 */
function caEnablePanicOnCrash(options)
{
	if (options && options.abortOnPanic)
		caPanicAbort = true;

	if (options && options.skipDump)
		caPanicSkipDump = true;

	process.on('uncaughtException', function (ex) {
	    caPanic('panic due to uncaught exception', ex);
	});
}

/*
 * caPanic is invoked when the program encounters a fatal error to log the error
 * message and optional exception, dump all state previously registered via
 * panicDbg to the file "ncore.<pid>", and then exit the program.  This function
 * is invoked either explicitly by the application or, if caEnablePanicOnCrash
 * has been invoked, automatically when an uncaught exception bubbles back to
 * the event loop.  Since the program has effectively crashed at the point this
 * function is called, we must not allow any other code to run, so we perform
 * all filesystem operations synchronously and then exit immediately with a
 * non-zero exit status.
 */
function caPanic(str, err)
{
	var when, filename, msg;

	if (!err) {
		err = new Error(str);
		str = 'explicit panic';
	}

	try {
		when = new Date();
		filename = 'ncore.' + process.pid;
		msg = caPanicWriteSafeError('PANIC: ' + str, err);

		panicDbg.set('panic.error', msg);
		panicDbg.set('panic.time', when);
		panicDbg.set('panic.time-ms', when.getTime());
		panicDbg.set('panic.memusage', process.memoryUsage());

		/*
		 * If we had child.execSync(), we could get pfiles. :(
		 */

		if (!caPanicSkipDump) {
			caPanicLog('writing core dump to ' + process.cwd() +
			    '/' + filename);
			caPanicSave(filename);
			caPanicLog('finished writing core dump');
		}
	} catch (ex) {
		caPanicWriteSafeError('error during panic', ex);
	}

	if (!caPanicAbort)
		process.exit(1);

	if (process.abort)
		process.abort();

	for (;;)
		process.kill(process.pid, 'SIGABRT');
}

/*
 * Log the given message and error without throwing an exception.
 */
function caPanicWriteSafeError(msg, err)
{
	var errstr;

	try {
		errstr = mod_subr.caSprintf('%r', err);
	} catch (ex) {
		errstr = (err && err.message && err.stack) ?
		    err.message + '\n' + err.stack : '<unknown error>';
	}

	caPanicLog(msg + ': ' + errstr);
	return (errstr);
}

/*
 * Log the given raw message without throwing an exception.
 */
function caPanicLog(msg)
{
	process.stderr.write('[' + mod_subr.caFormatDate(new Date()) + ']' +
	    ' CRIT   ' + msg + '\n');
}

/*
 * Saves panicDbg state to the named file.
 */
function caPanicSave(filename)
{
	var dump = panicDbg.dump();
	mod_fs.writeFileSync(filename, dump);
}

/*
 * Since we want all components to be able to save debugging state without
 * having to pass context pointers around everywhere, we supply a global object
 * called panicDbg to which program state can be attached via the following
 * methods:
 *
 * 	set(name, state)	Adds a new debugging key called "name" and
 * 				associates "state" with that key.  If "name" is
 * 				already being used, the previous association is
 * 				replaced with the new one.  This key-value pair
 * 				will be serialized and dumped when the program
 * 				crashes.  Assuming "state" is a reference type,
 * 				the caller can modify this object later and such
 * 				updates will be reflected in the serialized
 * 				state when the program crashes.
 *
 * 	add(name, state)	Like set(name, state), but ensures that the new
 * 				key does not conflict with an existing key by
 * 				adding a unique identifier to it.  Returns the
 * 				actual key that was used for subsequent use in
 * 				"remove".
 *
 * 	remove(name)		Removes an existing association.
 *
 * 	dump()			Returns the serialized debug state.  This should
 * 				NOT be used except by the panic code itself and
 * 				test code since it may modify the debug state.
 */
function caDebugState()
{
	var now = new Date();

	this.cds_state = {};
	this.cds_ids = {};

	this.set('dbg.format-version', '0.1');
	this.set('init.process.argv', process.argv);
	this.set('init.process.pid', process.pid);
	this.set('init.process.cwd', process.cwd());
	this.set('init.process.env', process.env);
	this.set('init.process.version', process.version);
	this.set('init.process.platform', process.platform);
	this.set('init.time', now);
	this.set('init.time-ms', now.getTime());
}

caDebugState.prototype.set = function (name, state)
{
	this.cds_state[name] = state;
};

caDebugState.prototype.add = function (name, state)
{
	var ii;

	if (!this.cds_ids[name])
		this.cds_ids[name] = 1;

	for (ii = this.cds_ids[name]; ; ii++) {
		if (!((name + ii) in this.cds_state))
			break;
	}

	this.cds_ids[name] = ii + 1;
	this.set(name + ii, state);
	return (name + ii);
};

caDebugState.prototype.remove = function (name)
{
	delete (this.cds_state[name]);
};

caDebugState.prototype.dump = function ()
{
	/*
	 * JSON.stringify() does not deal with circular structures, so we have
	 * to explicitly remove such references here.  It would be nice if we
	 * could encode these properly, but we'll need something more
	 * sophisticated than JSON.  We're allowed to stomp on the state
	 * in-memory here because we're only invoked in the crash path.
	 */
	mod_subr.caRemoveCircularRefs(this.cds_state);
	return (JSON.stringify(this.cds_state));
};

/*
 * The public interface for this module is simple:
 *
 *	caPanic(msg, [err])	Dumps all registered debug state and exits the
 *				program.
 *
 *	caEnablePanicOnCrash()	Configures the program to automatically invoke
 *				caPanic when an uncaught exception bubbles back
 *				to the event loop.
 *
 *	[global] panicDbg	Manages state to be dumped when caPanic is
 *				invoked.
 *
 * While global state is traditionally frowned upon in favor of reusable
 * components, the global solution makes more sense for this module since
 * there can be only one application running at a time and no matter how many
 * components it contains there must only be one set of debugging state that
 * gets dumped when the program crashes.
 */
if (!global.panicDbg)
	global.panicDbg = new caDebugState();

/*
 * We expose "caPanic" as a global for the "ncore" tool, which uses the debugger
 * interface to invoke it.
 */
global.caPanic = caPanic;

exports.enablePanicOnCrash = caEnablePanicOnCrash;
exports.panic = caPanic;
exports.caPanicSave = caPanicSave;	/* for testing only */
exports.caDebugState = caDebugState;	/* for testing only */
