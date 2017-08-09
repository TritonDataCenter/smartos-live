/*
 * vasync.js: utilities for observable asynchronous control flow
 */

var mod_assert = require('assert');
var mod_events = require('events');
var mod_util = require('util');
var mod_verror = require('verror');

/*
 * Public interface
 */
exports.parallel = parallel;
exports.forEachParallel = forEachParallel;
exports.pipeline = pipeline;
exports.tryEach = tryEach;
exports.forEachPipeline = forEachPipeline;
exports.filter = filter;
exports.filterLimit = filterLimit;
exports.filterSeries = filterSeries;
exports.queue = queue;
exports.queuev = queuev;
exports.barrier = barrier;
exports.waterfall = waterfall;

if (!global.setImmediate) {
	global.setImmediate = function (func) {
		var args = Array.prototype.slice.call(arguments, 1);
		args.unshift(0);
		args.unshift(func);
		setTimeout.apply(this, args);
	};
}

/*
 * This is incorporated here from jsprim because jsprim ends up pulling in a lot
 * of dependencies.  If we end up needing more from jsprim, though, we should
 * add it back and rip out this function.
 */
function isEmpty(obj)
{
	var key;
	for (key in obj)
		return (false);
	return (true);
}

/*
 * Given a set of functions that complete asynchronously using the standard
 * callback(err, result) pattern, invoke them all and merge the results.  See
 * README.md for details.
 */
function parallel(args, callback)
{
	var funcs, rv, doneOne, i;

	mod_assert.equal(typeof (args), 'object', '"args" must be an object');
	mod_assert.ok(Array.isArray(args['funcs']),
	    '"args.funcs" must be specified and must be an array');
	mod_assert.equal(typeof (callback), 'function',
	    'callback argument must be specified and must be a function');

	funcs = args['funcs'].slice(0);

	rv = {
	    'operations': new Array(funcs.length),
	    'successes': [],
	    'ndone': 0,
	    'nerrors': 0
	};

	if (funcs.length === 0) {
		setImmediate(function () { callback(null, rv); });
		return (rv);
	}

	doneOne = function (entry) {
		return (function (err, result) {
			mod_assert.equal(entry['status'], 'pending');

			entry['err'] = err;
			entry['result'] = result;
			entry['status'] = err ? 'fail' : 'ok';

			if (err)
				rv['nerrors']++;
			else
				rv['successes'].push(result);

			if (++rv['ndone'] < funcs.length)
				return;

			var errors = rv['operations'].filter(function (ent) {
				return (ent['status'] == 'fail');
			}).map(function (ent) { return (ent['err']); });

			if (errors.length > 0)
				callback(new mod_verror.MultiError(errors), rv);
			else
				callback(null, rv);
		});
	};

	for (i = 0; i < funcs.length; i++) {
		rv['operations'][i] = {
			'func': funcs[i],
			'funcname': funcs[i].name || '(anon)',
			'status': 'pending'
		};

		funcs[i](doneOne(rv['operations'][i]));
	}

	return (rv);
}

/*
 * Exactly like parallel, except that the input is specified as a single
 * function to invoke on N different inputs (rather than N functions).  "args"
 * must have the following fields:
 *
 *	func		asynchronous function to invoke on each input value
 *
 *	inputs		array of input values
 */
function forEachParallel(args, callback)
{
	var func, funcs;

	mod_assert.equal(typeof (args), 'object', '"args" must be an object');
	mod_assert.equal(typeof (args['func']), 'function',
	    '"args.func" must be specified and must be a function');
	mod_assert.ok(Array.isArray(args['inputs']),
	    '"args.inputs" must be specified and must be an array');

	func = args['func'];
	funcs = args['inputs'].map(function (input) {
		return (function (subcallback) {
			return (func(input, subcallback));
		});
	});

	return (parallel({ 'funcs': funcs }, callback));
}

/*
 * Like parallel, but invokes functions in sequence rather than in parallel
 * and aborts if any function exits with failure.  Arguments include:
 *
 *    funcs	invoke the functions in parallel
 *
 *    arg	first argument to each pipeline function
 */
