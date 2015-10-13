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
 * Copyright 2015 Joyent, Inc.
 */

/*
 * This is a syseventd module that is responsible for listening to datalink link
 * state change events and updating sysinfo. To ensure that the sysinfo update
 * storm doesn't happen, we apply the following hysteresis rules:
 *
 * 1) Always run sysinfo -u when we first are started, this ensures that we have
 * a more up to date view of the system.
 *
 * 2) We only care about events if the zone id in the event is the global zones.
 *
 * 3) We skip any events about things that have the name tmp$number, as those
 * are used by the brands as a temporary vnic name.
 *
 * 4) We only update sysinfo at most once per minute.
 *
 * 5) Always do the fork / exec / wait's in a different thread.
 *
 * 6) When inactive, always wait five seconds after getting the first sysinfo
 * change
 */

#include <string.h>
#include <libsysevent.h>
#include <sys/sysevent/eventdefs.h>
#include <sys/sysevent/datalink.h>
#include <sys/dls_mgmt.h>
#include <thread.h>
#include <synch.h>
#include <sys/debug.h>
#include <sys/time.h>
#include <sys/fork.h>
#include <time.h>
#include <errno.h>
#include <stdlib.h>
#include <paths.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/wait.h>
#include <ctype.h>

static thread_t sysinfo_thr;
static mutex_t sysinfo_lock = ERRORCHECKMUTEX;
static cond_t sysinfo_cond = DEFAULTCV;
static boolean_t sysinfo_exit;
static int sysinfo_devnull;
static int sysinfo_count;
static int sysinfo_stall = 5;
static int sysinfo_period = 60;
static char *sysinfo_prog = "/usr/bin/sysinfo";
static char *sysinfo_args[] = { "/usr/bin/sysinfo", "-u", NULL };

static void
sysinfo_sleep(int sec)
{
	struct timespec rq;

	rq.tv_sec = sec;
	rq.tv_nsec = 0;

	for (;;) {
		int ret = nanosleep(&rq, &rq);
		if (ret == 0)
			break;
		if (errno == EINTR)
			continue;
		abort();
	}
}

static void *
sysinfo_notify_thread(void *arg)
{
	hrtime_t lastact = 0;
	hrtime_t diff;

	for (;;) {
		int wait, ret, estat;
		pid_t child;

		mutex_enter(&sysinfo_lock);
		while (sysinfo_count == 0 && sysinfo_exit == B_FALSE) {
			(void) cond_wait(&sysinfo_cond, &sysinfo_lock);
		}
		ASSERT(sysinfo_count > 0 || sysinfo_exit == B_TRUE);
		if (sysinfo_exit == B_TRUE) {
			mutex_exit(&sysinfo_lock);
			return (NULL);
		}
		mutex_exit(&sysinfo_lock);

		/*
		 * Okay, we're going to go, first determine how long we should
		 * wait. We need to apply both rules 6 and rule 1.
		 */
		diff = (gethrtime() - lastact) / NANOSEC;

		if (diff > sysinfo_period) {
			wait = sysinfo_stall;
		} else {
			wait = diff;
		}

		sysinfo_sleep(wait);

		mutex_enter(&sysinfo_lock);
		sysinfo_count = 0;
		mutex_exit(&sysinfo_lock);

		/*
		 * Finally, go ahead and do the execution.
		 */
		child = forkx(FORK_NOSIGCHLD | FORK_WAITPID);
		if (child == -1) {
			(void) fprintf(stderr, "sysinfo_mod.so: failed "
			    "to fork sysinfo update: %s\n",
			    strerror(errno));

			mutex_enter(&sysinfo_lock);
			sysinfo_count++;
			mutex_exit(&sysinfo_lock);

			lastact = gethrtime();
			continue;
		}

		if (child == 0) {
			if (dup2(sysinfo_devnull, STDIN_FILENO) != 0)
				_exit(127);
			closefrom(STDERR_FILENO + 1);
			(void) execv(sysinfo_prog, sysinfo_args);
			_exit(127);
		}

		do {
			ret = waitpid(child, &estat, 0);
		} while (ret == -1 && errno == EINTR);

		if (ret == -1)
			abort();

		if (estat != 0) {
			mutex_enter(&sysinfo_lock);
			sysinfo_count++;
			mutex_exit(&sysinfo_lock);
		}

		lastact = gethrtime();
	}
	return (NULL);
}

static int
sysinfo_deliver_event(sysevent_t *ev, int unused)
{
	const char *class = sysevent_get_class_name(ev);
	const char *subclass = sysevent_get_subclass_name(ev);
	nvlist_t *nvl;
	int32_t zid;
	char *name;

	if (strcmp(class, EC_DATALINK) != 0 ||
	    strcmp(subclass, ESC_DATALINK_LINK_STATE) != 0)
		return (0);

	if (sysevent_get_attr_list(ev, &nvl) != 0)
		return (EINVAL);

	/*
	 * If we don't find an attribute that we expect, then we'll end up
	 * returning zero, as it indicates that we processed this correctly, but
	 * it's a bit messed up.
	 */
	if (nvlist_lookup_int32(nvl, DATALINK_EV_ZONE_ID, &zid) != 0 ||
	    nvlist_lookup_string(nvl, DATALINK_EV_LINK_NAME, &name) != 0)
		goto out;

	if (zid != GLOBAL_ZONEID)
		goto out;

	if (strncmp(name, "tmp", 3) == 0) {
		if (isdigit(*(name + 3)) != 0)
			goto out;
	}

	mutex_enter(&sysinfo_lock);
	sysinfo_count++;
	(void) cond_signal(&sysinfo_cond);
	mutex_exit(&sysinfo_lock);

out:
	nvlist_free(nvl);
	return (0);
}

static struct slm_mod_ops sysinfo_mod_ops = {
	SE_MAJOR_VERSION,
	SE_MINOR_VERSION,
	SE_MAX_RETRY_LIMIT,
	sysinfo_deliver_event
};

struct slm_mod_ops *
slm_init()
{
	sysinfo_count = 1;

	if ((sysinfo_devnull = open(_PATH_DEVNULL, O_RDONLY)) < 0)
		return (NULL);

	if (thr_create(NULL, 0, sysinfo_notify_thread, NULL, 0,
	    &sysinfo_thr) != 0) {
		if (close(sysinfo_devnull) != 0)
			abort();
		return (NULL);
	}

	return (&sysinfo_mod_ops);
}

void
slm_fini()
{
	mutex_enter(&sysinfo_lock);
	sysinfo_exit = B_TRUE;
	(void) cond_signal(&sysinfo_cond);
	mutex_exit(&sysinfo_lock);
	VERIFY(thr_join(sysinfo_thr, NULL, NULL) == 0);
	if (close(sysinfo_devnull) != 0)
		abort();
}
