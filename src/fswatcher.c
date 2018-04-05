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
 * Copyright (c) 2018, Joyent, Inc.
 *
 * cc -Wall -Wextra fswatcher.c -o fswatcher -lthread -lnvpair -lavl
 *
 */

/*
 * `fswatcher` will run indefinitely when invoked.  It listens for messages
 * over stdin, and emits events and responses over stdout, and errors over
 * stderr.
 *
 * On stdin you can send:
 *
 * <KEY> WATCH <pathname>\n
 * <KEY> UNWATCH <pathname>\n
 * <KEY> STATUS\n
 *
 * The first will cause <pathname> to be added to the watch list. The second
 * will cause the watch for the specified path to be removed.  The third will
 * print this programs status to stdout. The <KEY> must be an integer in the
 * range 1-UINT64_MAX (inclusive). Leading 0's will be removed. The key is for
 * the caller to know which response by `fswatcher` is related to which command
 * given since commands are processed asynchronously.
 *
 * NOTE: 0 is a special key that will be used in output for errors which were
 * not directly the result of a command.
 *
 * "pathname" can be any type of file that event ports supports (file,
 * directory, pipe, etc. see port_associate(3C) for a full list).  This program
 * cannot watch symlinks, but instead will watch the source file of a symlink.
 * Note that, like a regular file, the source file for the symlink must exist
 * to watch, and if the source file is deleted after a watch is established a
 * FILE_DELETE event will be emitted.
 *
 * When watching a file, it will be rewatched every time an event is seen
 * until an UNWATCH command for the file is received from the user, or an event
 * indicates that the file can no longer be watched (like FILE_DELETE).
 *
 * On stdout you will see JSON messages that look like the following but are
 * on a single line:
 *
 *  {
 *     "type": <string>,
 *     "time": [array],
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
 *   - type
 *             One of: ready, event, response, error.
 *             Always included.
 *   - time
 *             Time as an array of [seconds, nanoseconds], similar to
 *             Node's process.hrtime()
 *             Always included.
 *   - changes
 *             An array of strings indicating which changes occurred.
 *             Included for "event" messages.
 *   - code
 *             A positive integer code for an error.
 *             Included for "response" and "error" messages.
 *   - final
 *             true when the event being printed is the last without re-watch.
 *             Included for "event" messages.
 *   - key
 *             The <KEY> for which a response corresponds.
 *             Included for "response" and "error" messages.
 *   - message
 *             Human-readable string describing response.
 *             Included for "response" and "error" messages.
 *   - pathname
 *             pathname to which an event applies.
 *             Included for "response" and "event" messages.
 *   - result
 *             Indicates whether a command was a "SUCCESS" or "FAILURE"
 *             Included for "response" messages.
 *
 * Current values for "code" are in the ErrorCodes enum below.
 *
 * EXIT STATUS
 *
 *   Under normal operation, fswatcher will run until stdin is closed or a fatal
 *   error occurs.
 *
 *   When errors occur that are completly unexpected, fswatcher will call
 *   abort() to generate a core dump.
 *
 */

#include <assert.h>
#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <port.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <sys/debug.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <thread.h>
#include <time.h>
#include <unistd.h>

#include <sys/avl.h>
#include <libnvpair.h>

#define MAX_STAT_RETRY 10  /* number of times to retry stat() before abort() */
#define SYSTEM_KEY 0       /* reserved key for system events */

/* longest command is '<KEY> UNWATCH <path>' */
#define MAX_KEY_LEN 20     /* number of digits 0-UINT64_MAX */
#define MAX_CMD_LEN (MAX_KEY_LEN + 1 + 7 + 1 + PATH_MAX + 1)

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
 * These are possible values returned from an "error" event
 */
