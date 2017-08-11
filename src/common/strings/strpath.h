/*
 * This file and its contents are supplied under the terms of the
 * Common Development and Distribution License ("CDDL"), version 1.0.
 * You may only use this file in accordance with the terms of version
 * 1.0 of the CDDL.
 *
 * A full copy of the text of the CDDL should have accompanied this
 * source.  A copy of the CDDL is also available via the Internet at
 * http://www.illumos.org/license/CDDL.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

#ifndef _STRPATH_H
#define	_STRPATH_H

/*
 * smartos-live: Path manipulation utility functions.
 */

#include "custr.h"

#ifdef __cplusplus
extern "C" {
#endif

extern int strpath_append(custr_t *, const char *);

#ifdef __cplusplus
}
#endif

#endif /* _STRPATH_H */
