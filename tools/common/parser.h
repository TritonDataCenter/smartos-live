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
 * Copyright 2015 Joyent, Inc.
 */

#ifndef _PARSER_H
#define	_PARSER_H

/*
 * smartos-live: Build Tools: String Parsing Utilities.
 */

#include "strlist.h"

#ifdef __cplusplus
extern "C" {
#endif

extern int split_on(const char *, char, strlist_t *);
extern int parse_line(const char *, strlist_t *);

#ifdef __cplusplus
}
#endif

#endif /* _PARSER_H */
