/*
 * Copyright (c) 2012 Mathieu Turcotte
 * Licensed under the MIT license.
 */

var events = require('events');
var util = require('util');

var Backoff = require('./backoff');
var FibonacciBackoffStrategy = require('./strategy/fibonacci');

/**
 * Returns true if the specified value is a function
 * @param val Variable to test.
 * @return Whether variable is a function.
 */
function isFunction(val) {
    return typeof val == 'function';
}

/**
 * Manages the calling of a function in a backoff loop.
 * @param fn Function to wrap in a backoff handler.
 * @param args Array of function's arguments.
 * @param callback Function's callback.
 * @constructor
 */
function FunctionCall(fn, args, callback) {
    events.EventEmitter.call(this);

    if (!isFunction(fn)) {
        throw new Error('fn should be a function.' +
                        'Actual: ' + typeof fn);
    }

    if (!isFunction(callback)) {
        throw new Error('callback should be a function.' +
                        'Actual: ' + typeof fn);
    }

    this.function_ = fn;
    this.arguments_ = args;
    this.callback_ = callback;
    this.results_ = [];

    this.backoff_ = null;
    this.strategy_ = null;

    this.called_ = false;
    this.aborted_ = false;
}
util.inherits(FunctionCall, events.EventEmitter);

/**
 * Creates a backoff instance from the provided strategy; defaults to a
 * Fibonacci backoff strategy if none is provided.
 * @param strategy Optional strategy to use when instantiating the backoff.
 * @return A backoff instance.
 * @private
 */
FunctionCall.backoffFactory_ = function(strategy) {
    return new Backoff(strategy || new FibonacciBackoffStrategy());
};

/**
 * Default number of backoffs.
 * @private
 */
FunctionCall.prototype.failAfter_ = 5;

/**
 * Sets the backoff strategy.
 * @param strategy The backoff strategy to use.
 */
FunctionCall.prototype.setStrategy = function(strategy) {
    if (this.called_) {
        throw new Error('Call in progress.');
    }
    this.strategy_ = strategy;
};

/**
 * Returns all intermediary results returned by the wrapped function since
 * the initial call.
 * @return An array of intermediary results.
 */
FunctionCall.prototype.getResults = function() {
    return this.results_.concat();
};

/**
 * Sets the backoff limit.
 * @param maxNumberOfRetry The maximum number of backoffs.
 */
FunctionCall.prototype.failAfter = function(maxNumberOfRetry) {
    if (this.called_) {
        throw new Error('Call in progress.');
    }
    this.failAfter_ = maxNumberOfRetry;
};

/**
 * Aborts the current call.
 */
FunctionCall.prototype.abort = function() {
    this.aborted_ = true;
    if (this.called_) {
        this.backoff_.reset();
    }
};

/**
 * Initiates the call to the wrapped function.
 * @param backoffFactory Optional factory method used to create the backoff
 *     instance.
 */
FunctionCall.prototype.start = function(backoffFactory) {
    if (this.aborted_) {
        return;
    }

    if (this.called_) {
        throw new Error('Call in progress.');
    }

    backoffFactory = backoffFactory || FunctionCall.backoffFactory_;

    this.backoff_ = backoffFactory(this.strategy_);
    this.backoff_.on('ready', this.doCall_.bind(this));
    this.backoff_.on('fail', this.doCallback_.bind(this));
    this.backoff_.on('backoff', this.handleBackoff_.bind(this));
    this.backoff_.failAfter(this.failAfter_);

    this.called_ = true;
    this.doCall_();
};

/**
 * Calls the wrapped function.
 * @private
 */
FunctionCall.prototype.doCall_ = function() {
    var eventArgs = ['call'].concat(this.arguments_);
    events.EventEmitter.prototype.emit.apply(this, eventArgs);
    var callback = this.handleFunctionCallback_.bind(this);
    this.function_.apply(null, this.arguments_.concat(callback));
};

/**
 * Calls the wrapped function's callback with the last result returned by the
 * wrapped function.
 * @private
 */
FunctionCall.prototype.doCallback_ = function() {
    var args = this.results_[this.results_.length - 1];
    this.callback_.apply(null, args);
};

/**
 * Handles wrapped function's completion. This method acts as a replacement
 * for the original callback function.
 * @private
 */
FunctionCall.prototype.handleFunctionCallback_ = function() {
    if (this.aborted_) {
        return;
    }

    var args = Array.prototype.slice.call(arguments);
    this.results_.push(args); // Save callback arguments.
    events.EventEmitter.prototype.emit.apply(this, ['callback'].concat(args));

    if (args[0]) {
        this.backoff_.backoff();
    } else {
        this.doCallback_();
    }
};

/**
 * Handles backoff event.
 * @param number Backoff number.
 * @param delay Backoff delay.
 * @private
 */
FunctionCall.prototype.handleBackoff_ = function(number, delay) {
    this.emit('backoff', number, delay);
};

module.exports = FunctionCall;
