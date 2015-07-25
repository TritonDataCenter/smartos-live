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
 * smartos-live: String List with variable element count.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>

#include "strlist.h"

/*
 * Each time we need to add capacity to the array, add this many new elements:
 */
#define	GROW_COUNT	32

/*
 * The capacity of the list is expressed as an unsigned int, but the list
 * itself is backed by a contiguous array of pointers to strings.  The backing
 * array includes one extra element beyond the usable capacity, such that the
 * array is always terminated by a NULL pointer.  This definition accounts for
 * the extra element, as well as the maximum byte length we can allocate and
 * address with a size_t.
 */
#define	MAX_CAPACITY	(SIZE_MAX / sizeof (char *) - 1)


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

	/*
	 * Allocate the list object, and the pointer array for the stored
	 * strings.  We allocate one array element beyond our stated capacity
	 * so that the array is always NULL-terminated.
	 */
	if ((sl = calloc(1, sizeof (strlist_t))) == NULL ||
	    (sl->sl_strings = calloc(capacity + 1, sizeof (char *))) == NULL) {
		free(sl);
		return (-1);
	}
	sl->sl_capacity = capacity;

	*slp = sl;
	return (0);
}

/*
 * Increase the capacity of a strlist_t.
 */
static int
strlist_grow_by(strlist_t *sl, unsigned int grow_by)
{
	char **new_strings = NULL;
	unsigned int old_capacity = sl->sl_capacity;
	unsigned int new_capacity = old_capacity + grow_by;
	/*
	 * The new size must include the extra array element for the NULL
	 * terminator, but the old size does not; a new NULL terminator will be
	 * written into the new object by memset(), rather than copied from the
	 * original.
	 */
	size_t oldsz = old_capacity * sizeof (char *);
	size_t newsz = (1 + new_capacity) * sizeof (char *);

	if (grow_by == 0) {
		return (0);
	}

	/*
	 * Check that the growth size does not cause us to exceed the maximum
	 * possible capacity, with care to avoid integer overflow:
	 */
	if (grow_by > (MAX_CAPACITY - old_capacity)) {
		errno = ENOSPC;
		return (-1);
	}

	if ((new_strings = malloc(newsz)) == NULL) {
		return (-1);
	}

	(void) memcpy(new_strings, sl->sl_strings, oldsz);
	(void) memset(&new_strings[old_capacity], 0, newsz - oldsz);

	free(sl->sl_strings);

	sl->sl_strings = new_strings;
	sl->sl_capacity = new_capacity;

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

	if (idx >= sl->sl_capacity && strlist_grow_by(sl, (idx -
	    sl->sl_capacity + 1) + GROW_COUNT) != 0) {
		return (-1);
	}
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
 * Return the index of the first NULL element.  If there are no NULL elements,
 * the array will be extended to ensure one exists.
 */
int
strlist_first_empty(strlist_t *sl, unsigned int *idx)
{
	unsigned short try = 0;

again:
	VERIFY(try++ < 2);
	for (unsigned int i = 0; i < sl->sl_capacity; i++) {
		if (sl->sl_strings[i] == NULL) {
			*idx = i;
			return (0);
		}
	}

	if (strlist_grow_by(sl, GROW_COUNT) != 0) {
		return (-1);
	}
	goto again;
}

/*
 * Count the number of contiguous non-NULL elements starting from the first
 * element.
 */
unsigned int
strlist_contig_count(strlist_t *sl)
{
	for (unsigned int i = 0; i < sl->sl_capacity; i++) {
		if (sl->sl_strings[i] == NULL) {
			return (i);
		}
	}

	return (sl->sl_capacity);
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
	if (idx >= sl->sl_capacity) {
		return (NULL);
	}

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

	if (idx >= sl->sl_capacity) {
		return (NULL);
	}

	t = sl->sl_strings[idx];
	sl->sl_strings[idx] = NULL;

	return (t);
}

/*
 * Expose the contents of the list as a classical C string array, for use with
 * functions like execve(2), etc.  The array will always be terminated by a
 * NULL pointer.
 */
char *const *
strlist_array(strlist_t *sl)
{
	return (sl->sl_strings);
}
