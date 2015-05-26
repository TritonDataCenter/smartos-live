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

#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>
#include <strings.h>
#include <errno.h>
#include <libnvpair.h>

#include "json-nvlist.h"

typedef enum json_type {
	JSON_TYPE_NOTHING,
	JSON_TYPE_STRING = 1,
	JSON_TYPE_INTEGER,
	JSON_TYPE_DOUBLE,
	JSON_TYPE_BOOLEAN,
	JSON_TYPE_NULL,
	JSON_TYPE_OBJECT,
	JSON_TYPE_ARRAY
} json_type_t;

typedef enum parse_state {
	PARSE_ERROR = -1,
	PARSE_DONE = 0,
	PARSE_REST,
	PARSE_OBJECT,
	PARSE_KEY_STRING,
	PARSE_COLON,
	PARSE_STRING,
	PARSE_OBJECT_COMMA,
	PARSE_ARRAY,
	PARSE_BAREWORD,
	PARSE_NUMBER,
	PARSE_ARRAY_VALUE,
	PARSE_ARRAY_COMMA,
} parse_state_t;

#define	JSON_MARKER		".__json_"
#define	JSON_MARKER_ARRAY	JSON_MARKER "array"

typedef struct parse_frame {
	parse_state_t pf_ps;
	nvlist_t *pf_nvl;

	char *pf_key;
	void *pf_value;
	json_type_t pf_value_type;
	int pf_array_index;

	struct parse_frame *pf_next;
} parse_frame_t;

typedef struct state {
	char *s_in;
	off_t s_pos;
	size_t s_len;

	parse_frame_t *s_top;

	nvlist_parse_json_flags_t s_flags;
} state_t;

typedef void (*parse_handler_t)(state_t *);

static void
movestate(state_t *s, parse_state_t ps)
{
#ifdef DEBUG
	fprintf(stderr, "move state %d -> %d\n", s->s_top->pf_ps, ps);
#endif
	s->s_top->pf_ps = ps;
}

static void
pushstate(state_t *s, parse_state_t ps, parse_state_t retps)
{
	parse_frame_t *n = calloc(1, sizeof (*n));

#ifdef DEBUG
	fprintf(stderr, "push state %d -> %d (ret %d)\n", s->s_top->pf_ps, ps,
	    retps);
#endif

	/*
	 * Store the state we'll return to when popping this
	 * frame:
	 */
	s->s_top->pf_ps = retps;

	/*
	 * Store the initial state for the new frame, and
	 * put it on top of the stack:
	 */
	n->pf_ps = ps;
	n->pf_value_type = JSON_TYPE_NOTHING;

	n->pf_next = s->s_top;
	s->s_top = n;
}

static void
posterror(state_t *s, char *error)
{
	/*
	 * XXX do something better here.
	 */
	if (s->s_flags & NVJSON_ERRORS_TO_STDERR)
		fprintf(stderr, "error (pos %lld): %s\n", (long long int) s->s_pos, error);
	movestate(s, PARSE_ERROR);
}

static char
popchar(state_t *s)
{
	if ((size_t)s->s_pos > s->s_len) {
		return (0);
	}
	return (s->s_in[s->s_pos++]);
}

static char
peekchar(state_t *s)
{
	if ((size_t)s->s_pos > s->s_len) {
		return (0);
	}
	return (s->s_in[s->s_pos]);
}

static void
discard_whitespace(state_t *s)
{
	while (isspace(peekchar(s)))
		popchar(s);
}

static char *escape_pairs[] = {
	"\"\"", "\\\\", "//", "b\b", "f\f", "n\n", "r\r", "t\t", NULL
};

