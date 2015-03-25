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
 * mancheck:
 *
 * This tool ensures that no manual page is left behind.  We want to audit the
 * traditional paths where user binaries are delivered, ensuring that we ship
 * section "1" and section "1M" manual pages for all of them.
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

#include "common.h"
#include "strset.h"
#include "parser.h"
#include "manifest.h"

/*
 * List of directories to check for binaries.
 */
static const char *cm_bpaths[] = {
	"bin",
	"usr/bin",
	"sbin",
	"usr/sbin",
	"smartdc/bin",
	NULL
};

/*
 * List of source directories in which we expect to find manual pages.
 */
static const char *cm_mpaths[] = {
	"proto/usr/share/man",
	"man/man",
	NULL
};

/*
 * List of manual sections where pages may be shipped for executable commands.
 * The case of these sections should match the case of the shipped filenames,
 * e.g. "1m", not "1M".
 */
static const char *cm_mansects[] = {
	"1",
	"1m",
	NULL
};

/*
 * The directory in the proto area where manual pages are shipped.
 */
static const char *cm_pdir = "usr/share/man";


/*
 * Option and state tracking:
 */
typedef enum mancheck_flags {
	MCF_DONT_EXIST = 0x1,
	MCF_NOT_SHIPPED = 0x2
} mancheck_flags_t;

typedef struct mancheck {
	mancheck_flags_t mc_flags;
	char *mc_manifest_path;
	unsigned long mc_cnt_dont_exist;
	unsigned long mc_cnt_not_shipped;
	strset_t *mc_shiplist;
} mancheck_t;

static void
mancheck_reset(mancheck_t *mc)
{
	free(mc->mc_manifest_path);
	strset_free(mc->mc_shiplist);

	bzero(mc, sizeof (*mc));
}

static void
usage(int rc, const char *progname)
{
	const char *msg =
	    "Usage: %s -f manifest [ -m | -s ]\n"
	    "\n"
	    "Validate that all binaries mentioned in 'manifest' have man "
	    "pages and that they\n"
	    "are present in 'manifest'.\n"
	    "\n"
	    "\t-f manifest\tManifest file to search\n"
	    "\t-h\t\tShow this message\n"
	    "\t-m\t\tOnly warn for man pages which don't exist\n"
	    "\t-m\t\tOnly warn for man pages which aren't shipped\n"
	    "\n";

	(void) fprintf(rc == 0 ? stdout : stderr, msg, progname);
	exit(rc);
}

