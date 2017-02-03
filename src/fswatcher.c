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
 * Copyright 2015, Joyent, Inc.
 *
 * gcc -Wall -Wextra fswatcher.c -o fswatcher -lthread
 *
 */

// #define DEBUG

#define _REENTRANT
#include <assert.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdlib.h>
#include <err.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>
#include <fcntl.h>
#include <strings.h>
#include <port.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <thread.h>
#include <time.h>

#include <libnvpair.h>

/*
 * On STDIN you can send:
 *
 * <KEY> WATCH <pathname> [timestamp]\n
 * <KEY> UNWATCH <pathname>\n
 *
 * The first will cause <pathname> to be added to the watch list. The second
 * will cause the watch for the specified path to be removed. The <KEY> must
 * be an integer in the range 1-4294967295 (inclusive). Leading 0's will be
 * removed. NOTE: 0 is a special key in that it will be used in output for
 * errors which were not directly the result of a command.
 *
 * When using a WATCH command with a <timestamp> argument, the timestamp must
 * be an integer number of nanoseconds since Jan 1, 1970 00:00:00 UTC. This
 * usually will be the time that the last event or modification was seen for
 * this file and the data can be pulled from stat(2)'s st_mtim structure.
 *
 * On STDOUT you will see JSON messages that look like the following but are
 * on a single line:
 *
 *  {
 *     "changes": [array],
 *     "code": <number>,
 *     "final": true|false,
 *     "key": <number>,
 *     "message": "human readable string",
 *     "pathname": "/path/which/had/event",
 *     "result": "SUCCESS|FAIL",
 *     "date": <string>,
 *     "type": <type>
 *  }
 *
 * Where:
 *
 *   changes   is an array of strings indicating which changes occurred
 *   code      is a positive integer code for an error
 *   final     true when the event being printed is the last without re-watch
 *   key       is the <KEY> for which a response corresponds
 *   message   is a human-readable string describing response
 *   pathname  is the path to which an event applies
 *   result    indicates whether a command was a SUCCESS or FAILURE
 *   date      ISO string date with millisecond resolution
 *   type      is one of: event, response, error
 *
 * And:
 *
 *   "date" is always included
 *   "type" is always included
 *   "changes" is included only when (type == event)
 *   "code" is included only when (type == error)
 *   "final" is included when (type == event)
 *   "key" is included whenever (type == response)
 *   "message" is included whenever (type == error)
 *   "pathname" is included whenever (type == event)
 *   "result" is included when (type == response) value: "SUCCESS" or "FAILURE"
 *
 * Current values for "code" are in the ErrorCodes enum below.
 *
 * EXIT STATUS
 *
 *   Under normal operation, fswatcher will run until STDIN is closed or a fatal
 *   error occurs. STDIN closing will result in exit code 0. Any other exit code
 *   should result in a message of type "error" being output before exiting
 *   non-zero.
 *
 *   When errors occur that are completly unexpected, this will call abort() to
 *   generate a core dump.
 *
 */

#define MAX_FMT_LEN 64
#define MAX_KEY 4294967295
#define MAX_KEY_LEN 10 /* number of digits (0-4294967295) */
#define MAX_STAT_RETRY 10 /* number of times to retry stat() before abort() */
#define MAX_TIMESTAMP_LEN 20

/* longest command is '<KEY> UNWATCH <path>' with <KEY> being 10 characters. */
#define MAX_CMD_LEN (MAX_KEY_LEN + 1 + 7 + 1 + PATH_MAX + 1 + MAX_TIMESTAMP_LEN)
#define HANDLES_MASK 0xffff /* number of lookup buckets in the hash */
#define SYSTEM_KEY 0

/* hashing implementation, really needs a real one */
#define HASH(name, hash, namlen)                    \
    {                                               \
        char Xc;                                    \
        const char *Xcp;                            \
        for (Xcp = (name); (Xc = *Xcp) != 0; Xcp++) \
            (hash) = ((hash) << 4) + (hash) + Xc;   \
        (namlen) = Xcp - (name);                    \
    }

