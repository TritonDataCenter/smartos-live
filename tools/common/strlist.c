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
 * smartos-live: Build Tools: String List with fixed element count.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>

#include "common.h"
#include "strlist.h"


struct strlist {
	char **sl_strings;
	unsigned int sl_capacity;
};

/*
 * Allocate a strlist_t.
 */
int
strlist_alloc(strlist_t **slp, unsigned int capacity)
{
	strlist_t *sl = NULL;

	if ((sl = calloc(1, sizeof (strlist_t))) == NULL ||
	    (sl->sl_strings = calloc(capacity, sizeof (char *))) == NULL) {
		free(sl);
		return (-1);
	}
	sl->sl_capacity = capacity;

	*slp = sl;
	return (0);
}

/*
 * Clear all of the elements in a strlist_t.
 */
void
strlist_reset(strlist_t *sl)
{
	/*
	 * Free every string buffer in the list.
	 */
	for (unsigned int i = 0; i < sl->sl_capacity; i++) {
		free(sl->sl_strings[i]);
		sl->sl_strings[i] = NULL;
	}
}

/*
 * Free a strlist_t.
 */
void
strlist_free(strlist_t *sl)
{
	if (sl == NULL) {
		return;
	}

	strlist_reset(sl);
	free(sl->sl_strings);
	free(sl);
}

/*
 * Set, or replace, the string in the element "idx".
 */
int
strlist_set(strlist_t *sl, unsigned int idx, const char *str)
{
	char *t;

	VERIFY(str != NULL);
	VERIFY(idx < sl->sl_capacity);

	if ((t = strdup(str)) == NULL) {
		return (-1);
	}

	/*
	 * Free the old string.
	 */
	free(sl->sl_strings[idx]);
	sl->sl_strings[idx] = t;

	return (0);
}

/*
 * Copy "str" into the first non-NULL element of the array, or fail with ENOSPC
 * if all elements are occupied.
 */
int
strlist_set_tail(strlist_t *sl, const char *str)
{
	unsigned int idx;

	if (strlist_first_empty(sl, &idx) != 0) {
		return (-1);
	}

	return (strlist_set(sl, idx, str));
}

/*
 * Return the index of the first NULL element, or an ENOSPC error if all
 * elements are occupied.
 */
int
strlist_first_empty(strlist_t *sl, unsigned int *idx)
{
	for (unsigned int i = 0; i < sl->sl_capacity; i++) {
		if (sl->sl_strings[i] == NULL) {
			*idx = i;
			return (0);
		}
	}

	errno = ENOSPC;
	return (-1);
}

/*
 * Count the number of contiguous non-NULL elements starting from the first
 * element.
 */
unsigned int
strlist_contig_count(strlist_t *sl)
{
	unsigned int idx;

	if (strlist_first_empty(sl, &idx) != 0) {
		VERIFY(errno == ENOSPC);

		return (sl->sl_capacity);
	}

	return (idx);
}

/*
 * A "strlist_t" can hold a fixed number of string pointers.  This function
 * returns that number.
 */
unsigned int
strlist_capacity(strlist_t *sl)
{
	return (sl->sl_capacity);
}

/*
 * Fetch the string at index "idx", or NULL if no string is stored at that
 * offset.
 */
const char *
strlist_get(strlist_t *sl, unsigned int idx)
{
	VERIFY(idx < sl->sl_capacity);

	return (sl->sl_strings[idx]);
}

/*
 * Return the string from this offset, clearing the pointer.  The storage now
 * belongs to the caller, who must call free(3C) when finished with the string.
 */
char *
strlist_adopt(strlist_t *sl, unsigned int idx)
{
	char *t;

	VERIFY(idx < sl->sl_capacity);

	t = sl->sl_strings[idx];
	sl->sl_strings[idx] = NULL;

	return (t);
}
