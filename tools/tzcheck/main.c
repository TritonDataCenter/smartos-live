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
 * tzcheck:
 *
 * Check that the shipping directives in the manifest file are consistent
 * with the built time zone database in the proto area.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
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
#include <ctype.h>
#include <sys/avl.h>

#include "common.h"
#include "parser.h"
#include "manifest.h"
#include "custr.h"
#include "strpath.h"

/*
 * The directory in the proto area where time zone files are shipped.
 */
static const char *cm_pdir = "usr/share/lib/zoneinfo";

static int tzent_comparator(const void *l, const void *r);

/*
 * Option and state tracking:
 */
typedef struct tzcheck {
	char *tzc_manifest_path;
	char *tzc_proto_path;

	avl_tree_t tzc_zoneinfo_manifest;
	avl_tree_t tzc_zoneinfo_proto;

	boolean_t tzc_verbose;

	custr_t *tzc_prefix;
} tzcheck_t;

typedef struct tzent {
	avl_node_t tze_node;
	manifest_ent_type_t tze_type;
	char *tze_path;
	char *tze_target;
	ino_t tze_inode;
} tzent_t;

static int
tzent_comparator(const void *l, const void *r)
{
	const tzent_t *ll = l;
	const tzent_t *rr = r;
	int comp = strcmp(ll->tze_path, rr->tze_path);

	return (comp < 0 ? -1 : comp > 0 ? 1 : 0);
}

static void
tzcheck_free_tze_avl(avl_tree_t *t)
{
	void *ck = NULL;
	tzent_t *tze;

	while ((tze = avl_destroy_nodes(t, &ck)) != NULL) {
		free(tze->tze_target);
		free(tze->tze_path);
		free(tze);
	}
	avl_destroy(t);
}

static void
tzcheck_reset(tzcheck_t *tzc)
{
	tzcheck_free_tze_avl(&tzc->tzc_zoneinfo_manifest);
	tzcheck_free_tze_avl(&tzc->tzc_zoneinfo_proto);

	free(tzc->tzc_manifest_path);
	free(tzc->tzc_proto_path);
	custr_free(tzc->tzc_prefix);

	bzero(tzc, sizeof (*tzc));
}

void
tzcheck_init(tzcheck_t *tzc)
{
	bzero(tzc, sizeof (*tzc));

	avl_create(&tzc->tzc_zoneinfo_manifest, tzent_comparator,
	    sizeof (tzent_t), offsetof(tzent_t, tze_node));
	avl_create(&tzc->tzc_zoneinfo_proto, tzent_comparator,
	    sizeof (tzent_t), offsetof(tzent_t, tze_node));

	if (custr_alloc(&tzc->tzc_prefix) != 0 ||
	    strpath_append(tzc->tzc_prefix, cm_pdir) != 0 ||
	    custr_appendc(tzc->tzc_prefix, '/') != 0) {
		err(1, "tzc_prefix setup");
	}
}

static void
record_statbuf(tzcheck_t *tzc, int dirfd, const char *name, struct stat *st)
{
	tzent_t *tze;
	avl_index_t where;

	if ((tze = calloc(1, sizeof (*tze))) == NULL) {
		err(1, "alloc failure");
	}

	tze->tze_path = strdup(name);
	if (S_ISDIR(st->st_mode)) {
		tze->tze_type = ME_TYPE_DIRECTORY;
	} else if (S_ISREG(st->st_mode)) {
		tze->tze_type = ME_TYPE_FILE;
		tze->tze_inode = st->st_ino;
	} else if (S_ISLNK(st->st_mode)) {
		char buf[2 * PATH_MAX];
		ssize_t sz;

		tze->tze_type = ME_TYPE_SYMLINK;

		bzero(buf, sizeof (buf));
		if ((sz = readlinkat(dirfd, name, buf,
		    sizeof (buf))) < 0) {
			err(1, "readlinkat");
		}

		tze->tze_target = strdup(buf);

	} else {
		errx(1, "path \"%s\" of unknown file type", name);
	}

	if (avl_find(&tzc->tzc_zoneinfo_proto, tze, &where) != NULL) {
		errx(1, "path \"%s\" in directory twice?!", name);
	}

	avl_insert(&tzc->tzc_zoneinfo_proto, tze, where);
}

