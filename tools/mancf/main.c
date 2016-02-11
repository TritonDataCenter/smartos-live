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
 * Copyright 2016 Joyent, Inc.
 */

/*
 * mancf:
 *
 * This tool builds a "man.cf" that places all manual sections in a total
 * search order, based on several partial ordering directives.
 */

#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <libgen.h>
#include <fcntl.h>
#include <sys/param.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/debug.h>
#include <err.h>
#include <errno.h>
#include <dirent.h>
#include <fnmatch.h>
#include <ctype.h>

#include "common.h"
#include "strset.h"
#include "parser.h"
#include "manifest.h"
#include "custr.h"

typedef struct manorder {
	char *mao_section;
	int mao_priority;
} manorder_t;

/*
 * Set of manual ordering constraints.  The default priority of a manual page
 * section is 0.  These records raise or lower the priority.
 *
 * Note that priority only applies to subsections within a section; e.g. all
 * subsections of section 1 will still appear before any subsection of section
 * 3.
 */
static const manorder_t cm_manorders[] = {
	/*
	 * Prefer the base section before any named subsection:
	 */
	{ "1",		100 },
	{ "2",		100 },
	{ "3",		100 },
	{ "4",		100 },
	{ "5",		100 },
	{ "6",		100 },
	{ "7",		100 },
	{ "8",		100 },
	{ "9",		100 },

	/*
	 * Prefer shutdown(1M) over shutdown(1B):
	 */
	{ "1m",		99 },
	{ "1b",		-100 },

	/*
	 * Subsection 3C is likely the most important library (3) subsection.
	 */
	{ "3c",		99 },

	/*
	 * Prefer 3SOCKET over 3XNET or 3HEAD:
	 */
	{ "3socket",	98 },

	/*
	 * EOL
	 */
	{ "",		0 }
};

/*
 * The directory in the proto area where manual pages are shipped.
 */
static const char *cm_pdir = "usr/share/man";


/*
 * Option and state tracking:
 */
typedef struct mancf {
	char *mcf_manifest_path;
	boolean_t mcf_trailing_comma;

	strset_t *mcf_sections;
} mancf_t;

static strset_compare_t section_compare(const char *, const char *);

static void
mancf_reset(mancf_t *mcf)
{
	free(mcf->mcf_manifest_path);

	strset_free(mcf->mcf_sections);

	bzero(mcf, sizeof (*mcf));
}

void
mancf_init(mancf_t *mcf)
{
	int e = 0;

	bzero(mcf, sizeof (*mcf));

	e |= strset_allocx(&mcf->mcf_sections, 0, section_compare);

	if (e != 0) {
		err(1, "alloc failure");
	}
}

/*
 * Comparison functions for strset to enforce priority ordering in the
 * set of sections:
 */
static int
section_priority(const char *section)
{
	for (int i = 0; cm_manorders[i].mao_section[0] != '\0'; i++) {
		if (strcmp(section, cm_manorders[i].mao_section) == 0) {
			return (cm_manorders[i].mao_priority);
		}
	}

	return (0);
}

static strset_compare_t
section_compare(const char *l, const char *r)
{
	if (l[0] == r[0]) {
		/*
		 * Same section.  Check for difference in relative priority
		 * of subsections.
		 */
		int lprio = section_priority(l);
		int rprio = section_priority(r);

		if (lprio > rprio)
			return (STRSET_COMPARE_LEFT_FIRST);
		else if (lprio < rprio)
			return (STRSET_COMPARE_RIGHT_FIRST);
	}

	int cmp = strcmp(l, r);

	return (cmp < 0 ? STRSET_COMPARE_LEFT_FIRST :
	    cmp > 0 ? STRSET_COMPARE_RIGHT_FIRST :
	    STRSET_COMPARE_EQUAL);
}

static void
usage(int rc, const char *progname _UNUSED)
{
	const char *msg =
	    "Usage: %s -f manifest\n"
	    "\n"
	    "Generate the contents of \"/usr/share/man/man.cf\" file on "
	    "stdout.\n"
	    "\n"
	    "\t-h\t\tShow this message\n"
	    "\n"
	    "\t-f manifest\tManifest file to search\n"
	    "\n"
	    "\t-t\t\tEnd the section list with a trailing comma\n"
	    "\n";

	(void) fprintf(rc == 0 ? stdout : stderr, msg, progname);
	exit(rc);
}

