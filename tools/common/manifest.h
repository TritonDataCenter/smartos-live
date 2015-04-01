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

#ifndef _MANIFEST_H
#define	_MANIFEST_H

/*
 * smartos-live: Build Tools: Manifest File Reader.
 */

#ifdef __cplusplus
extern "C" {
#endif

typedef enum manifest_ent_type {
	ME_TYPE_INVALID = 0,
	ME_TYPE_DIRECTORY,
	ME_TYPE_FILE,
	ME_TYPE_HARDLINK,
	ME_TYPE_SYMLINK
} manifest_ent_type_t;

typedef struct manifest_ent {
	manifest_ent_type_t me_type;
	char *me_name;
	char *me_target; /* for links */
	mode_t me_mode;
	char *me_user;
	char *me_group;
} manifest_ent_t;

typedef enum me_cb_ret {
	MECB_NEXT = 0,
	MECB_DONE,
	MECB_CANCEL
} me_cb_ret_t;

typedef me_cb_ret_t manifest_ent_cb_t(manifest_ent_t *, void *);

extern int read_manifest_file(const char *, manifest_ent_cb_t *, void *);
extern void manifest_ent_reset(manifest_ent_t *);

#ifdef __cplusplus
}
#endif

#endif /* _MANIFEST_H */
