/*
 * Copyright 2015 Joyent, Inc.
 */

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <err.h>
#include <strings.h>

#include "users.h"
#include "copyfile.h"
#include "strlist.h"
#include "strset.h"
#include "manifest.h"
#include "custr.h"

/*
 * Maximum number of input directories to search:
 */
#define	MAX_DIRS	32

typedef struct builder {
	char *b_passwd_dir;
	char *b_output_dir;
	char *b_manifest_file;
	strset_t *b_paths;
	strlist_t *b_search_dirs;
	builder_ids_t *b_ids;
	boolean_t b_quiet;
	char *b_errbuf;
	custr_t *b_error;
} builder_t;

static void
usage(int status, char *msg)
{
	if (msg != NULL) {
		(void) fprintf(status == 0 ? stdout : stderr, "%s\n", msg);
	}

	(void) fprintf(status == 0 ? stdout : stderr,
	    "Usage: builder -p passwd_dir <manifest_file> <output_dir>\n"
	    "           <input_dir>...\n"
	    "\n");

	exit(status);
}

static void
emit(builder_t *b, const char *fmt, ...)
{
	va_list ap;

	if (b->b_quiet) {
		return;
	}

	va_start(ap, fmt);
	(void) vfprintf(stdout, fmt, ap);
	va_end(ap);
}

static void
parse_opts(builder_t *b, int argc, char **argv)
{
	int c, i;
	char *pflag = NULL;

	while ((c = getopt(argc, argv, ":p:q")) != -1) {
		switch (c) {
		case 'p':
			pflag = optarg;
			break;
		case 'q':
			b->b_quiet = B_TRUE;
			break;
		case ':':
			(void) fprintf(stderr, "Option -%c requires an "
			    "operand\n", optopt);
			usage(1, NULL);
			break;
		case '?':
			(void) fprintf(stderr, "Unrecognised option: -%c\n",
			    optopt);
			usage(1, NULL);
			break;
		}
	}

	if (pflag == NULL) {
		usage(1, "must specify passwd directory with -p");
	} else if ((b->b_passwd_dir = strdup(pflag)) == NULL) {
		err(1, "strdup failure");
	}

	if ((argc - optind) < 3) {
		usage(1, "must provide manifest, output directory and input"
		    "directories");
	}

	if (argv[optind][0] != '/') {
		usage(1, "manifest file must be an absolute path");
	} else if ((b->b_manifest_file = strdup(argv[optind])) == NULL) {
		err(1, "strdup failure");
	}

	if (argv[optind + 1][0] != '/') {
		usage(1, "output directory must be an absolute path");
	} else if ((b->b_output_dir = strdup(argv[optind + 1])) == NULL) {
		err(1, "strdup failure");
	}

	for (i = optind + 2; i < argc; i++) {
		if (argv[i][0] != '/') {
			usage(1, "input directory must be an absolute path");
		}

		if (strlist_set_tail(b->b_search_dirs, argv[i]) != 0) {
			err(1, "strlist_set_tail failure");
		}
	}
	if (strlist_contig_count(b->b_search_dirs) < 1) {
		usage(1, "must provide at least one input directory");
	}
}

static int
map_user_and_group(builder_t *b, const char *user, uid_t *u,
    const char *group, gid_t *g)
{
	int e;

	if (uid_from_name(b->b_ids, user, u) != 0) {
		if (errno != ENOENT) {
			e = errno;
			goto fail;
		}

		(void) custr_append_printf(b->b_error, "user \"%s\" not find "
		    "in passwd file", user);
		errno = ENOENT;
		return (-1);
	}

	if (gid_from_name(b->b_ids, group, g) != 0) {
		if (errno != ENOENT) {
			e = errno;
			goto fail;
		}

		(void) custr_append_printf(b->b_error, "group \"%s\" not find "
		    "in group file", group);
		errno = ENOENT;
		return (-1);
	}

	return (0);

fail:
	(void) custr_append_printf(b->b_error, "id lookup failure: %s",
	    strerror(errno));
	errno = e;
	return (-1);
}