enum ErrorCodes {
	ERR_INVALID_COMMAND = 1, /* failed to parse command from stdin line */
	ERR_INVALID_KEY,         /* key parsed from command is invalid */
	ERR_UNKNOWN_COMMAND,     /* line parsable, but command unknown */
	ERR_CANNOT_ASSOCIATE     /* port_associate(3c) failed */
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
 * watched, and 2. unwatch files at a later time if the user wants.
 *
 * These structs are stored in a global AVL tree that uses the filename (and a
 * hash of it) as the key.
 */
static avl_tree_t files_tree;
struct files_tree_node {
	struct file_obj fobj;
	char *name;
	unsigned long name_hash;
	avl_node_t avl_node;
};

/*
 * This programs has 2 main threads running that block on new events from:
 *
 * 1. stdin (user commands)
 * 2. event ports (filesystem events)
 *
 * When an event is received from either, this global "work_mutex" is acquired.
 * This way, no other locks are necessary, and whatever method is currently
 * processing its event can safely access members of the AVL tree and write
 * to stdout/stderr.
 */
static mutex_t work_mutex = DEFAULTMUTEX;

/* global event port handle */
static int port = -1;

/* CLI args */
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
	fprintf(s,
	    "Usage: fswatcher [-hrj]\n"
	    "\n"
	    "Watch files using event ports with commands sent to\n"
	    "stdin and event notifications sent to stdout.\n"
	    "\n"
	    "Options\n"
	    "  -h             print this message and exit\n"
	    "  -j             JSON output\n"
	    "  -r             print 'ready' event at start\n");
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

	/* first check filename hash */
	if (ltn->name_hash < rtn->name_hash)
		return (-1);
	else if (ltn->name_hash > rtn->name_hash)
		return (1);

	/* hashes are the same, do string comparison */
	ret = strcmp(ltn->name, rtn->name);

	if (ret < 0)
		return (-1);
	else if (ret > 0)
		return (1);

	return (0);
}

/*
 * Simple hashing algorithm pulled from http://www.cse.yorku.ca/~oz/hash.html
 *
 * This function is used primarily to make lookups in the AVL tree faster.
 * Since the tree is keyed off of a files pathname, the pathname string as well
 * as a hash of the string is stored in the tree.
 *
 * There is nothing inherently special or particularly useful about the "djb2"
 * hashing algorithm, really any quick hashing algorithm will work here, since
 * when a hash collision is detected a full strcmp() is performed.
 */
static unsigned long
djb2(char *str)
{
	unsigned long hash = 5381;
	int c;
	while ((c = *str++))
		hash = ((hash << 5) + hash) + c;
	return (hash);
}

/*
 * Allocate an nvlist with "type" set to the type argument given, and "time"
 * set to the current time.  This function handles any error checking needed
 * and will exit the program if anything fails.
 *
 * nvlist must be freed by the caller
 */
static nvlist_t *
make_nvlist(char *type)
{
	uint64_t time[2];
	nvlist_t *nvl;
	struct timespec tv;

	ENSURE0(nvlist_alloc(&nvl, NV_UNIQUE_NAME, 0));

	/* get the current hrtime */
	if (clock_gettime(CLOCK_MONOTONIC, &tv) != 0)
		err(1, "clock_gettime CLOCK_MONOTONIC");
	time[0] = tv.tv_sec;
	time[1] = tv.tv_nsec;

	ENSURE0(nvlist_add_string(nvl, "type", type));
	ENSURE0(nvlist_add_uint64_array(nvl, "time", time, 2));

	return (nvl);
}

/*
 * Print an nvlist to stdout.  Will use the proper function to print
 * based on -j being set or not.
 *
 * This function handles fflushing stdout.
 */
