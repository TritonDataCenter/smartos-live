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
 * Copyright 2016 Joyent, Inc.
 */

#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

int
mknod(const char *path, mode_t mode, dev_t dev)
{
        int tmpfd;

        if ((tmpfd = open(path, O_CREAT | O_EXCL, mode)) == -1) {
                return (-1);
        }

        (void) close(tmpfd);

        return (0);
}

int
mknodat(int fd, const char *path, mode_t mode, dev_t dev)
{
        int tmpfd;

        if ((tmpfd = openat(fd, path, O_CREAT | O_EXCL, mode)) == -1) {
                return (-1);
        }

        (void) close(tmpfd);

        return (0);
}

int
_mknod()
{
        return (0);
}

int
_xmknod(int version, const char *path, mode_t mode, dev_t dev)
{
        return (0);
}
