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
 * smartos-live: Build Tools: Manifest File Reader.
 */


#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <err.h>
#include <errno.h>
#include <sys/debug.h>

#include "common.h"
#include "custr.h"
#include "strlist.h"
#include "parser.h"
#include "manifest.h"

/*
 * Free storage and clear pointers for a manifest entry.
 */
void
manifest_ent_reset(manifest_ent_t *me)
{
	free(me->me_name);
	free(me->me_target);
	free(me->me_user);
	free(me->me_group);

	bzero(me, sizeof (*me));
}

/*
 * Process a symlink or a hardlink; i.e. any manifest entry of the form:
 *
 *	x source=target
 *
 */
static int
process_manifest_line_link(manifest_ent_t *me, strlist_t *line)
{
	strlist_t *fields = NULL;
	int error = 0;

	if (strlist_contig_count(line) != 2) {
		error = EPROTO;
		goto out;
	}

	if (strlist_alloc(&fields, 2) != 0) {
		error = errno;
		goto out;
	}

	if (split_on(strlist_get(line, 1), '=', fields) == -1) {
		error = (errno == ENOSPC) ? EPROTO : errno;
		goto out;
	}

	if (strlist_contig_count(fields) != 2) {
		error = EPROTO;
		goto out;
	}

	me->me_name = strlist_adopt(fields, 0);
	me->me_target = strlist_adopt(fields, 1);

	if (me->me_name[0] == '\0' || me->me_target[0] == '\0') {
		error = EPROTO;
		goto out;
	}

out:
	if (error != 0) {
		manifest_ent_reset(me);
	}
	strlist_free(fields);
	errno = error;
	return (error == 0 ? 0 : -1);
}

static int
parse_octal(const char *input, unsigned int *outp)
{
	char *endp;
	long out;

	if (input == NULL || input[0] == '\0') {
		errno = EINVAL;
		return (-1);
	}

	errno = 0;
	if ((out = strtol(input, &endp, 8)) == 0 && errno != 0) {
		return (-1);
	}

	if (*endp != '\0') {
		errno = EINVAL;
		return (-1);
	}

	*outp = (unsigned int)out;
	return (0);
}

/*
 * Process a file or directory; i.e. any manifest entry of the form:
 *
 * 	x file 0777 user group
 *
 */
static int
process_manifest_line_file(manifest_ent_t *me, strlist_t *line)
{
	int error = 0;
	unsigned int val = 0;

	if (strlist_contig_count(line) != 5) {
		error = EPROTO;
		goto out;
	}

	errno = 0;
	if (parse_octal(strlist_get(line, 2), &val) == -1 ||
	    (val & ~07777) != 0) {
		error = EPROTO;
		goto out;
	}
	me->me_mode = val;

	me->me_name = strlist_adopt(line, 1);
	me->me_user = strlist_adopt(line, 3);
	me->me_group = strlist_adopt(line, 4);

	if (me->me_name[0] == '\0' || me->me_user[0] == '\0' ||
	    me->me_group[0] == '\0') {
		error = EPROTO;
		goto out;
	}

out:
	if (error != 0) {
		manifest_ent_reset(me);
	}
	errno = error;
	return (error == 0 ? 0 : -1);
}

static int
process_manifest_line(const char *line, manifest_ent_t *me)
{
	strlist_t *sl = NULL;
	int error = 0;

	const struct typehandler {
		char th_char;
		manifest_ent_type_t th_type;
		int (*th_funcp)(manifest_ent_t *, strlist_t *);
	} th[] = {
		{ 'h', ME_TYPE_HARDLINK, process_manifest_line_link },
		{ 's', ME_TYPE_SYMLINK, process_manifest_line_link },
		{ 'f', ME_TYPE_FILE, process_manifest_line_file },
		{ 'd', ME_TYPE_DIRECTORY, process_manifest_line_file },
		{ '\0', 0, NULL }
	};

	if (strlist_alloc(&sl, 5) != 0) {
		error = errno;
		goto out;
	}

	if (parse_line(line, sl) != 0) {
		error = errno;
		goto out;
	}

	if (strlist_contig_count(sl) == 0 || strlen(strlist_get(sl, 0)) == 0) {
		/*
		 * Empty line; ignore.
		 */
		me->me_type = ME_TYPE_INVALID;
		goto out;
	}

	if (strlen(strlist_get(sl, 0)) != 1) {
		(void) fprintf(stderr, "invalid manifest line: %s\n", line);
		error = EPROTO;
		goto out;
	}

	/*
	 * Read type character:
	 */
	for (int i = 0; th[i].th_char != '\0'; i++) {
		if (th[i].th_char != strlist_get(sl, 0)[0]) {
			continue;
		}

		me->me_type = th[i].th_type;
		if (th[i].th_funcp(me, sl) != 0) {
			error = errno;
		}
		goto out;
	}

	(void) fprintf(stderr, "ERROR: manifest line type '%c' "
	    "unrecognised\n", strlist_get(sl, 0)[0]);
	error = EPROTO;

out:
	if (error != 0) {
		if (error == EPROTO) {
			(void) fprintf(stderr, "ERROR: invalid manifest line: "
			    "%s\n", line);
		}
		manifest_ent_reset(me);
	}

	strlist_free(sl);
	errno = error;
	return (error == 0 ? 0 : -1);
}

/*
 * Read a manifest file.  For each non-blank line, call the callback with
 * the parsed manifest entry object.
 */
int
read_manifest_file(const char *path, manifest_ent_cb_t *mecb, void *arg)
{
	FILE *mf;
	char *line = NULL;
	size_t cap = 0;
	int rval = 0;
	int error = 0;
	manifest_ent_t me;

	if ((mf = fopen(path, "r")) == NULL) {
		return (-1);
	}

	if (!is_regular_file(mf)) {
		(void) fprintf(stderr, "ERROR: %s is not a regular file\n",
		    path);
		(void) fclose(mf);
		return (-1);
	}

	bzero(&me, sizeof (me));

	for (;;) {
		errno = 0;
		if (getline(&line, &cap, mf) < 0) {
			if (errno == 0) {
				/*
				 * End of file reached.
				 */
				goto out;
			}

			/*
			 * Some other error:
			 */
			error = errno;
			rval = -1;
			goto out;
		}

		if ((rval = process_manifest_line(line, &me)) != 0) {
			error = errno;
			goto out;
		}

		if (me.me_type != ME_TYPE_INVALID) {
			switch (mecb(&me, arg)) {
			case MECB_NEXT:
				break;

			case MECB_DONE:
				goto out;

			case MECB_CANCEL:
				error = ECANCELED;
				goto out;

			default:
				abort();
			}
		}

		manifest_ent_reset(&me);
	}

out:
	manifest_ent_reset(&me);
	free(line);
	(void) fclose(mf);
	errno = error;
	return (rval);
}