static void
parse_opts(mancf_t *mcf, int argc, char **argv)
{
	int c;

	while ((c = getopt(argc, argv, ":f:ht")) != -1) {
		switch (c) {
		case 'f':
			mcf->mcf_manifest_path = strdup(optarg);
			break;
		case 't':
			mcf->mcf_trailing_comma = B_TRUE;
			break;
		case 'h':
			usage(0, argv[0]);
			break;
		case ':':
			(void) fprintf(stderr, "Option -%c requires an "
			    "operand\n", optopt);
			usage(2, argv[0]);
			break;
		case '?':
			(void) fprintf(stderr, "Unrecognised option: -%c\n",
			    optopt);
			usage(2, argv[0]);
			break;
		}
	}

	if (mcf->mcf_manifest_path == NULL ||
	    strlen(mcf->mcf_manifest_path) < 1) {
		(void) fprintf(stderr, "Must provide '-f manifest' option.\n");
		usage(2, argv[0]);
	}
}

/*
 * Populate "mcf_sections" with manual page section names; e.g., "1" or "3c".
 */
static me_cb_ret_t
populate_sections(manifest_ent_t *me, void *arg)
{
	char *prefix;
	const char *sect;
	int len;
	mancf_t *mcf = arg;

	if ((len = asprintf(&prefix, "%s/man", cm_pdir)) < 0) {
		err(1, "asprintf");
	}

	switch (me->me_type) {
	case ME_TYPE_DIRECTORY:
		if (strncmp(me->me_name, prefix, len) != 0) {
			break;
		}

		/*
		 * Select the section name portion of the path, which
		 * should be a non-empty string that contains no
		 * further sub-directories:
		 */
		sect = me->me_name + len;
		if (strlen(sect) < 1 || strchr(sect, '/') != NULL) {
			break;
		}

		if (strset_add(mcf->mcf_sections, sect) != 0) {
			err(1, "strset_add failure (%s)", sect);
		}
		break;

	default:
		break;
	}

	free(prefix);
	return (MECB_NEXT);
}

static strset_walk_t
append_to_str(strset_t *ss _UNUSED, const char *pattern, void *arg0,
    void *arg1 _UNUSED)
{
	custr_t *mansect = arg0;
	mancf_t *mcf = arg1;

	if (!mcf->mcf_trailing_comma) {
		/*
		 * If trailing comma mode is not enabled, we only put commas
		 * _between_ entries.  If the string is currently empty,
		 * no comma is required.
		 */
		if (custr_len(mansect) > 0) {
			if (custr_appendc(mansect, ',') != 0) {
				err(1, "custr_appendc");
			}
		}
	}

	if (custr_append(mansect, pattern) != 0) {
		err(1, "custr_append");
	}

	if (mcf->mcf_trailing_comma) {
		/*
		 * In the trailing comma mode, every entry (even the last)
		 * must be followed by a comma.
		 */
		if (custr_appendc(mansect, ',') != 0) {
			err(1, "custr_appendc");
		}
	}

	return (STRSET_WALK_NEXT);
}

static void
make_sects(mancf_t *mcf)
{
	custr_t *mansect;
	const char *filestr = "#\n"
	    "# This file is automatically generated by the \"mancf\" tool\n"
	    "# in \"smartos-live.git\".  It affects the search order of\n"
	    "# manual page sections for pages shipped in \"/usr/share/man\".\n"
	    "#\n"
	    "# NOTE: All sections must be listed in this file, or they will\n"
	    "#       NOT be searched.  See man(1) for more details.\n"
	    "#\n"
	    "MANSECTS=%s\n";

	if (custr_alloc(&mansect) != 0) {
		err(1, "custr_alloc");
	}

	(void) strset_walk(mcf->mcf_sections, append_to_str, mansect, mcf);

	if (fprintf(stdout, filestr, custr_cstr(mansect)) < 0) {
		err(1, "fprintf");
	}

	custr_free(mansect);
}

int
main(int argc _UNUSED, char **argv _UNUSED)
{
	int rval = 0;
	mancf_t mcf;

	mancf_init(&mcf);

	parse_opts(&mcf, argc, argv);

	/*
	 * Read the manifest file once to populate the list of shipped
	 * manual pages.
	 */
	if (read_manifest_file(mcf.mcf_manifest_path, populate_sections,
	    &mcf) != 0) {
		perror("ERROR: could not read manifest file");
		rval = 50;
		goto out;
	}

	make_sects(&mcf);

out:
	mancf_reset(&mcf);
	if (getenv("ABORT_ON_EXIT") != NULL) {
		fprintf(stderr, "abort on exit for findleaks (status %d)\n",
		    rval);
		abort();
	}
	return (rval);
}
