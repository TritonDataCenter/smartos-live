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
 * Copyright 2017, Joyent, Inc.
 *
 * cc -Wall -Wextra fswatcher.c -o fswatcher -lthread -lnvpair -lavl
 *
 */

/*
 * On STDIN you can send:
 *
 * <KEY> WATCH <pathname>\n
 * <KEY> UNWATCH <pathname>\n
 * <KEY> STATUS\n
 *
 * The first will cause <pathname> to be added to the watch list. The second
 * will cause the watch for the specified path to be removed.  The third will
 * print this programs status to stdout. The <KEY> must be an integer in the
 * range 1-4294967295 (inclusive). Leading 0's will be removed. NOTE: 0 is a
 * special key that will be used in output for errors which were not directly
 * the result of a command.
 *
 * "pathname" can be any type of file that event ports supports (file,
 * directory, pipe, etc.).  This program will also follow symlinks as well:
 * note that the source file for the symlink must exist to watch, and if
 * the source file is deleted after a watch is established a FILE_DELETE
 * event will be seen.
 *
 * When watching a file, it will be rewatched every time an event is seen
 * until an UNWATCH command for the file is received by the user, or an event
 * indicates that the file can no longer be watched (like FILE_DELETE).
 *
 * On STDOUT you will see JSON messages that look like the following but are
 * on a single line:
 *
 *  {
 *     "type": <string>,
 *     "date": <string>,
 *     "changes": [array],
 *     "code": <number>,
 *     "final": true|false,
 *     "key": <number>,
 *     "message": "human readable string",
 *     "pathname": "/path/which/had/event",
 *     "result": "SUCCESS|FAIL"
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
 *   result    indicates whether a command was a "SUCCESS" or "FAILURE"
 *   date      ISO string date with millisecond resolution
 *   type      is one of: ready, event, response, error
 *
 * And:
 *
 *   "type" is always included
 *   "date" is always included
 *   "changes" is included only when (type == event)
 *   "code" is included only when (type == error)
 *   "final" is included when (type == event)
 *   "key" is included whenever (type == response)
 *   "message" is included whenever (type == error)
 *   "pathname" is included whenever (type == event)
 *   "result" is included when (type == response) value: "SUCCESS" or "FAILURE"
 *   "data" is included when a call to STATUS is made (type == response)
 *
 * Current values for "code" are in the ErrorCodes enum below.
 *
 * EXIT STATUS
 *
 *   Under normal operation, fswatcher will run until STDIN is closed or a fatal
 *   error occurs.
 *
 *   When errors occur that are completly unexpected, this will call abort() to
 *   generate a core dump.
 *
 */

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
#include <stddef.h>
#include <stdio.h>
#include <thread.h>
#include <time.h>

#include <sys/avl.h>
#include <libnvpair.h>

#define MAX_FMT_LEN 64
#define MAX_KEY 4294967295
#define MAX_KEY_LEN 10       // number of digits (0-4294967295)
#define MAX_STAT_RETRY 10    // number of times to retry stat() before abort()

/* longest command is '<KEY> UNWATCH <path>' with <KEY> being 10 characters. */
#define MAX_CMD_LEN (MAX_KEY_LEN + 1 + 7 + 1 + PATH_MAX + 1)
#define SYSTEM_KEY 0

/*
 * These are possible values returned from an "error" event
 */
enum ErrorCodes {
	ERR_INVALID_COMMAND = 1, // failed to parse command from stdin line
	ERR_INVALID_KEY,         // key parsed from command is invalid
	ERR_UNKNOWN_COMMAND,     // line was parsable, but unimplmented command
	ERR_CANNOT_ASSOCIATE     // port_associate(3c) failed
};

/*
 * Values returned for "result" events
 */
enum ResultCodes {
	RESULT_SUCCESS = 0,
	RESULT_FAILURE
};

/*
 * file_obj structs are held in memory for every file that is currently being
 * watched.  This way we can 1. verify that incoming events are for files being
 * watched, and 2. unwatch files at a later time if the user wants..
 *
 * These structs are stored in an AVL tree that uses the filename (and a hash
 * of it) as the key.
 */
struct files_tree_node {
	struct file_obj fobj;
	char *name;
	unsigned long name_hash;
	avl_node_t avl_node;
};

static avl_tree_t files_tree;
static mutex_t work_mutex;
static int port = -1;