static me_cb_ret_t
record_zoneinfo(manifest_ent_t *me, void *arg)
{
	tzcheck_t *tzc = arg;
	tzent_t *tze;
	avl_index_t where;

	/*
	 * We care only for records within the time zone database
	 * directory.
	 */
	if (strncmp(custr_cstr(tzc->tzc_prefix), me->me_name,
	    custr_len(tzc->tzc_prefix)) != 0) {
		return (MECB_NEXT);
	}

	if ((tze = calloc(1, sizeof (*tze))) == NULL) {
		err(1, "alloc failure");
	}

	tze->tze_path = strdup(me->me_name + custr_len(tzc->tzc_prefix));
	switch (me->me_type) {
	case ME_TYPE_HARDLINK:
		if (strncmp(me->me_target, custr_cstr(tzc->tzc_prefix),
		    custr_len(tzc->tzc_prefix)) != 0) {
			errx(1, "hardlink \"%s\" target did not begin "
			    "with correct prefix (%s)", me->me_target,
			    custr_cstr(tzc->tzc_prefix));
		}
		tze->tze_target = strdup(me->me_target +
		    custr_len(tzc->tzc_prefix));
		tze->tze_type = me->me_type;
		break;

	case ME_TYPE_SYMLINK:
		tze->tze_target = strdup(me->me_target);
		/* FALLTHRU */
	case ME_TYPE_DIRECTORY:
	case ME_TYPE_FILE:
		tze->tze_type = me->me_type;
		break;

	default:
		errx(1, "unexpected type (%d) of \"%s\" in manifest",
		    me->me_type, me->me_name);
	}

	if (avl_find(&tzc->tzc_zoneinfo_manifest, tze, &where) != NULL) {
		errx(1, "path \"%s\" in manifest twice", me->me_name);
	}

	avl_insert(&tzc->tzc_zoneinfo_manifest, tze, where);

	return (MECB_NEXT);
}

static void
usage(int rc, const char *progname _UNUSED)
{
	const char *msg =
	    "Usage: %s [-v] -f manifest -p proto\n"
	    "\n"
	    "Check for consistency between built time zone files in the "
	    "proto area\n"
	    "and shipping directives in the manifest.\n"
	    "\n"
	    "\t-h\t\tShow this message\n"
	    "\n"
	    "\t-f manifest\tManifest file to search\n"
	    "\n"
	    "\t-p proto\tProto area to search\n"
	    "\n"
	    "\t-v\t\tVerbose (print on success as well as on error)\n"
	    "\n";

	(void) fprintf(rc == 0 ? stdout : stderr, msg, progname);
	exit(rc);
}

