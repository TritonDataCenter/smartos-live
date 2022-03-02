/*
 * Copyright (c) 2010 Joyent Inc., All rights reserved.
 *
 */

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/fcntl.h>

#define MAX_DIRS     10
#define MAX_LINE_LEN 1024

/* Globals! */
char *search_dirs[MAX_DIRS] = { NULL };

static int exit_status = 0;

/* These are from the generated users.c */
int uid_from_name(const char *user);
int gid_from_name(const char *group);

/* From file_cp.c */
int file_cp(const char *to, const char *from);

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

  m = str_to_mode(mode);
  printf("DIR: [%s][%04o][%s/%d][%s/%d]: ", target, (unsigned int) m, user, uid_from_name(user), group, gid_from_name(group));
  r = mkdir(target, m);
  if ((r) && (errno != EEXIST)) {
    perror("mkdir()");
    exit (1);
  }

  r = chown(target, (gid_t) uid_from_name(user), (gid_t) gid_from_name(group));
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

  found = NULL;
  m = str_to_mode(mode);
  printf("FILE: [%s][%04o][%s/%d][%s/%d]: ", target, (unsigned int) m, user, uid_from_name(user), group, gid_from_name(group));

  for(i=0; (i < MAX_DIRS) && (search_dirs[i] != NULL); i++) {
    if (found == NULL) {
      sprintf(testfile, "%s/%s", search_dirs[i], target);
      r = file_cp(target, testfile);
      if (r < 0) {
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
    r = chown(target, (gid_t) uid_from_name(user), (gid_t) gid_from_name(group));
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

/* Disambiguate the chasing of symlinks at the end... */
static int
no_xpg4_link(const char *existing, const char *new)
{
	return (linkat(AT_FDCWD, existing, AT_FDCWD, new, 0));
}

void handle_link(const char *target, const char *type, int(*linker)(const char *, const char *))
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

  if ((argc < 4) || (argc > (MAX_DIRS + 3))) {
    printf("Usage: %s <manifest> <output dir> <dir1> [<dir2> ... <dirX>]\n", argv[0]);
    printf("\n");
    printf(" * Use only absolute paths\n");
    printf(" * Directories are searched in order listed, stop at first match\n");
    printf(" * MAX_DIRS=%d, modify and recompile if you need more\n", MAX_DIRS);
    printf("\n");
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
                 handle_link(target, "link", no_xpg4_link);
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