function pipeline(args, callback)
{
	mod_assert.equal(typeof (args), 'object', '"args" must be an object');
	mod_assert.ok(Array.isArray(args['funcs']),
	    '"args.funcs" must be specified and must be an array');

	var opts = {
	    'funcs': args['funcs'].slice(0),
	    'callback': callback,
	    'args': { impl: 'pipeline', uarg: args['arg'] },
	    'stop_when': 'error',
	    'res_type': 'values'
	};
	return (waterfall_impl(opts));
}

function tryEach(funcs, callback)
{
	mod_assert.ok(Array.isArray(funcs),
	    '"funcs" must be specified and must be an array');
	mod_assert.ok(arguments.length == 1 || typeof (callback) == 'function',
	    '"callback" must be a function');
	var opts = {
	    'funcs': funcs.slice(0),
	    'callback': callback,
	    'args': { impl: 'tryEach' },
	    'stop_when': 'success',
	    'res_type': 'array'
	};
	return (waterfall_impl(opts));
}

/*
 * Exactly like pipeline, except that the input is specified as a single
 * function to invoke on N different inputs (rather than N functions).  "args"
 * must have the following fields:
 *
 *	func		asynchronous function to invoke on each input value
 *
 *	inputs		array of input values
 */
function forEachPipeline(args, callback) {
	mod_assert.equal(typeof (args), 'object', '"args" must be an object');
	mod_assert.equal(typeof (args['func']), 'function',
	    '"args.func" must be specified and must be a function');
	mod_assert.ok(Array.isArray(args['inputs']),
	    '"args.inputs" must be specified and must be an array');
	mod_assert.equal(typeof (callback), 'function',
	    'callback argument must be specified and must be a function');

	var func = args['func'];

	var funcs = args['inputs'].map(function (input) {
		return (function (_, subcallback) {
				return (func(input, subcallback));
			});
	});

	return (pipeline({'funcs': funcs}, callback));
}

/*
 * async.js compatible filter, filterLimit, and filterSeries.  Takes an input
 * array, optionally a limit, and a single function to filter an array and will
 * callback with a new filtered array. This is effectively an asynchronous
 * version of Array.prototype.filter.
 */
function filter(inputs, filterFunc, callback) {
	return (filterLimit(inputs, Infinity, filterFunc, callback));
}

function filterSeries(inputs, filterFunc, callback) {
	return (filterLimit(inputs, 1, filterFunc, callback));
}

function filterLimit(inputs, limit, filterFunc, callback) {
	mod_assert.ok(Array.isArray(inputs),
	    '"inputs" must be specified and must be an array');
	mod_assert.equal(typeof (limit), 'number',
	    '"limit" must be a number');
	mod_assert.equal(isNaN(limit), false,
	    '"limit" must be a number');
	mod_assert.equal(typeof (filterFunc), 'function',
	    '"filterFunc" must be specified and must be a function');
	mod_assert.equal(typeof (callback), 'function',
	    '"callback" argument must be specified as a function');

	var errors = [];
	var q = queue(processInput, limit);
	var results = [];

	function processInput(input, cb) {
		/*
		 * If the errors array has any members, an error was
		 * encountered in a previous invocation of filterFunc, so all
		 * future filtering will be skipped.
		 */
		if (errors.length > 0) {
			cb();
			return;
		}

		filterFunc(input.elem, function inputFiltered(err, ans) {
			/*
			 * We ensure here that a filterFunc callback is only
			 * ever invoked once.
			 */
			if (results.hasOwnProperty(input.idx)) {
				throw (new mod_verror.VError(
				    'vasync.filter*: filterFunc idx %d ' +
				    'invoked its callback twice', input.idx));
			}

			/*
			 * The original element, as well as the answer "ans"
			 * (truth value) is stored to later be filtered when
			 * all outstanding jobs are finished.
			 */
			results[input.idx] = {
				elem: input.elem,
				ans: !!ans
			};

			/*
			 * Any error encountered while filtering will result in
			 * all future operations being skipped, and the error
			 * object being returned in the users callback.
			 */
			if (err) {
				errors.push(err);
				cb();
				return;
			}

			cb();
		});
	}

	q.once('end', function queueDrained() {
		if (errors.length > 0) {
			callback(mod_verror.errorFromList(errors));
			return;
		}

		/*
		 * results is now an array of objects in the same order of the
		 * inputs array, where each object looks like:
		 *
		 * {
		 *     "ans": <true|false>,
		 *     "elem": <original input element>
		 * }
		 *
		 * we filter out elements that have a false "ans" value, and
		 * then map the array to contain only the input elements.
		 */
		results = results.filter(function filterFalseInputs(input) {
			return (input.ans);
		}).map(function mapInputElements(input) {
			return (input.elem);
		});
		callback(null, results);
	});

	inputs.forEach(function iterateInput(elem, idx) {
		/*
		 * We retain the array index to ensure that order is
		 * maintained.
		 */
		q.push({
			elem: elem,
			idx: idx
		});
	});

	q.close();

	return (q);
}