static struct {
	boolean_t opt_j; /* -j, json output */
	boolean_t opt_r; /* -r, print ready event */
} opts;

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
 * The unique key for the files_tree_node objects are the filenames.  When a
 * node is created, a hash is calculated for the filename to make comparisons
 * fast.  Only if the hash matches is a full string (strcmp) comparison done.
 */
static int
files_tree_node_comparator(const void *l, const void *r)
{
	const struct files_tree_node *ltn = l;
	const struct files_tree_node *rtn = r;
	int ret;

	// first check hash matches
	if (ltn->name_hash < rtn->name_hash)
		return (-1);
	else if (ltn->name_hash > rtn->name_hash)
		return (1);

	// hashes are the same, check strings
	ret = strcmp(ltn->name, rtn->name);

	if (ret < 0)
		return (-1);
	else if (ret > 0)
		return (1);

	return (0);
}

/*
 * Simple hashing algorithm pulled from http://www.cse.yorku.ca/~oz/hash.html
 */
unsigned long
djb2(char *str)
{
	unsigned long hash = 5381;
	int c;
	while ((c = *str++))
		hash = ((hash << 5) + hash) + c;
	return (hash);
}

/*
 * Allocate an nvlist with the "type" set to the type argument given, and the
 * "date" set to the current time.  This function handles any error checking
 * needed and will exit the program if anything fails.
 */
