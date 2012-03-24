/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * This tool exists to exec qemu after rotating the /tmp/vm.log.* files and
 * sending all output to /tmp/vm.log.  It also dumps the zone's privileges to
 * the log for verification.
 *
 */


#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <priv.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <unistd.h>

#define LOG_FILE "/tmp/vm.log"
#define LOG_FILE_PATTERN "/tmp/vm.log.%u"

void dump_args(int argc, char **argv);
void dump_privs(void);
void exec_next(int argc, char **argv);
void redirect_output(void);
void rotate_logs(void);

int
main(int argc, char **argv)
{
    if (argc < 2) {
        (void) fprintf(stderr, "Usage: %s <command> ...\n", argv[0]);
        exit(1);
    }

    rotate_logs();
    redirect_output();
    dump_privs();
    dump_args(argc, argv);

    /* print the header for the output from the program we exec (pre-flush) */
    (void) puts("=== OUTPUT ===");

    /* flush before next cmd takes over */
    (void) fflush(stdout);
    (void) fflush(stderr);

    exec_next(argc, argv);

    /* if we got here, we failed */
    (void) fprintf(stderr, "FATAL: execvp() failed.\n");
    exit(1);
}

void
rotate_logs(void)
{
    unsigned int i;
    char old_filename[] = LOG_FILE_PATTERN;
    char new_filename[] = LOG_FILE_PATTERN;

    /* rename:
     *
     * log.8 -> log.9
     * ...
     * log.0 -> log.1
     *
     */
    for (i=9; i>0; i--) {
        if (snprintf((char *)&old_filename, strlen(LOG_FILE_PATTERN),
            LOG_FILE_PATTERN, i - 1) < 0) {

            perror("Warning, failed to build old filename string");
            continue;
        }
        if (snprintf((char *)&new_filename, strlen(LOG_FILE_PATTERN),
            LOG_FILE_PATTERN, i) < 0) {

            perror("Warning, failed to build new filename string");
            continue;
        }
        if (rename(old_filename, new_filename)) {
            perror(old_filename);
        }
    }

    /* rename: log -> log.0 */
    if (snprintf((char *)&new_filename, strlen(LOG_FILE_PATTERN),
        LOG_FILE_PATTERN, 0) < 0) {

        perror("Warning, failed to build new filename string");
        return;
    }
    if (rename(LOG_FILE, new_filename)) {
        perror(LOG_FILE);
    }

    return;
}

void
redirect_output(void)
{
    int fd;

    fd = open(LOG_FILE, O_WRONLY | O_CREAT, 0644);
    if (fd >= 0) {
        if (dup2(fd, 1) < 0) {
            perror("Warning, dup2(stdout) failed");
        }
        if (dup2(fd, 2) < 0) {
            perror("Warning, dup2(stderr) failed");
        }
    }

    return;
}

void
dump_privs(void)
{
    const char *pname;
    int i;

    priv_set_t *pset = priv_str_to_set("zone", ",", NULL);
    if (pset == NULL) {
        (void) fprintf(stderr, "unable to create priv_set for 'zone'\n");
        return;
    }
    (void) puts("== Zone privileges ==");
    for (i = 0; ((pname = priv_getbynum(i++)) != NULL); ) {
        if (priv_ismember(pset, pname)) {
            (void) puts(pname);
        }
    }

    return;
}

void
dump_args(int argc, char **argv)
{
    int i;

    (void) puts("=== ARGV ===");
    for (i = 0; i < argc; i++) {
        (void) puts(argv[i]);
    }

    return;
}

void
exec_next(int argc, char **argv)
{
    argv++;
    argc--;

    execvp(*argv, argv);

    /* if we got here we failed. */
    return;
}
