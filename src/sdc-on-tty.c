/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License (the "License").
 * You may not use this file except in compliance with the License.
 *
 * You can obtain a copy of the license at usr/src/OPENSOLARIS.LICENSE
 * or http://www.opensolaris.org/os/licensing.
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file and include the License file at usr/src/OPENSOLARIS.LICENSE.
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 */

/*
 * Copyright 2012, Joyent, Inc. All rights reserved.
 */

/*
 * This utility uses its parameters as a command (with options) and runs that
 * command on each tty specified by the -d option(s).  Each tty is setup as
 * the controlling terminal for the command so that it can receive control
 * characters (such as SIGINT) properly.  The utility then waits for one of
 * the processes to exit and terminates the remaining processes running on the
 * other ttys.
 *
 * Example usage:
 *  sdc-on-tty -d /dev/console -d /dev/ttya -d /dev/ttyb config-sys foo bar
 */

#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <stropts.h>
#include <limits.h>

#define MAXDEVS		10

int
run_cmd(char *dev, char *cmd[])
{
	struct stat buf;
	int std_in, std_out, std_err;
	int id;

	if (stat(dev, &buf) < 0)
		return (-1);

	if ((buf.st_mode & S_IFMT) != S_IFCHR)
		return (-1);

	switch (id = fork()) {
	case 0:
		/* child */
		closefrom(0);

		/* Create a new session and process group */
		if (setsid() < 0)
			exit(1);

		if ((std_in = open(dev, O_RDONLY)) < 0)
			exit(1);
		if ((std_out = open(dev, O_WRONLY)) < 0)
			exit(1);
		if ((std_err = open(dev, O_WRONLY)) < 0)
			exit(1);

		if (execv(cmd[0], cmd))
			exit(1);
		/*NOTREACHED*/
		break;
	case -1:
		return (-1);
	default:
		/* parent */
		return (id);
	}

	/*NOTREACHED*/
	return (-1);
}

int
main(int argc, char **argv)
{
	int arg;
	int nprocs = 0, ndevs = 0;
	int i;
	int pid;
	int stat;
	pid_t procs[MAXDEVS];
	char *devs[MAXDEVS];
	char *args[ARG_MAX];
	extern char *optarg;
	extern int optind;

	while ((arg = getopt(argc, argv, "d:")) != EOF) {
		switch (arg) {
		case 'd':
			if (ndevs == MAXDEVS) {
				fprintf(stderr, "too many tty devices\n");
				exit(1);
			}
			devs[ndevs++] = optarg;
			break;
		default:
			fprintf(stderr, "unknown option\n");
			exit(1);
		}
	}

	if (ndevs == 0) {
		fprintf(stderr, "a tty device is required\n");
		exit(1);
	}

	if (optind >= argc) {
		fprintf(stderr, "missing command\n");
		exit(1);
	}

	for (i = 0; optind < argc; i++, optind++) {
		args[i] = argv[optind];
	}
	args[i] = NULL;

	for (i = 0; i < ndevs; i++) {
		pid = run_cmd(devs[i], args);
		if (pid != -1)
			procs[nprocs++] = (pid_t)pid;
		else
			fprintf(stderr, "unable to run %s on %s\n",
			    args[0], devs[i]);
	}

	if (nprocs == 0) {
		fprintf(stderr, "unable to run any processes\n");
		exit(1);
	}

	signal(SIGHUP, SIG_IGN);
	signal(SIGINT, SIG_IGN);
	signal(SIGSTOP, SIG_IGN);
	signal(SIGTSTP, SIG_IGN);
	signal(SIGTTIN, SIG_IGN);
	signal(SIGTTOU, SIG_IGN);

	pid = wait(&stat);
	for (i = 0; i < nprocs; i++) {
		if (procs[i] != pid) {
			(void) kill(procs[i], SIGKILL);
			(void) wait(&stat);
		}
	}

	return (0);
}
