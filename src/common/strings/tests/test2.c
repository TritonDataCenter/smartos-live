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
check_string(strlist_t *sl, unsigned int idx, const char *expect)
{
	const char *x = strlist_get(sl, idx);

	if (expect == NULL) {
		if (x == NULL) {
			return;
		}

		errx(1, "string %u is not NULL, but \"%s\"", idx, x);
	}

	if (strcmp(x, expect) != 0) {
		errx(1, "string %u is not \"%s\", but \"%s\"", idx, expect, x);
	}
}

int
main(int argc, char *argv[])
{
	strlist_t *sl = NULL;
	unsigned int cap;
	unsigned int added = 0;

	if (strlist_alloc(&sl, 0) != 0) {
		err(1, "strlist_alloc(, 0) failure");
	}

	fprintf(stderr, "0: capacity now %u\n", strlist_capacity(sl));

	append_string(sl, "alpha");
	append_string(sl, "beta");
	append_string(sl, "gamma");

	fprintf(stderr, "1: capacity now %u\n", strlist_capacity(sl));

	check_string(sl, 1, "beta");
	check_string(sl, 0, "alpha");
	check_string(sl, 2, "gamma");

	cap = strlist_capacity(sl);
	do {
		append_string(sl, "another string");
		append_string(sl, "another string");
		append_string(sl, "another string");
		added += 3;
	} while (cap == strlist_capacity(sl));

	fprintf(stderr, "1: capacity now %u\n", strlist_capacity(sl));

	check_string(sl, 1, "beta");
	check_string(sl, 0, "alpha");
	check_string(sl, 2, "gamma");

	cap = strlist_capacity(sl);
	do {
		append_string(sl, "third string");
	} while (cap == strlist_capacity(sl));

	for (unsigned int j = 3; j < 3 + added; j++) {
		check_string(sl, j, "another string");
	}

	check_string(sl, 3 + added, "third string");

	strlist_reset(sl);

	check_string(sl, 0, NULL);
	check_string(sl, 1, NULL);
	check_string(sl, 2, NULL);
	check_string(sl, 3, NULL);

	strlist_free(sl);

	return (0);
}
