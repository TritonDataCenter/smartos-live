/*
* CDDL HEADER START
*
* The contents of this file are subject to the terms of the
* Common Development and Distribution License, Version 1.0 only
* (the "License").  You may not use this file except in compliance
* with the License.
*
* You can obtain a copy of the license at COPYING
* See the License for the specific language governing permissions
* and limitations under the License.
*
* When distributing Covered Code, include this CDDL HEADER in each
* file and include the License file at COPYING.
* If applicable, add the following below this CDDL HEADER, with the
* fields enclosed by brackets "[]" replaced with your own identifying
* information: Portions Copyright [yyyy] [name of copyright owner]
*
* CDDL HEADER END
*
* Copyright (c) 2010,2011 Joyent Inc.
*
*/

#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/dkio.h>
#include <sys/vtoc.h>

void
usage(char* argv0) {
	printf("Usage: %s [char dev]\n", argv0);
}

int
main(int argc, char* argv[]) {
	char* devpath = argv[1];
    int devnode;
	struct stat buf;
	int ret;
	int removable;
	
	if(argc != 2) {
		usage(argv[0]);
		return -1;
	}
	
    if ((devnode = open(devpath, O_RDONLY)) < 0 ) {
		printf("Could not open %s\n", devpath);
		usage(argv[0]);
		return -1;
    }
    
	if (fstat(devnode, &buf) == -1 || !S_ISCHR(buf.st_mode)) {
		printf("%s: not a character device\n", devpath);
		usage(argv[0]);
		close(devnode);
		return -1;
	}
	
	ret = ioctl(devnode, DKIOCREMOVABLE, &removable);

	if ((ret >= 0) && (removable != 0)) {
		close(devnode);
		return 0;
	}
	
	close(devnode);
	return 1;
}