nvlist_t *
make_nvlist(char *type)
{
	nvlist_t *nvl = fnvlist_alloc();
	struct timeval tv;
	struct tm *gmt;
	size_t i;
	char date[128];

	// get the current time
	if (gettimeofday(&tv, NULL) != 0)
		err(1, "gettimeofday");

	if ((gmt = gmtime(&tv.tv_sec)) == NULL)
		err(1, "gmtime");

	// example: "2017-02-06T17:13:44.974Z"
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
 * This function handles fflushing stdout.
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
 * print_response() takes a key, code (RESULT_SUCCESS||RESULT_FAILURE), pathname
 * and message and handles creating and printing a "result" message.
 */
void
print_response(uint32_t key, uint32_t code, const char *pathname,
    const char *message_fmt, ...)
{
	va_list arg_ptr;
	char message[4096];
	nvlist_t *nvl = make_nvlist("response");

	va_start(arg_ptr, message_fmt);
	if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
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
 * Only called from stdin thread.  Prints information about this program
 *
 * print_status prints a message of type "response"
 */
void
print_status(uint32_t key)
{
	int numnodes;
	char **filenames;
	struct files_tree_node *ftn;
	int i = 0;
	nvlist_t *nvl = make_nvlist("response");
	nvlist_t *data_nvl = fnvlist_alloc();

	fnvlist_add_uint32(nvl, "key", key);
	fnvlist_add_uint32(nvl, "code", 0);
	fnvlist_add_string(nvl, "result", "SUCCESS");

	// get all nodes in the avl tree
	numnodes = avl_numnodes(&files_tree);
	filenames = malloc(numnodes * (sizeof (char *)));

	if (filenames == NULL) {
		perror("malloc");
		abort();
	}

	// walk the avl tree and add each filename
	for (ftn = avl_first(&files_tree); ftn != NULL;
	    ftn = AVL_NEXT(&files_tree, ftn)) {

		filenames[i++] = ftn->name;
	}

	// all STATUS data is stored in a separate nvl that is attached to the
	// "data" key of the response object.
	fnvlist_add_string_array(data_nvl, "files", filenames, i);
	fnvlist_add_uint32(data_nvl, "files_count", numnodes);
	fnvlist_add_int32(data_nvl, "pid", getpid());

	fnvlist_add_nvlist(nvl, "data", data_nvl);

	print_nvlist(nvl);

	nvlist_free(data_nvl);
	nvlist_free(nvl);
	free(filenames);
}

/*
 * find_handle() takes a pathname and returns the files_tree_node struct from
 * the files_tree treeh. returns NULL if no pathname matches.
 */
struct files_tree_node *
find_handle(char *pathname)
{
	struct files_tree_node lookup;

	lookup.name = pathname;
	lookup.name_hash = djb2(pathname);

	return (avl_find(&files_tree, &lookup, NULL));
}

/*
 * insert_handle() inserts a files_tree_node struct into the files_tree tree.
 */
void
add_handle(struct files_tree_node *ftn)
{
	avl_add(&files_tree, ftn);
}

/*
 * remove_handle() removes a files_tree_node struct from the files_tree tree.
 */
void
remove_handle(struct files_tree_node *ftn)
{
	avl_remove(&files_tree, ftn);
}

/*
 * free_handle() frees a file_tree_node struct
 */
void
free_handle(struct files_tree_node *ftn)
{
	if (ftn->name) {
		free(ftn->name);
		ftn->name = NULL;
	}
	free(ftn);
}

/*
 * destroy_handle() removes and frees a files_tree_node struct from the
 * files_tree tree.
 */
void
destroy_handle(struct files_tree_node *ftn)
{
	remove_handle(ftn);
	free_handle(ftn);
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
check_and_rearm_event(uint32_t key, char *name, int revents,
    struct files_tree_node *ftn)
{
	int final = 0;
	struct stat sb;
	int stat_ret;
	int pa_ret;
	struct file_obj *fobjp;

	// ftn may be passed as an argument.  if not, we look for it.
	if (ftn == NULL) {
		ftn = find_handle(name);
	}

	// if ftn is still null, we don't have a handle for this file so ignore
	// it
	if (ftn == NULL) {
		fprintf(stderr, "got event for '%s' without a handle\n", name);
		return;
	}

	// We always stat the file after an event is received, or for the
	// inital watch.  If the stat fails for any reason, or any event is
	// seen that indicates the file is gone, we mark this file as "final" -
	// this means we will no longer be watching this file.
	stat_ret = get_stat(name, &sb);
	if (stat_ret != 0 ||
	    revents & FILE_DELETE || revents & FILE_RENAME_FROM ||
	    revents & UNMOUNTED || revents & MOUNTEDOVER) {

		final = 1;
	}

	if (key != SYSTEM_KEY && stat_ret != 0) {
		// We're doing the initial register for this file, so we need
		// to send a result. Since stat() just failed, we'll send now
		// and return since we're not going to do anything further.
		print_response(key, RESULT_FAILURE, name,
		    "stat(2) failed with errno %d: %s",
		    stat_ret, strerror(stat_ret));
		assert(final);
	}

	if (final) {
		// we're not going to re-watch the file, so cleanup
		if (revents != 0) {
			print_event(revents, name, final);
		}
		destroy_handle(ftn);
		return;
	}

	// (re)register watch
	fobjp = &ftn->fobj;
	fobjp->fo_atime = sb.st_atim;
	fobjp->fo_mtime = sb.st_mtim;
	fobjp->fo_ctime = sb.st_ctim;

	pa_ret = port_associate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp,
	    FILE_MODIFIED|FILE_TRUNC, name);

	if (key != SYSTEM_KEY) {
		// We're trying to do an initial associate, so we'll print a
		// result whether we succeeded or failed.
		assert(revents == 0);
		if (pa_ret == -1) {
			print_response(key, RESULT_FAILURE, name,
			    "port_associate(3c) failed with errno %d: %s",
			    errno, strerror(errno));
			destroy_handle(ftn);
			return;
		}

		print_response(key, RESULT_SUCCESS, name,
		    "port_associate(3c) started watching path");
		return;
	}

	// if we are here, this function was called as a result of an event
	// being seen.
	assert(revents != 0);
	print_event(revents, name, final);

	if (pa_ret == -1) {
		print_error(key, ERR_CANNOT_ASSOCIATE,
		    "port_associate(3c) failed for '%s', errno %d: %s",
		    name, errno, strerror(errno));
		destroy_handle(ftn);
	}
}

/*
 * Only called from stdin thread. Attempts to watch pathname.
 */
void
watch_path(char *pathname, uint32_t key)
{
	struct files_tree_node *ftn;
	char *dupname;

	if (find_handle(pathname) != NULL) {
		print_response(key, RESULT_SUCCESS, pathname,
		    "already watching");
		return;
	}

	ftn = malloc(sizeof (struct files_tree_node));
	if (ftn == NULL) {
		fprintf(stderr, "failed to allocate memory for new watcher "
		    "errno %d: %s", errno, strerror(errno));
		abort();
	}

	dupname = strdup(pathname);
	if (dupname == NULL) {
		fprintf(stderr, "strdup failed w/ errno %d: %s",
		    errno, strerror(errno));
		abort();
	}
	ftn->fobj.fo_name = dupname;
	ftn->name = dupname;
	ftn->name_hash = djb2(dupname);

	add_handle(ftn);

	check_and_rearm_event(key, dupname, 0, ftn);
}

/*
 * Only called from stdin thread. Attempts to unwatch pathname.
 */
void
unwatch_path(char *pathname, uint32_t key)
{
	struct file_obj *fobjp;
	int ret;

	struct files_tree_node *ftn;

	ftn = find_handle(pathname);
	if (ftn == NULL) {
		print_response(key, RESULT_FAILURE, pathname,
		    "not watching '%s', cannot unwatch", pathname);
		return;
	}

	fobjp = &ftn->fobj;
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

	destroy_handle(ftn);

	if (ret == -1) {
		print_response(key, RESULT_FAILURE, pathname,
		    "failed to unregister '%s' (errno %d): %s", pathname, errno,
		    strerror(errno));
	} else {
		print_response(key, RESULT_SUCCESS, pathname,
		    "no longer watching '%s'", pathname);
	}
}

/*
 * process one line of stdin
 *
 * returns 0 if we can continue, otherwise returns a value suitable
 * for exiting the program with.
 */
void
process_stdin_line(char *str)
{
	char cmd[MAX_CMD_LEN + 1] = {'\0'};
	uint32_t key;
	char key_str[MAX_KEY_LEN + 2];
	char path[MAX_CMD_LEN + 1] = {'\0'};
	int res;
	char sscanf_fmt[MAX_FMT_LEN];

	// read one character past MAX_KEY_LEN so we know if it's too long
	snprintf(sscanf_fmt, MAX_FMT_LEN, "%%%ds %%s %%s", MAX_KEY_LEN + 1);
	res = sscanf(str, sscanf_fmt, key_str, cmd, path);

	if (!(res == 2 || res == 3)) {
		print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
		    "invalid command line");
		return;
	}

	// convert key to a number we can work with
	key = strtoul(key_str, NULL, 10);
	if ((strlen(key_str) > MAX_KEY_LEN) ||
	    (key == ULONG_MAX && errno == ERANGE)) {

		print_error(SYSTEM_KEY, ERR_INVALID_KEY,
		    "invalid key: > ULONG_MAX");
		return;
	}

	// this is a reserved key
	if (key == SYSTEM_KEY) {
		print_error(SYSTEM_KEY, ERR_INVALID_KEY, "invalid key: 0");
	}

	if (strcmp("UNWATCH", cmd) == 0) {
		if (path[0] == '\0') {
			print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
			    "invalid command line - UNWATCH requires pathname");
			return;
		}
		unwatch_path(path, key);
	} else if (strcmp("WATCH", cmd) == 0) {
		if (path[0] == '\0') {
			print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
			    "invalid command line - WATCH requires pathname");
			return;
		}
		watch_path(path, key);
	} else if (strcmp("STATUS", cmd) == 0) {
		if (path[0] != '\0') {
			print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
			    "invalid command line - STATUS takes no arguments");
			return;
		}
		print_status(key);
	} else {
		print_error(key, ERR_UNKNOWN_COMMAND, "unknown command '%s'",
		    cmd);
	}
}

