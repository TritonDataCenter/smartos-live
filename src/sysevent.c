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
 * Copyright 2017 Joyent, Inc.
 *
 */

#include <err.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <synch.h>
#include <thread.h>
#include <time.h>
#include <unistd.h>

#include <libsysevent.h>
#include <libnvpair.h>

/* CLI arguments */
struct {
	boolean_t opt_j; /* -j, json output */
	boolean_t opt_r; /* -r, print ready event */
} opts;

static mutex_t stdout_mutex;

/*
 * Like VERIFY0, but instead of calling abort(), will print an error message
 * to stderr and exit the program.
 *
 * This is used by the nvlist_* functions to ensure that we are able to create
 * and add to an nvlist without error.  The nvlist functions used can only
 * fail with EINVAL or ENOMEM: dumping core because of either of these failure
 * modes would be excessive.
 */
#define ENSURE0(arg) {	\
    if (arg != 0)	\
        err(1, #arg);	\
}

/*
 * Create an nvlist with "type" set to the type argument given,
 * and "date" set to the current time.  Must be freed by the caller.
 */
nvlist_t *
make_nvlist(char *type)
{
	nvlist_t *nvl;
	struct timeval tv;
	struct tm *gmt;
	char date[128];
	size_t i;

	ENSURE0(nvlist_alloc(&nvl, NV_UNIQUE_NAME, 0));

	/* get the current time */
	if (gettimeofday(&tv, NULL) != 0)
		err(1, "gettimeofday");

	if ((gmt = gmtime(&tv.tv_sec)) == NULL)
		err(1, "gmtime");

	i = strftime(date, sizeof (date), "%Y-%m-%dT%H:%M:%S", gmt);
	if (i == 0)
		err(1, "strftime");

	/* append milliseconds */
	i = snprintf(date + i, sizeof (date) - i, ".%03ldZ", tv.tv_usec / 1000);
	if (i == 0)
		err(1, "snprintf date");

	ENSURE0(nvlist_add_string(nvl, "date", date));
	ENSURE0(nvlist_add_string(nvl, "type", type));

	return (nvl);
}

/*
 * Print an nvlist to stdout (with respect to the -j argument)
 * as well as a trailing newline followed by a call to fflush.
 *
 * Must be called while holding the stdout mutex
 */
void
print_nvlist(nvlist_t *nvl)
{
	if (opts.opt_j)
		nvlist_print_json(stdout, nvl);
	else
		nvlist_print(stdout, nvl);

	printf("\n");
	fflush(stdout);
}

/*
 * Called by sysevent handlers for each event. This will handle emitting the
 * event to stdout, either in human-readable form or JSON based on the
 * command line options given.
 *
 * "channel" is optional and may be set to NULL in the case that is not
 * applicable.
 *
 */
static void
process_event(sysevent_t *ev, const char *channel)
{
	nvlist_t *nvl;
	nvlist_t *evnvl = NULL;
	char *vendor = NULL;
	char *publisher = NULL;
	char *class = NULL;
	char *subclass = NULL;
	pid_t pid;

	/* create an nvlist to hold everything */
	nvl = make_nvlist("event");

	/* get the nvlist from the sysevent */
	if (sysevent_get_attr_list(ev, &evnvl) != 0)
		err(1, "sysevent_get_attr_list");

	/* get sysevent metadata and add to the nvlist */
	vendor = sysevent_get_vendor_name(ev);
	publisher = sysevent_get_pub_name(ev);
	class = sysevent_get_class_name(ev);
	subclass = sysevent_get_subclass_name(ev);
	sysevent_get_pid(ev, &pid);

	if (vendor == NULL || publisher == NULL || class == NULL ||
	    subclass == NULL)
		err(1, "failed to retrieve sysevent metadata");

	ENSURE0(nvlist_add_string(nvl, "vendor", vendor));
	ENSURE0(nvlist_add_string(nvl, "publisher", publisher));
	ENSURE0(nvlist_add_string(nvl, "class", class));
	ENSURE0(nvlist_add_string(nvl, "subclass", subclass));
	ENSURE0(nvlist_add_int32(nvl, "pid", pid));

	if (evnvl != NULL)
	    ENSURE0(nvlist_add_nvlist(nvl, "data", evnvl));

	if (channel != NULL)
	    ENSURE0(nvlist_add_string(nvl, "channel", channel));

	mutex_lock(&stdout_mutex);
	print_nvlist(nvl);
	mutex_unlock(&stdout_mutex);

	free(vendor);
	free(publisher);
	nvlist_free(evnvl);
	nvlist_free(nvl);
}

