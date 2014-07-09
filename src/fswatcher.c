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
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * gcc -Wall -Wextra fswatcher.c -o fswatcher -lthread
 *
 */

#define DEBUG

#define _REENTRANT
#include <assert.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdlib.h>
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

/*
 * On STDIN you can send:
 *
 * <KEY> WATCH <pathname>\n
 * <KEY> UNWATCH <pathname>\n
 *
 * The first will cause <pathname> to be added to the watch list. The second
 * will cause the watch for the specified path to be removed. The <KEY> must
 * be an integer in the range 1-4294967295 (inclusive). Leading 0's will be
 * removed. NOTE: 0 is a special key in that it will be used in output for
 * errors which were not directly the result of a command.
 *
 * On STDOUT you will see JSON messages that look like the following but are
 * on a single line:
 *
 *  {
 *     "changes": [array],
 *     "code": <number>,
 *     "is_final": true|false,
 *     "key": <number>,
 *     "message": "human readable string",
 *     "pathname": "/path/which/had/event",
 *     "result": "SUCCESS|FAIL",
 *     "timestamp": <number>,
 *     "type": <type>
 *  }
 *
 * Where:
 *
 *   changes   is an array of strings indicating which changes occurred
 *   code      is a positive integer code for an error
 *   is_final  true when the event being printed is the last without re-watch
 *   key       is the <KEY> for which a response corresponds
 *   message   is a human-readable string describing response
 *   pathname  is the path to which an event applies
 *   result    indicates whether a command was a SUCCESS or FAILURE
 *   timestamp timestamp in ms since 1970-01-01 00:00:00 UTC
 *   type      is one of: event, response, error
 *
 * And:
 *
 *   "changes" is included only when (type == event)
 *   "code" is included only when (type == error)
 *   "is_final" is included when (type == event)
 *   "key" is included whenever (type == response)
 *   "message" is included whenever (type == error)
 *   "pathname" is included whenever (type == event)
 *   "result" is included when (type == response) value: "SUCCESS" or "FAILURE"
 *   "timestamp" is included when (type == event)
 *   "type" is always included
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

/*
 * XXX watch/unwatch are currently O(N)
 */

#define MAX_FMT_LEN 64
#define MAX_KEY 4294967295
#define MAX_KEY_LEN 10 /* number of digits (0-4294967295) */
#define MAX_STAT_RETRY 10 /* number of times to retry stat() before abort() */
#define MAX_TIMESTAMP_LEN 10

/* longest command is '<KEY> UNWATCH <path>' with <KEY> being 10 characters. */
#define MAX_CMD_LEN (MAX_KEY_LEN + 1 + 7 + 1 + PATH_MAX + 1 + MAX_TIMESTAMP_LEN)
#define MAX_HANDLES 100000 /* limit on how many watches to have active */
#define SYSTEM_KEY 0

enum ErrorCodes {
    SUCCESS,               /* not an error */
    ERR_PORT_CREATE,       /* failed to create a port */
    ERR_GET_STDIN,         /* failed to read from stdin (non-EOF) */
    ERR_INVALID_COMMAND,   /* failed to parse command from stdin line */
    ERR_INVALID_KEY,       /* failed to parse command from stdin line */
    ERR_UNKNOWN_COMMAND,   /* line was parsable, but unimplmented command */
    ERR_CANNOT_ALLOCATE,   /* can't allocate memory required */
    ERR_CANNOT_ASSOCIATE,  /* port_associate(3c) failed */
    ERR_UNEXPECTED_SOURCE  /* port_get(3c) gave us unexpected portev_source */
};

enum ResultCodes {
    RESULT_SUCCESS,
    RESULT_FAILURE
};

struct fileinfo {
    struct file_obj fobj;
    int events;
    int port;
};

struct fileinfo *handles[MAX_HANDLES] = { NULL };
int largest_idx = 0;
static mutex_t handles_mutex;
int next_unused = 0;
int port = -1;

