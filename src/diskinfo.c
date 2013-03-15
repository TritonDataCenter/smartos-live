/*
 * Copyright (c) 2012 Joyent Inc., All rights reserved.
 *
 * This tool lists all of the disks attached to a system, their product/vendor
 * identifiers, their size, type of disk, and whether a disk is removable.
 *
 * Usage: diskinfo [-Hp]
 *
 *    -H: Scripting mode, do not print headers and fields are separated by tabs
 *    -p: Display numbers in parseabel (exact) values
 */

#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <limits.h>
#include <assert.h>
#include <ctype.h>

#include <libdiskmgt.h>
#include <sys/nvpair.h>
#include <sys/param.h>

typedef struct di_opts {
	boolean_t di_scripted;
	boolean_t di_parseable;
} di_opts_t;

static void
nvlist_query_string(nvlist_t *nvl, const char *label, char **val)
{
	if (nvlist_lookup_string(nvl, label, val) != 0)
		*val = "-";
}

static void
print_disks(dm_descriptor_t media, di_opts_t *opts)
{
	dm_descriptor_t *disk, *controller;
	nvlist_t *mattrs, *dattrs, *cattrs = NULL;
	int error;

	uint64_t size, total;
	uint32_t blocksize;
	double total_in_GiB;
	char sizestr[32];

	char *vid, *pid, *opath, *c, *ctype = NULL;
	boolean_t removable;
	boolean_t ssd;
	char device[MAXPATHLEN];
	size_t len;

	mattrs = dm_get_attributes(media, &error);
	assert(nvlist_lookup_uint64(mattrs, DM_SIZE, &size) == 0);
	assert(nvlist_lookup_uint32(mattrs, DM_BLOCKSIZE, &blocksize) == 0);
	nvlist_free(mattrs);

	if ((disk = dm_get_associated_descriptors(media,
	    DM_DRIVE, &error)) != NULL) {
		dattrs = dm_get_attributes(disk[0], &error);

		nvlist_query_string(dattrs, DM_VENDOR_ID, &vid);
		nvlist_query_string(dattrs, DM_PRODUCT_ID, &pid);
		nvlist_query_string(dattrs, DM_OPATH, &opath);

		removable = B_FALSE;
		if (nvlist_lookup_boolean(dattrs, DM_REMOVABLE) == 0)
			removable = B_TRUE;

		ssd = B_FALSE;
		if (nvlist_lookup_boolean(dattrs, DM_SOLIDSTATE) == 0)
			ssd = B_TRUE;

		if ((controller = dm_get_associated_descriptors(disk[0],
		    DM_CONTROLLER, &error)) != NULL) {
			cattrs = dm_get_attributes(controller[0], &error);
			nvlist_query_string(cattrs, DM_CTYPE, &ctype);
			ctype = strdup(ctype);
			for (c = ctype; *c != '\0'; c++)
				*c = toupper(*c);
		}

		/*
		 * Parse full device path to only show the device name, i.e.
		 * c0t1d0.  Many paths will reference a particular slice
		 * (c0t1d0s0), so remove the slice if present.
		 */
		if ((c = strrchr(opath, '/')) != NULL)
			(void) strlcpy(device, c + 1, sizeof (device));
		else
			(void) strlcpy(device, opath, sizeof (device));
		len = strlen(device);
		if (device[len - 2] == 's' &&
		    (device[len - 1] >= '0' && device[len - 1] <= '9'))
			device[len - 2] = '\0';

		/*
		 * The size is given in blocks, so multiply the number of blocks
		 * by the block size to get the total size, then convert to GiB.
		 */
		total = size * blocksize;

		if (opts->di_parseable) {
			(void) snprintf(sizestr, sizeof (sizestr),
			    "%llu", total);
		} else {
			total_in_GiB = (double)total/ 1024.0 / 1024.0 / 1024.0;
			(void) snprintf(sizestr, sizeof (sizestr),
			    "%.2f GiB", total_in_GiB);
		}

		if (opts->di_scripted) {
			printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			    ctype, device, vid, pid, sizestr,
			    removable ? "yes" : "no", ssd ? "yes" : "no");
		} else {
			printf("%-4s    %-6s    %-8s    %-16s   "
			    "%-12s    %-4s    %-4s\n", ctype, device,
			    vid, pid, sizestr, removable ? "yes" : "no",
			    ssd ? "yes" : "no");
		}

		free(ctype);
		nvlist_free(cattrs);
		nvlist_free(dattrs);
		dm_free_descriptors(controller);
	}

	dm_free_descriptors(disk);
}

int
main(int argc, char *argv[])
{
	di_opts_t opts = { B_FALSE, B_FALSE };
	char c;

	dm_descriptor_t *media;
	int error, ii;
	int filter[] = { DM_DT_FIXED, -1 };

	while ((c = getopt(argc, argv, "Hp")) != EOF) {
		switch (c) {
		case 'H':
			opts.di_scripted = B_TRUE;
			break;
		case 'p':
			opts.di_parseable = B_TRUE;
			break;
		default:
			return (1);
		}
	}

	error = 0;
	if ((media = dm_get_descriptors(DM_MEDIA, filter, &error)) == NULL) {
		fprintf(stderr, "Error from dm_get_descriptors: %d\n", error);
		return (1);
	}

	if (!opts.di_scripted) {
		printf("TYPE    DISK      VID         PID"
		    "                SIZE            REMV    SSD\n");
	}

	for (ii = 0; media != NULL && media[ii] != NULL; ii++)
		print_disks(media[ii], &opts);
	dm_free_descriptors(media);

	return (0);
}
