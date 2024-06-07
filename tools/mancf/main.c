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
 * Copyright 2024 Oxide Computer Company
 */

/*
 * mancf:
 *
 * This tool builds a "man.cf" that places all manual sections in a total
 * search order, based on several partial ordering directives.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
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
#include "strlist.h"
#include "parser.h"
#include "manifest.h"
#include "custr.h"

typedef struct manorder {
	char *mao_more_important;
	char *mao_less_important;
} manorder_t;

/*
 * Set of manual section and subsection ordering constraints.  This is a list
 * of partial ordering rules, each with two fnmatch(3C) patterns.  The first
 * pattern matches any section that we consider more important than anything
 * which matches the second pattern.
 *
 * Each entry in the table creates potentially many edges in the graph of all
 * sections and subsections.  In the absence of any entry in this table which
 * matches a pair of sections, we break ties using the natural lexicographical
 * sort of section name strings.
 */
static const manorder_t cm_manorders[] = {
	/*
	 * Section 8 (formerly subsection 1M) is "Maintenance Commands and
	 * Procedures", which has some unfortunate overlap with the mostly
	 * vestigial subsection 1B, "BSD Compatibility Package Commands".
	 */
	{ "1m",		"1b" },
	{ "8*",		"1b" },

	/*
	 * There are also pages in other lower numbered sections that conflict
	 * with the commands people are generally looking for; e.g., swap(8) is
	 * a better first match than swap(4).  Put section 8 before everything
	 * else.
	 */
	{ "8*",		"[2-7]*"},

	/*
	 * The pages in subsection 3C are likely more immediately relevant than
	 * those found in any other subsection of 3.  Likewise, prefer pages
	 * from 3SOCKET before 3XNET and 3HEAD; e.g., socket(3SOCKET) is likely
	 * more relevant than socket(3HEAD) which describes "socket.h" itself.
	 */
	{ "3c",		"3?*" },
	{ "3socket",	"3xnet" },
	{ "3socket",	"3head" },

	/*
	 * EOL
	 */
	{ "",		"" }
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
	strlist_t *mcf_output;
} mancf_t;

static void
mancf_reset(mancf_t *mcf)
{
	free(mcf->mcf_manifest_path);

	strset_free(mcf->mcf_sections);

	bzero(mcf, sizeof (*mcf));
}

static void
mancf_init(mancf_t *mcf)
{
	bzero(mcf, sizeof (*mcf));

	if (strset_alloc(&mcf->mcf_sections, 0) != 0 ||
	    strlist_alloc(&mcf->mcf_output, 0) != 0) {
		err(1, "alloc failure");
	}
}

/*
 * Determine whether "section" is more important than "other_section" by
 * scanning the partial order constraints.  Returns true if the "section"
 * should appear in the output list before "other_section".
 */
static bool
section_is_more_important(const char *section, const char *other_section)
{
	if (strcmp(section, other_section) == 0) {
		/*
		 * These are the same section.
		 */
		return (false);
	}

	for (int i = 0; cm_manorders[i].mao_more_important[0] != '\0'; i++) {
		const manorder_t *mao = &cm_manorders[i];

		if (fnmatch(mao->mao_more_important, section, 0) == 0 &&
		    fnmatch(mao->mao_less_important, other_section, 0) == 0) {
			/*
			 * This section is more important than the other
			 * section.
			 */
			return (true);
		}
	}

	return (false);
}

static strset_walk_t
section_sort_walk_blocked_check(strset_t *set _UNUSED, const char *other_sect,
    void *arg0, void *arg1)
{
	const char *sect = arg0;
	bool *blocked = arg1;

	if (section_is_more_important(other_sect, sect)) {
		/*
		 * This section is blocked from inclusion in the output list
		 * because another section is considered more important.
		 */
		*blocked = true;
		return (STRSET_WALK_DONE);
	}

	return (STRSET_WALK_NEXT);
}

static strset_walk_t
section_sort_walk(strset_t *set _UNUSED, const char *sect, void *arg0,
    void *arg1)
{
	mancf_t *mcf = arg0;
	bool *made_progress = arg1;

	/*
	 * For this section, determine if any of the _other_ sections in the
	 * input set are more important.
	 */
	bool blocked = false;
	if (strset_walk(mcf->mcf_sections, section_sort_walk_blocked_check,
	    (void *)sect, &blocked) != 0) {
		err(1, "section_sort_walk: strset_walk");
	}

	if (!blocked) {
		/*
		 * No other section is more important than this one, so prepend
		 * it to the output list:
		 */
		strlist_set_tail(mcf->mcf_output, sect);
		*made_progress = true;

		/*
		 * Remove it from the input set so that we don't consider it a
		 * second time.  Restart the walk of the input set in case
		 * there are sections that would sort lexicographically earlier
		 * in the set which have now been unblocked for inclusion.
		 */
		return (STRSET_WALK_DONE | STRSET_WALK_REMOVE);
	}

	return (STRSET_WALK_NEXT);
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

	for (unsigned i = 0; i < strlist_contig_count(mcf->mcf_output); i++) {
		append_to_str(NULL, strlist_get(mcf->mcf_output, i),
		    mansect, mcf);
	}

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
	 * Read the manifest file once to populate the input set of shipped
	 * manual pages.
	 */
	if (read_manifest_file(mcf.mcf_manifest_path, populate_sections,
	    &mcf) != 0) {
		perror("ERROR: could not read manifest file");
		rval = 50;
		goto out;
	}

	/*
	 * Continuously walk the input set looking for the next viable entry to
	 * transfer to the sorted output list, until there are no more
	 * candidates.  The lexicographical tie-breaking is an implicit result
	 * of the fact that strset walks in that order naturally.
	 */
	while (strset_count(mcf.mcf_sections) > 0) {
		bool made_progress = false;

		if (strset_walk(mcf.mcf_sections, section_sort_walk, &mcf,
		    &made_progress) != 0) {
			err(1, "strset_walk");
		}

		if (!made_progress) {
			errx(1, "section ordering rules contain a cycle?");
		}
	}

	/*
	 * Emit the final list as a "man.cf" file to stdout.
	 */
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
