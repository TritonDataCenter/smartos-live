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
 * Copyright 2019 Joyent, Inc.
 */

/*
 * Verify that all of the microcode files that we care about are shipped.
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
#include <limits.h>
#include <unistd.h>

#include "common.h"
#include "parser.h"
#include "manifest.h"
#include "custr.h"
#include "strpath.h"

static const char *ucc_progname;
static const char *amd_ucodedir = "platform/i86pc/ucode/AuthenticAMD";
static const char *intc_ucodedir = "platform/i86pc/ucode/GenuineIntel";

typedef struct ucodecheck {
	const char	*ucc_manifest_path;
	const char	*ucc_proto_path;
	int		ucc_proto_dir;
	boolean_t	ucc_verbose;
	avl_tree_t	ucc_manifest_ents;
	avl_tree_t	ucc_proto_ents;
	uint_t		ucc_errors;
} ucodecheck_t;

typedef struct ucode_ent {
	avl_node_t uce_node;
	char *uce_name;
} ucode_ent_t;

static int
ucode_ent_comparator(const void *l, const void *r)
{
	int ret;
	const ucode_ent_t *ll = l, *rr = r;

	ret = strcmp(ll->uce_name, rr->uce_name);
	return (ret < 0 ? -1 : ret > 0 ? 1 : 0);
}

/*
 * We only concern ourselves with files that match the directory
 */
static me_cb_ret_t
ucc_manifest_cb(manifest_ent_t *me, void *arg)
{
	ucodecheck_t *ucc = arg;
	ucode_ent_t *ent;
	avl_index_t where;

	static size_t intc_len = 0;
	static size_t amd_len = 0;

	if (amd_len == 0) {
		amd_len = strlen(amd_ucodedir);
	}

	if (intc_len == 0) {
		intc_len = strlen(intc_ucodedir);
	}

	if (strncmp(amd_ucodedir, me->me_name, amd_len) != 0 &&
	    strncmp(intc_ucodedir, me->me_name, intc_len) != 0) {
		return (MECB_NEXT);
	}

	/*
	 * The only entries we expect in here are files and links and the
	 * directory entry themselves. If for some reason they exist, then we
	 * need to error and figure out what happened.
	 */
	if (me->me_type != ME_TYPE_FILE && me->me_type != ME_TYPE_HARDLINK) {
		if (me->me_type == ME_TYPE_DIRECTORY)
			return (MECB_NEXT);

		err(EXIT_FAILURE, "encountered manifest entry (%s) with "
		    "unexpected type: %u", me->me_name, me->me_type);
	}

	if ((ent = malloc(sizeof (ucode_ent_t))) == NULL) {
		err(EXIT_FAILURE, "failed to allocate memory for ucode entry "
		    "for manifest entry %s", me->me_name);
	}

	ent->uce_name = strdup(me->me_name);
	if (ent->uce_name == NULL) {
		err(EXIT_FAILURE, "failed to duplicate name for ucode entry "
		    "%s", ent->uce_name);
	}

	if (avl_find(&ucc->ucc_manifest_ents, ent, &where) != NULL) {
		err(EXIT_FAILURE, "encountered duplicated ucode entry for %s",
		    ent->uce_name);
	}

	avl_insert(&ucc->ucc_manifest_ents, ent, where);

	return (MECB_NEXT);
}

static void
ucc_read_proto(ucodecheck_t *ucc, const char *dir)
{
	uint_t nfound = 0;
	int dirfd;
	DIR *d;
	struct dirent *dp;

	if ((dirfd = openat(ucc->ucc_proto_dir, dir, O_RDONLY)) < 0) {
		err(EXIT_FAILURE, "failed to open proto directory %s, current "
		    "root is at %s", dir, ucc->ucc_proto_path);
	}

	if ((d = fdopendir(dirfd)) == NULL) {
		err(EXIT_FAILURE, "failed to turn proto fd dir to DIR *");
	}

	while ((dp = readdir(d)) != NULL) {
		struct stat st;
		ucode_ent_t *ent;
		avl_index_t where;

		if (strcmp(dp->d_name, ".") == 0)
			continue;
		if (strcmp(dp->d_name, "..") == 0)
			continue;

		if (fstatat(dirfd, dp->d_name, &st, AT_SYMLINK_NOFOLLOW) != 0) {
			err(EXIT_FAILURE, "failed to stat \"%s/%s\"", dir,
			    dp->d_name);
		}

		if (!S_ISREG(st.st_mode)) {
			errx(EXIT_FAILURE, "encountered non-regular file at "
			    "\"%s/%s\"", dir, dp->d_name);
		}


		if ((ent = malloc(sizeof (ucode_ent_t))) == NULL) {
			err(EXIT_FAILURE, "failed to allocate memory for "
			    "ucode entry for proto entry %s/%s", dir,
			    dp->d_name);
		}

		if (asprintf(&ent->uce_name, "%s/%s", dir, dp->d_name) == -1) {
			err(EXIT_FAILURE, "failed to duplicate name for ucode "
			    "entry %s", ent->uce_name);
		}

		if (avl_find(&ucc->ucc_proto_ents, ent, &where) != NULL) {
			errx(EXIT_FAILURE, "encountered duplicated ucode entry "
			    "for %s", ent->uce_name);
		}

		avl_insert(&ucc->ucc_proto_ents, ent, where);

		nfound++;
	}

	if (nfound == 0) {
		errx(EXIT_FAILURE, "failed to find ucode files at \"%s/%s\", "
		    "suspicious build", dir, dp->d_name);
	}

	if (closedir(d) != 0) {
		err(EXIT_FAILURE, "failed to close directory %s", dir);
	}

	if (ucc->ucc_verbose) {
		printf("found %u entries in %s\n", nfound, dir);
	}
}