static void
parse_opts(tzcheck_t *tzc, int argc, char **argv)
{
	int c;

	while ((c = getopt(argc, argv, ":f:hp:v")) != -1) {
		switch (c) {
		case 'f':
			tzc->tzc_manifest_path = strdup(optarg);
			break;
		case 'p':
			tzc->tzc_proto_path = strdup(optarg);
			break;
		case 'h':
			usage(0, argv[0]);
			break;
		case 'v':
			tzc->tzc_verbose = B_TRUE;
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

	if (tzc->tzc_manifest_path == NULL ||
	    strlen(tzc->tzc_manifest_path) < 1) {
		(void) fprintf(stderr, "Must provide '-f manifest' option.\n");
		usage(2, argv[0]);
	}

	if (tzc->tzc_proto_path == NULL ||
	    strlen(tzc->tzc_proto_path) < 1) {
		(void) fprintf(stderr, "Must provide '-p proto' option.\n");
		usage(2, argv[0]);
	}
}

static void
dirwalk(tzcheck_t *tzc, int parentfd, const char *parentdir,
    const char *dirname)
{
	int dirfd;
	DIR *d;
	struct dirent *de;
	int oflags = O_RDONLY | O_LARGEFILE;
	custr_t *cu;
	boolean_t discard_dirname = B_FALSE;

	if (custr_alloc(&cu) != 0) {
		err(1, "custr_alloc");
	}

	if (parentfd == -1) {
		discard_dirname = B_TRUE;

		if ((dirfd = open(parentdir, oflags)) < 0) {
			err(1, "could not open dir \"%s\"", parentdir);
		}
	} else {
		if ((dirfd = openat(parentfd, dirname, oflags)) < 0) {
			err(1, "could not open dir \"%s\"", dirname);
		}
	}

	if ((d = fdopendir(dirfd)) == NULL) {
		err(1, "could not open dir from fd \"%s\"", dirname);
	}

	if (discard_dirname) {
		parentdir = "";
	}

	while ((de = readdir(d)) != NULL) {
		struct stat st;

		if (strcmp(de->d_name, ".") == 0 ||
		    strcmp(de->d_name, "..") == 0) {
			continue;
		}

		if (fstatat(dirfd, de->d_name, &st,
		    AT_SYMLINK_NOFOLLOW) != 0) {
			err(1, "could not stat \"%s/%s\"", dirname,
			    de->d_name);
		}

		custr_reset(cu);
		if (strpath_append(cu, parentdir) != 0 ||
		    strpath_append(cu, de->d_name) != 0) {
			err(1, "strpath_append");
		}

		record_statbuf(tzc, dirfd, custr_cstr(cu), &st);

		if (S_ISDIR(st.st_mode)) {
			dirwalk(tzc, dirfd, custr_cstr(cu), de->d_name);
		}
	}

	VERIFY0(closedir(d));
	custr_free(cu);
}

static tzent_t *
lookup_tzent(avl_tree_t *t, char *path)
{
	tzent_t look;

	bzero(&look, sizeof (look));
	look.tze_path = path;

	return (avl_find(t, &look, NULL));
}

/*
 * Determine if these two paths refer to the same inode in the proto
 * area.
 */
static boolean_t
hardlink_check(avl_tree_t *t, char *path_l, char *path_r)
{
	tzent_t *el = lookup_tzent(t, path_l);
	tzent_t *er = lookup_tzent(t, path_r);

	if (el == NULL || er == NULL) {
		return (B_FALSE);
	}

	if (el->tze_inode == 0 || er->tze_inode == 0) {
		warnx("wanted inode check, but inode was 0 (%s, %s)",
		    path_l, path_r);
		return (B_FALSE);
	}

	return (el->tze_inode == er->tze_inode);
}

static void
load_from_proto(tzcheck_t *tzc)
{
	custr_t *cu;

	if (custr_alloc(&cu) != 0) {
		err(1, "custr_alloc");
	}
	if (strpath_append(cu, tzc->tzc_proto_path) != 0 ||
	    strpath_append(cu, cm_pdir) != 0) {
		err(1, "strpath_append");
	}

	dirwalk(tzc, -1, custr_cstr(cu), NULL);

	custr_free(cu);
}

int
main(int argc, char **argv)
{
	int rval = 0;
	tzcheck_t tzc;

	tzcheck_init(&tzc);

	parse_opts(&tzc, argc, argv);

	/*
	 * Read the manifest file once to populate the list of shipped
	 * time zone files.
	 */
	if (read_manifest_file(tzc.tzc_manifest_path, record_zoneinfo,
	    &tzc) != 0) {
		warn("could not read manifest file \"%s\"",
		    tzc.tzc_manifest_path);
		rval = 50;
		goto out;
	}

	/*
	 * Walk the zoneinfo tree in the proto area for comparison.
	 */
	load_from_proto(&tzc);

	/*
	 * For each file or directory in the proto area, look up associated
	 * manifest record and ensure that they are consistent.
	 */
	int errors = 0;
	for (tzent_t *pp = avl_first(&tzc.tzc_zoneinfo_proto); pp != NULL;
	    pp = AVL_NEXT(&tzc.tzc_zoneinfo_proto, pp)) {
		tzent_t *mp;

		errors++;

		/*
		 * Locate the manifest entry for this time zone file.
		 */
		if ((mp = lookup_tzent(&tzc.tzc_zoneinfo_manifest,
		    pp->tze_path)) == NULL) {
			fprintf(stdout, "missing from manifest: %s\n",
			    pp->tze_path);
			continue;
		}

		/*
		 * A hard link in the manifest will appear as a regular
		 * file in the filesystem.
		 */
		manifest_ent_type_t mptype = (mp->tze_type ==
		    ME_TYPE_HARDLINK) ? ME_TYPE_FILE : mp->tze_type;
		if (pp->tze_type != mptype) {
			fprintf(stdout, "type mismatch: %s\n",
			    mp->tze_path);
			fprintf(stdout, "\tproto:    %s\n",
			    manifest_ent_type_name(pp->tze_type));
			fprintf(stdout, "\tmanifest: %s\n",
			    manifest_ent_type_name(mp->tze_type));
			continue;
		}

		/*
		 * If this is a symbolic link, check the target.
		 */
		if (pp->tze_type == ME_TYPE_SYMLINK &&
		    strcmp(pp->tze_target, mp->tze_target) != 0) {
			fprintf(stdout, "symlink target mismatch: %s\n",
			    pp->tze_path);
			fprintf(stdout, "\tproto:    %s\n",
			    pp->tze_target);
			fprintf(stdout, "\tmanifest: %s\n",
			    mp->tze_target);
			continue;
		}

		errors--;

		if (tzc.tzc_verbose) {
			fprintf(stdout, "ok: %s\n", pp->tze_path);
		}
	}

	/*
	 * For each hardlink record in the manifest, check that the proto
	 * area reflects the choice of hardlink target.
	 */
	for (tzent_t *mp = avl_first(&tzc.tzc_zoneinfo_manifest); mp != NULL;
	    mp = AVL_NEXT(&tzc.tzc_zoneinfo_manifest, mp)) {
		if (mp->tze_type != ME_TYPE_HARDLINK) {
			continue;
		}

		errors++;

		if (!hardlink_check(&tzc.tzc_zoneinfo_proto, mp->tze_path,
		    mp->tze_target)) {
			fprintf(stdout, "hardlink mismatch: %s\n",
			    mp->tze_path);
			fprintf(stdout, "\tmanifest: %s\n",
			    mp->tze_target);
			fprintf(stdout, "\tproto:    check manually\n");
			continue;
		}

		errors--;
	}

	if (errors > 0) {
		fprintf(stdout, "\ntime zone errors found: %d\n", errors);
		rval = 60;
	}

out:
	tzcheck_reset(&tzc);
	if (getenv("ABORT_ON_EXIT") != NULL) {
		fprintf(stderr, "abort on exit for findleaks (status %d)\n",
		    rval);
		abort();
	}
	return (rval);
}