static void
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
static void
print_event(int event, char *pathname, boolean_t is_final)
{
	nvlist_t *nvl = make_nvlist("event");
	uint_t i;
	uint_t count = 0;

	/* Map event port file event flags to strings */
	struct flag_names {
		int fn_flag;
		char *fn_name;
	};
	static struct flag_names flags[] = {
		{ FILE_ACCESS, "FILE_ACCESS" },
		{ FILE_ATTRIB, "FILE_ATTRIB" },
		{ FILE_DELETE, "FILE_DELETE" },
		{ FILE_EXCEPTION, "FILE_EXCEPTION" },
		{ FILE_MODIFIED, "FILE_MODIFIED" },
		{ FILE_RENAME_FROM, "FILE_RENAME_FROM" },
		{ FILE_RENAME_TO, "FILE_RENAME_TO" },
		{ FILE_TRUNC, "FILE_TRUNC" },
		{ FILE_NOFOLLOW, "FILE_NOFOLLOW" },
		{ MOUNTEDOVER, "MOUNTEDOVER" },
		{ UNMOUNTED, "UNMOUNTED" }
	};
	static const uint_t num_flags = (sizeof (flags) / sizeof (flags[0]));
	char *changes[num_flags];

	for (i = 0; i < num_flags; i++) {
		if ((event & flags[i].fn_flag) != 0) {
			changes[count++] = flags[i].fn_name;
		}
	}

	ENSURE0(nvlist_add_string_array(nvl, "changes", changes, count));
	ENSURE0(nvlist_add_string(nvl, "pathname", pathname));
	ENSURE0(nvlist_add_int32(nvl, "revents", event));
	ENSURE0(nvlist_add_boolean_value(nvl, "final", is_final));

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * Handle creating and printing a "ready" message.
 */
static void
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
static void
print_error(uint64_t key, uint32_t code, const char *message_fmt, ...)
{
	va_list arg_ptr;
	char message[4096];
	nvlist_t *nvl = make_nvlist("error");

	va_start(arg_ptr, message_fmt);
	if (vsnprintf(message, sizeof (message), message_fmt, arg_ptr) < 0) {
		perror("fswatcher: vsnprintf");
		abort();
	}
	va_end(arg_ptr);

	ENSURE0(nvlist_add_uint64(nvl, "key", key));
	ENSURE0(nvlist_add_uint32(nvl, "code", code));
	ENSURE0(nvlist_add_string(nvl, "message", message));

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * print_response() takes a key, code (RESULT_SUCCESS||RESULT_FAILURE), pathname
 * and message and handles creating and printing a "result" message.
 */
static void
print_response(uint64_t key, uint32_t code, const char *pathname,
    const char *message_fmt, ...)
{
	va_list arg_ptr;
	char message[4096];
	nvlist_t *nvl = make_nvlist("response");

	va_start(arg_ptr, message_fmt);
	if (vsnprintf(message, sizeof (message), message_fmt, arg_ptr) < 0) {
		perror("fswatcher: vsnprintf");
		abort();
	}
	va_end(arg_ptr);

	ENSURE0(nvlist_add_uint64(nvl, "key", key));
	ENSURE0(nvlist_add_uint32(nvl, "code", code));
	ENSURE0(nvlist_add_string(nvl, "pathname", pathname));
	ENSURE0(nvlist_add_string(nvl, "message", message));
	ENSURE0(nvlist_add_string(nvl, "result",
	    code == RESULT_SUCCESS ? "SUCCESS" : "FAIL"));

	print_nvlist(nvl);

	nvlist_free(nvl);
}

/*
 * Only called from stdin thread.  Prints information about this program
 *
 * print_status prints a message of type "response"
 */
static void
print_status(uint64_t key)
{
	ulong_t numnodes;
	char **filenames;
	struct files_tree_node *ftn;
	ulong_t i = 0;
	nvlist_t *nvl = make_nvlist("response");
	nvlist_t *data_nvl = fnvlist_alloc();

	ENSURE0(nvlist_add_uint64(nvl, "key", key));
	ENSURE0(nvlist_add_uint32(nvl, "code", RESULT_SUCCESS));
	ENSURE0(nvlist_add_string(nvl, "result", "SUCCESS"));

	/* get all nodes in the avl tree */
	numnodes = avl_numnodes(&files_tree);
	filenames = calloc(numnodes, sizeof (char *));

	if (filenames == NULL)
		err(1, "calloc");

	/* walk the avl tree and add each filename */
	for (ftn = avl_first(&files_tree); ftn != NULL;
	    ftn = AVL_NEXT(&files_tree, ftn)) {

		filenames[i++] = ftn->name;
	}

	/*
	 * all STATUS data is stored in a separate nvl that is attached to the
	 * "data" key of the response object.
	 */
	ENSURE0(nvlist_add_string_array(data_nvl, "files", filenames, i));
	ENSURE0(nvlist_add_uint32(data_nvl, "files_count", numnodes));
	ENSURE0(nvlist_add_int32(data_nvl, "pid", getpid()));

	ENSURE0(nvlist_add_nvlist(nvl, "data", data_nvl));

	print_nvlist(nvl);

	nvlist_free(data_nvl);
	nvlist_free(nvl);
	free(filenames);
}

/*
 * find_handle() takes a pathname and returns the files_tree_node struct from
 * the files_tree treeh. returns NULL if no pathname matches.
 */
static struct files_tree_node *
find_handle(char *pathname)
{
	struct files_tree_node lookup;

	lookup.name = pathname;
	lookup.name_hash = djb2(pathname);

	return (avl_find(&files_tree, &lookup, NULL));
}

/*
 * add_handle() inserts a files_tree_node struct into the files_tree tree.
 */
static void
add_handle(struct files_tree_node *ftn)
{
	avl_add(&files_tree, ftn);
}

/*
 * remove_handle() removes a files_tree_node struct from the files_tree tree.
 */
static void
remove_handle(struct files_tree_node *ftn)
{
	avl_remove(&files_tree, ftn);
}

/*
 * destroy_handle() removes and frees a files_tree_node struct from the
 * files_tree tree.
 */
static void
destroy_handle(struct files_tree_node *ftn)
{
	remove_handle(ftn);
	free(ftn->name);
	free(ftn);
}

/*
 * stat_file() takes the same arguments as stat and calls stat for you but does
 * retries on errors and ultimately returns either 0 (success) or one of the
 * errno's listed in stat(2).
 *
 * WARNING: If it gets EINTR too many times (more than MAX_STAT_RETRY), this
 * will call abort().
 */
static int
stat_file(const char *path, struct stat *buf)
{
	int i;

	for (i = 0; i < MAX_STAT_RETRY; i++) {
		int stat_ret = stat(path, buf);
		int stat_err = errno;

		/* return immediately upon success */
		if (stat_ret == 0)
			return (0);

		/* error from stat that means we can't retry, just return it */
		if (stat_err != EINTR)
			return (stat_err);

		/* Interrupted by signal, try again... */
	}

	/* if we are here, give up */
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
static int
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
static void
check_and_rearm_event(uint64_t key, char *name, int revents,
    struct files_tree_node *ftn)
{
	boolean_t is_final = B_FALSE;
	struct stat sb;
	int stat_ret;
	int pa_ret;
	struct file_obj *fobjp;

	/* ftn may be passed as an argument.  if not, we look for it. */
	if (ftn == NULL) {
		ftn = find_handle(name);
	}

	/* we don't have a handle for this file so ignore the event */
	if (ftn == NULL) {
		fprintf(stderr, "got event for '%s' without a handle\n", name);
		return;
	}

	/*
	 * We always stat the file after an event is received, or for the
	 * inital watch.  If the stat fails for any reason, or any event is
	 * seen that indicates the file is gone, we mark this file as "final" -
	 * this means we will no longer be watching this file.
	 */
	stat_ret = get_stat(name, &sb);
	if (stat_ret != 0 ||
	    revents & FILE_DELETE || revents & FILE_RENAME_FROM ||
	    revents & UNMOUNTED || revents & MOUNTEDOVER) {

		is_final = B_TRUE;
	}

	if (key != SYSTEM_KEY && stat_ret != 0) {
		/*
		 * We're doing the initial register for this file, so we need
		 * to send a result.
		 */
		print_response(key, RESULT_FAILURE, name,
		    "stat(2) failed with errno %d: %s",
		    stat_ret, strerror(stat_ret));
		assert(is_final);
	}

	if (is_final) {
		/* We're not going to re-watch the file, so cleanup */
		if (revents != 0) {
			print_event(revents, name, B_TRUE);
		}
		destroy_handle(ftn);
		return;
	}

	/* (re)register watch */
	fobjp = &ftn->fobj;
	fobjp->fo_atime = sb.st_atim;
	fobjp->fo_mtime = sb.st_mtim;
	fobjp->fo_ctime = sb.st_ctim;

	pa_ret = port_associate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp,
	    FILE_MODIFIED|FILE_TRUNC, name);

	if (key != SYSTEM_KEY) {
		/*
		 * We're trying to do an initial associate, so we'll print a
		 * result whether we succeeded or failed.
		 */
		VERIFY3S(revents, ==, 0);
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

	/*
	 * If we are here, this function was called as a result of an event
	 * being seen.
	 */
	VERIFY3S(revents, !=, 0);
	print_event(revents, name, B_FALSE);

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
static void
watch_path(char *pathname, uint64_t key)
{
	struct files_tree_node *ftn;
	char *dupname;

	if (find_handle(pathname) != NULL) {
		print_response(key, RESULT_SUCCESS, pathname,
		    "already watching");
		return;
	}

	ftn = malloc(sizeof (struct files_tree_node));
	if (ftn == NULL)
		err(1, "malloc new watcher");

	/*
	 * Copy the pathname given here as we need to hold onto it for as long
	 * as the file is being watched.
	 */
	dupname = strdup(pathname);
	if (dupname == NULL)
		err(1, "strdup new watcher");

	ftn->fobj.fo_name = dupname;
	ftn->name = dupname;
	ftn->name_hash = djb2(dupname);

	add_handle(ftn);

	check_and_rearm_event(key, dupname, 0, ftn);
}

/*
 * Only called from stdin thread. Attempts to unwatch pathname.
 */
static void
unwatch_path(char *pathname, uint64_t key)
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
 * Process one line of stdin
 */
static void
process_stdin_line(char *str)
{
	char cmd[MAX_CMD_LEN + 1];
	char path[MAX_CMD_LEN + 1];
	int res;
	unsigned long long key;

	cmd[0] = '\0';
	path[0] = '\0';

	if (strlen(str) > MAX_CMD_LEN) {
		print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
		    "command line too long");
		return;
	}

	res = sscanf(str, "%llu %s %s", &key, cmd, path);

	if (!(res == 2 || res == 3)) {
		print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
		    "invalid command line");
		return;
	}

	/* this is a reserved key */
	if (key == SYSTEM_KEY) {
		print_error(SYSTEM_KEY, ERR_INVALID_KEY,
		    "invalid key: %d", SYSTEM_KEY);
		return;
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
static void *
wait_for_stdin(void *arg __unused)
{
	char str[MAX_CMD_LEN + 1];

	/* read stdin line-by-line indefinitely */
	while (fgets(str, sizeof (str), stdin) != NULL) {
		mutex_lock(&work_mutex);
		process_stdin_line(str);
		mutex_unlock(&work_mutex);

		str[0] = '\0';
	}

	/* stdin closed or error */
	if (feof(stdin)) {
		errx(0, "stdin closed");
	} else {
		perror("stdin fgets");
		abort();
	}
}

/*
 * Worker thread waits here for event port events.
 */
static void *
wait_for_events(void *arg __unused)
{
	port_event_t pe;

	while (!port_get(port, &pe, NULL)) {
		mutex_lock(&work_mutex);

		switch (pe.portev_source) {
		case PORT_SOURCE_FILE:
			/* call handler for filesystem event */
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

	/* should not be reached */
	perror("wait_for_events thread exited (port_get)");
	abort();
}

/*
 * Create a thread using the given thread_func and exit the process if thread
 * creation fails.
 */
static void
create_thread(void *(*thread_func)(void *))
{
	int rc;
	thread_t tid;

	if ((rc = thr_create(NULL, 0, thread_func, NULL, 0, &tid)) != 0) {
		errx(1, "thr_create: %s", strerror(rc));
	}
}

int
main(int argc, char **argv)
{
	int opt;

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

	/* create event port globally */
	if ((port = port_create()) == -1) {
		err(1, "port_create");
	}

	/* initialize the AVL tree to hold all files currently being watched */
	avl_create(&files_tree, files_tree_node_comparator,
	    sizeof (struct files_tree_node),
	    offsetof(struct files_tree_node, avl_node));

	/*
	 * If the caller wants a "ready" event to be emitted, we grab the
	 * global mutex here, and unlock it after the threads are created.
	 */
	if (opts.opt_r) {
		mutex_lock(&work_mutex);
	}

	/* create worker threads to process stdin and event ports */
	create_thread(wait_for_events);
	create_thread(wait_for_stdin);

	/* alert that we are ready for input */
	if (opts.opt_r) {
		print_ready();
		mutex_unlock(&work_mutex);
	}

	/* do nothing while threads handle the load */
	while (thr_join(0, NULL, NULL) == 0) {
		/* pass */
	}

	return (0);
}
