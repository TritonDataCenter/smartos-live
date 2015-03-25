/*
 * Copyright 2015 Joyent, Inc.
 */

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>

#include "users.h"
#include "copyfile.h"
#include "strlist.h"

/*
 * Maximum number of input directories to search:
 */
#define	MAX_DIRS	32

#define	MAX_LINE_LEN	1024

/* Globals! */
strlist_t *search_dirs;

static int exit_status = 0;

/* Convert a string like "0755" to the octal mode_t equivalent */
mode_t str_to_mode(const char *mode)
{
  long result;
  char *p;
  errno = 0;

  result = strtol(mode, &p, 8);
  if (errno != 0 || *p != 0 || p == mode) {
    perror("converting string to octal");
    return (mode_t) -1;
  }

  return ((mode_t) result);
}

void handle_dir(const char *target, const char *mode, const char *user, const char *group)
{
  int r;
  mode_t m;
  uid_t uid;
  gid_t gid;

  if (uid_from_name(bid, user, &uid) != 0) {
    printf("ERROR: user \"%s\" not found in passwd file\n", user);
    exit(1);
  }

  if (gid_from_name(bid, group, &gid) != 0) {
    printf("ERROR: group \"%s\" not found in group file\n", group);
    exit(1);
  }

  m = str_to_mode(mode);
  printf("DIR: [%s][%04o][%s/%d][%s/%d]: ", target, (unsigned int) m, user, uid, group, gid);
  r = mkdir(target, m);
  if ((r) && (errno != EEXIST)) {
    perror("mkdir()");
    exit (1);
  }

  r = chown(target, uid, gid);
  if (r) {
    perror("chown()");
    exit (1);
  }

  printf("OK\n");
}

void handle_file(const char *target, const char *mode, const char *user, const char *group)
{
  int i, r;
  mode_t m;
  char *found, testfile[MAX_LINE_LEN];
  uid_t uid;
  gid_t gid;

  if (uid_from_name(bid, user, &uid) != 0) {
    printf("ERROR: user \"%s\" not found in passwd file\n", user);
    exit(1);
  }

  if (gid_from_name(bid, group, &gid) != 0) {
    printf("ERROR: group \"%s\" not found in group file\n", group);
    exit(1);
  }

  found = NULL;
  m = str_to_mode(mode);
  printf("FILE: [%s][%04o][%s/%d][%s/%d]: ", target, (unsigned int) m, user, uid, group, gid);

  for(i=0; (i < MAX_DIRS) && (search_dirs[i] != NULL); i++) {
    if (found == NULL) {
      sprintf(testfile, "%s/%s", search_dirs[i], target);

      if ((r = builder_copy_file(testfile, target)) != 0) {
        if (errno != ENOENT) {
          perror("file_cp()");
          exit (1);
        }
      } else {
        found=search_dirs[i];
      }
    }
  }

  if (found) {
    r = chown(target, uid, gid);
    if (r) {
      perror("chown()");
      exit (1);
    }

    r = chmod(target, m);
    if (r) {
      perror("chmod()");
      exit (1);
    }
    
    /* tell where we found it */
    printf("OK (%s)\n", found);
  } else {
    printf("FAILED\n");
    exit_status = 1;
  } 

}

void
handle_link(const char *target, const char *type, int(*linker)(const char *, const char *))
{
  char *copy, *ptr, *oldpath, *newpath;

  copy = strdup(target); 
  if (copy == NULL) {
    printf("OUT OF MEMORY\n");
    exit(1);
  }

  ptr=newpath=copy;
  while (*ptr != '\0') {
    if (*ptr == '=') {
      *ptr++='\0';
      oldpath = ptr;
      break;
    } else {
      ptr++;
    }
  }
  
  if (*ptr == '\0') {
    printf("invalid %s target: '%s'\n", type, target);
    exit(1);
  }

  printf("LINK(%s): %s => %s: ", type, newpath, oldpath);

  if (linker(oldpath, newpath)) {
    perror(type);
    exit(1);
  }

  free(copy);

  printf("OK\n");
}

typedef struct builder {
	char *b_passwd_dir;
	char *b_output_dir;
	char *b_manifest_file;
	strlist_t *b_search_dirs;
	strset_t *b_errors;
	builder_ids_t *b_ids;
} builder_t;

