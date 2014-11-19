/*
 * Copyright (c) 2013, Joyent, Inc.
 * See LICENSE file for copyright and license details.
 */

#include <stdlib.h>
#include <stdio.h>
#include <stdint.h>
#include <sys/types.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/uio.h>
#include <time.h>

#include "common.h"
#include "reqid.h"

static int urandom_fd = -1;

char *
reqid(char *buf)
{
	int i;
	static int seed = -1;
	uint32_t tmp = 0;

	VERIFY(buf != NULL);

	/*
	 * If we were able to open it, try and read a random request ID
	 * from /dev/urandom:
	 */
	if (urandom_fd != -1) {
		if (read(urandom_fd, &tmp, sizeof (tmp)) == sizeof (tmp))
			goto out;
	}

	/*
	 * Otherwise, fall back to C rand():
	 */
	if (seed == -1) {
		seed = (int) time(NULL);
		srand(seed);

	}
	for (i = 0; i < 4; i++) {
		tmp |= (0xff & (rand())) << (i * 8);
	}

out:
	sprintf(buf, "%08x", tmp);
	return (buf);
}

int
reqid_init(void)
{
	if (urandom_fd == -1)
		urandom_fd = open("/dev/urandom", O_RDONLY | O_NONBLOCK);

	return (0);
}

void
reqid_fini(void)
{
	if (urandom_fd == -1)
		return;

	(void) close(urandom_fd);
	urandom_fd = -1;
}