static char
collect_string_escape(state_t *s)
{
	int i;
	char c = popchar(s);

	if (c == '\0') {
		fprintf(stderr, "ERROR: eof mid-escape\n");
		return ('\0');
	} else if (c == 'u') {
		int res;
		int ndigs = 0;
		char digs[5];
		/*
		 * Deal with 4-digit unicode escape.
		 */
		while (ndigs < 4) {
			if ((digs[ndigs++] = popchar(s)) == '\0') {
				fprintf(stderr, "ERROR: eof mid-escape\n");
				return ('\0');
			}
		}
		digs[4] = '\0';
		res = atoi(digs);
		if (res > 127) {
			fprintf(stderr, "ERROR: unicode escape above 0x7f\n");
			return ('\0');
		}
		return (res);
	}

	for (i = 0; escape_pairs[i] != NULL; i++) {
		char *ep = escape_pairs[i];
		if (ep[0] == c)
			return (ep[1]);
	}

	fprintf(stderr, "ERROR: unrecognised escape char %c\n", c);
	return ('\0');
}

static char *
collect_string(state_t *s)
{
	/* XXX make this not static: */
	char buf[1000];
	char *pos = buf;

	for (;;) {
		char c = popchar(s);
		if (c == '\0') {
			/*
			 * Unexpected EOF
			 */
			fprintf(stderr, "ERROR: unexpected EOF mid-string\n");
			return (NULL);
		} else if (c == '\\') {
			char esc;
			/*
			 * Escape Character.
			 *
			 * XXX better error handling here.
			 */
			if ((esc = collect_string_escape(s)) == '\0')
				return (NULL);
			*pos++ = esc;
		} else if (c == '"') {
			/*
			 * Legal End of String.
			 */
			break;
		} else {
			*pos++ = c;
		}
	}
	*pos = '\0';
	return (strdup(buf));
}

static char *
collect_bareword(state_t *s)
{
	/* XXX make this not static: */
	char out[100];
	char *pos = out;
	char c;
	for (;;) {
		c = peekchar(s);
		if (islower(c)) {
			*pos++ = popchar(s);
		} else {
			/*
			 * We're done...
			 */
			*pos = '\0';
			break;
		}
	}
	return (strdup(out));
}

static void
hdlr_bareword(state_t *s)
{
	char *str = collect_bareword(s);
	if (strcmp(str, "true") == 0) {
		s->s_top->pf_value_type = JSON_TYPE_BOOLEAN;
		s->s_top->pf_value = (void *) B_TRUE;
	} else if (strcmp(str, "false") == 0) {
		s->s_top->pf_value_type = JSON_TYPE_BOOLEAN;
		s->s_top->pf_value = (void *) B_FALSE;
	} else if (strcmp(str, "null") == 0) {
		s->s_top->pf_value_type = JSON_TYPE_NULL;
	} else {
		free(str);
		return (posterror(s, "expected 'true', 'false' or 'null'"));
	}
	free(str);
	return (movestate(s, PARSE_DONE));
}

static int
collect_number(state_t *s, boolean_t *isint, int32_t *result,
    double *fresult __UNUSED)
{
	/* XXX make not static */
	char out[100];
	char *pos = out;
	boolean_t neg = B_FALSE;
	char c;

	if (peekchar(s) == '-') {
		neg = B_TRUE;
		popchar(s);
	}
	/*
	 * Read the 'int' portion:
	 */
	if (!isdigit(c = peekchar(s))) {
		fprintf(stderr, "expected a digit (0-9)\n");
		return (-1);
	}
	for (;;) {
		if (!isdigit(peekchar(s)))
			break;
		*pos++ = popchar(s);
	}
	if (peekchar(s) == '.' || peekchar(s) == 'e' || peekchar(s) == 'E') {
		fprintf(stderr, "do not yet support FRACs or EXPs\n");
		return (-1);
	}

	*isint = B_TRUE;
	*pos = '\0';
	*result = neg == B_TRUE ? -atoi(out) : atoi(out);
	return (0);
}

static void
hdlr_number(state_t *s)
{
	boolean_t isint;
	int32_t result;
	double fresult;

	if (collect_number(s, &isint, &result, &fresult) != 0) {
		return (posterror(s, "malformed number"));
	}

	if (isint == B_TRUE) {
		s->s_top->pf_value = (void *)(uintptr_t)result;
		s->s_top->pf_value_type = JSON_TYPE_INTEGER;
	} else {
		s->s_top->pf_value = malloc(sizeof (fresult));
		bcopy(&fresult, s->s_top->pf_value, sizeof (fresult));
		s->s_top->pf_value_type = JSON_TYPE_DOUBLE;
	}

	return (movestate(s, PARSE_DONE));
}