static void
parse_opts(mancheck_t *mc, int argc, char **argv)
{
	int c;
	int mflag = 0, sflag = 0;

	while ((c = getopt(argc, argv, ":f:hms")) != -1) {
		switch (c) {
		case 'f':
			mc->mc_manifest_path = strdup(optarg);
			break;
		case 'h':
			usage(0, argv[0]);
			break;
		case 'm':
			mflag++;
			break;
		case 's':
			sflag++;
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

	if (mc->mc_manifest_path == NULL || strlen(mc->mc_manifest_path) < 1) {
		(void) fprintf(stderr, "Must provide '-f manifest' option.\n");
		usage(2, argv[0]);
	}

	/*
	 * If no flags are specified, we do both checks by default:
	 */
	mc->mc_flags |= (MCF_DONT_EXIST | MCF_NOT_SHIPPED);

	if (mflag > 0 && sflag > 0) {
		(void) fprintf(stderr, "-m and -s are mutually exclusive\n");
		usage(2, argv[0]);
	} else if (mflag > 0) {
		mc->mc_flags &= ~MCF_NOT_SHIPPED;
	} else if (sflag > 0) {
		mc->mc_flags &= ~MCF_DONT_EXIST;
	}
}

/*
 * Given a filename, e.g. "usr/bin/prstat", check to see if manual pages exist
 * in any of the proto or source directories (cm_mpaths) that we know contain
 * manual pages.  The manual pages must be in a known section (cm_mansects),
 * e.g. "proto/usr/share/man/man1m/prstat.1m".
 *
 * All matching pages are added to the string set "pages".  The function
 * returns B_TRUE if any matching pages were found in the filesystem, or
 * B_FALSE otherwise.
 */
static boolean_t
check_man(const char *filen, strset_t *pages)
{
	char buf[MAXPATHLEN];
	char *basen;

	(void) strlcpy(buf, filen, sizeof (buf));
	basen = basename(buf);

	strset_reset(pages);

	/*
	 * For each manual page directory:
	 */
	for (int i = 0; cm_mpaths[i] != NULL; i++) {
		/*
		 * For each manual page section:
		 */
		for (int j = 0; cm_mansects[j] != NULL; j++) {
			struct stat st;
			char fullp[MAXPATHLEN];

			/*
			 * Construct the full path of the manual page:
			 */
			(void) snprintf(fullp, sizeof (fullp),
			    "%s/man%s/%s.%s", cm_mpaths[i],
			    cm_mansects[j], basen,
			    cm_mansects[j]);

			/*
			 * If this file exists, we add it to the list.  Note
			 * that we follow symlinks, here, as a link to an
			 * extant file is also acceptable.
			 */
			if (stat(fullp, &st) == 0 && S_ISREG(st.st_mode)) {
				(void) snprintf(fullp, sizeof (fullp),
				    "man%s/%s.%s", cm_mansects[j], basen,
				    cm_mansects[j]);

				if (strset_add(pages, fullp) != 0) {
					err(1, "strset_add failure (%s)", fullp);
				}
			}
		}
	}

	return (strset_count(pages) > 0);
}

/*
 * Returns B_TRUE if this file, e.g. "usr/bin/ls", resides within a known
 * binary shipping directory (cm_bpaths), e.g. "usr/bin".  Returns B_FALSE
 * otherwise.
 */
static boolean_t
in_dir(const char *filen)
{
	char buf[MAXPATHLEN];
	char *dirn;
	int i;

	(void) strlcpy(buf, filen, sizeof (buf));
	dirn = dirname(buf);

	for (i = 0; cm_bpaths[i] != NULL; i++) {
		if (strcmp(dirn, cm_bpaths[i]) == 0) {
			return (B_TRUE);
		}
	}

	return (B_FALSE);
}

/*
 * Add this manifest entry to the list of shipped manual pages if it resides
 * within the manual page tree ("cm_pdir").
 */
static me_cb_ret_t
populate_shiplist(manifest_ent_t *me, void *arg)
{
	mancheck_t *mc = arg;

	switch (me->me_type) {
	case ME_TYPE_FILE:
	case ME_TYPE_HARDLINK:
	case ME_TYPE_SYMLINK:
		if (strncmp(me->me_name, cm_pdir, strlen(cm_pdir)) == 0) {
			if (strset_add(mc->mc_shiplist, me->me_name) != 0) {
				err(1, "strset_add failure");
			}
		}
		break;

	default:
		break;
	}

	return (MECB_NEXT);
}

/*
 * Check if this manual page, e.g. "man1m/prstat.1m", is being shipped in
 * the manifest under the manual page tree (cm_pdir).  Return B_TRUE if
 * it is shipped, or B_FALSE otherwise.
 */
static strset_walk_t
check_shipped(strset_t *ss _UNUSED, const char *page, void *arg0, void *arg1)
{
	mancheck_t *mc = arg0;
	manifest_ent_t *me = arg1;
	char buf[MAXPATHLEN];

	(void) snprintf(buf, sizeof (buf), "%s/%s", cm_pdir, page);

	if (strset_contains(mc->mc_shiplist, buf)) {
		/*
		 * This page is begin shipped.
		 */
		return (STRSET_WALK_NEXT);
	}

	/*
	 * This page is not being shipped.  Count it and, if requested,
	 * notify the user.
	 */
	mc->mc_cnt_not_shipped++;
	if (mc->mc_flags & MCF_NOT_SHIPPED) {
		(void) fprintf(stdout, "binary /%s has unshipped manual "
		    "page: %s\n", me->me_name, page);
	}

	return (STRSET_WALK_NEXT);
}

/*
 * Perform manual page checks on this manifest entry.
 */
static me_cb_ret_t
check_manifest_ent(manifest_ent_t *me, void *arg)
{
	mancheck_t *mc = arg;
	strset_t *pages = NULL;

	if (strset_alloc(&pages, STRSET_IGNORE_DUPLICATES) != 0) {
		perror("strset_alloc");
		return (MECB_CANCEL);
	}

	switch (me->me_type) {
	case ME_TYPE_FILE:
	case ME_TYPE_HARDLINK:
	case ME_TYPE_SYMLINK:
		if (!in_dir(me->me_name)) {
			/*
			 * This file does not reside in a directory used for
			 * user-executable binaries.
			 */
			break;
		}

		if (!check_man(me->me_name, pages)) {
			/*
			 * This command does not have a manual page in the
			 * appropriate section.
			 */
			mc->mc_cnt_dont_exist++;
			if (mc->mc_flags & MCF_DONT_EXIST) {
				(void) fprintf(stdout, "missing manual page "
				    "for /%s\n", me->me_name);
			}
			break;
		}

		/*
		 * If we found manual pages for this command, check whether
		 * they are shipped or not:
		 */
		VERIFY0(strset_walk(pages, check_shipped, mc, me));
		break;

	default:
		break;
	}

	strset_free(pages);
	return (MECB_NEXT);
}

int
main(int argc _UNUSED, char **argv _UNUSED)
{
	int rval = 0;
	mancheck_t mc;
	boolean_t endl = B_FALSE;

	bzero(&mc, sizeof (mc));
	parse_opts(&mc, argc, argv);

	if (strset_alloc(&mc.mc_shiplist, 0) != 0) {
		err(1, "strset_alloc failure");
	}

	/*
	 * Read the manifest file once to populate the list of shipped
	 * manual pages.
	 */
	if (read_manifest_file(mc.mc_manifest_path, populate_shiplist,
	    &mc) != 0) {
		perror("ERROR: could not read manifest file");
		rval = 50;
		goto out;
	}

	/*
	 * Read the manifest file a second time to perform the required
	 * checks on each entry that represents an executable program.
	 */
	if (read_manifest_file(mc.mc_manifest_path, check_manifest_ent,
	    &mc) != 0) {
		perror("ERROR: could not read manifest file");
		rval = 50;
		goto out;
	}

	/*
	 * Print final status counts for each requested check.
	 */
	if ((mc.mc_flags & MCF_DONT_EXIST) && mc.mc_cnt_dont_exist > 0) {
		if (!endl) {
			(void) fprintf(stdout, "\n");
			endl = B_TRUE;
		}
		(void) fprintf(stdout, "missing manual pages: %ld\n",
		    mc.mc_cnt_dont_exist);
		rval = 60;
	}
	if ((mc.mc_flags & MCF_NOT_SHIPPED) && mc.mc_cnt_not_shipped > 0) {
		if (!endl) {
			(void) fprintf(stdout, "\n");
			endl = B_TRUE;
		}
		(void) fprintf(stdout, "unshipped manual pages: %ld\n",
		    mc.mc_cnt_not_shipped);
		rval = 60;
	}

out:
	mancheck_reset(&mc);
	if (getenv("ABORT_ON_EXIT") != NULL) {
		fprintf(stderr, "abort on exit for findleaks "
		    "(status %d)\n", rval);
		abort();
	}
	return (rval);
}
