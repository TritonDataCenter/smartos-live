/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 */

var Queue = module.exports = function (opts) {
    var self = this;

    if (!opts) {
        opts = {};
    }

    // the set of jobs, indexed by timestamp
    self.jobs = {};

    // the number of jobs currently being worked
    self.working = 0;

    // the number of concurrent jobs
    self.workers = (opts.workers === undefined) ? 1 : opts.workers;

    // lock to prevent workers from running
    self.paused = (opts.paused === undefined) ? false : opts.paused;

    // array of callbacks once we have confirmed pause
    self.pause_callbacks = [];

    // a timestamp
    self.stop_at = undefined;

    // array of callbacks once we have confirmed fast forwarded
    self.ff_callbacks = [];

    self.work = function () {
        var key;
        var job;

        // queue is paused and we're not fast-forwarding
        if (self.paused === true && self.stop_at === undefined) {
            return;
        }

        // no jobs to work
        if (Object.keys(self.jobs).length === 0) {
            return;
        }

        // max concurrency
        if (self.working === self.workers) {
            return;
        }

        // since the keys are a timestamp, sort the keys and return
        // the first item to get the oldest.
        key = Object.keys(self.jobs).sort()[0];

        // we've fast-forwarded
        if (self.stop_at !== undefined) {
            if (key > self.stop_at) {
                return;
            }
        }

        job = self.jobs[key];

        // increment the working count
        self.working++;

        job.work(function () {
            // decrement working count
            self.working--;

            // run the original callback, passing along the arguments
            job.callback.apply(null, arguments);

            // delete the job
            delete (self.jobs)[key];

            // checkPaused if nothing is working
            if (self.working === 0) {
                self.checkPaused();
            }

            // checkFastForwarded if nothing is working
            if (self.working === 0) {
                self.checkFastForwarded();
            }

            process.nextTick(function () {
                self.work();
            });
        });
    };

    self.checkPaused = function () {
        if (self.paused !== true) {
            return;
        }

        if (self.working > 0) {
            // something is still working
            return;
        }

        self.pause_callbacks.forEach(function (cb) {
            cb();
        });
    };

    self.checkFastForwarded = function () {
        if (self.stop_at === undefined) {
            return;
        }

        if (self.working > 0) {
            // something is still working
            return;
        }

        for (var key in self.jobs) {
            if (key < self.stop_at) {
                // something still needs to work
                return;
            }
        }

        self.ff_callbacks.forEach(function (cb) {
            cb();
        });
    };

    return (self);
};

Queue.prototype.enqueue = function (job, callback) {
    var self = this;
    var key;

    if (callback === undefined) {
        callback = function () {};
    }

    key = (new Date()).toISOString();

    self.jobs[key] = {
        work: job,
        callback: callback
    };

    process.nextTick(function () {
        self.work();
    });
};

Queue.prototype.pause = function (callback) {
    var self = this;
    self.paused = true;
    self.pause_callbacks.push(callback);
    self.checkPaused();
};

Queue.prototype.resume = function () {
    var self = this;
    self.paused = false;
    self.stop_at = undefined;
    self.pause_callbacks = [];
    self.ff_callbacks = [];
    self.work();
};

Queue.prototype.fastForward = function (timestamp, callback) {
    var self = this;
    if (self.paused !== true) {
        callback(new Error('cannot fastForward a queue that is not paused'));
        return;
    }

    self.stop_at = timestamp;
    self.ff_callbacks.push(callback);
    self.checkFastForwarded();
};
