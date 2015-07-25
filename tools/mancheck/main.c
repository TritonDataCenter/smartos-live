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
#include <errno.h>
#include <dirent.h>
#include <fnmatch.h>
#include <ctype.h>

#include "common.h"
#include "strset.h"
#include "parser.h"
#include "manifest.h"
#include "custr.h"

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
	MCF_NOT_SHIPPED = 0x2,
	MCF_WHOLE_SECTS = 0x4,
	MCF_DUMP_CONFIG = 0x8
} mancheck_flags_t;

typedef struct mancheck {
	mancheck_flags_t mc_flags;
	char *mc_manifest_path;
	strset_t *mc_config_paths;

	unsigned long mc_cnt_dont_exist;
	unsigned long mc_cnt_not_shipped;
	unsigned long mc_cnt_whole_sects;

	strset_t *mc_shiplist;

	strset_t *mc_section_includes;
	strset_t *mc_section_excludes;
	strset_t *mc_page_excludes;
} mancheck_t;

static void
mancheck_reset(mancheck_t *mc)
{
	free(mc->mc_manifest_path);

	strset_free(mc->mc_shiplist);
	strset_free(mc->mc_config_paths);

	strset_free(mc->mc_section_includes);
	strset_free(mc->mc_section_excludes);
	strset_free(mc->mc_page_excludes);

	bzero(mc, sizeof (*mc));
}

static void
usage(int rc, const char *progname)
{
	const char *msg =
	    "Usage: %s -f manifest [ -c mancheck.conf [ -c ... ]]\n"
	    "\t\t\t\t[ -m | -s ] [ -D ]\n"
	    "\n"
	    "Validate that all binaries mentioned in 'manifest' have man "
	    "pages and that they\n"
	    "are present in 'manifest'.\n"
	    "\n"
	    "\t-h\t\t\tShow this message\n"
	    "\n"
	    "\t-f manifest\t\tManifest file to search\n"
	    "\t-c mancheck.conf\tMancheck configuration file(s) to read\n"
	    "\t-m\t\t\tOnly warn for man pages which don't exist\n"
	    "\t-s\t\t\tOnly warn for man pages which aren't shipped\n"
	    "\t-D\t\t\tDump configuration file directives\n"
	    "\n";

	(void) fprintf(rc == 0 ? stdout : stderr, msg, progname);
	exit(rc);
}