/*
 * async-compatible "queue" function.
 */
function queue(worker, concurrency)
{
	return (new WorkQueue({
	    'worker': worker,
	    'concurrency': concurrency
	}));
}

function queuev(args)
{
	return (new WorkQueue(args));
}

function WorkQueue(args)
{
	mod_assert.ok(args.hasOwnProperty('worker'));
	mod_assert.equal(typeof (args['worker']), 'function');
	mod_assert.ok(args.hasOwnProperty('concurrency'));
	mod_assert.equal(typeof (args['concurrency']), 'number');
	mod_assert.equal(Math.floor(args['concurrency']), args['concurrency']);
	mod_assert.ok(args['concurrency'] > 0);

	mod_events.EventEmitter.call(this);

	this.nextid = 0;
	this.worker = args['worker'];
	this.worker_name = args['worker'].name || 'anon';
	this.npending = 0;
	this.pending = {};
	this.queued = [];
	this.closed = false;
	this.ended = false;

	/* user-settable fields inherited from "async" interface */
	this.concurrency = args['concurrency'];
	this.saturated = undefined;
	this.empty = undefined;
	this.drain = undefined;
}

mod_util.inherits(WorkQueue, mod_events.EventEmitter);

WorkQueue.prototype.push = function (tasks, callback)
{
	if (!Array.isArray(tasks))
		return (this.pushOne(tasks, callback));

	var wq = this;
	return (tasks.map(function (task) {
	    return (wq.pushOne(task, callback));
	}));
};

WorkQueue.prototype.updateConcurrency = function (concurrency)
{
	if (this.closed)
		throw new mod_verror.VError(
			'update concurrency invoked after queue closed');
	this.concurrency = concurrency;
	this.dispatchNext();
};

WorkQueue.prototype.close = function ()
{
	var wq = this;

	if (wq.closed)
		return;
	wq.closed = true;

	/*
	 * If the queue is already empty, just fire the "end" event on the
	 * next tick.
	 */
	if (wq.npending === 0 && wq.queued.length === 0) {
		setImmediate(function () {
			if (!wq.ended) {
				wq.ended = true;
				wq.emit('end');
			}
		});
	}
};

/* private */
WorkQueue.prototype.pushOne = function (task, callback)
{
	if (this.closed)
		throw new mod_verror.VError('push invoked after queue closed');

	var id = ++this.nextid;
	var entry = { 'id': id, 'task': task, 'callback': callback };

	this.queued.push(entry);
	this.dispatchNext();

	return (id);
};

/* private */
WorkQueue.prototype.dispatchNext = function ()
{
	var wq = this;
	if (wq.npending === 0 && wq.queued.length === 0) {
		if (wq.drain)
			wq.drain();
		wq.emit('drain');
		/*
		 * The queue is closed; emit the final "end"
		 * event before we come to rest:
		 */
		if (wq.closed) {
			wq.ended = true;
			wq.emit('end');
		}
	} else if (wq.queued.length > 0) {
		while (wq.queued.length > 0 && wq.npending < wq.concurrency) {
			var next = wq.queued.shift();
			wq.dispatch(next);

			if (wq.queued.length === 0) {
				if (wq.empty)
					wq.empty();
				wq.emit('empty');
			}
		}
	}
};

WorkQueue.prototype.dispatch = function (entry)
{
	var wq = this;

	mod_assert.ok(!this.pending.hasOwnProperty(entry['id']));
	mod_assert.ok(this.npending < this.concurrency);
	mod_assert.ok(!this.ended);

	this.npending++;
	this.pending[entry['id']] = entry;

	if (this.npending === this.concurrency) {
		if (this.saturated)
			this.saturated();
		this.emit('saturated');
	}

	/*
	 * We invoke the worker function on the next tick so that callers can
	 * always assume that the callback is NOT invoked during the call to
	 * push() even if the queue is not at capacity.  It also avoids O(n)
	 * stack usage when used with synchronous worker functions.
	 */
	setImmediate(function () {
		wq.worker(entry['task'], function (err) {
			--wq.npending;
			delete (wq.pending[entry['id']]);

			if (entry['callback'])
				entry['callback'].apply(null, arguments);

			wq.dispatchNext();
		});
	});
};

