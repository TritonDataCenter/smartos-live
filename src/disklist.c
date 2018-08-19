/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright 2018 Joyent, Inc.
 *
 */

#include <dirent.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <getopt.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <unistd.h>
#include <sys/dkio.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/vtoc.h>

#define verbose_warn(...) \
	do { \
		if (is_verbose) { \
			warn(__VA_ARGS__); \
		} \
	} while (0)

char mode = '0';
boolean_t is_verbose = B_FALSE;
boolean_t printed_disk = B_FALSE;

/*
 * Print the usage message to the given FILE handle
 */
static void
usage(FILE *s)
{
	fprintf(s, "usage: disklist [-ahnrv]\n");
	fprintf(s, "\n");
	fprintf(s, "list the disks on the system\n");
	fprintf(s, "\n");
	fprintf(s, "options\n");
	fprintf(s, "  -a       list all devices\n");
	fprintf(s, "  -h       print this message and exit\n");
	fprintf(s, "  -n       list non-removable devices\n");
	fprintf(s, "  -r       list removable devices\n");
	fprintf(s, "  -v       verbose output\n");
}

/*
 * Process a single disk.  To maintain consistency with the original disklist.sh
 * script, this function will ignore and not print any disks that encounter any
 * failures (such as failing to open, failing to ioctl, etc.).  However, `-v`
 * can be specified to print debug messages to stderr with information about any
 * failures encountered.
 */
void do_disk(char *dsk_path) {
	char dsk_name[PATH_MAX];
	char rdsk_path[PATH_MAX];
	int devnode;
	int removable;
	int ret;
	struct stat buf;
	int len = strlen(dsk_path);

	if (len < 2) {
		return;
	}

	// Only care about files that end in "s2"
	if (strcmp(dsk_path + len - 2, "s2") != 0) {
		return;
	}

	strncpy(dsk_name, dsk_path, len - 2);
	dsk_name[len - 2] = '\0';

	if (snprintf(rdsk_path, PATH_MAX, "/dev/rdsk/%sp0", dsk_name) <= 0) {
		err(2, "snprintf");
	};

	if ((devnode = open(rdsk_path, O_RDONLY)) < 0) {
		verbose_warn("open %s", rdsk_path);
		return;
	}

	if (fstat(devnode, &buf) == -1 || !S_ISCHR(buf.st_mode)) {
		verbose_warn("%s: not a character device", rdsk_path);
		goto done;
	}

	ret = ioctl(devnode, DKIOCREMOVABLE, &removable);
	if (ret < 0) {
		verbose_warn("ioctl DKIOCREMOVABLE %s", rdsk_path);
		goto done;
	}

	/*
	 * Print only non-removable disks and their sizes - this is an
	 * undocumented flag for this program with a very specific purpose
	 * (currently only used by the sysinfo command).
	 */
	if (mode == 's') {
		unsigned long long bytes;
		struct dk_minfo mediainfo;

		if (removable) {
			goto done;
		}

		ret = ioctl(devnode, DKIOCGMEDIAINFO, &mediainfo);
		if (ret < 0) {
			verbose_warn("ioctl DKIOCGMEDIAINFO %s", rdsk_path);
			goto done;
		}

		bytes = mediainfo.dki_capacity * mediainfo.dki_lbsize;

		printf("%s=%llu\n", dsk_name, bytes);

		goto done;
	}

	if ((mode == 'a') ||
	    (mode == 'r' && removable) ||
	    (mode == 'n' && !removable)) {

		if (printed_disk) {
			printf(" %s", dsk_name);
		} else {
			printf("%s", dsk_name);
		}

		printed_disk = B_TRUE;
	}

done:
	close(devnode);
}

int main(int argc, char **argv) {
	DIR *d;
	struct dirent *dp;
	int opt;

	while ((opt = getopt(argc, argv, "ahnrsv")) != -1) {
		switch (opt) {
		case 'a':
			mode = 'a';
			break;
		case 'h':
			usage(stdout);
			return (0);
		case 'n':
			mode = 'n';
			break;
		case 'r':
			mode = 'r';
			break;
		case 's':
			mode = 's';
			break;
		case 'v':
			is_verbose = B_TRUE;
			break;
		default:
			usage(stderr);
			return (1);
		}
	}
	argc -= optind;
	argv += optind;

	/*
	 * This is to mimic the behavior of the disklist.sh script that came
	 * before this program.  If no "mode" argument is specified on the
	 * command line, print nothing and exit 0.
	 */
	if (mode == '0') {
		return (0);
	}

	d = opendir("/dev/dsk");
	if (d == NULL) {
		err(1, "opendir /dev/dsk");
	}

	while ((dp = readdir(d)) != NULL) {
		do_disk(dp->d_name);
	}

	if ((mode == 'a' || mode == 'n' || mode == 'r') && printed_disk) {
		printf("\n");
	}

	closedir(d);
	return (0);
}