static void
hdlr_rest(state_t *s)
{
	char c;
	discard_whitespace(s);
	c = popchar(s);
	switch (c) {
	case '{':
		return (movestate(s, PARSE_OBJECT));
	case '[':
		return (movestate(s, PARSE_ARRAY));
	default:
		return (posterror(s, "eof before object or array"));
	}
}

static int
add_empty_child(state_t *s)
{
	/*
	 * Here, we create an empty nvlist to represent this object
	 * or array:
	 */
	nvlist_t *empty;
	if (nvlist_alloc(&empty, NV_UNIQUE_NAME, 0) != 0)
		return (-1);
	if (s->s_top->pf_next != NULL) {
		/*
		 * If we're a child of the frame above, we store ourselves in
		 * that frame's nvlist:
		 */
		nvlist_t *nvl = s->s_top->pf_next->pf_nvl;
		char *key = s->s_top->pf_next->pf_key;

		if (nvlist_add_nvlist(nvl, key, empty) != 0) {
			nvlist_free(empty);
			return (-1);
		}
		nvlist_free(empty);
		if (nvlist_lookup_nvlist(nvl, key, &empty) != 0) {
			return (-1);
		}
	}
	s->s_top->pf_nvl = empty;
	return (0);
}

static int
decorate_array(state_t *s)
{
	/*
	 * When we are done creating an array, we store a 'length'
	 * property on it, as well as an internal-use marker value.
	 */
	if (nvlist_add_boolean(s->s_top->pf_nvl, JSON_MARKER_ARRAY) != 0 ||
	    nvlist_add_uint32(s->s_top->pf_nvl, "length",
	    s->s_top->pf_array_index))
		return (-1);
	return (0);
}

static void
hdlr_array(state_t *s)
{
	char c;
	s->s_top->pf_value_type = JSON_TYPE_ARRAY;

	if (add_empty_child(s) == -1)
		return (posterror(s, "nvlist error"));

	discard_whitespace(s);
	c = peekchar(s);
	switch (c) {
	case ']':
		popchar(s);
		decorate_array(s);
		return (movestate(s, PARSE_DONE));
	default:
		return (movestate(s, PARSE_ARRAY_VALUE));
	}
}

static void
hdlr_array_comma(state_t *s)
{
	discard_whitespace(s);

	switch (popchar(s)) {
	case ']':
		decorate_array(s);
		return (movestate(s, PARSE_DONE));
	case ',':
		return (movestate(s, PARSE_ARRAY_VALUE));
	default:
		return (posterror(s, "expected ',' or ']'"));
	}
}

static void
hdlr_array_value(state_t *s)
{
	char c;
	discard_whitespace(s);

	/*
	 * Generate keyname from the next array index:
	 */
	if (s->s_top->pf_key != NULL) {
		fprintf(stderr, "pf_key not null! was %s\n", s->s_top->pf_key);
		abort();
	}
	s->s_top->pf_key = malloc(11); /* 10 digits in uint32_t */
	if (s->s_top->pf_key == NULL)
		return (posterror(s, "could not allocate memory"));
	(void) snprintf(s->s_top->pf_key, 11, "%d", s->s_top->pf_array_index++);

	/*
	 * Select which type handler we need for the next value:
	 */
	switch (c = peekchar(s)) {
	case '"':
		popchar(s);
		return (pushstate(s, PARSE_STRING, PARSE_ARRAY_COMMA));
	case '{':
		popchar(s);
		return (pushstate(s, PARSE_OBJECT, PARSE_ARRAY_COMMA));
	case '[':
		popchar(s);
		return (pushstate(s, PARSE_ARRAY, PARSE_ARRAY_COMMA));
	default:
		if (islower(c))
			return (pushstate(s, PARSE_BAREWORD,
			    PARSE_ARRAY_COMMA));
		else if (c == '-' || isdigit(c))
			return (pushstate(s, PARSE_NUMBER, PARSE_ARRAY_COMMA));
		else
			return (posterror(s, "unexpected character at start "
			    "of value"));
	}
}