WorkQueue.prototype.length = function ()
{
	return (this.queued.length);
};

WorkQueue.prototype.kill = function ()
{
	this.killed = true;
	this.queued = [];
	this.drain = undefined;
	this.close();
};

/*
 * Barriers coordinate multiple concurrent operations.
 */
function barrier(args)
{
	return (new Barrier(args));
}

function Barrier(args)
{
	mod_assert.ok(!args || !args['nrecent'] ||
	    typeof (args['nrecent']) == 'number',
	    '"nrecent" must have type "number"');

	mod_events.EventEmitter.call(this);

	var nrecent = args && args['nrecent'] ? args['nrecent'] : 10;

	if (nrecent > 0) {
		this.nrecent = nrecent;
		this.recent = [];
	}

	this.pending = {};
	this.scheduled = false;
}

mod_util.inherits(Barrier, mod_events.EventEmitter);

Barrier.prototype.start = function (name)
{
	mod_assert.ok(!this.pending.hasOwnProperty(name),
	    'operation "' + name + '" is already pending');
	this.pending[name] = Date.now();
};

Barrier.prototype.done = function (name)
{
	mod_assert.ok(this.pending.hasOwnProperty(name),
	    'operation "' + name + '" is not pending');

	if (this.recent) {
		this.recent.push({
		    'name': name,
		    'start': this.pending[name],
		    'done': Date.now()
		});

		if (this.recent.length > this.nrecent)
			this.recent.shift();
	}

	delete (this.pending[name]);

	/*
	 * If we executed at least one operation and we're now empty, we should
	 * emit "drain".  But most code doesn't deal well with events being
	 * processed while they're executing, so we actually schedule this event
	 * for the next tick.
	 *
	 * We use the "scheduled" flag to avoid emitting multiple "drain" events
	 * on consecutive ticks if the user starts and ends another task during
	 * this tick.
	 */
	if (!isEmpty(this.pending) || this.scheduled)
		return;

	this.scheduled = true;

	var self = this;

	setImmediate(function () {
		self.scheduled = false;

		/*
		 * It's also possible that the user has started another task on
		 * the previous tick, in which case we really shouldn't emit
		 * "drain".
		 */
		if (isEmpty(self.pending))
			self.emit('drain');
	});
};

/*
 * waterfall([ funcs ], callback): invoke each of the asynchronous functions
 * "funcs" in series.  Each function is passed any values emitted by the
 * previous function (none for the first function), followed by the callback to
 * invoke upon completion.  This callback must be invoked exactly once,
 * regardless of success or failure.  As conventional in Node, the first
 * argument to the callback indicates an error (if non-null).  Subsequent
 * arguments are passed to the next function in the "funcs" chain.
 *
 * If any function fails (i.e., calls its callback with an Error), then the
 * remaining functions are not invoked and "callback" is invoked with the error.
 *
 * The only difference between waterfall() and pipeline() are the arguments
 * passed to each function in the chain.  pipeline() always passes the same
 * argument followed by the callback, while waterfall() passes whatever values
 * were emitted by the previous function followed by the callback.
 */
function waterfall(funcs, callback)
{
	mod_assert.ok(Array.isArray(funcs),
	    '"funcs" must be specified and must be an array');
	mod_assert.ok(arguments.length == 1 || typeof (callback) == 'function',
	    '"callback" must be a function');
	var opts = {
	    'funcs': funcs.slice(0),
	    'callback': callback,
	    'args': { impl: 'waterfall' },
	    'stop_when': 'error',
	    'res_type': 'values'
	};
	return (waterfall_impl(opts));
}

