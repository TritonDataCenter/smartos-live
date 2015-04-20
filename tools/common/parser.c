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

/*
 * smartos-live: Build Tools: String Parsing Utilities.
 */


#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <err.h>
#include <errno.h>

#include "common.h"
#include "custr.h"
#include "strlist.h"
#include "parser.h"


typedef enum state {
	ST_WHITESPACE = 1,
	ST_TOKEN
} state_t;

typedef enum lextype {
	LEX_ENDL = 1,
	LEX_WHITESPACE,
	LEX_OTHER
} lextype_t;

int
split_on(const char *line, char delim, strlist_t *sl)
{
	custr_t *cu = NULL;
	int error = 0;
	const char *c = line;

	if (custr_alloc(&cu) != 0 || custr_append(cu, "") != 0) {
		error = errno;
		goto out;
	}

	for (;;) {
		char cc = *c++;

		if (cc == '\0') {
			if (custr_len(cu) > 0 && strlist_set_tail(sl,
			    custr_cstr(cu)) != 0) {
				error = errno;
			}
			goto out;
		} else if (cc == delim) {
			if (strlist_set_tail(sl, custr_cstr(cu)) != 0) {
				error = errno;
				goto out;
			}
			custr_reset(cu);
		} else {
			if (custr_appendc(cu, cc) != 0) {
				error = errno;
				goto out;
			}
		}
	}

out:
	custr_free(cu);
	errno = error;
	return (error == 0 ? 0 : -1);
}

int
parse_line(const char *line, strlist_t *sl)
{
	custr_t *cu = NULL;
	state_t state = ST_WHITESPACE;
	const char *c = line;
	int error = 0;

	if (custr_alloc(&cu) != 0 || custr_append(cu, "") != 0) {
		error = errno;
		goto out;
	}

	for (;;) {
		char cc = *c;
		lextype_t lextype;

		/*
		 * Determine which class of character this is:
		 */
		switch (cc) {
		case '\0':
		case '#':
		case '\n':
		case '\r':
			lextype = LEX_ENDL;
			break;

		case ' ':
		case '\t':
			lextype = LEX_WHITESPACE;
			break;

		default:
			lextype = LEX_OTHER;
			break;
		}

		/*
		 * Determine what to do with this character based on the class
		 * and our current state:
		 */
		switch (state) {
		case ST_WHITESPACE: {
			switch (lextype) {
			case LEX_ENDL:
				goto out;

			case LEX_WHITESPACE:
				c++;
				break;

			case LEX_OTHER:
				state = ST_TOKEN;
				break;

			default:
				(void) printf("ST_WHITESPACE: unknown "
				    "lextype: %d\n", lextype);
				abort();
			}
			break;
		}

		case ST_TOKEN: {
			switch (lextype) {
			case LEX_ENDL:
				if (strlist_set_tail(sl, custr_cstr(cu)) != 0) {
					error = errno;
					goto out;
				}
				goto out;

			case LEX_WHITESPACE:
				if (strlist_set_tail(sl, custr_cstr(cu)) != 0) {
					error = errno;
					goto out;
				}
				custr_reset(cu);
				state = ST_WHITESPACE;
				break;

			case LEX_OTHER:
				if (custr_appendc(cu, cc) != 0) {
					error = errno;
					goto out;
				}
				c++;
				break;

			default:
				(void) printf("ST_TOKEN: unknown lextype: %d\n",
				    lextype);
				abort();
			}
			break;
		}

		default:
			(void) printf("unknown state: %d\n", state);
			abort();
		}
	}

out:
	custr_free(cu);
	errno = error;
	return (error == 0 ? 0 : -1);
}