static void
hdlr_object(state_t *s)
{
	char c;
	s->s_top->pf_value_type = JSON_TYPE_OBJECT;

	if (add_empty_child(s) == -1)
		return (posterror(s, "nvlist error"));

	discard_whitespace(s);
	c = popchar(s);
	switch (c) {
	case '}':
		return (movestate(s, PARSE_DONE));
	case '"':
		return (movestate(s, PARSE_KEY_STRING));
	default:
		return (posterror(s, "expected key or '}'"));
	}
}

static void
hdlr_key_string(state_t *s)
{
	char *str = collect_string(s);
	if (str == NULL)
		return (posterror(s, "could not collect key string"));

	/*
	 * Record the name of the next
	 */
	s->s_top->pf_key = str;
	return (movestate(s, PARSE_COLON));
}

static void
hdlr_colon(state_t *s)
{
	char c;
	discard_whitespace(s);

	if ((c = popchar(s)) != ':')
		return (posterror(s, "expected ':'"));

	discard_whitespace(s);

	/*
	 * Select which type handler we need for the value after the colon:
	 */
	switch (c = peekchar(s)) {
	case '"':
		popchar(s);
		return (pushstate(s, PARSE_STRING, PARSE_OBJECT_COMMA));
	case '{':
		popchar(s);
		return (pushstate(s, PARSE_OBJECT, PARSE_OBJECT_COMMA));
	case '[':
		popchar(s);
		return (pushstate(s, PARSE_ARRAY, PARSE_OBJECT_COMMA));
	default:
		if (islower(c))
			return (pushstate(s, PARSE_BAREWORD,
			    PARSE_OBJECT_COMMA));
		else if (c == '-' || isdigit(c))
			return (pushstate(s, PARSE_NUMBER, PARSE_OBJECT_COMMA));
		else
			return (posterror(s, "unexpected character at start "
			    "of value"));
	}
}

static void
hdlr_object_comma(state_t *s)
{
	char c;
	discard_whitespace(s);

	switch (c = popchar(s)) {
	case '}':
		return (movestate(s, PARSE_DONE));
	case ',':
		discard_whitespace(s);
		if ((c = popchar(s)) != '"')
			return (posterror(s, "expected '\"'"));
		return (movestate(s, PARSE_KEY_STRING));
	default:
		return (posterror(s, "expected ',' or '}'"));
	}
}

static void
hdlr_string(state_t *s)
{
	s->s_top->pf_value = collect_string(s);
	if (s == NULL)
		return (posterror(s, "could not collect string"));
	s->s_top->pf_value_type = JSON_TYPE_STRING;
	return (movestate(s, PARSE_DONE));
}

static int
store_value(state_t *s)
{
	nvlist_t *targ = s->s_top->pf_next->pf_nvl;
	char *key = s->s_top->pf_next->pf_key;
	json_type_t type = s->s_top->pf_value_type;
	int ret = 0;

	switch (type) {
	case JSON_TYPE_STRING:
		ret = nvlist_add_string(targ, key, s->s_top->pf_value);
		free(s->s_top->pf_value);
		goto out;
	case JSON_TYPE_BOOLEAN:
		ret = nvlist_add_boolean_value(targ, key,
		    (boolean_t)s->s_top->pf_value);
		goto out;
	case JSON_TYPE_NULL:
		ret = nvlist_add_boolean(targ, key);
		goto out;
	case JSON_TYPE_INTEGER:
		ret = nvlist_add_int32(targ, key,
		    (int32_t)(uintptr_t)s->s_top->pf_value);
		goto out;
	case JSON_TYPE_ARRAY:
		/* FALLTHRU */
	case JSON_TYPE_OBJECT:
		/*
		 * Objects and arrays are already 'stored' in their target
		 * nvlist on creation. See: hdlr_object, hdlr_array.
		 */
		goto out;
	default:
		fprintf(stderr, "ERROR: could not store unknown type %d\n",
		    type);
		abort();
	}
out:
	s->s_top->pf_value = NULL;
	free(s->s_top->pf_next->pf_key);
	s->s_top->pf_next->pf_key = NULL;
	return (ret);
}