/*
 * For each entry in the proto AVL, make sure we found the corresponding entry
 * in the manifest. Note we don't check the reverse (that every entry in the
 * manifest is here) as that is the job of the general build tools.
 */
static void
ucc_check_proto(ucodecheck_t *ucc)
{
	ucode_ent_t *ent;

	for (ent = avl_first(&ucc->ucc_proto_ents); ent != NULL;
	    ent = AVL_NEXT(&ucc->ucc_proto_ents, ent)) {
		ucode_ent_t *manifest;

		manifest = avl_find(&ucc->ucc_manifest_ents, ent, NULL);
		if (manifest == NULL) {
			(void) fprintf(stderr, "missing from manifest: %s\n",
			    ent->uce_name);
			ucc->ucc_errors++;
			continue;
		}

		if (ucc->ucc_verbose) {
			(void) printf("%s OK\n", ent->uce_name);
		}
	}
}

static void
ucc_usage(const char *fmt, ...)
{
	if (fmt != NULL) {
		va_list ap;

		(void) fprintf(stderr, "%s: ", ucc_progname);
		va_start(ap, fmt);
		(void) vfprintf(stderr, fmt, ap);
		va_end(ap);
		(void) fputs("\n", stderr);
	}

	(void) fprintf(stderr, "Usage: %s [-v] -f manifest -p proto\n"
	    "\n"
	    "Check for consistency between microcode files in the proto area "
	    "and manifest\n"
	    "\n"
	    "\t-f  Use manifest file manifest to search\n"
	    "\t-h  Show this message\n"
	    "\t-p  Path to proto area to search\n"
	    "\t-v  Verbose (print on success as well as on error)\n",
	    ucc_progname);
}

int
main(int argc, char *argv[])
{
	int c, fd;
	ucodecheck_t ucc;

	ucc_progname = basename(argv[0]);
	bzero(&ucc, sizeof (ucc));

	while ((c = getopt(argc, argv, ":f:hp:v")) != -1) {
		switch (c) {
		case 'f':
			ucc.ucc_manifest_path = strdup(optarg);
			if (ucc.ucc_manifest_path == NULL) {
				err(EXIT_FAILURE, "failed to allocate memory "
				    "for manifest path");
			}
			break;
		case 'p':
			ucc.ucc_proto_path = strdup(optarg);
			if (ucc.ucc_proto_path == NULL) {
				err(EXIT_FAILURE, "failed to allocate memory "
				    "for proto path");
			}
			break;
		case 'h':
			ucc_usage(NULL);
			return (2);
		case 'v':
			ucc.ucc_verbose = B_TRUE;
			break;
		case ':':
			ucc_usage("Option -%c requires an operand\n", optopt);
			return (2);
		case '?':
			ucc_usage("Unrecognised option: -%c\n", optopt);
			return (2);
		}
	}

	if (ucc.ucc_manifest_path == NULL) {
		ucc_usage("missing required manifest path (-f)");
		return (2);
	}

	if (ucc.ucc_proto_path == NULL) {
		ucc_usage("missing required proto path (-p)");
		return (2);
	}

	if ((fd = open(ucc.ucc_proto_path, O_RDONLY)) < 0) {
		err(EXIT_FAILURE, "failed to open proto path %s",
		    ucc.ucc_proto_path);
	}
	ucc.ucc_proto_dir = fd;

	avl_create(&ucc.ucc_manifest_ents, ucode_ent_comparator,
	    sizeof (ucode_ent_t), offsetof(ucode_ent_t, uce_node));
	avl_create(&ucc.ucc_proto_ents, ucode_ent_comparator,
	    sizeof (ucode_ent_t), offsetof(ucode_ent_t, uce_node));

	if (read_manifest_file(ucc.ucc_manifest_path, ucc_manifest_cb,
	    &ucc) != 0) {
		err(EXIT_FAILURE, "failed to read manifest file\n");
	}

	ucc_read_proto(&ucc, amd_ucodedir);
	ucc_read_proto(&ucc, intc_ucodedir);

	ucc_check_proto(&ucc);

	if (ucc.ucc_errors > 0) {
		errx(EXIT_FAILURE, "ucode errors found: %u", ucc.ucc_errors);
	}

	return (0);
}