/*
 * Worker thread waits here for stdin data.
 */
void *
wait_for_stdin(void *arg)
{
	(void) arg;
	char str[MAX_CMD_LEN + 1];

	// read stdin line-by-line indefinitely
	while (fgets(str, MAX_CMD_LEN + 1, stdin) != NULL) {
		mutex_lock(&work_mutex);
		process_stdin_line(str);
		mutex_unlock(&work_mutex);

		str[0] = '\0';
	}

	err(1, "fswatcher: error on stdin (errno: %d): %s\n",
	    errno, strerror(errno));
}

/*
 * Worker thread waits here for event port events.
 */
void *
wait_for_events(void *arg)
{
	(void) arg;
	port_event_t pe;

	while (!port_get(port, &pe, NULL)) {
		mutex_lock(&work_mutex);

		switch (pe.portev_source) {
		case PORT_SOURCE_FILE:
			// Call file events event handler
			check_and_rearm_event(0, (char *)pe.portev_user,
			    pe.portev_events, NULL);
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

		mutex_unlock(&work_mutex);
	}

	err(1, "wait_for_events thread exited");
}


int
main(int argc, char **argv)
{
	int opt;
	pthread_t tid;

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

	avl_create(&files_tree, files_tree_node_comparator,
	    sizeof (struct files_tree_node),
	    offsetof(struct files_tree_node, avl_node));

	// create worker threads to process events from stdin and event ports
	pthread_create(&tid, NULL, wait_for_events, NULL);
	pthread_create(&tid, NULL, wait_for_stdin, NULL);

	// alert that we are ready for input
	if (opts.opt_r) {
		print_ready();
	}

	// block on therads
	while (thr_join(0, NULL, NULL) == 0) {
		// do nothing
	}

	return (0);
}
