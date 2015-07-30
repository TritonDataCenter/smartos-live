#include <err.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

#include <libsysevent.h>
#include <libnvpair.h>

struct {
	boolean_t opt_j; /* -j, json output */
} opts;

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
	struct timeval tv;
	struct tm *gmt;
	nvlist_t *evnvl = NULL;
	nvlist_t *nvl = NULL;
	char *vendor = NULL;
	char *publisher = NULL;
	char *class = NULL;
	char *subclass = NULL;
	char date[128];
	pid_t pid;
	size_t i;

	/* create an nvlist to hold everything */
	if (nvlist_alloc(&nvl, NV_UNIQUE_NAME, 0) != 0) {
		warn("nvlist_alloc");
		goto done;
	}

	/* get the nvlist from the sysevent */
	if (sysevent_get_attr_list(ev, &evnvl) != 0) {
		warn("sysevent_get_attr_list");
		goto done;
	}

	/* get the current time */
	if (gettimeofday(&tv, NULL) != 0) {
		warn("gettimeofday");
		goto done;
	}
	if ((gmt = gmtime(&tv.tv_sec)) == NULL) {
		warn("gmtime");
		goto done;
	}
	i = strftime(date, sizeof (date), "%Y-%m-%dT%H:%M:%S", gmt);
	if (i == 0) {
		warn("strftime");
		goto done;
	}
	/* append milliseconds */
	i = snprintf(date + i, sizeof (date) - i, ".%03ldZ", tv.tv_usec / 1000);
	if (i == 0) {
		warn("snprintf date");
		goto done;
	}

	/* get sysevent metadata and add to the nvlist */
	vendor = sysevent_get_vendor_name(ev);
	publisher = sysevent_get_pub_name(ev);
	class = sysevent_get_class_name(ev);
	subclass = sysevent_get_subclass_name(ev);
	sysevent_get_pid(ev, &pid);

	if (vendor == NULL || publisher == NULL || class == NULL ||
	    subclass == NULL) {
		warn("failed to retrieve sysevent metadata");
		goto done;
	}

	if (nvlist_add_string(nvl, "date", date) != 0 ||
	    nvlist_add_string(nvl, "vendor", vendor) != 0 ||
	    nvlist_add_string(nvl, "publisher", publisher) != 0 ||
	    nvlist_add_string(nvl, "class", class) != 0 ||
	    nvlist_add_string(nvl, "subclass", subclass) != 0 ||
	    nvlist_add_int32(nvl, "pid", pid) != 0) {
		warn("nvlist_add_* nvl");
		goto done;
	}

	if (evnvl != NULL &&
	    nvlist_add_nvlist(nvl, "data", evnvl) != 0) {
		warn("nvlist_add_nvlist evnvl");
		goto done;
	}

	if (channel != NULL &&
	    nvlist_add_string(nvl, "channel", channel) != 0) {
		warn("nvlist_add_string channel");
		goto done;
	}

	/* print to stdout */
	if (opts.opt_j) {
		/* json output */
		nvlist_print_json(stdout, nvl);
	} else {
		/* default  output */
		nvlist_print(stdout, nvl);
	}
	printf("\n");

	fflush(stdout);

done:
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
}

int
main(int argc, char **argv)
{
	int opt;
	char *channel = NULL;
	char *class;
	const char **subclasses;
	int num_subclasses;

	const char *all_subclasses[1];
	all_subclasses[0] = EC_SUB_ALL;

	opts.opt_j = B_FALSE;
	while ((opt = getopt(argc, argv, "c:hj")) != -1) {
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

	/* bind and subscribe */
	if (channel != NULL)
		sysevc_register(channel, class);
	else
		sysev_register(class, subclasses, num_subclasses);

	/* halt until events */
	for (;;)
		pause();

	return (0);
}