enum ErrorCodes {
	ERR_INVALID_COMMAND,   /* failed to parse command from stdin line */
	ERR_INVALID_KEY,       /* failed to parse command from stdin line */
	ERR_UNKNOWN_COMMAND,   /* line was parsable, but unimplmented command */
	ERR_CANNOT_ASSOCIATE   /* port_associate(3c) failed */
};

enum ResultCodes {
	RESULT_SUCCESS,
	RESULT_FAILURE
};

struct fileinfo {
	struct fileinfo *next;
	struct fileinfo *prev;
	int namelen;
	int hash;
	struct file_obj fobj;
	int events;
};

struct fileinfo **handles = NULL;
volatile struct fileinfo *free_list = NULL;
static mutex_t handles_mutex;
static mutex_t free_mutex;
static mutex_t stdout_mutex;
static int port = -1;

static struct {
	boolean_t opt_j; /* -j, json output */
	boolean_t opt_r; /* -r, print ready event */
} opts;

static void usage(FILE *s);
nvlist_t * make_nvlist(char *type);
void print_nvlist(nvlist_t *nvl);
void enqueue_free_finf(struct fileinfo *finf);
void print_event(int event, char *pathname, int final);
void print_ready();
void check_and_rearm_event(uint32_t key, char *name, int revents);
void * wait_for_events(void *pn);
void watch_path(char *pathname, uint32_t key);
void unwatch_path(char *pathname, uint32_t key);
int process_stdin_line();

/*
 * Print the usage message to the given FILE handle
 */
static void
usage(FILE *s)
{
	fprintf(s, "Usage: fswatcher [-hrj]\n");
	fprintf(s, "\n");
	fprintf(s, "Watch files using event ports with commands sent to\n");
	fprintf(s, "stdin and event notifications sent to stdout.\n");
	fprintf(s, "\n");
	fprintf(s, "Options\n");
	fprintf(s, "  -h             print this message and exit\n");
	fprintf(s, "  -j             JSON output\n");
	fprintf(s, "  -r             print 'ready' event at start\n");
}

/*
 * Create an nvlist with "type" set to the type argument given,
 * and "date" set to the current time.  Must be free()d by
 * the caller
 */
nvlist_t *
make_nvlist(char *type)
{
	nvlist_t *nvl = fnvlist_alloc();
	struct timeval tv;
	struct tm *gmt;
	char date[128];
	size_t i;

	// get the current time
	if (gettimeofday(&tv, NULL) != 0)
		err(1, "gettimeofday");

	if ((gmt = gmtime(&tv.tv_sec)) == NULL)
		err(1, "gmtime");

	i = strftime(date, sizeof (date), "%Y-%m-%dT%H:%M:%S", gmt);
	if (i == 0)
		err(1, "strftime");

	// append milliseconds
	i = snprintf(date + i, sizeof (date) - i, ".%03ldZ", tv.tv_usec / 1000);
	if (i == 0)
		err(1, "snprintf date");

	fnvlist_add_string(nvl, "date", date);
	fnvlist_add_string(nvl, "type", type);

	return (nvl);
}

/*
 * Print an nvlist to stdout.  Will use the proper function to print
 * based on -j being set or not.
 *
 * This function handles acquiring the stdout_mutex as well as
 * fflushing stdout.
 */
void
print_nvlist(nvlist_t *nvl)
{
	mutex_lock(&stdout_mutex);

	if (opts.opt_j)
		nvlist_print_json(stdout, nvl);
	else
		nvlist_print(stdout, nvl);
	printf("\n");
	fflush(stdout);

	mutex_unlock(&stdout_mutex);
}

/*
 * Handle creating and printing an "event" message.
 */