static void
usage(int status, char *msg)
{
	if (msg != NULL) {
		(void) fprintf(status == 0 ? stdout : stderr, "%s\n", msg);
	}

	(void) fprintf(status == 0 ? stdout : stderr,
	    "Usage: builder -p passwd_dir <manifest_file> <output_dir>\n"
	    "           <input_dir>...\n",
	    "\n");

	exit(status);
}

static void
parse_opts(builder_t *b, int argc, char **argv)
{
	int c, i;
	char *pflag = NULL;

	while ((c = getopt(argc, argv, ":p:")) != -1) {
		switch (c) {
		case 'p':
			pflag = optarg;
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

		if (strlist_set_tail(&b->b_search_dirs, argv[i]) != 0) {
			err(1, "strlist_set_tail failure");
		}
	}
	if (strlist_contig_count(&b->b_search_dirs) < 1) {
		usage(1, "must provide at least one input directory");
	}
}

static int
map_user_and_group(builder_t *b, const char *user, uid_t *u,
    const char *group, gid_t *g)
{
	char buf[100];

	if (uid_from_name(b->b_ids, user, u) != 0) {
		(void) snprintf(buf, sizeof (buf), "user \"%s\" not "
		    "found in passwd file", user);
		if (strset_add(&b->b_errors, buf) != 0) {
			err(1, "strset_add failure");
		}
	}

	if (gid_from_name(b->b_ids, group, g) != 0) {
		(void) snprintf(buf, sizeof (buf), "group \"%s\" not "
		    "found in group file", group);
		if (strset_add(&b->b_errors, buf) != 0) {
			err(1, "strset_add failure");
		}
	}
}

static me_cb_ret_t
handle_directory(manifest_ent_t *me, void *arg)
{
	builder_t *b = arg;
	uid_t u;
	gid_t g;

	if (me->me_type != ME_TYPE_DIRECTORY) {
		return (MECB_NEXT);
	}

	if (map_user_and_group(b, me->me_user, &u, me->me_group, &g) != 0) {
		return (MECB_NEXT);
	}

	fprintf(stdout, "DIR: [%s][%04o][%s/%d][%s/%d]: ", me->me_name,
	    (unsigned int)me->me_mode, me->me_user, u, me->me_group, g);

	if (mkdir(me->me_name, me->me_mode) != 0 && errno != EEXIST) {
		char buf[MAXPATHLEN + 100];

		(void) snprintf(buf, sizeof (buf), "mkdir failed for "
		    "\"%s\": %s", me->me_name, strerror(errno));

		if (strset_add(&b->b_errors, buf) != 0) {
			err(1, "strset_add failure");
		}

		return (MECB_CANCEL);
	}

	if (chown(me->me_name, u, g) != 0) {
		char buf[MAXPATHLEN + 100];

		(void) snprintf(buf, sizeof (buf), "chown failed for "
		    "\"%s\": %s", me->me_name, strerror(errno));

		if (strset_add(&b->b_errors, buf) != 0) {
			err(1, "strset_add failure");
		}

		return (MECB_CANCEL);
	}

	fprintf(stdout, "OK\n");
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
	if (strset_add(&b->b_paths, me->me_name) != 0) {
		if (errno == EEXIST) {
			char buf[100 + MAXPATHLEN];

			(void) snprintf(buf, sizeof (buf), "duplicate entry "
			    "\"%s\"", me->me_name);
			if (strset_add(&b->b_errors, buf) != 0) {
				err(1, "strset_add failure");
			}
		} else {
			err(1, "strset_add failure");
		}
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
			return (MECB_NEXT);
		}
		break;

	default:
		break;
	}

	return (MECB_NEXT);
}

static manifest_ent_cb_t *builder_passes[] = {
	sanity_check,
	handle_directory,
	handle_file,
	handle_link,
	NULL
};

int
main(int argc, char **argv)
{
	builder_t b;

	bzero(&b, sizeof (b));
	if (strlist_alloc(&b->b_search_dirs, MAX_DIRS) != 0 ||
	    strset_alloc(&b->b_errors, STRSET_IGNORE_DUPLICATES) != 0 ||
	    strset_alloc(&b->b_paths, 0) != 0) {
		err(1, "strlist_alloc failure");
	}

	if (geteuid() != 0) {
		errx(1, "must be root to use this tool");
	}

	parse_opts(&b, argc, argv);

	if (builder_ids_init(&b->b_ids, b->b_passwd_dir) != 0) {
		err(1, "failed to read passwd/group files");
	}

	(void) fprintf(stdout, "MANIFEST:   %s\n", b->b_manifest_path);
	(void) fprintf(stdout, "OUTPUT:     %s\n", b->b_output_dir);
	for (int i = 0; (char *c = strlist_get(&b->b_search_dirs, i)) != NULL;
	    i++) {
		(void) fprintf(stdout, "SEARCH[%02d]: %s\n", i, c);
	}

	if (chdir(b->b_output_dir) != 0) {
		err(1, "failed to change to output directory (%s)",
		    b->b_output_dir);
	}

	return (1);
}

