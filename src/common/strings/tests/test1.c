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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>

#include "strlist.h"

int
main(int argc, char *argv[])
{
	strlist_t *sl = NULL;
	unsigned int cap;

	if (strlist_alloc(&sl, 0) != 0) {
		err(1, "strlist_alloc(, 0) failure");
	}

	if ((cap = strlist_capacity(sl)) != 0) {
		errx(1, "capacity is %u, not zero", cap);
	}

	strlist_free(sl);

	return (0);
}