static me_cb_ret_t
handle_link_common(manifest_ent_t *me, void *arg, manifest_ent_type_t type)
{
	int e;
	builder_t *b = arg;
	const char *op = NULL;

	if (me->me_type != type) {
		return (MECB_NEXT);
	}

	emit(b, "LINK(%s): %s => %s: ",
	    me->me_type == ME_TYPE_HARDLINK ? "link" : "symlink",
	    me->me_name, me->me_target);

	op = "unlinking target";
	if (unlink(me->me_name) != 0 && errno != ENOENT) {
		e = errno;
		goto fail;
	}

	if (me->me_type == ME_TYPE_HARDLINK) {
		op = "hardlinking";
		if (link(me->me_target, me->me_name) != 0) {
			e = errno;
			goto fail;
		}
	} else {
		op = "symlinking";
		if (symlink(me->me_target, me->me_name) != 0) {
			e = errno;
			goto fail;
		}
	}

	emit(b, "OK\n");
	return (MECB_NEXT);

fail:
	emit(b, "FAILED\n");
	(void) custr_append_printf(b->b_error, "%s failed for \"%s\": %s",
	    op, me->me_name, strerror(errno));
	errno = e;
	return (MECB_CANCEL);
}

static me_cb_ret_t
handle_hardlink(manifest_ent_t *me, void *arg)
{
	return (handle_link_common(me, arg, ME_TYPE_HARDLINK));
}

static me_cb_ret_t
handle_symlink(manifest_ent_t *me, void *arg)
{
	return (handle_link_common(me, arg, ME_TYPE_SYMLINK));
}

static me_cb_ret_t
handle_file(manifest_ent_t *me, void *arg)
{
	int e;
	builder_t *b = arg;
	const char *op = NULL;
	char *p = NULL;
	boolean_t found = B_FALSE;
	uid_t u;
	gid_t g;

	if (me->me_type != ME_TYPE_FILE) {
		return (MECB_NEXT);
	}

	op = "mapping user/group";
	if (map_user_and_group(b, me->me_user, &u, me->me_group, &g) != 0) {
		e = errno;
		goto fail;
	}

	emit(b, "FILE: [%s][%04o][%s/%d][%s/%d]: ", me->me_name,
	    (unsigned int)me->me_mode, me->me_user, u, me->me_group, g);

	/*
	 * Look in each search directory and find the first one that this
	 * file appears in:
	 */
	op = "locating source file";
	for (unsigned int i = 0; i < strlist_contig_count(b->b_search_dirs);
	    i++) {
		struct stat st;

		free(p);
		if (asprintf(&p, "%s/%s", strlist_get(b->b_search_dirs, i),
		    me->me_name) < 0) {
			err(1, "asprintf failure");
		}

		if (stat(p, &st) == 0 && S_ISREG(st.st_mode)) {
			found = B_TRUE;
			break;
		}
	}

	if (!found) {
		e = ENOENT;
		goto fail;
	}

	op = "unlinking target";
	if (unlink(me->me_name) != 0 && errno != ENOENT) {
		e = errno;
		goto fail;
	}

	op = "copying file";
	if (builder_copy_file(p, me->me_name) != 0) {
		e = errno;
		goto fail;
	}

	op = "chown";
	if (chown(me->me_name, u, g) != 0) {
		e = errno;
		goto fail;
	}

	op = "chmod";
	if (chmod(me->me_name, me->me_mode) != 0) {
		e = errno;
		goto fail;
	}

	emit(b, "OK (%s)\n", p);
	free(p);
	return (MECB_NEXT);

fail:
	free(p);
	emit(b, "FAILED\n");
	(void) custr_append_printf(b->b_error, "%s failed for \"%s\": %s",
	    op, me->me_name, strerror(errno));
	errno = e;
	return (MECB_CANCEL);
}

static me_cb_ret_t
handle_directory(manifest_ent_t *me, void *arg)
{
	int e;
	const char *op = NULL;
	builder_t *b = arg;
	uid_t u;
	gid_t g;

	if (me->me_type != ME_TYPE_DIRECTORY) {
		return (MECB_NEXT);
	}

	op = "mapping user/group";
	if (map_user_and_group(b, me->me_user, &u, me->me_group, &g) != 0) {
		e = errno;
		goto fail;
	}

	emit(b, "DIR: [%s][%04o][%s/%d][%s/%d]: ", me->me_name,
	    (unsigned int)me->me_mode, me->me_user, u, me->me_group, g);

	op = "mkdir";
	if (mkdir(me->me_name, me->me_mode) != 0 && errno != EEXIST) {
		e = errno;
		goto fail;
	}

	op = "chown";
	if (chown(me->me_name, u, g) != 0) {
		e = errno;
		goto fail;
	}

	op = "chmod";
	if (chmod(me->me_name, me->me_mode) != 0) {
		e = errno;
		goto fail;
	}

	emit(b, "OK\n");
	return (MECB_NEXT);

fail:
	emit(b, "FAILED\n");
	(void) custr_append_printf(b->b_error, "%s failed for \"%s\": %s",
	    op, me->me_name, strerror(errno));
	errno = e;
	return (MECB_CANCEL);
}