int main(int argc, char *argv[])
{
  FILE *file;
  int i, lineno=0, args_found, pass=1;
  char type, line[MAX_LINE_LEN], target[MAX_LINE_LEN];
  char mode[MAX_LINE_LEN], user[MAX_LINE_LEN], group[MAX_LINE_LEN];
  char *manifest, *output;

  if (geteuid() != 0) {
    printf("euid must be 0 to use this tool.\n");
    exit(1);
  }

  if (strlist_alloc(&search_dirs, MAX_DIRS) != 0) {
    exit(1);
  }

  if ((argc < 4) || (argc > (MAX_DIRS + 3))) {
    printf("Usage: %s <manifest> <output dir> <dir1> [<dir2> ... <dirX>]\n", argv[0]);
    printf("\n");
    printf(" * Use only absolute paths\n");
    printf(" * Directories are searched in order listed, stop at first match\n");
    printf(" * MAX_DIRS=%d, modify and recompile if you need more\n", MAX_DIRS);
    printf("\n");
    exit(1);
  }

  if (getenv("BUILDER_PASSWD_DIR") == NULL) {
    printf("Must set BUILDER_PASSWD_DIR to a directory containing \"passwd\" "
      "and \"group\" files");
    exit(1);
  }

  if (builder_ids_init(&bid, getenv("BUILDER_PASSWD_DIR")) != 0) {
    printf("Failed to read passwd/group files: %s\n", strerror(errno));
    exit(1);
  }

  manifest = argv[1];
  output = argv[2];
  for(i=3; i < (MAX_DIRS + 3); i++) {
    search_dirs[i - 3] = argv[i];
  }

  printf("MANIFEST:   %s\n", argv[1]);
  printf("OUTPUT:     %s\n", argv[2]);
  for(i=0; (i < MAX_DIRS) && (search_dirs[i] != NULL); i++) {
    printf("SEARCH[%02d]: %s\n", i, search_dirs[i]);
  }

  if (chdir(output)) {
    perror("failed to chdir(<output dir>)");
    exit(1);
  }

  /* scan through the manifest once each for each type of entry, in order */
  while (pass < 6) {
    file = fopen(manifest, "r");
    if (file != NULL) {
       while(fgets(line, MAX_LINE_LEN, file) != NULL) {
         lineno++;
         args_found = sscanf(line, "%c %s %s %s %s", &type, target, mode, user, group);
         switch(type) {
           case 'd':
             if (args_found == 5) {
               if (pass == 1) {
                 handle_dir(target, mode, user, group);
               } else if (pass == 5) { /* Set permissions last, in case read-only */
                   mode_t m;
                   m = str_to_mode(mode);
                   if (chmod(target, m) != 0) {
                       perror("chmod()");
                       exit(1);
                   }
               }
             } else {
               printf("Wrong number of arguments for directory on line[%d]: %s\n", lineno, line);
             }
             break;
           case 'f':
             if (args_found == 5) {
               if (pass == 2) {
                 handle_file(target, mode, user, group);
               }
             } else {
               printf("Wrong number of arguments for file on line[%d]: %s\n", lineno, line);
             }
             break;
           case 's':
             if (args_found == 2) {
               if (pass == 3) {
                 handle_link(target, "symlink", symlink);
               }
             } else {
               printf("Wrong number of arguments for symlink on line[%d]: %s\n", lineno, line);
             }
             break;
           case 'h':
             if (args_found == 2) {
               if (pass == 4) {
                 handle_link(target, "link", link);
               }
             } else {
               printf("Wrong number of arguments for link on line[%d]: %s\n", lineno, line);
             }
             break;
           default:
             printf("Invalid type (%c) on line[%d]: %s\n", type, lineno, line);
             break;
          } 
       }
       fclose(file);
    } else {
       perror(manifest);
    }

    pass++;
  }

  exit(exit_status);
}
