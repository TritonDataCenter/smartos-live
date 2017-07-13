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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>

#include "custr.h"
#include "strpath.h"

typedef struct {
	const char *td_left;
	const char *td_right;
	const char *td_expect;
} testdef_t;

static const testdef_t testdefs[] = {
	{ "",					"",
	    "" },
	{ "/",					"b/c/d/",
	    "/b/c/d" },
	{ "////",				"",
	    "/" },
	{ "",					"/",
	    "/" },
	{ "///one//path/",			"/another/path////",
	    "/one/path/another/path" },
	{ "/one/pathnosl",			"another/pathnosl",
	    "/one/pathnosl/another/pathnosl" },
	{ "a/b",				"c/d",
	    "a/b/c/d" },
	{ NULL,					NULL,
	    NULL }
};

int
main(int argc, char *argv[])
{
	custr_t *cu = NULL;

	if (custr_alloc(&cu) != 0) {
		err(1, "strlist_alloc(, 0) failure");
	}

	for (unsigned int i = 0; testdefs[i].td_left != NULL; i++) {
		custr_reset(cu);

		printf("[%2u] left:   \"%s\"\n", i, testdefs[i].td_left);
		printf("[%2u] right:  \"%s\"\n", i, testdefs[i].td_right);
		printf("[%2u] expect: \"%s\"\n", i, testdefs[i].td_expect);

		if (strpath_append(cu, testdefs[i].td_left) != 0) {
			err(1, "failed on left\n");
		}
		if (strpath_append(cu, testdefs[i].td_right) != 0) {
			err(1, "failed on right\n");
		}

		printf("[%2u] actual: \"%s\"\n", i, custr_cstr(cu));
		if (strcmp(custr_cstr(cu), testdefs[i].td_expect) != 0) {
			errx(1, "actual output did not match expected\n");
		}
		printf("\n");
	}

	custr_free(cu);

	return (0);
}
