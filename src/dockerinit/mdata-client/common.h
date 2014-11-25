/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#ifndef _COMMON_H
#define	_COMMON_H

#ifdef __cplusplus
extern "C" {
#endif

#ifndef	__HAVE_BOOLEAN_T
typedef enum {
	B_FALSE = 0,
	B_TRUE = 1
} boolean_t;
#endif	/* !__HAVE_BOOLEAN_T */

#define	__UNUSED	__attribute__((unused))

#define	VERIFY(EX)	((void)((EX) || print_and_abort("EX", __FILE__,__LINE__)))
#define	VERIFY0(EX)	((void)((EX) && print_and_abort("EX", __FILE__, __LINE__)))

#define	ABORT(MSG)	print_and_abort((MSG), __FILE__,__LINE__)

int print_and_abort(const char *, const char *, int);

#ifdef __cplusplus
}
#endif

#endif /* _COMMON_H */
