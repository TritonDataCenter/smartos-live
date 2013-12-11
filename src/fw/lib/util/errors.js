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
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 *
 * fwadm: errors
 */

var verror = require('verror');



// --- Exports



/**
 * Creates a MultiError from an array of errors, or if there's only one in the
 * list, just returns that error.
 */
function createMultiError(errs) {
    if (errs.length == 1) {
        return errs[0];
    }

    var details = [];
    var err = new verror.MultiError(errs);

    errs.forEach(function (e) {
        if (e.hasOwnProperty('details')) {
            details.push(e.details);
        }
    });

    if (details.length !== 0) {
        err.details = details;
    }

    return err;
}



module.exports = {
    createMultiError: createMultiError
};
