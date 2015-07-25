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


#define	NUM_LISTS	128
#define	NUM_STRINGS	290


void
append_string(strlist_t *sl, const char *s)
{
	if (strlist_set_tail(sl, s) != 0) {
		err(1, "strlist_set_tail failure");
	}
}

int
main(int argc, char *argv[])
{
	strlist_t *sl[NUM_LISTS];

	fprintf(stdout, "alloc...\n");
	for (unsigned int i = 0; i < NUM_LISTS; i++) {
		if (strlist_alloc(&sl[i], 0) != 0) {
			err(1, "[%3u] strlist_alloc(, 0) failure", i);
		}
	}
	fprintf(stdout, "done.\n");

	fprintf(stdout, "first append pass...\n");
	for (unsigned int i = 0; i < NUM_STRINGS; i++) {
		for (unsigned int j = 0; j < NUM_LISTS; j++) {
			append_string(sl[j], "|sample string 0 sample string 1"
			    " sample string 2 sample string 3|");
		}
	}
	fprintf(stdout, "done.\n");

	fprintf(stdout, "reset...\n");
	for (unsigned int i = 0; i < NUM_LISTS; i++) {
		strlist_reset(sl[i]);
	}
	fprintf(stdout, "done.\n");

	fprintf(stdout, "second append pass...\n");
	for (unsigned int i = 0; i < NUM_STRINGS; i++) {
		for (unsigned int j = 0; j < NUM_LISTS; j++) {
			append_string(sl[j], "|sample string 0 sample string 1"
			    " sample string 2 sample string 3|");
		}
	}
	fprintf(stdout, "done.\n");

	fprintf(stdout, "free...\n");
	for (unsigned int i = 0; i < NUM_LISTS; i++) {
		strlist_free(sl[i]);
	}
	fprintf(stdout, "done.\n");

	if (getenv("ABORT_ON_EXIT") != NULL) {
		abort();
	}

	return (0);
}
