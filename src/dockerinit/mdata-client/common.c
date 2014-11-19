/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#include <stdlib.h>
#include <stdio.h>

int
print_and_abort(const char *message, const char *file, int line)
{
	(void) fprintf(stderr, "ASSERT: %s, file: %s @ line %d\n",
	    message, file, line);

	abort();

	return (0);
}
