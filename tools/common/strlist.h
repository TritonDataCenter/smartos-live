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

#ifndef _STRLIST_H
#define	_STRLIST_H

/*
 * smartos-live: Build Tools: String List with fixed element count.
 */

#ifdef __cplusplus
extern "C" {
#endif

typedef struct strlist strlist_t;


extern int strlist_alloc(strlist_t **, unsigned int);
extern void strlist_reset(strlist_t *);
extern void strlist_free(strlist_t *);

extern int strlist_set(strlist_t *, unsigned int, const char *);
extern int strlist_set_tail(strlist_t *, const char *);

extern const char *strlist_get(strlist_t *, unsigned int);
extern char *strlist_adopt(strlist_t *, unsigned int);

extern int strlist_first_empty(strlist_t *, unsigned int *);
extern unsigned int strlist_contig_count(strlist_t *);
extern unsigned int strlist_capacity(strlist_t *);

#ifdef __cplusplus
}
#endif

#endif /* _STRLIST_H */
