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

#ifndef _STRSET_H
#define	_STRSET_H

/*
 * smartos-live: Build Tools: String Set data structure backed by libavl.
 */

#ifdef __cplusplus
extern "C" {
#endif

typedef struct strset strset_t;


typedef enum strset_flags {
	/*
	 * Ordinarily, strset_add() fails with EEXIST if a duplicate string
	 * is added to the set.  IGNORE_DUPLICATES makes this a success.
	 */
	STRSET_IGNORE_DUPLICATES = 0x01,
	/*
	 * If strset_remove() is called with a string not present in the set,
	 * ENOENT is returned.  IGNORE_MISSING makes this a success.
	 */
	STRSET_IGNORE_MISSING = 0x02
} strset_flags_t;

#define	STRSET_FLAGS_ALL	(STRSET_IGNORE_DUPLICATES)


typedef enum strset_walk {
	STRSET_WALK_NEXT = 0x00,
	STRSET_WALK_DONE = 0x01,
	STRSET_WALK_CANCEL = 0x02,
	STRSET_WALK_REMOVE = 0x10,
} strset_walk_t;

#define	STRSET_WALK_WHATNEXT(a)	((a) & 0xf)


typedef strset_walk_t strset_walk_func(strset_t *, const char *, void *, void *);


extern int strset_alloc(strset_t **, strset_flags_t);
extern void strset_reset(strset_t *);
extern void strset_free(strset_t *);

extern int strset_add(strset_t *, const char *);
extern int strset_remove(strset_t *, const char *);

extern boolean_t strset_contains(strset_t *, const char *);
extern int strset_count(strset_t *);

extern int strset_walk(strset_t *, strset_walk_func *, void *, void *);

#ifdef __cplusplus
}
#endif

#endif /* _STRSET_H */
