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

#ifndef _WRITEFILE_H
#define	_WRITEFILE_H

/*
 * builder: Read passwd/group files from proto area.
 */

#ifdef __cplusplus
extern "C" {
#endif

int builder_copy_file(const char *src, const char *dst);

#ifdef __cplusplus
}
#endif

#endif /* _WRITEFILE_H */