static parse_frame_t *
parse_frame_free(parse_frame_t *pf, boolean_t free_nvl)
{
	parse_frame_t *next = pf->pf_next;
	if (pf->pf_key != NULL)
		free(pf->pf_key);
	if (pf->pf_value != NULL)
		abort();
	if (free_nvl && pf->pf_nvl != NULL)
		nvlist_free(pf->pf_nvl);
	free(pf);
	return (next);
}

static parse_handler_t hdlrs[] = {
	NULL,				/* PARSE_DONE */
	hdlr_rest,			/* PARSE_REST */
	hdlr_object,			/* PARSE_OBJECT */
	hdlr_key_string,		/* PARSE_KEY_STRING */
	hdlr_colon,			/* PARSE_COLON */
	hdlr_string,			/* PARSE_STRING */
	hdlr_object_comma,		/* PARSE_OBJECT_COMMA */
	hdlr_array,			/* PARSE_ARRAY */
	hdlr_bareword,			/* PARSE_BAREWORD */
	hdlr_number,			/* PARSE_NUMBER */
	hdlr_array_value,		/* PARSE_ARRAY_VALUE */
	hdlr_array_comma,		/* PARSE_ARRAY_COMMA */
};
#define	NUM_PARSE_HANDLERS	(int)(sizeof (hdlrs) / sizeof (hdlrs[0]))

int
nvlist_parse_json(char *buf, size_t buflen, nvlist_t **nvlp,
    nvlist_parse_json_flags_t flag)
{
	int ret = 0;
	state_t s;

	/*
	 * Check for valid flags:
	 */
	if ((flag & (NVJSON_FORCE_INTEGER | NVJSON_FORCE_DOUBLE)) ==
	    (NVJSON_FORCE_INTEGER | NVJSON_FORCE_DOUBLE))
		return (EINVAL);

	/*
	 * Initialise parsing state structure:
	 */
	bzero(&s, sizeof (s));
	s.s_in = buf;
	s.s_pos = 0;
	s.s_len = buflen;
	s.s_flags = flag;

	/*
	 * Allocate top-most stack frame:
	 */
	s.s_top = calloc(1, sizeof (*s.s_top));
	if (s.s_top == NULL) {
		ret = errno;
		goto out;
	}

	s.s_top->pf_ps = PARSE_REST;
	for (;;) {
		if (s.s_top->pf_ps < 0) {
			/*
			 * The parser reported an error.
			 */
#if 0
			fprintf(stderr, "parse error\n");
#endif
			ret = EFAULT;
			goto out;
		} else if (s.s_top->pf_ps == PARSE_DONE) {
			if (s.s_top->pf_next == NULL) {
				/*
				 * Last frame, so we're really
				 * done.
				 */
				*nvlp = s.s_top->pf_nvl;
				goto out;
			} else {
				/*
				 * Otherwise, pop a frame and continue
				 * in previous state.
				 */
#if 0
				parse_frame_t *t = s.s_top->pf_next;
#endif

				/*
				 * Copy out the value we created in the
				 * old frame:
				 */
				if ((ret = store_value(&s)) != 0)
					goto out;
#if 0
				fprintf(stderr, "pop state %d -> %d\n",
				    s.s_top->pf_ps, t->pf_ps);
#endif
				/*
				 * Free old frame:
				 */
				s.s_top = parse_frame_free(s.s_top, B_FALSE);
			}
		}
		/*
		 * Dispatch to parser handler routine for this state:
		 */
		if (s.s_top->pf_ps >= NUM_PARSE_HANDLERS ||
		    hdlrs[s.s_top->pf_ps] == NULL) {
			fprintf(stderr, "no handler for state %d\n",
			    s.s_top->pf_ps);
			abort();
		}
		hdlrs[s.s_top->pf_ps](&s);
	}

out:
	while (s.s_top != NULL)
		s.s_top = parse_frame_free(s.s_top, ret == 0 ? B_FALSE :
		    B_TRUE);
	return (ret);
}