static me_cb_ret_t
sanity_check(manifest_ent_t *me, void *arg)
{
	builder_t *b = arg;
	uid_t u;
	gid_t g;

	/*
	 * Check for duplicate entries in the manifest file.
	 */
	if (strset_add(b->b_paths, me->me_name) != 0) {
		if (errno != EEXIST) {
			err(1, "strset_add failure");
		}

		(void) custr_append_printf(b->b_error, "duplicate entry \"%s\"",
		    me->me_name);
		return (MECB_CANCEL);
	}

	/*
	 * Check that all user and group names map to valid entries in the
	 * shipped /etc/passwd and /etc/group databases.
	 */
	switch (me->me_type) {
	case ME_TYPE_DIRECTORY:
	case ME_TYPE_FILE:
		if (map_user_and_group(b, me->me_user, &u, me->me_group,
		    &g) != 0) {
			return (MECB_CANCEL);
		}
		break;

	default:
		break;
	}

	return (MECB_NEXT);
}

struct builder_pass {
	char *bp_name;
	manifest_ent_cb_t *bp_func;
} builder_passes[] = {
	{ "checking manifest",		sanity_check },
	{ "creating directories",	handle_directory },
	{ "copying files",		handle_file },
	{ "creating symlinks",		handle_symlink },
	{ "creating hardlinks",		handle_hardlink },
	{ NULL,				NULL }
};

static void
builder_free(builder_t *b)
{
	if (b == NULL) {
		return;
	}

	strlist_free(b->b_search_dirs);
	strset_free(b->b_paths);

	custr_free(b->b_error);
	free(b->b_errbuf);

	free(b->b_passwd_dir);
	free(b->b_output_dir);
	free(b->b_manifest_file);

	free(b);
}

static int
builder_alloc(builder_t **bpp)
{
	size_t errsz = 2048;
	builder_t *b;

	if ((b = calloc(1, sizeof (*b))) == NULL) {
		*bpp = NULL;
		return (-1);
	}

	if ((b->b_errbuf = calloc(errsz, sizeof (char))) == NULL ||
	    strlist_alloc(&b->b_search_dirs, MAX_DIRS) != 0 ||
	    custr_alloc_buf(&b->b_error, b->b_errbuf, errsz) != 0 ||
	    strset_alloc(&b->b_paths, 0) != 0) {
		builder_free(b);
		*bpp = NULL;
		return (-1);
	}

	*bpp = b;
	return (0);
}

int
main(int argc, char **argv)
{
	builder_t *b = NULL;
	const char *c;

	if (geteuid() != 0) {
		errx(1, "must be root to use this tool");
	}

	if (builder_alloc(&b) != 0) {
		err(1, "builder_t alloc failure");
	}

	parse_opts(b, argc, argv);

	if (builder_ids_init(&b->b_ids, b->b_passwd_dir) != 0) {
		err(1, "failed to read passwd/group files");
	}

	(void) fprintf(stdout, "MANIFEST:   %s\n", b->b_manifest_file);
	(void) fprintf(stdout, "OUTPUT:     %s\n", b->b_output_dir);
	for (int i = 0; (c = strlist_get(b->b_search_dirs, i)) != NULL;
	    i++) {
		(void) fprintf(stdout, "SEARCH[%02d]: %s\n", i, c);
	}

	if (chdir(b->b_output_dir) != 0) {
		err(1, "failed to change to output directory (%s)",
		    b->b_output_dir);
	}

	for (int i = 0; builder_passes[i].bp_name != NULL; i++) {
		struct builder_pass *bp = &builder_passes[i];

		(void) fprintf(stdout, "builder pass: %s\n", bp->bp_name);
		if (read_manifest_file(b->b_manifest_file, bp->bp_func,
		    b) != 0) {
			if (errno == ECANCELED) {
				errx(1, "builder pass \"%s\" failed: %s",
				    bp->bp_name, custr_cstr(b->b_error));
			} else {
				err(1, "reading manifest \"%s\" failed",
				    b->b_manifest_file);
			}
		}
	}

	builder_free(b);
	return (0);
}