/*
 * Sysevents handler
 *
 * This function is bound with sysevent_bind_handle() to handle
 * any incoming, non-channeled, sysevents.
 *
 */
static void
sysev_handler(sysevent_t *ev)
{
	process_event(ev, NULL);
}

/*
 * Sysevents channel handler
 *
 * This function is bound with sysevent_evc_bind() to handle
 * any incoming, channeled, sysevents.
 *
 */
static int
sysevc_handler(sysevent_t *ev, void *cookie)
{
	const char *channel = (const char *)cookie;
	process_event(ev, channel);
	return (0);
}

/*
 * Register sysevent
 *
 * Takes a class, and an array of subclasses (and the count), and binds
 * and subscribes the sysev_handler() function.
 *
 */
static void
sysev_register(char *class, const char **subclasses, int num_subclasses)
{
	sysevent_handle_t *handle = sysevent_bind_handle(sysev_handler);

	if (handle == NULL)
		err(1, "sysevent_bind_handle");

	if (sysevent_subscribe_event(handle, class, subclasses,
	    num_subclasses) != 0)
		err(2, "sysevent_subscribe_event");
}

/*
 * register sysevent channel
 *
 * Takes a channel and class, and binds and subscribes the sysevc_handler()
 * function.
 *
 */
static void
sysevc_register(const char *channel, const char *class)
{
	evchan_t *ch;
	char subid[128];

	if (sysevent_evc_bind(channel, &ch, 0) != 0)
		err(1, "sysevent_evc_bind");

	snprintf(subid, sizeof (subid), "sysevent-%ld", getpid());
	if (sysevent_evc_subscribe(ch, subid, class, sysevc_handler,
	    (void *)channel, 0) != 0)
		err(2, "sysevent_evc_subscribe");

}

/*
 * Print the usage message to the given FILE handle
 *
 */
static void
usage(FILE *s)
{
	fprintf(s, "usage: sysevent [-hj] [-c channel] [class] [subclass1] "
	    "[...]\n");
	fprintf(s, "\n");
	fprintf(s, "emit sysevents to stdout\n");
	fprintf(s, "\n");
	fprintf(s, "options\n");
	fprintf(s, "  -c <channel>   bind to the event channel\n");
	fprintf(s, "  -h             print this message and exit\n");
	fprintf(s, "  -j             JSON output\n");
	fprintf(s, "  -r             print 'ready' event at start\n");
}

int
main(int argc, char **argv)
{
	int opt;
	char *channel = NULL;
	char *class;
	const char **subclasses;
	int num_subclasses;
	nvlist_t *ready_nvl;

	const char *all_subclasses[1];
	all_subclasses[0] = EC_SUB_ALL;

	opts.opt_j = B_FALSE;
	while ((opt = getopt(argc, argv, "c:hjr")) != -1) {
		switch (opt) {
		case 'c':
			channel = optarg;
			break;
		case 'h':
			usage(stdout);
			return (0);
		case 'j':
			opts.opt_j = B_TRUE;
			break;
		case 'r':
			opts.opt_r = B_TRUE;
			break;
		default:
			usage(stderr);
			return (1);
		}
	}
	argc -= optind;
	argv += optind;

	/* class */
	if (argc > 0) {
		class = argv[0];
		argv++;
		argc--;
	} else {
		class = EC_ALL;
	}

	/* subclasses */
	if (argc > 0) {
		subclasses = (const char **)argv;
		num_subclasses = argc;
	} else {
		subclasses = all_subclasses;
		num_subclasses = 1;
	}

	/*
	 * If the caller wants a "ready" event to be emitted, we must grab the
	 * stdout mutex before registering for any sysevents.  This ensures the
	 * "ready" event is printed before any other event is printed, but
	 * after we are successfully subscribed to the event channel.
	 */
	if (opts.opt_r) {
		mutex_lock(&stdout_mutex);
	}

	/* bind and subscribe */
	if (channel != NULL)
		sysevc_register(channel, class);
	else
		sysev_register(class, subclasses, num_subclasses);

	/* ready event */
	if (opts.opt_r) {
		ready_nvl = make_nvlist("ready");

		print_nvlist(ready_nvl);
		mutex_unlock(&stdout_mutex);

		nvlist_free(ready_nvl);
	}

	/* halt until events */
	for (;;)
		pause();

	return (0);
}