function waterfall_impl(opts)
{
	mod_assert.ok(typeof (opts) === 'object');
	var rv, current, next;
	var funcs = opts.funcs;
	var callback = opts.callback;

	mod_assert.ok(Array.isArray(funcs),
	    '"opts.funcs" must be specified and must be an array');
	mod_assert.ok(arguments.length == 1,
	    'Function "waterfall_impl" must take only 1 arg');
	mod_assert.ok(opts.res_type === 'values' ||
	    opts.res_type === 'array',
	    '"opts.res_type" must either be "value" or "array"');
	mod_assert.ok(opts.stop_when === 'error' ||
	    opts.stop_when === 'success',
	    '"opts.stop_when" must either be "error" or "success"');
	mod_assert.ok(opts.args.impl === 'pipeline' ||
	    opts.args.impl === 'waterfall' || opts.args.impl === 'tryEach',
	    '"opts.args.impl" must be "pipeline", "waterfall", or "tryEach"');
	if (opts.args.impl === 'pipeline') {
		mod_assert.ok(typeof (opts.args.uarg) !== undefined,
		    '"opts.args.uarg" should be defined when pipeline is used');
	}

	rv = {
	    'operations': funcs.map(function (func) {
	        return ({
		    'func': func,
		    'funcname': func.name || '(anon)',
		    'status': 'waiting'
		});
	    }),
	    'successes': [],
	    'ndone': 0,
	    'nerrors': 0
	};

	if (funcs.length === 0) {
		if (callback)
			setImmediate(function () {
				var res = (opts.args.impl === 'pipeline') ? rv
				    : undefined;
				callback(null, res);
			});
		return (rv);
	}

	next = function (idx, err) {
		var res_key, args, entry, nextentry;

		if (err === undefined)
			err = null;

		if (idx != current) {
			throw (new mod_verror.VError(
			    'vasync.waterfall: function %d ("%s") invoked ' +
			    'its callback twice', idx,
			    rv['operations'][idx].funcname));
		}

		mod_assert.equal(idx, rv['ndone'],
		    'idx should be equal to ndone');
		entry = rv['operations'][rv['ndone']++];
		if (opts.args.impl === 'tryEach' ||
		    opts.args.impl === 'waterfall') {
			args = Array.prototype.slice.call(arguments, 2);
			res_key = 'results';
		} else if (opts.args.impl === 'pipeline') {
			args = [ opts.args.uarg ];
			res_key = 'result';
		}

		mod_assert.equal(entry['status'], 'pending',
		    'status should be pending');
		entry['status'] = err ? 'fail' : 'ok';
		entry['err'] = err;
		entry[res_key] = args;

		if (err)
			rv['nerrors']++;
		else
			rv['successes'].push(args);

		if ((opts.stop_when === 'error' && err) ||
		    (opts.stop_when === 'success' &&
		    rv['successes'].length > 0) ||
		    rv['ndone'] == funcs.length) {
			if (callback) {
				if (opts.res_type === 'values' ||
				    (opts.res_type === 'array' &&
				     args.length <= 1)) {
					args.unshift(err);
					callback.apply(null, args);
				} else if (opts.res_type === 'array') {
					callback(err, args);
				}
			}
		} else {
			nextentry = rv['operations'][rv['ndone']];
			nextentry['status'] = 'pending';
			current++;
			args.push(next.bind(null, current));
			setImmediate(function () {
				var nfunc = nextentry['func'];
				/*
				 * At first glance it may seem like this branch
				 * is superflous with the code above that
				 * branches on `opts.args.impl`. It may also
				 * seem like calling `nfunc.apply` is
				 * sufficient for both cases (after all we
				 * pushed `next.bind(null, current)` to the
				 * `args` array), before we call
				 * `setImmediate()`. However, this is not the
				 * case, because the interface exposed by
				 * tryEach is different from the others. The
				 * others pass argument(s) from task to task.
				 * tryEach passes nothing but a callback
				 * (`next.bind` below). However, the callback
				 * itself _can_ be called with one or more
				 * results, which we collect into `args` using
				 * the aformentioned `opts.args.impl` branch
				 * above, and which we pass to the callback via
				 * the `opts.res_type` branch above (where
				 * res_type is set to 'array').
				 */
				if (opts.args.impl !== 'tryEach') {
					nfunc.apply(null, args);
				} else {
					nfunc(next.bind(null, current));
				}
			});
		}
	};

	rv['operations'][0]['status'] = 'pending';
	current = 0;
	if (opts.args.impl !== 'pipeline') {
		funcs[0](next.bind(null, current));
	} else {
		funcs[0](opts.args.uarg, next.bind(null, current));
	}
	return (rv);
}