static void
parse_opts(mancheck_t *mc, int argc, char **argv)
{
	int c;
	int mflag = 0, sflag = 0, Dflag = 0;

	while ((c = getopt(argc, argv, ":c:Df:hms")) != -1) {
		switch (c) {
		case 'c':
			if (strset_add(mc->mc_config_paths, optarg) != 0) {
				err(1, "strset_add failure");
			}
			break;
		case 'D':
			Dflag++;
			break;
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

	/*
	 * If configuration files were passed in, we attempt to use them to
	 * do the whole-section checks that can be specified through these
	 * files.
	 */
	if (strset_count(mc->mc_config_paths) > 0) {
		mc->mc_flags |= MCF_WHOLE_SECTS;
	}

	if (Dflag) {
		/*
		 * The -D flag disables all other behaviours.
		 */
		mc->mc_flags = MCF_DUMP_CONFIG;
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
					err(1, "strset_add failure (%s)",
					    fullp);
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

static strset_walk_t
strset_fnmatch_walker(strset_t *ss _UNUSED, const char *pattern, void *arg0,
    void *arg1)
{
	const char *input = arg0;
	int *count = arg1;

	switch (fnmatch(pattern, input, FNM_PATHNAME)) {
	case 0:
		(*count)++;
		return (STRSET_WALK_NEXT);

	case FNM_NOMATCH:
		return (STRSET_WALK_NEXT);

	default:
		err(1, "fnmatch failure");
	}
}

static int
strset_fnmatch(strset_t *set, const char *input)
{
	int count = 0;

	if (strset_walk(set, strset_fnmatch_walker, (void *)input,
	    &count) != 0) {
		err(1, "strset_walk failure");
	}

	return (count);
}

static int
check_whole_sect_dir(const char *sect, const char *sectpath, mancheck_t *mc)
{
	int e = 0;
	DIR *dir;
	custr_t *shipname = NULL, *path = NULL;

	if ((dir = opendir(sectpath)) == NULL) {
		if (errno == ENOENT) {
			/*
			 * Some manual sections may not appear in every
			 * source directory.
			 */
			return (0);
		}
		fprintf(stderr, "opendir failure\n");
		return (-1);
	}

	if (custr_alloc(&shipname) != 0 || custr_alloc(&path) != 0) {
		e = errno;
		goto out;
	}

	for (;;) {
		struct dirent *de;
		struct stat st;

top:
		errno = 0;
		if ((de = readdir(dir)) == NULL) {
			e = errno;
			goto out;
		}

		if (strcmp(de->d_name, ".") == 0 ||
		    strcmp(de->d_name, "..") == 0 ||
		    strlen(de->d_name) < 1) {
			/*
			 * Ignore special directory entries.
			 */
			continue;
		}

		custr_reset(path);
		if (custr_append_printf(path, "%s/%s", sectpath,
		    de->d_name) != 0) {
			e = errno;
			fprintf(stderr, "custr_append_printf failure\n");
			goto out;
		}

		if (lstat(custr_cstr(path), &st) != 0) {
			e = errno;
			fprintf(stderr, "lstat(%s) failed: %s\n",
			    custr_cstr(path), strerror(errno));
			goto out;
		}

		if (!S_ISREG(st.st_mode) && !S_ISLNK(st.st_mode)) {
			/*
			 * We only care about files or symlinks.
			 */
			continue;
		}

		if (strset_fnmatch(mc->mc_page_excludes, de->d_name) > 0) {
			/*
			 * Do not ship this page.
			 */
			goto top;
		}

		/*
		 * The shipped page list contains strings of the form
		 * "<cm_pdir>/man<sect>/pagename.<sect>".
		 */
		custr_reset(shipname);
		if (custr_append_printf(shipname, "%s/man%s/%s",
		    cm_pdir, sect, de->d_name) != 0) {
			e = errno;
			fprintf(stderr, "custr_append_printf failure\n");
			goto out;
		}

		if (!strset_contains(mc->mc_shiplist, custr_cstr(shipname))) {
			(void) fprintf(stdout, "section %s page not shipped:"
			    " %s\n", sect, custr_cstr(path));
			mc->mc_cnt_whole_sects++;
		}
	}

out:
	custr_free(path);
	custr_free(shipname);
	VERIFY0(closedir(dir));
	errno = e;
	return (e == 0 ? 0 : -1);
}

static strset_walk_t
check_whole_sect(strset_t *ss _UNUSED, const char *sect, void *arg0,
    void *arg1)
{
	mancheck_t *mc = arg0;
	custr_t *tmp = arg1;

	/*
	 * For each manual page directory:
	 */
	for (int i = 0; cm_mpaths[i] != NULL; i++) {
		/*
		 * Construct the full path of the manual page section:
		 */
		custr_reset(tmp);
		if (custr_append_printf(tmp, "%s/man%s",
		    cm_mpaths[i], sect) != 0) {
			err(1, "custr_append_printf failure");
		}

		if (check_whole_sect_dir(sect, custr_cstr(tmp), mc) != 0) {
			(void) fprintf(stderr, "ERROR: failed to check "
			    "section %s in directory %s: %s\n",
			    sect, custr_cstr(tmp),
			    strerror(errno));
		}
	}

	return (STRSET_WALK_NEXT);
}

static int
check_whole_sects(mancheck_t *mc)
{
	int e = 0;
	custr_t *sectpath = NULL;
	strset_t *wholesects = NULL;
	DIR *dir = NULL;

	if (custr_alloc(&sectpath) != 0 || strset_alloc(&wholesects,
	    STRSET_IGNORE_DUPLICATES) != 0) {
		e = errno;
		goto out;
	}

	/*
	 * Build manual page section list.  For each manual page
	 * directory:
	 */
	for (int i = 0; cm_mpaths[i] != NULL; i++) {
		if ((dir = opendir(cm_mpaths[i])) == NULL) {
			e = errno;
			(void) fprintf(stderr, "ERROR: failed to open "
			    "directory %s: %s\n", cm_mpaths[i],
			    strerror(errno));
			goto out;
		}

		for (;;) {
			struct dirent *de;

			errno = 0;
			if ((de = readdir(dir)) == NULL) {
				break;
			}

			if (strcmp(de->d_name, ".") == 0 ||
			    strcmp(de->d_name, "..") == 0 ||
			    strlen(de->d_name) < 1) {
				continue;
			}

			if (strncmp(de->d_name, "man", 3) != 0) {
				/*
				 * Ignore directories that do not begin with the
				 * "man" prefix.
				 */
				continue;
			}

			/*
			 * Check to see if this section name is excluded by a
			 * section exclusion directive:
			 */
			if (strset_fnmatch(mc->mc_section_excludes,
			    de->d_name + 3) > 0) {
				continue;
			}

			/*
			 * Check to see if this section name is included by
			 * any section inclusion directives:
			 */
			if (strset_fnmatch(mc->mc_section_includes,
			    de->d_name + 3) < 1) {
				continue;
			}

			if (strset_add(wholesects, de->d_name + 3) != 0) {
				e = errno;
				goto out;
			}
		}

		VERIFY0(closedir(dir));
		dir = NULL;
	}

	VERIFY0(strset_walk(wholesects, check_whole_sect, mc, sectpath));

out:
	if (dir != NULL) {
		VERIFY0(closedir(dir));
	}
	strset_free(wholesects);
	custr_free(sectpath);
	errno = e;
	return (e == 0 ? 0 : -1);
}

static strset_walk_t
read_config_file(strset_t *ss _UNUSED, const char *config_path, void *arg0,
    void *arg1 _UNUSED)
{
	int c = EOF;
	FILE *f;
	mancheck_t *mc _UNUSED = arg0;
	enum state {
		ST_REST = 1,
		ST_COMMENT_0,
		ST_COMMENT_1,
		ST_COMMENT_2,
		ST_PRE_STRING,
		ST_STRING,
		ST_PRE_SEMICOLON,
		ST_KEYWORD
	} state = ST_REST, comment_state = ST_REST;
	char type = '?';
	custr_t *keyword = NULL;
	custr_t *value = NULL;

	if (custr_alloc(&keyword) != 0 || custr_alloc(&value) != 0) {
		err(1, "custr_alloc failure");
	}

	if ((f = fopen(config_path, "r")) == NULL) {
		err(1, "could not open config file \"%s\"", config_path);
	}

	if (!is_regular_file(f)) {
		errx(1, "\"%s\" is not a regular file", config_path);
	}

	for (;;) {
		/*
		 * Attempt to read a character from the input file:
		 */
		errno = 0;
		if ((c = fgetc(f)) == EOF) {
			if (errno != 0) {
				err(1, "error reading file");
			}
			if (state != ST_REST) {
				errx(1, "unexpected end of file \"%s\"",
				    config_path);
			}
			goto out;
		}

top:
		switch (state) {
		case ST_REST:
		case ST_PRE_STRING:
		case ST_PRE_SEMICOLON:
			if (c == '/') {
				/*
				 * Begin comment.
				 */
				comment_state = state;
				state = ST_COMMENT_0;
				continue;
			}
			break;
		default:
			break;
		}

		switch (state) {
		case ST_REST:
			if (isspace(c)) {
				/*
				 * Eat whitespace.
				 */
				continue;
			} else if (c == '+' || c == '-') {
				/*
				 * Begin +page, -section or +section:
				 */
				type = c;
				custr_reset(keyword);
				custr_reset(value);
				state = ST_KEYWORD;
				continue;
			}
			goto parse_error;

		case ST_KEYWORD:
			if (isalnum(c)) {
				if (custr_appendc(keyword, c) != 0) {
					err(1, "custr_appendc failure");
				}
				continue;
			} else if (isspace(c)) {
				const char *x = custr_cstr(keyword);

				if (x == NULL) {
					goto parse_error;
				}

				state = ST_PRE_STRING;
				goto top;
			}
			goto parse_error;

		case ST_PRE_STRING:
			if (isspace(c)) {
				/*
				 * Eat whitespace.
				 */
				continue;
			} else if (c == '"') {
				state = ST_STRING;
				custr_reset(value);
				break;
			}
			goto parse_error;

		case ST_STRING:
			if (c == '\n' || c == '\r') {
				errx(1, "line break in string");
			}
			if (c == '"') {
				state = ST_PRE_SEMICOLON;
				continue;
			}
			if (custr_appendc(value, c) != 0) {
				err(1, "custr_appendc failure");
			}
			continue;

		case ST_PRE_SEMICOLON:
			if (isspace(c)) {
				/*
				 * Eat whitespace.
				 */
				continue;
			} else if (c != ';') {
				goto parse_error;
			}

			if (strcmp(custr_cstr(keyword), "section") == 0) {
				strset_t *a;

				if (type == '+') {
					a = mc->mc_section_includes;
				} else {
					a = mc->mc_section_excludes;
				}

				if (strset_add(a, custr_cstr(value)) != 0) {
					err(1, "strset_add failure");
				}
			} else if (strcmp(custr_cstr(keyword), "page") == 0) {
				strset_t *a;

				if (type == '+') {
					errx(1, "pages may only be excluded");
				} else {
					a = mc->mc_page_excludes;
				}

				if (strset_add(a, custr_cstr(value)) != 0) {
					err(1, "strset_add failure");
				}
			} else {
				errx(1, "invalid keyword \"%s\"",
				    custr_cstr(keyword));
			}
			state = ST_REST;
			continue;

		case ST_COMMENT_0:
			if (c == '*') {
				state = ST_COMMENT_1;
				continue;
			}
			goto parse_error;

		case ST_COMMENT_1:
			if (c == '*') {
				state = ST_COMMENT_2;
				continue;
			}
			break;

		case ST_COMMENT_2:
			if (c == '/') {
				state = comment_state;
				continue;
			}
			state = ST_COMMENT_1;
			goto top;

		}
	}

parse_error:
	errx(1, "invalid config file \"%s\", character '%c'", config_path, c);

out:
	custr_free(keyword);
	custr_free(value);
	(void) fclose(f);
	return (STRSET_WALK_NEXT);
}

static strset_walk_t
dump_record(strset_t *ss _UNUSED, const char *pattern, void *arg0 _UNUSED,
    void *arg1 _UNUSED)
{
	(void) fprintf(stdout, "\t%s\n", pattern);
	return (STRSET_WALK_NEXT);
}

void
mancheck_init(mancheck_t *mc)
{
	int e = 0;

	bzero(mc, sizeof (*mc));

	e |= strset_alloc(&mc->mc_config_paths, STRSET_IGNORE_DUPLICATES);
	e |= strset_alloc(&mc->mc_shiplist, 0);
	e |= strset_alloc(&mc->mc_section_includes, STRSET_IGNORE_DUPLICATES);
	e |= strset_alloc(&mc->mc_section_excludes, STRSET_IGNORE_DUPLICATES);
	e |= strset_alloc(&mc->mc_page_excludes, STRSET_IGNORE_DUPLICATES);

	if (e != 0) {
		err(1, "alloc failure");
	}
}

int
main(int argc _UNUSED, char **argv _UNUSED)
{
	int rval = 0;
	mancheck_t mc;
	boolean_t endl = B_FALSE;

	mancheck_init(&mc);

	parse_opts(&mc, argc, argv);
	(void) strset_walk(mc.mc_config_paths, read_config_file, &mc, NULL);

	if (mc.mc_flags & MCF_DUMP_CONFIG) {
		fprintf(stdout, "dumping config in processing order:\n");
		fprintf(stdout, "\n");

		fprintf(stdout, "   1. section excludes:\n");
		(void)strset_walk(mc.mc_section_excludes, dump_record,
		    NULL, NULL);
		fprintf(stdout, "\n");

		fprintf(stdout, "   2. section includes:\n");
		(void)strset_walk(mc.mc_section_includes, dump_record,
		    NULL, NULL);
		fprintf(stdout, "\n");

		fprintf(stdout, "   3. page excludes:\n");
		(void)strset_walk(mc.mc_page_excludes, dump_record,
		    NULL, NULL);
		fprintf(stdout, "\n");

		if (mc.mc_flags == MCF_DUMP_CONFIG) {
			fprintf(stdout, "dumping only\n");
			return (0);
		}
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
	 * Read the manual page shipping directories to see if there are
	 * unshipped manual pages in sections where we intend to ship the
	 * entire section.
	 */
	if (check_whole_sects(&mc) != 0) {
		rval = 50;
		goto out;
	}

	/*
	 * Print final status counts for each requested check.
	 */
	if ((mc.mc_flags & MCF_WHOLE_SECTS) && mc.mc_cnt_whole_sects > 0) {
		if (!endl) {
			(void) fprintf(stdout, "\n");
			endl = B_TRUE;
		}
		(void) fprintf(stdout, "unshipped manual pages from entirely "
		    "shipped sections: %ld\n", mc.mc_cnt_whole_sects);
		rval = 60;
	}
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
