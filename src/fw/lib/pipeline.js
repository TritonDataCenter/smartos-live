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
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: shared vasync logic
 */

var vasync = require('vasync');



// --- Exports



/**
 * Wraps vasync's pipeline so that each function in the pipeline gets called
 * with (state, cb) as its arguments. state contains the output of previous
 * steps of the pipeline, keyed by function name.
 */
function pipeline(opts, callback) {
  var state = {};
  var funcs = [];

  opts['funcs'].forEach(function (fn, i) {
    funcs.push(function (_, cb) {
      var name = fn.name || 'func' + i;

      fn(state, function (e, r) {
        state[name] = r;
        return cb(e, r);
      });
    });
  });

  vasync.pipeline({
    funcs: funcs
  }, function (err, res) {
    return callback(err, { results: res, state: state });
  });
}



module.exports = {
  pipeline: pipeline
};
