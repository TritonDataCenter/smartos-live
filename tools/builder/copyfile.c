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
 * Copyright 2008 Sun Microsystems, Inc.  All rights reserved.
 * Use is subject to license terms.
 */

/*	Copyright (c) 1984, 1986, 1987, 1988, 1989 AT&T	*/
/*	  All Rights Reserved  	*/

/*
 * University Copyright- Copyright (c) 1982, 1986, 1988
 * The Regents of the University of California
 * All Rights Reserved
 *
 * University Acknowledgment- Portions of this document are derived from
 * software developed by the University of California, Berkeley, and its
 * contributors.
 */

/*
 * Copyright 2015 Joyent, Inc.
 */

#include <stdlib.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>


#define	MAXMAPSIZE	(1024*1024*8)	/* map at most 8MB */
#define	SMALLFILESIZE	(32*1024)	/* don't use mmap on little file */

/*
 * This function was lifted from "usr/src/lib/libcmdutils/common/writefile.c"
 * in illumos.  It had some unfortunate behaviour for a library function,
 * including emitting error messages to stderr; those deficiencies have been
 * addressed in this copy.
 */
static int
builder_writefile(int fi, int fo, struct stat *stsrc)
{
	int mapsize, munmapsize;
	caddr_t cp;
	off_t filesize = stsrc->st_size;
	off_t offset;
	int nbytes;
	int remains;
	int n;

	if (S_ISREG(stsrc->st_mode) && stsrc->st_size > SMALLFILESIZE) {
		/*
		 * Determine size of initial mapping.  This will determine the
		 * size of the address space chunk we work with.  This initial
		 * mapping size will be used to perform munmap() in the future.
		 */
		mapsize = MAXMAPSIZE;
		if (stsrc->st_size < mapsize) {
			mapsize = stsrc->st_size;
		}
		munmapsize = mapsize;

		/*
		 * Mmap time!
		 */
		if ((cp = mmap((caddr_t)NULL, mapsize, PROT_READ,
		    MAP_SHARED, fi, (off_t)0)) == MAP_FAILED) {
			mapsize = 0;   /* can't mmap today */
		}
	} else {
		mapsize = 0;
	}

	if (mapsize != 0) {
		offset = 0;

		for (;;) {
			nbytes = write(fo, cp, mapsize);
			/*
			 * if we write less than the mmaped size it's due to a
			 * media error on the input file or out of space on
			 * the output file.  So, try again, and look for errno.
			 */
			if ((nbytes >= 0) && (nbytes != (int)mapsize)) {
				remains = mapsize - nbytes;
				while (remains > 0) {
					nbytes = write(fo,
					    cp + mapsize - remains, remains);
					if (nbytes < 0) {
						int error = errno;

						(void) munmap(cp, munmapsize);

						errno = error;
						return (-1);
					}
					remains -= nbytes;
					if (remains == 0)
						nbytes = mapsize;
				}
			}
			/*
			 * although the write manual page doesn't specify this
			 * as a possible errno, it is set when the nfs read
			 * via the mmap'ed file is accessed, so report the
			 * problem as a source access problem, not a target file
			 * problem
			 */
			if (nbytes < 0) {
				int error = errno;

				(void) munmap(cp, munmapsize);

				errno = error;
				return (-1);
			}
			filesize -= nbytes;
			if (filesize == 0) {
				break;
			}
			offset += nbytes;
			if (filesize < mapsize) {
				mapsize = filesize;
			}
			if (mmap(cp, mapsize, PROT_READ, MAP_SHARED |
			    MAP_FIXED, fi, offset) == MAP_FAILED) {
				int error = errno;

				(void) munmap(cp, munmapsize);

				errno = error;
				return (-1);
			}
		}
		(void) munmap(cp, munmapsize);
	} else {
		char buf[SMALLFILESIZE];

		for (;;) {
			if ((n = read(fi, buf, sizeof (buf))) == 0) {
				return (0);
			} else if (n < 0) {
				return (-1);
			}

			errno = 0;
			if (write(fo, buf, n) != n) {
				if (errno == 0) {
					errno = EINTR;
				}
				return (-1);
			}
		}
	}

	return (0);
}

int
builder_copy_file(const char *src, const char *dst)
{
	int error = 0;
	int fsrc = -1, fdst = -1;
	struct stat stsrc;

	if ((fsrc = open(src, O_RDONLY)) < 0 ||
	    (fdst = open(dst, O_WRONLY | O_CREAT | O_EXCL, 0644)) < 0 ||
	    fstat(fsrc, &stsrc) != 0) {
		error = errno;
		goto out;
	}

	/*
	 * The source must be a regular file:
	 */
	if (!S_ISREG(stsrc.st_mode)) {
		error = EINVAL;
		goto out;
	}

	if (builder_writefile(fsrc, fdst, &stsrc) != 0) {
		error = errno;
		goto out;
	}

out:
	if (fsrc != -1) {
		(void) close(fsrc);
	}
	if (fdst != -1) {
		(void) close(fdst);
		if (error != 0) {
			/*
			 * If we were able to open the destination file with
			 * the O_CREAT and O_EXCL flags, we created it and it
			 * is a regular file.  Clean up the mess we made:
			 */
			(void) unlink(dst);
		}
	}

	errno = error;
	return (error == 0 ? 0 : -1);
}
