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

void
append_string(strlist_t *sl, const char *s)
{
	if (strlist_set_tail(sl, s) != 0) {
		err(1, "strlist_set_tail failure");
	}
}

void
look_at_result(char *const argv[])
{
	unsigned int i = 0;

	for (;;) {
		if (argv[i] == NULL) {
			fprintf(stderr, "[%u] <NULL>\n", i);
			return;
		}

		fprintf(stderr, "[%u] \"%s\"\n", i, argv[i]);
		i++;
	}
}

int
main(int argc, char *argv[])
{
	strlist_t *sl = NULL;

	if (strlist_alloc(&sl, 0) != 0) {
		err(1, "strlist_alloc(, 0) failure");
	}

	fprintf(stderr, "0: capacity now %u\n", strlist_capacity(sl));

	append_string(sl, "alpha");
	append_string(sl, "beta");
	append_string(sl, "gamma");
	append_string(sl, "delta");

	fprintf(stderr, "1: capacity now %u\n", strlist_capacity(sl));

	look_at_result(strlist_array(sl));

	strlist_free(sl);

	return (0);
}