void
print_event(int event, char *pathname, int final)
{
	int i = 0;
	char *changes[16];
	nvlist_t *nvl = make_nvlist("event");

	if (event & FILE_ACCESS) {
		changes[i++] = "FILE_ACCESS";
	}
	if (event & FILE_ATTRIB) {
		changes[i++] = "FILE_ATTRIB";
	}
	if (event & FILE_DELETE) {
		changes[i++] = "FILE_DELETE";
	}
	if (event & FILE_EXCEPTION) {
		changes[i++] = "FILE_EXCEPTION";
	}
	if (event & FILE_MODIFIED) {
		changes[i++] = "FILE_MODIFIED";
	}
	if (event & FILE_RENAME_FROM) {
		changes[i++] = "FILE_RENAME_FROM";
	}
	if (event & FILE_RENAME_TO) {
		changes[i++] = "FILE_RENAME_TO";
	}
	if (event & FILE_TRUNC) {
		changes[i++] = "FILE_TRUNC";
	}
	if (event & FILE_NOFOLLOW) {
		changes[i++] = "FILE_NOFOLLOW";
	}
	if (event & MOUNTEDOVER) {
		changes[i++] = "MOUNTEDOVER";
	}
	if (event & UNMOUNTED) {
		changes[i++] = "UNMOUNTED";
	}

	fnvlist_add_string_array(nvl, "changes", changes, i);
	fnvlist_add_string(nvl, "pathname", pathname);
        fnvlist_add_int32(nvl, "revents", event);
	fnvlist_add_boolean_value(nvl, "final", final);

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * Handle creating and printing a "ready" message.
 */
void
print_ready()
{
	nvlist_t *nvl = make_nvlist("ready");

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * print_error() takes a key, code (one of the ErrorCodes) and message and
 * handles creating and printing an "error" message.
 */
void
print_error(uint32_t key, uint32_t code, const char *message_fmt, ...)
{
	va_list arg_ptr;
	char message[4096];
	nvlist_t *nvl = make_nvlist("error");

	va_start(arg_ptr, message_fmt);
	if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
		/*
		 * We failed to build the error message, and there's no good
		 * way to handle this so we try to force a core dump. Most
		 * likely a bug.
		 */
		perror("fswatcher: vsnprintf");
		abort();
	}
	va_end(arg_ptr);

	fnvlist_add_uint32(nvl, "key", key);
	fnvlist_add_uint32(nvl, "code", code);
	fnvlist_add_string(nvl, "message", message);

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * print_result() takes a key, code (RESULT_SUCCESS||RESULT_FAILURE), pathname
 * and message and handles creating and printing a "result" message.
 */
void
print_result(uint32_t key, uint32_t code, const char *pathname,
    const char *message_fmt, ...)
{
	va_list arg_ptr;
	char message[4096];
	nvlist_t *nvl = make_nvlist("response");

	va_start(arg_ptr, message_fmt);
	if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
		/*
		 * We failed to build the error message, and there's no good
		 * way to handle this so we try to force a core dump. Most
		 * likely a bug.
		 */
		perror("fswatcher: vsnprintf");
		abort();
	}
	va_end(arg_ptr);

	fnvlist_add_uint32(nvl, "key", key);
	fnvlist_add_uint32(nvl, "code", code);
	fnvlist_add_string(nvl, "pathname", pathname);
	fnvlist_add_string(nvl, "message", message);
	fnvlist_add_string(nvl, "result", code == 0 ? "SUCCESS" : "FAIL");

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * find_handle() takes a pathname and returns the fileinfo struct from the
 * handles hash. returns NULL if no pathname matches.
 *
 * Should only be called when holding the handles_mutex
 */
struct fileinfo *
find_handle(char *pathname)
{
	int namelen;
	int hash = 0;
	int hash_idx;
	struct fileinfo *handle;

	HASH(pathname, hash, namelen);
	hash_idx = hash & HANDLES_MASK;
	handle = handles[hash_idx];

	if (handle == NULL)
		return (NULL);
	do {
		if (handle->hash == hash &&
		    handle->namelen == namelen &&
		    strcmp(handle->fobj.fo_name, pathname) == 0) {
			return (handle);
		}
		handle = handle->next;
	} while (handle != handles[hash_idx]);

	return (NULL);
}

/*
 * insert_handle() inserts a fileinfo into the hash.
 *
 * Should only be called after validating that the element does not exist
 * in the hash, and when holding the handles_mutex.
 */
void
insert_handle(struct fileinfo *handle)
{
	int hash_idx;

	handle->hash = 0;
	HASH(handle->fobj.fo_name, handle->hash, handle->namelen);
	hash_idx = handle->hash & HANDLES_MASK;

	if (handles[hash_idx] == NULL) {
		handle->next = handle;
		handle->prev = handle;
		handles[hash_idx] = handle;
	} else {
		handle->next = handles[hash_idx];
		handle->prev = handles[hash_idx]->prev;
		handles[hash_idx]->prev->next = handle;
		handles[hash_idx]->prev = handle;
		handles[hash_idx] = handle;
	}
}

/*
 * i_remove_handle() removes a fileinfo from the hash if the handle
 * is alreay known.
 *
 * Should only be called when holding the handles_mutex.
 */
void
i_remove_handle(struct fileinfo *handle)
{
	if (handle->next == handle) {
		handles[handle->hash & HANDLES_MASK] = NULL;
	} else {
		handles[handle->hash & HANDLES_MASK] = handle->next;
		handle->next->prev = handle->prev;
		handle->prev->next = handle->next;
	}
	handle->next = NULL;
	handle->prev = NULL;
}

/*
 * remove_handle() removes a fileinfo from the hash.
 *
 * Should only be called when holding the handles_mutex.
 */
void
remove_handle(char *pathname)
{
	struct fileinfo *handle;

	handle = find_handle(pathname);

	if (handle != NULL)
		i_remove_handle(handle);
}

/*
 * free_handle() frees a fileinfo handle.
 *
 */
void
free_handle(struct fileinfo *handle)
{
	if (handle->fobj.fo_name) {
		free(handle->fobj.fo_name);
		handle->fobj.fo_name = NULL;
	}
	free(handle);
}

/*
 * destroy_handle() removes a fileinfo handle for the hash, and frees it.
 *
 * MUST only be called from the secondary thread.
 */
void
destroy_handle(struct fileinfo *handle)
{
	mutex_lock(&handles_mutex);
	i_remove_handle(handle);
	mutex_unlock(&handles_mutex);
	free_handle(handle);
}

/*
 * stat_file() takes the same arguments as stat and calls stat for you but does
 * retries on errors and ultimately returns either 0 (success) or one of the
 * errno's listed in stat(2).
 *
 * WARNING: If it gets EINTR too many times (more than MAX_STAT_RETRY), this
 * will call abort().
 */
int
stat_file(const char *path, struct stat *buf)
{
	int stat_err;
	int stat_ret;
	int i;

	for (i = 0; i < MAX_STAT_RETRY; i++) {
		stat_ret = stat(path, buf);
		stat_err = errno;

		// return immediately upon success
		if (stat_ret == 0)
			return (0);

		// error from stat that means we can't retry - just return it
		if (stat_err != EINTR)
			return (stat_err);

		// Interrupted by signal, try again...
	}

	// if we are here, give up
	fprintf(stderr, "failed to stat %s more than %d times\n",
	    path, MAX_STAT_RETRY);
	abort();

	return (-1);
}

/*
 * Returns:
 *
 *  0     - success: atime, ctime and mtime will be populated
 *  non-0 - failed: file could not be accessed (return is stat(2) errno)
 */
int
get_stat(char *pathname, struct stat *sb)
{
	int stat_ret;

	stat_ret = stat_file(pathname, sb);

	switch (stat_ret) {
	case 0:
		/* SUCCESS! (sb will be populated) */
		return (0);
	case ELOOP:         /* symbolic links in path point to each other */
	case ENOTDIR:       /* component of path is not a dir */
	case EACCES:        /* permission denied */
	case ENOENT:        /* file or component path doesn't exist */
		/*
		 * The above are all fixable problems. We can't open the file
		 * right now, but we know that we shouldn't be able to either.
		 * As such, these are non-fatal and just result in a FAIL (with
		 * final flag set true) response if we're responding to a
		 * request or an error line if we're dealing with an event.
		 */
		return (stat_ret);
	case EFAULT:        /* filename or buffer invalid (programmer error) */
	case EIO:           /* error reading from filesystem (system error) */
	case ENAMETOOLONG:  /* fo_name is too long (programmer error) */
	case ENOLINK:       /* broken link to remote machine */
	case ENXIO:         /* path marked faulty and retired */
	case EOVERFLOW:     /* file is broken (system error) */
	default:
		/*
		 * This handles cases we don't know how to deal with, by
		 * dumping core so that it can later be debugged.
		 */
		abort();
		break;
	}
}

void
register_watch(uint32_t key, char *name, struct stat sb)
{
	struct fileinfo *finf;
	struct file_obj *fobjp;
	int pa_ret;

	mutex_lock(&handles_mutex);

	finf = find_handle(name);

	/*
	 * We are no longer interested in events for this idx.
	 */
	if (finf == NULL) {
		mutex_unlock(&handles_mutex);
		return;
	}

	fobjp = &finf->fobj;
	fobjp->fo_atime = sb.st_atim;
	fobjp->fo_mtime = sb.st_mtim;
	fobjp->fo_ctime = sb.st_ctim;

	/*
	 * we do the associate inside of the mutex so that we don't
	 * accidentally associate a source that had been removed.
	 */
	pa_ret = port_associate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp,
	    finf->events, name);

	mutex_unlock(&handles_mutex);

	if (key != 0) {
		/*
		 * We're trying to do an initial associate, so we'll print a
		 * result whether we succeeded or failed.
		 */
		if (pa_ret == -1) {
			print_result(key, RESULT_FAILURE, fobjp->fo_name,
			    "port_associate(3c) failed with errno %d: %s",
			    errno, strerror(errno));
			destroy_handle(finf);
		} else {
			print_result(key, RESULT_SUCCESS, fobjp->fo_name,
			    "port_associate(3c) started watching path");
		}
	} else if (pa_ret == -1) {
		/*
		 * We're trying to re-associate so we only dump a message if
		 * that failed.
		 */
		print_error(key, ERR_CANNOT_ASSOCIATE,
		    "port_associate(3c) failed for '%s', errno %d: %s",
		    fobjp->fo_name, errno, strerror(errno));
	}
}

/*
 * check_and_rearm_event() is called to (re)arm watches. This can either be
 * because of an event (in which case revents should be pe.portev_events) or to
 * initially arm in which case revents should be 0.
 *
 * It also performs the required stat() and in case this is a re-arm prints
 * the event.
 *
 * We keep these two functions together (rearming and printing) because we need
 * to do the stat() before we print the results since if the file no longer
 * exists we cannot rearm. In that case we set the 'final' flag in the response.
 */
void
check_and_rearm_event(uint32_t key, char *name, int revents)
{
	int final = 0;
	struct fileinfo *finf;
	struct stat sb;
	int stat_ret;

	mutex_lock(&handles_mutex);

	finf = find_handle(name);
	if (finf == NULL) {
		mutex_unlock(&handles_mutex);
		return;
	}
	mutex_unlock(&handles_mutex);

	// We always stat the file after an event is received, or for the
	// inital watch.  If the stat fails for any reason, or a delete
	// or unmounted event are seen, we mark this file as "final".  This
	// means we will no longer be watching this file.
	stat_ret = get_stat(finf->fobj.fo_name, &sb);
	if (stat_ret != 0 || revents & FILE_DELETE || revents & UNMOUNTED) {
		final = 1;
	}

	if (revents) {
		print_event(revents, finf->fobj.fo_name, final);
	}

	if ((key != 0) && (stat_ret != 0)) {
		// We're doing the initial register for this file, so we need
		// to send a result. Since stat() just failed, we'll send now
		// and return since we're not going to do anything further.
		print_result(key, RESULT_FAILURE, finf->fobj.fo_name,
		    "stat(2) failed with errno %d: %s",
		    stat_ret, strerror(stat_ret));
		assert(final);
	}

	if (final) {
		// we're not going to re-enable, so cleanup
		destroy_handle(finf);
		return;
	}

	// (re)register
	register_watch(key, name, sb);
}

/*
 * Worker thread waits here for events, which then get dispatched to
 * check_and_rearm_event().
 */
void *
wait_for_events(void *arg)
{
	(void) arg;
	struct fileinfo *finf;
	port_event_t pe;

	while (!port_get(port, &pe, NULL)) {
		/*
		 * Can add cases for other sources if this
		 * port is used to collect events from multiple sources.
		 */
		switch (pe.portev_source) {
		case PORT_SOURCE_FILE:
			/* Call file events event handler */
			check_and_rearm_event(0, (char *)pe.portev_user,
			    pe.portev_events);
			break;
		default:
			/*
			 * Something's seriously wrong if we get events with a
			 * port source other than FILE, since that's all we're
			 * adding. So abort and hope there's enough state in
			 * the core.
			 */
			fprintf(stderr, "event from unexpected source: %d",
			    pe.portev_source);
			abort();
		}

		/*
		 * The actual work of freeing finf objects is done in this
		 * thread so that there aren't any race conditions while
		 * accessing free_list->fobj.fo_name in the
		 * check_and_rearm_event function
		 */
		mutex_lock(&free_mutex);
		while (free_list != NULL) {
			finf = free_list->next;
			free_handle((struct fileinfo *)free_list);
			free_list = finf;
		}
		mutex_unlock(&free_mutex);
	}
	fprintf(stderr, "fswatcher: worker thread exiting\n");
	fflush(stderr);
	return (NULL);
}

/*
 * Enqueue a finf object to be freed. All this really does is add the structure
 * to a list that should be freed in the secondary worker thread.
 *
 * This is done to prevent race conditions where the finf object would be freed
 * in the main thread right before an event in the secondary thread would try to
 * access the name of the object that was going to be stat'd.
 */
void
enqueue_free_finf(struct fileinfo *finf)
{
	if (finf != NULL) {
		mutex_lock(&free_mutex);
		finf->next = (struct fileinfo *)free_list;
		free_list = finf;
		finf->prev = NULL;
		mutex_unlock(&free_mutex);
	}
}

/*
 * Only called from main thread. Attempts to watch pathname.
 */
void
watch_path(char *pathname, uint32_t key)
{
	struct fileinfo *finf;

	finf = malloc(sizeof (struct fileinfo));
	if (finf == NULL) {
		fprintf(stderr, "failed to allocate memory for new watcher "
		    "errno %d: %s", errno, strerror(errno));
		abort();
	}

	if ((finf->fobj.fo_name = strdup(pathname)) == NULL) {
		fprintf(stderr, "strdup failed w/ errno %d: %s",
		    errno, strerror(errno));
		abort();
	}

	// from here on we'll need to cleanup finf when done with it.

	mutex_lock(&handles_mutex);

	if (find_handle(pathname) != NULL) {
		// early-return: already watching so unlock and return success
		mutex_unlock(&handles_mutex);

		print_result(key, RESULT_SUCCESS, pathname, "already watching");
		free_handle(finf);
		return;
	}

	insert_handle(finf);

	mutex_unlock(&handles_mutex);

	// only watch for modification events
	finf->events = FILE_MODIFIED;
	check_and_rearm_event(key, finf->fobj.fo_name, 0);
}

/*
 * Only called from main thread. Attempts to unwatch pathname.
 */
void
unwatch_path(char *pathname, uint32_t key)
{
	struct fileinfo *finf;
	struct file_obj *fobjp;
	int ret;

	mutex_lock(&handles_mutex);

	finf = find_handle(pathname);
	if (finf == NULL) {
		mutex_unlock(&handles_mutex);
		print_result(key, RESULT_FAILURE, pathname,
		    "not watching '%s', cannot unwatch", pathname);
		return;
	}

	fobjp = &finf->fobj;
	/*
	 * From the man page, there are 5 possible errors for port_dissociate():
	 *
	 * EBADF
	 *          The port identifier is not valid.
	 *
	 * EBADFD
	 *          The source argument is of type PORT_SOURCE_FD  and  the
	 *          object argument is not a valid file descriptor.
	 *
	 * EINVAL
	 *          The source argument is not valid.
	 *
	 * EACCES
	 *          The process is not the owner of the association.
	 *
	 * ENOENT
	 *          The specified object is not associated with the port.
	 *
	 *
	 * none of these seem like they'll succeed if tried again later for this
	 * same file, so in every case we assume that the file is no longer
	 * associated and remove the handle.
	 */
	ret = port_dissociate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp);
	i_remove_handle(finf);
	mutex_unlock(&handles_mutex);

	enqueue_free_finf(finf);

	if (ret == -1) {
		/* file may have been deleted/moved */
		print_result(key, RESULT_FAILURE, pathname,
		    "failed to unregister '%s' (errno %d): %s", pathname, errno,
		    strerror(errno));
	} else {
		print_result(key, RESULT_SUCCESS, pathname,
		    "no longer watching '%s'", pathname);
	}
}

