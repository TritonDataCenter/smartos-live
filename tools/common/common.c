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

/*
 * smartos-live: Build Tools: Common Utilities.
 */


#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/stat.h>

#include "common.h"

boolean_t
is_regular_file(FILE *f)
{
	int fd = fileno(f);
	struct stat st;

	if (fstat(fd, &st) == 0 && S_ISREG(st.st_mode)) {
		return (B_TRUE);
	}

	return (B_FALSE);
}
