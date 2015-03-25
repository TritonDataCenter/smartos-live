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

#ifndef _USERS_H
#define	_USERS_H

/*
 * builder: Read passwd/group files from proto area.
 */

#ifdef __cplusplus
extern "C" {
#endif

typedef struct builder_ids builder_ids_t;

extern int gid_from_name(builder_ids_t *, const char *, gid_t *);
extern int uid_from_name(builder_ids_t *, const char *, uid_t *);
extern void builder_ids_fini(builder_ids_t *);
extern int builder_ids_init(builder_ids_t **, const char *);

#ifdef __cplusplus
}
#endif

#endif /* _USERS_H */
