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
 * smartos-live: Build Tools: String Set data structure backed by libavl.
 */


#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>
#include <sys/avl.h>

#include "common.h"
#include "strset.h"

typedef struct strset_node strset_node_t;

struct strset {
	avl_tree_t ss_strings;
	strset_flags_t ss_flags;
	int ss_walking;
};

struct strset_node {
	const char *ssn_string;
	avl_node_t ssn_node;
};

static int
strset_comparator(const void *lp, const void *rp)
{
	const strset_node_t *lssn = lp;
	const strset_node_t *rssn = rp;
	int cmp;

	VERIFY3P(lssn->ssn_string, !=, NULL);
	VERIFY3P(rssn->ssn_string, !=, NULL);

	cmp = strcmp(lssn->ssn_string, rssn->ssn_string);

	return (cmp < 0 ? -1 : cmp > 0 ? 1 : 0);
}

int
strset_alloc(strset_t **ssp, strset_flags_t flags)
{
	strset_t *ss;

	if ((flags & ~STRSET_FLAGS_ALL) != 0) {
		errno = EINVAL;
		return (-1);
	}

	if ((ss = calloc(1, sizeof (strset_t))) == NULL) {
		return (-1);
	}

	ss->ss_flags = flags;
	avl_create(&ss->ss_strings, strset_comparator,
	    sizeof (strset_node_t), offsetof(strset_node_t, ssn_node));

	*ssp = ss;
	return (0);
}

static int
strset_node_alloc(strset_node_t **ssnp, const char *str)
{
	strset_node_t *ssn = NULL;


	VERIFY(str != NULL);

	if ((ssn = calloc(1, sizeof (strset_node_t))) == NULL ||
	    (ssn->ssn_string = strdup(str)) == NULL) {
		free(ssn);
		return (-1);
	}

	*ssnp = ssn;
	return (0);
}

static void
strset_node_free(strset_node_t *ssn)
{
	if (ssn == NULL) {
		return;
	}

	VERIFY(ssn->ssn_string != NULL);
	free((void *)ssn->ssn_string);
	free(ssn);
}

void
strset_reset(strset_t *ss)
{
	strset_node_t *ssn;
	void *cookie = NULL;

	VERIFY(ss->ss_walking == 0);

	while ((ssn = avl_destroy_nodes(&ss->ss_strings, &cookie)) != NULL) {
		strset_node_free(ssn);
	}

	VERIFY(avl_is_empty(&ss->ss_strings));
}

void
strset_free(strset_t *ss)
{
	if (ss == NULL) {
		return;
	}

	VERIFY(ss->ss_walking == 0);

	/*
	 * Remove all of the strings in the tree before we free the tree
	 * itself.
	 */
	strset_reset(ss);

	avl_destroy(&ss->ss_strings);
	free(ss);
}

int
strset_remove(strset_t *ss, const char *torm)
{
	strset_node_t srch;
	strset_node_t *ssn;

	VERIFY(ss->ss_walking == 0);

	VERIFY((srch.ssn_string = torm) != NULL);
	if ((ssn = avl_find(&ss->ss_strings, &srch, NULL)) == NULL) {
		/*
		 * The string is not in the set already.
		 */
		if (ss->ss_flags & STRSET_IGNORE_MISSING) {
			return (0);
		}

		errno = ENOENT;
		return (-1);
	}

	avl_remove(&ss->ss_strings, ssn);
	strset_node_free(ssn);

	return (0);
}

int
strset_add(strset_t *ss, const char *str)
{
	strset_node_t *ssn = NULL;
	avl_index_t where;
	strset_node_t srch;

	VERIFY((srch.ssn_string = str) != NULL);

	/*
	 * Check to see if the string is in the set already:
	 */
	if (avl_find(&ss->ss_strings, &srch, &where) != NULL) {
		if (ss->ss_flags & STRSET_IGNORE_DUPLICATES) {
			return (0);
		}

		errno = EEXIST;
		return (-1);
	}

	if (strset_node_alloc(&ssn, str) != 0) {
		return (-1);
	}

	avl_insert(&ss->ss_strings, ssn, where);

	return (0);
}

boolean_t
strset_contains(strset_t *ss, const char *search)
{
	strset_node_t srch;

	VERIFY((srch.ssn_string = search) != NULL);

	if (avl_find(&ss->ss_strings, &srch, NULL) == NULL) {
		return (B_FALSE);
	}

	return (B_TRUE);
}

int
strset_count(strset_t *ss)
{
	return (avl_numnodes(&ss->ss_strings));
}

int
strset_walk(strset_t *ss, strset_walk_func *walk_cb, void *arg0, void *arg1)
{
	int error = 0;
	strset_node_t *cur, *next = NULL;

	ss->ss_walking++;

	for (cur = avl_first(&ss->ss_strings); cur != NULL; cur = next) {
		strset_walk_t ret;

		/*
		 * Call the walk callback:
		 */
		ret = walk_cb(ss, cur->ssn_string, arg0, arg1);

		/*
		 * Get the next string in the walk before, if requested,
		 * removing the current string:
		 */
		next = AVL_NEXT(&ss->ss_strings, cur);
		if (ret & STRSET_WALK_REMOVE) {
			avl_remove(&ss->ss_strings, cur);
			strset_node_free(cur);
		}

		/*
		 * Take action, depending on what the walk callback requested
		 * we do next:
		 */
		switch (STRSET_WALK_WHATNEXT(ret)) {
		case STRSET_WALK_NEXT:
			break;

		case STRSET_WALK_DONE:
			goto out;

		case STRSET_WALK_CANCEL:
			error = ECANCELED;
			goto out;

		default:
			abort();
		}
	}

out:
	ss->ss_walking--;

	errno = error;
	return (error == 0 ? 0 : -1);
}