/*
 * process one line of stdin
 *
 * returns 0 if we can continue, otherwise returns a value suitable
 * for exiting the program with.
 */
int
process_stdin_line()
{
	char cmd[MAX_CMD_LEN + 1];
	uint32_t key;
	char key_str[MAX_KEY_LEN + 2];
	char path[MAX_CMD_LEN + 1];
	int res;
	char sscanf_fmt[MAX_FMT_LEN];
	char str[MAX_CMD_LEN + 1];

	// get a line
	if (fgets(str, MAX_CMD_LEN + 1, stdin) == NULL) {
		fprintf(stderr, "fswatcher: error on stdin (errno: %d): %s\n",
		    errno, strerror(errno));
		return (1);
	}

	// read one character past MAX_KEY_LEN so we know it's too long
	snprintf(sscanf_fmt, MAX_FMT_LEN, "%%%ds %%s %%s", MAX_KEY_LEN + 1);
	res = sscanf(str, sscanf_fmt, key_str, cmd, path);

	if (res != 3) {
		print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
		    "invalid command line");
		return (0);
	}

	// convert key to a number we can work with
	key = strtoul(key_str, NULL, 10);
	if ((strlen(key_str) > MAX_KEY_LEN) ||
	    (key == ULONG_MAX && errno == ERANGE)) {

		print_error(SYSTEM_KEY, ERR_INVALID_KEY,
		    "invalid key: > ULONG_MAX");
		return (0);
	}

	// this is a reserved key
	if (key == 0) {
		print_error(SYSTEM_KEY, ERR_INVALID_KEY, "invalid key: 0");
		return (0);
	}

