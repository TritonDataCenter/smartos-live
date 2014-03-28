/*
 * Copyright (c) 2014 Joyent, Inc.  All rights reserved.
 */

#ifndef	_V8PLUS_C_IMPL_H
#define	_V8PLUS_C_IMPL_H

#include <stdarg.h>
#include <libnvpair.h>
#include "v8plus_errno.h"

#ifdef	__cplusplus
extern "C" {
#endif	/* __cplusplus */

#define	V8PLUS_OBJ_TYPE_MEMBER	".__v8plus_type"
#define	V8PLUS_JSF_COOKIE	".__v8plus_jsfunc_cookie"

#define	V8PLUS_STRINGIFY_HELPER(_x)	#_x
#define	V8PLUS_STRINGIFY(_x)	V8PLUS_STRINGIFY_HELPER(_x)

extern __thread nv_alloc_t _v8plus_nva;
extern __thread char _v8plus_exception_buf[1024];
extern __thread nvlist_t *_v8plus_pending_exception;

/*
 * Private methods.
 */
extern void v8plus_clear_exception(void);
extern boolean_t v8plus_in_event_thread(void);
extern void v8plus_crossthread_init(void);
extern nvlist_t *_v8plus_alloc_exception(void);

#ifdef	__cplusplus
}
#endif	/* __cplusplus */

#endif	/* _V8PLUS_C_IMPL_H */
