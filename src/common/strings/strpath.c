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

/*
 * smartos-live: Path manipulation utility functions.
 */
#include "custr.h"

/*
 * Append a path string, "inp", to the end of the path string already present
 * in "path".  Ensures that there is a "/" between the existing path, if one is
 * present, and the new path.  Duplicate adjacent "/" characters are elided.
 */
int
strpath_append(custr_t *path, const char *inp)
{
	size_t pathl = custr_len(path);
	unsigned int i = 0;
	unsigned slash_count = 0;

	if (pathl > 0) {
		/*
		 * If the existing path does not end in a slash, we must
		 * append one now.
		 */
		if (custr_cstr(path)[pathl - 1] != '/') {
			if (custr_appendc(path, '/') != 0) {
				return (-1);
			}
		}
	} else {
		/*
		 * If there is no existing path, and the input path is
		 * fully qualified, ensure that the output path is also.
		 */
		if (inp[0] == '/') {
			if (custr_appendc(path, '/') != 0) {
				return (-1);
			}
		}
	}

	/*
	 * Find the first non-slash character in the input path:
	 */
	for (;;) {
		if (inp[i] == '\0') {
			return (0);
		} else if (inp[i] != '/') {
			break;
		}

		i++;
	}

	/*
	 * Append characters from the input path, but do not copy
	 * two slashes in a row or write a trailing slash:
	 */
	for (;;) {
		char c = inp[i++];

		if (c == '\0') {
			return (0);
		}

		if (c == '/') {
			slash_count++;
			continue;
		}

		if (slash_count > 0 && custr_appendc(path, '/') != 0) {
			return (-1);
		}
		slash_count = 0;

		if (custr_appendc(path, c) != 0) {
			return (-1);
		}
	}
}