#ifdef DEBUG
	fprintf(stderr, "DEBUG key: %u cmd: %s path: %s\n", key, cmd, path);
#endif

	if (strcmp("UNWATCH", cmd) == 0) {
		unwatch_path(path, key);
	} else if (strcmp("WATCH", cmd) == 0) {
		watch_path(path, key);
	} else {
		print_error(key, ERR_UNKNOWN_COMMAND, "unknown command '%s'",
		    cmd);
	}

	return (0);
}

int
main(int argc, char **argv)
{
	int opt;
	int exit_code = 0;
	pthread_t tid;

	handles = calloc(sizeof (struct fileinfo *), HANDLES_MASK);

	opts.opt_j = B_FALSE;
	opts.opt_r = B_FALSE;
	while ((opt = getopt(argc, argv, "hjr")) != -1) {
		switch (opt) {
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

	if ((port = port_create()) == -1) {
		fprintf(stderr, "port_create failed(%d): %s",
		    errno, strerror(errno));
		return (1);
	}

	// create a worker thread to process events.
	pthread_create(&tid, NULL, wait_for_events, NULL);


	// alert that we are ready for input
	if (opts.opt_r)
		print_ready();

	// read stdin line-by-link until error
	while ((exit_code = process_stdin_line()) == 0) {
		// do nothing
	}

	// close port - will de-activate all file events watches
	close(port);
	port = -1;

	// wait for threads to exit
	while (thr_join(0, NULL, NULL) == 0) {
		// do nothing
	}

	// cleanup
	free(handles);

	return (exit_code);
}