int findHandleIdx(char *pathname);
void freeFinf(struct fileinfo **finfp);
int getNextHandleIdx();
void printEvent(int event, char *pathname, int final);
void processFile(uint32_t key, struct fileinfo *finf, int revents);
void * waitForEvents(void *pn);
int watchPath(char *pathname, uint32_t key);
int unwatchPath(char *pathname, uint32_t key);
void unHandle(char *pathname);
void unHandleIdx(int idx, int holdingMutex);

/*
 * This outputs a line to stdout indicating the type of event detected.
 */
void
printEvent(int event, char *pathname, int final)
{
    int hits = 0;
    struct timespec ts;
    uint64_t timestamp;

    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        /* This is entirely unexpected so we abort() to ensure a core dump. */
        abort();
    }

    timestamp = ((uint64_t)ts.tv_sec * (uint64_t)1000)
        + ((uint64_t) ts.tv_nsec / (uint64_t) 1000000);

    printf("{\"type\": \"event\", \"timestamp\": %llu, \"pathname\": \"%s\", "
        "\"changes\": [", timestamp, pathname);
    if (event & FILE_ACCESS) {
        printf("%s\"FILE_ACCESS\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_ATTRIB) {
        printf("%s\"FILE_ATTRIB\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_DELETE) {
        printf("%s\"FILE_DELETE\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_EXCEPTION) {
        printf("%s\"FILE_EXCEPTION\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_MODIFIED) {
        printf("%s\"FILE_MODIFIED\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_RENAME_FROM) {
        printf("%s\"FILE_RENAME_FROM\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_RENAME_TO) {
        printf("%s\"FILE_RENAME_TO\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & FILE_TRUNC) {
        printf("%s\"FILE_TRUNC\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & MOUNTEDOVER) {
        printf("%s\"MOUNTEDOVER\"", ((hits++ > 0) ? "," : ""));
    }
    if (event & UNMOUNTED) {
        printf("%s\"UNMOUNTED\"", ((hits++ > 0) ? "," : ""));
    }

    if (final) {
        printf("], \"is_final\": true}\n");
    } else {
        printf("], \"is_final\": false}\n");
    }

    fflush(stdout);
}

/*
 * printError() takes a key, code (one of the ErrorCodes) and message and writes
 * to stdout.
 */
void
printError(uint32_t key, uint32_t code, const char *message_fmt, ...)
{
    va_list arg_ptr;
    char message[4096];

    va_start(arg_ptr, message_fmt);
    if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
        /*
         * We failed to build the error message, and there's no good way to
         * handle this so we try to force a core dump. Most likely a bug.
         */
        abort();
    }
    va_end(arg_ptr);

    (void) printf("{\"type\": \"error\", \"key\": %u, \"code\": %u, "
        "\"message\": \"%s\"}\n", key, code, message);
    (void) fflush(stdout);
}

/*
 * printResult() takes a key, code (RESULT_SUCCESS||RESULT_FAILURE), pathname
 * and message and writes to stdout.
 */
void
printResult(uint32_t key, uint32_t code, const char *pathname,
    const char *message_fmt, ...)
{
    va_list arg_ptr;
    char message[4096];
    char *result;
    struct timespec ts;
    uint64_t timestamp;

    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        /* This is entirely unexpected so we abort() to ensure a core dump. */
        abort();
    }

    timestamp = ((uint64_t)ts.tv_sec * (uint64_t)1000)
        + ((uint64_t) ts.tv_nsec / (uint64_t) 1000000);

    va_start(arg_ptr, message_fmt);
    if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
        /*
         * We failed to build the error message, and there's no good way to
         * handle this so we try to force a core dump. Most likely a bug.
         */
        abort();
    }
    va_end(arg_ptr);

    if (code == 0) {
        result = "SUCCESS";
    } else {
        result = "FAIL";
    }

    (void) printf("{\"type\": \"response\", \"key\": %u, \"code\": %u, "
        "\"pathname\": \"%s\", \"result\": \"%s\", \"message\": \"%s\", "
        "\"timestamp\": %llu}\n",
        key, code, pathname, result, message, timestamp);
    (void) fflush(stdout);
}

/*
 * findHandleIdx() takes a pathname and returns the index from the handles array
 * for that path. It returns -1 if pathname is not found.
 *
 * This should be called only while holding the handles_mutex
 */
int
findHandleIdx(char *pathname)
{
    int i;
    struct fileinfo *handle;

    for (i = 0; i <= largest_idx; i++) {
        handle = handles[i];

        /* Record that this is the first unused since we're looping anyway */
        if (handle == NULL && i < next_unused) {
            next_unused = i;
        }

        if (handle != NULL && handle->fobj.fo_name &&
            strcmp(handle->fobj.fo_name, pathname) == 0) {

            return (i);
        }
    }

    return (-1);
}

/*
 * getNextHandleIdx() returns the next unused index from the handles array. If
 * no unused are found below MAX_HANDLES, it returns -1.
 *
 * This should be called only while holding the handles_mutex
 */
int
getNextHandleIdx()
{
    int idx = next_unused;

    while (idx < MAX_HANDLES && handles[idx] != NULL) {
        idx++;
    }

    if (idx < MAX_HANDLES) {
        return (idx);
    }

    /* couldn't find a handle < MAX_HANDLES that was available */
    return (-1);
}

/*
 * statFile() takes the same arguments as stat and calls stat for you but does
 * retries on errors and ultimately returns either 0 (success) or one of the
 * errno's listed in stat(2).
 *
 * WARNING: If it gets EINTR too many times (more than MAX_STAT_RETRY), this
 * will call abort().
 */
int
statFile(const char *path, struct stat *buf)
{
    int done = 0;
    int loops = 0;
    int result;
    int stat_err;
    int stat_ret;

    while (!done) {
        stat_ret = stat(path, buf);
        stat_err = errno;

        if (stat_ret == -1) {
            if (stat_err == EINTR) {
                /*
                 * Interrupted by signal, try again... but after MAX_STAT_RETRY
                 * tries we give up and try to dump core.
                 */
                loops++;
                if (loops > MAX_STAT_RETRY) {
                    abort();
                }
            } else {
                /* Actual failure, return code. */
                result = stat_err;
                done = 1;
            }
        } else {
            result = 0;
            done = 1;
        }
    }

    return (result);
}

/*
 * processFile() is called to (re)arm watches. This can either be because of
 * an event (in which case revents should be pe.portev_events) or to initially
 * arm in which case revents should be 0.
 *
 * It also performs the required stat() and in case this is a re-arm prints
 * the event.
 *
 * We keep these two functions together (rearming and printing) because we need
 * to do the stat() before we print the results since if the file no longer
 * exists we cannot rearm. In that case we set the 'final' flag in the response.
 *
 */
void
processFile(uint32_t key, struct fileinfo *finf, int revents)
{
    int final = 0;
    struct file_obj *fobjp = &finf->fobj;
    int pa_ret;
    int port = finf->port;
    struct stat sb;
    int stat_ret;

    /*
     * Events to not rearm themselves. So if we get here and we return without
     * rearming, there's no need to remove the event it simply won't get
     * rearmed. But we *do* want to ensure that if we fail to rearm, we remove
     * from handles and cleanup the memory.
     */

    stat_ret = statFile(fobjp->fo_name, &sb);
    fprintf(stderr, "DEBUG: statFile %s returned: %d: %s\n",
        fobjp->fo_name, stat_ret, strerror(stat_ret));
    fflush(stderr);
    switch (stat_ret) {
        case 0:
            /* SUCCESS! */
            break;
        case ELOOP:         /* symbolic links in path point to each other */
        case ENOTDIR:       /* component of path is not a dir */
        case EACCES:        /* permission denied */
        case ENOENT:        /* file or component path doesn't exist */
            /*
             * The above are all fixable problems. We can't open the file right
             * now, but we know that we shouldn't be able to either. As such,
             * these are non-fatal and just result in a FAIL (with final flag
             * set true) response if we're responding to a request or an error
             * line if we're dealing with an event.
             */
            final = 1;
            break;
        case EFAULT:        /* filename or buffer invalid (programmer error) */
        case EIO:           /* error reading from filesystem (system error) */
        case ENAMETOOLONG:  /* fo_name is too long (programmer error) */
        case ENOLINK:       /* broken link to remote machine */
        case ENXIO:         /* path or component is marked faulty and retired */
        case EOVERFLOW:     /* file is broken (system error) */
        default:
            /*
             * This handles cases we don't know how to deal with, by dumping
             * core so that suckers can come back in an try to figure out what
             * happened from the core.
             */
            abort();
            break;
    }

    /*
     * We print the result after we've done the stat() so that we can include
     * "final: true" when we're not going to be able to re-register the file.
     */
    if (revents) {
        printEvent(revents, fobjp->fo_name, final);
    }

    if ((key != 0) && (stat_ret != 0)) {
        /*
         * We're doing the initial register for this file, so we need to send
         * a result. Since stat() just failed, we'll send now and return since
         * we're not going to do anything further.
         */
        printResult(key, RESULT_FAILURE, fobjp->fo_name, "stat(2) failed with "
            "errno %d: %s", stat_ret, strerror(stat_ret));
        assert(final);
    }

    if (final) {
        /* we're not going to re-enable, so cleanup */
        unHandle(fobjp->fo_name);
        return;
    }

    /*
     * (re)register.
     */
    fobjp->fo_atime = sb.st_atim;
    fobjp->fo_mtime = sb.st_mtim;
    fobjp->fo_ctime = sb.st_ctim;

    pa_ret = port_associate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp,
        finf->events, (void *)finf);

    if (key != 0) {
        /*
         * We're trying to do an initial associate, so we'll print a result
         * whether we succeeded or failed.
         */
        if (pa_ret == -1) {
            printResult(key, RESULT_FAILURE, fobjp->fo_name,
                "port_associate(3c) failed with errno %d: %s",
                errno, strerror(errno));
            unHandle(fobjp->fo_name);
        } else {
            printResult(key, RESULT_SUCCESS, fobjp->fo_name,
                "port_associate(3c) started watching path");
        }
    } else if (pa_ret == -1) {
        /*
         * We're trying to re-associate so we only dump a message if that
         * failed.
         */
        printError(key, ERR_CANNOT_ASSOCIATE, "port_associate(3c) failed "
            "for '%s', errno %d: %s", fobjp->fo_name, errno, strerror(errno));
    }
}

/*
 * Worker thread waits here for events, which then get dispatched to
 * processFile().
 */
void *
waitForEvents(void *pn)
{
    int port = *((int *)pn);
    port_event_t pe;

    while (!port_get(port, &pe, NULL)) {
        /*
         * Can add cases for other sources if this
         * port is used to collect events from multiple sources.
         */
        switch (pe.portev_source) {
        case PORT_SOURCE_FILE:
            /* Call file events event handler */
            processFile(0, (struct fileinfo *)pe.portev_object,
                pe.portev_events);
            break;
        default:
            /*
             * Something's seriously wrong if we get events with a port source
             * other than FILE, since that's all we're adding. So abort and hope
             * there's enough state in the core.
             */
            printError(0, ERR_UNEXPECTED_SOURCE, "event from unexpected source:"
                " %s", strerror(errno));
            abort();
        }
    }
    fprintf(stderr, "fswatcher: worker thread exiting\n");
    fflush(stderr);
    return (NULL);
}

/*
 * Free a finf object.
 */
void
freeFinf(struct fileinfo **finfp)
{
    struct fileinfo *finf;

    if (*finfp != NULL) {
        finf = *finfp;
        if (finf->fobj.fo_name) {
            free(finf->fobj.fo_name);
            finf->fobj.fo_name = NULL;
        }
        free(finf);
        *finfp = NULL;
    }
}

/*
 * unHandle() attempts to remove the handles array data for a given pathname.
 */
void
unHandle(char *pathname)
{
    int idx;

    mutex_lock(&handles_mutex);

    idx = findHandleIdx(pathname);
    if (idx < 0) {
#ifdef DEBUG
        fprintf(stderr, "DEBUG: unHandle called, but no file: %s\n", pathname);
#endif
    } else {
        /* The 1 argument here tells unhandleIdx we're already holding mutex */
        unHandleIdx(idx, 1);
    }

    mutex_unlock(&handles_mutex);
}

/*
 * unHandleIdx() attempts to remove the handles array data at a given index.
 */
void
unHandleIdx(int idx, int holdingMutex)
{
    struct fileinfo *finf;

    if (!holdingMutex) {
        mutex_lock(&handles_mutex);
    }

    finf = handles[idx];

    if (finf != NULL) {
        freeFinf(&finf);
    }

#ifdef DEBUG
    fprintf(stderr, "DEBUG: clearing index: %d\n", idx);
#endif
    handles[idx] = NULL;

    if (idx < next_unused) {
        next_unused = idx;
    }

    if (!holdingMutex) {
        mutex_unlock(&handles_mutex);
    }
}

/*
 * Only called from main thread. Attempts to watch pathname.
 */
int
watchPath(char *pathname, uint32_t key)
{
    struct fileinfo *finf;
    int idx;
    /* port is global */

    finf = malloc(sizeof (struct fileinfo));
    if (finf == NULL) {
        printError(key, ERR_CANNOT_ALLOCATE, "failed to allocate memory for "
            "new watcher errno %d: %s", errno, strerror(errno));
        /* XXX abort(); ? */
        return (ERR_CANNOT_ALLOCATE);
    }

    if ((finf->fobj.fo_name = strdup(pathname)) == NULL) {
        printError(key, ERR_CANNOT_ALLOCATE, "strdup failed w/ errno %d: %s",
            errno, strerror(errno));
        /* XXX abort(); ? */
        free(finf);
        return (ERR_CANNOT_ALLOCATE);
    }

    /* From here on we'll need to cleanup finf when done with it. */

    mutex_lock(&handles_mutex);

    idx = findHandleIdx(pathname);
    if (idx >= 0) {
        printResult(key, RESULT_SUCCESS, pathname, "already watching");
        freeFinf(&finf);

        /* early-return: already watching so unlock and return success */
        mutex_unlock(&handles_mutex);
        return (0);
    }

    idx = getNextHandleIdx();
    if (idx < 0) {
        printResult(key, RESULT_FAILURE, pathname,
            "unable to find free handle");
        freeFinf(&finf);

        /* early-return: failed to find a handle, so return an error */
        mutex_unlock(&handles_mutex);
        return (1);
    }

#ifdef DEBUG
    fprintf(stderr, "DEBUG: using index: %d\n", idx);
#endif
    if (idx > largest_idx) {
        largest_idx = idx;
    }
    handles[idx] = finf;

    mutex_unlock(&handles_mutex);

    /*
     * Event types to watch.
     */
    finf->events = FILE_MODIFIED;
    finf->port = port;

    /*
     * Start monitor this file.
     */
    processFile(key, finf, 0);

    return (0);
}

/*
 * Only called from main thread. Attempts to unwatch pathname.
 */
int
unwatchPath(char *pathname, uint32_t key)
{
    struct fileinfo *finf;
    struct file_obj *fobjp;
    int idx;
    int port;

    mutex_lock(&handles_mutex);

    idx = findHandleIdx(pathname);
    if (idx == -1) {
        mutex_unlock(&handles_mutex);
        printResult(key, RESULT_FAILURE, pathname, "not watching '%s', cannot "
            "unwatch", pathname);
        return (0);
    }

    finf = handles[idx];

    if (finf == NULL) {
        /* XXX: already gone, should we output? */
        printResult(key, RESULT_SUCCESS, pathname, "already not watching '%s'",
            pathname);
    } else {

        port = finf->port;
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
        if (port_dissociate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp) == -1) {
            /* file may have been deleted/moved */
            printResult(key, RESULT_FAILURE, pathname,
                "failed to unregister '%s' (errno %d): %s", pathname, errno,
                strerror(errno));
        } else {
            printResult(key, RESULT_SUCCESS, pathname,
                "no longer watching '%s'", pathname);
        }

        unHandleIdx(idx, 1);
    }

    mutex_unlock(&handles_mutex);

    /* XXX what can fail here? */

    return (0);
}

int
main()
{
    char cmd[MAX_CMD_LEN + 1];
    int exit_code = SUCCESS;
    uint32_t key;
    char key_str[MAX_KEY_LEN + 2];
    char path[MAX_CMD_LEN + 1];
    int res;
    char sscanf_fmt[MAX_FMT_LEN];
    char str[MAX_CMD_LEN + 1];
    pthread_t tid;
    uint32_t start_timestamp;

    if ((port = port_create()) == -1) {
        printError(SYSTEM_KEY, ERR_PORT_CREATE, "port_create failed(%d): %s",
            errno, strerror(errno));
        exit(ERR_PORT_CREATE);
    }

    /* Create a worker thread to process events. */
    pthread_create(&tid, NULL, waitForEvents, (void *)&port);

    while (1) {
        if (fgets(str, MAX_CMD_LEN + 1, stdin) == NULL) {
            if (!feof(stdin)) {
                printError(SYSTEM_KEY, ERR_GET_STDIN, "fswatcher: error on "
                    "stdin (errno: %d): %s\n", errno, strerror(errno));
            }
            /* In EOF case we don't print, this this is normal termination. */
            break;
        }

        start_timestamp = 0;

        /* read one character past MAX_KEY_LEN so we know it's too long */
        snprintf(sscanf_fmt, MAX_FMT_LEN, "%%%ds %%s %%s %%u", MAX_KEY_LEN + 1);
        res = sscanf(str, sscanf_fmt, key_str, cmd, path, &start_timestamp);
        if (res != 3 && res != 4) {
            printError(SYSTEM_KEY, ERR_INVALID_COMMAND, "invalid command line");
            continue;
        }
        key = strtoul(key_str, NULL, 10);
        if ((strlen(key_str) > MAX_KEY_LEN) ||
            (key == ULONG_MAX && errno == ERANGE)) {

            printError(SYSTEM_KEY, ERR_INVALID_KEY, "invalid key: > ULONG_MAX");
            continue;
        }
        if (key == 0) {
            printError(SYSTEM_KEY, ERR_INVALID_KEY, "invalid key: 0");
            continue;
        }

#ifdef DEBUG
        fprintf(stderr, "DEBUG key: %u cmd: %s path: %s\n", key, cmd, path);
#endif

        if (strcmp("UNWATCH", cmd) == 0) {
            /* unwatchPath() will print an object to stdout */
            res = unwatchPath(path, key);
            if (res != 0) {
                /*
                 * An error occured and unwatchPath() will have written an
                 * error object to stdout. Break the loop so we can exit.
                 */
                exit_code = res;
                break;
            }
        } else if (strcmp("WATCH", cmd) == 0) {
            /* watchPath() will print an object to stdout */
            res = watchPath(path, key);
            if (res != 0) {
                /*
                 * An error occured and watchPath() will have written an error
                 * object to stdout. Break the loop so we can exit.
                 */
                exit_code = res;
                break;
            }
        } else {
            /* XXX if they include crazy garbage, this may include non-JSON */
            printError(key, ERR_UNKNOWN_COMMAND, "unknown command '%s'", cmd);
        }
    }

    /*
     * Close port, will de-activate all file events watches associated
     * with the port.
     */
    close(port);
    port = -1;

    /*
     * Wait for threads to exit.
     */
    while (thr_join(0, NULL, NULL) == 0) {
        /* do nothing */;
    }

    exit(exit_code);
}
