/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 */

#ifndef _EXAMPLE_H
#define	_EXAMPLE_H

#include <sys/types.h>
#include "v8plus_glue.h"

#ifdef	__cplusplus
extern "C" {
#endif	/* __cplusplus */

typedef struct example {
	uint64_t e_val;
} example_t;

#ifdef	__cplusplus
}
#endif	/* __cplusplus */

#endif	/* _EXAMPLE_H */
