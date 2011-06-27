/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License (the "License").
 * You may not use this file except in compliance with the License.
 *
 * You can obtain a copy of the license at usr/src/OPENSOLARIS.LICENSE
 * or http://www.opensolaris.org/os/licensing.
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file and include the License file at usr/src/OPENSOLARIS.LICENSE.
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 */

/*
	Copyright 10/08/99 Sun Microsystems, Inc. All Rights Reserved

	@(#)demangle.h	1.4 10/08/99 12:00:49
*/

#ifndef _DEMANGLE_H
#define _DEMANGLE_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifdef __STDC__

int demangle( const char *symbol, char *interpretation );
/*
   WARNING: the function demangle() is obsolete; use cplus_demangle().
   Return 0 if symbol is a valid mangled name.
   Return -1 if symbol is not a valid mangled name.
*/

int cplus_demangle( const char *symbol, char *interpretation, size_t size );
/*
   Return DEMANGLE_ESPACE if the interpretation buffer is too small.
   Return DEMANGLE_ENAME if the symbol is either not mangled,
                         or incorrectly mangled.
   Return 0 if both the symbol is a valid mangled name
            and there is sufficient space in the interpretation buffer.
*/

int cplus_demangle_noret( const char *symbol, char *prototype, size_t size );
/*
   The cplus_demangle_noret function is the same as cplus_demangle
   except that function symbol return types are not printed.
*/

#else

int demangle();
int cplus_demangle();
int cplus_demangle_noret();

#endif

#define DEMANGLE_ESPACE  -1  /* the interpretation buffer is too small */
#define DEMANGLE_ENAME   1   /* the symbol is either not mangled
                                or not mangled properly */

#ifdef __cplusplus
}
#endif

#endif  /* _DEMANGLE_H */
