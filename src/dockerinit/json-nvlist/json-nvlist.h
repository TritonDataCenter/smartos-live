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
 * Copyright (c) 2014, Joyent, Inc.  All rights reserved.
 */

#ifndef	_JSON_NVLIST_H
#define	_JSON_NVLIST_H

#include <libnvpair.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum nvlist_parse_json_flags {
	NVJSON_FORCE_INTEGER = 0x01,
	NVJSON_FORCE_DOUBLE = 0x02,
	NVJSON_ERRORS_TO_STDERR = 0x04
} nvlist_parse_json_flags_t;

extern int nvlist_parse_json(char *, size_t, nvlist_t **,
    nvlist_parse_json_flags_t);

#define	__UNUSED	__attribute__((unused))

#ifdef __cplusplus
}
#endif

#endif	/* _LIBVARPD_FILES_JSON_H */
