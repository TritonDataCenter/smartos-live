/*
 * Copyright (c) 2010 Joyent Inc., All rights reserved.
 *
 * This tool takes the character device node for a disk and prints the size
 * in *bytes* for that disk.  On any error, a message explaining the problem
 * is printed to STDERR and the exit code is non-zero.
 *
 */


#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/dkio.h>
#include <sys/vtoc.h>

void
usage(char *argv0)
{
	printf("Usage: %s [char dev]\n", argv0);
	exit(1);
}

int
main(int argc, char *argv[])
{
	char *devpath = argv[1];
	int devnode;
	int ret;
	unsigned long long bytes;
	struct dk_minfo mediainfo;

	if (argc != 2) {
		fprintf(stderr, "FATAL: Device argument required\n");
		usage(argv[0]);
	}

	if ((devnode = open(devpath, O_RDONLY)) < 0) {
		fprintf(stderr, "FATAL: Could not open %s\n", devpath);
		usage(argv[0]);
	}

	ret = ioctl(devnode, DKIOCGMEDIAINFO, &mediainfo);
	close(devnode);

	if (ret < 0) {
		fprintf(stderr, "FATAL: DKIOCGMEDIAINFO failed\n");
		exit(1);
	}

	bytes = (mediainfo.dki_capacity * mediainfo.dki_lbsize);
	printf("%llu\n", bytes);
	exit(0);
}
