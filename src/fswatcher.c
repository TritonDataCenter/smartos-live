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

// #define DEBUG

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
#include <time.h>

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
 *   timestamp timestamp in ns since 1970-01-01 00:00:00 UTC
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
int port = -1;

void enqueue_free_finf(struct fileinfo *finf);
void print_event(int event, char *pathname, int final);
void check_and_rearm_event(uint32_t key, char *name, int revents,
    uint64_t start_timestamp);
void * wait_for_events(void *pn);
int watch_path(char *pathname, uint32_t key, uint64_t start_timestamp);
int unwatch_path(char *pathname, uint32_t key);

/*
 * This outputs a line to stdout indicating the type of event detected.
 */
void
print_event(int event, char *pathname, int final)
{
    int hits = 0;
    struct timespec ts;
    uint64_t timestamp;

    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        /* This is entirely unexpected so we abort() to ensure a core dump. */
        perror("fswatcher: vsnprintf");
        abort();
    }

    timestamp = ((uint64_t)ts.tv_sec * (uint64_t)1000000000) + ts.tv_nsec;

    mutex_lock(&stdout_mutex);
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
    mutex_unlock(&stdout_mutex);

    fflush(stdout);
}

/*
 * print_error() takes a key, code (one of the ErrorCodes) and message and
 * writes to stdout.
 */
void
print_error(uint32_t key, uint32_t code, const char *message_fmt, ...)
{
    va_list arg_ptr;
    char message[4096];

    va_start(arg_ptr, message_fmt);
    if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
        /*
         * We failed to build the error message, and there's no good way to
         * handle this so we try to force a core dump. Most likely a bug.
         */
        perror("fswatcher: vsnprintf");
        abort();
    }
    va_end(arg_ptr);

    mutex_lock(&stdout_mutex);
    (void) printf("{\"type\": \"error\", \"key\": %u, \"code\": %u, "
        "\"message\": \"%s\"}\n", key, code, message);
    mutex_unlock(&stdout_mutex);

    (void) fflush(stdout);
}

/*
 * print_result() takes a key, code (RESULT_SUCCESS||RESULT_FAILURE), pathname
 * and message and writes to stdout.
 */
void
print_result(uint32_t key, uint32_t code, const char *pathname,
    const char *message_fmt, ...)
{
    va_list arg_ptr;
    char message[4096];
    char *result;
    struct timespec ts;
    uint64_t timestamp;

    if (clock_gettime(CLOCK_REALTIME, &ts) != 0) {
        /* This is entirely unexpected so we abort() to ensure a core dump. */
        perror("fswatcher: vsnprintf");
        abort();
    }

    timestamp = ((uint64_t)ts.tv_sec * (uint64_t)1000000000) + ts.tv_nsec;

    va_start(arg_ptr, message_fmt);
    if (vsnprintf(message, 4096, message_fmt, arg_ptr) < 0) {
        /*
         * We failed to build the error message, and there's no good way to
         * handle this so we try to force a core dump. Most likely a bug.
         */
        perror("fswatcher: vsnprintf");
        abort();
    }
    va_end(arg_ptr);

    if (code == 0) {
        result = "SUCCESS";
    } else {
        result = "FAIL";
    }

    mutex_lock(&stdout_mutex);
    (void) printf("{\"type\": \"response\", \"key\": %u, \"code\": %u, "
        "\"pathname\": \"%s\", \"result\": \"%s\", \"message\": \"%s\", "
        "\"timestamp\": %llu}\n",
        key, code, pathname, result, message, timestamp);
    mutex_unlock(&stdout_mutex);

    (void) fflush(stdout);
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

#ifdef DEBUG
    fprintf(stderr, "DEBUG: stat_file %s returned: %d: %s\n",
        pathname, stat_ret, strerror(stat_ret));
    fflush(stderr);
#endif

    switch (stat_ret) {
        case 0:
            /* SUCCESS! (sb will be populated) */
            return (0);
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
            return (stat_ret);
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
     * we do the associate inside of the mutex so that we don't accidentally
     * associate a source that had been removed.
     */
    pa_ret = port_associate(port, PORT_SOURCE_FILE, (uintptr_t)fobjp,
        finf->events, name);

    mutex_unlock(&handles_mutex);

    if (key != 0) {
        /*
         * We're trying to do an initial associate, so we'll print a result
         * whether we succeeded or failed.
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
         * We're trying to re-associate so we only dump a message if that
         * failed.
         */
        print_error(key, ERR_CANNOT_ASSOCIATE, "port_associate(3c) failed "
            "for '%s', errno %d: %s", fobjp->fo_name, errno, strerror(errno));
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
 *
 *
 */
void
check_and_rearm_event(uint32_t key, char *name, int revents,
    uint64_t start_timestamp)
{
    int final = 0;
    struct fileinfo *finf;
    struct stat sb;
    int stat_ret;
    time_t tv_sec;
    long tv_nsec;

    mutex_lock(&handles_mutex);

    finf = find_handle(name);
    /*
     * We are no longer interested in events for this idx.
     */
    if (finf == NULL) {
        mutex_unlock(&handles_mutex);
        return;
    }
    mutex_unlock(&handles_mutex);

    /*
     * We always do stat, even if we're going to override the timestamps so
     * that we also check for existence.
     */
    stat_ret = get_stat(finf->fobj.fo_name, &sb);
    if (stat_ret != 0) {
        final = 1;
    }
    if (start_timestamp != 0) {
        tv_sec = (time_t)(start_timestamp / (uint64_t)1000000000);
        tv_nsec = (long)(start_timestamp
            - ((uint64_t) tv_sec * (uint64_t)1000000000));

        sb.st_atim.tv_sec = tv_sec;
        sb.st_atim.tv_nsec = tv_nsec;
        sb.st_ctim.tv_sec = tv_sec;
        sb.st_ctim.tv_nsec = tv_nsec;
        sb.st_mtim.tv_sec = tv_sec;
        sb.st_mtim.tv_nsec = tv_nsec;

        fprintf(stderr, "%llu %ld %ld\n", start_timestamp, tv_sec, tv_nsec);
    }

    /*
     * We print the result after we've done the stat() so that we can include
     * "final: true" when we're not going to be able to re-register the file.
     */
    if (revents) {
        print_event(revents, finf->fobj.fo_name, final);
    }

    if ((key != 0) && (stat_ret != 0)) {
        /*
         * We're doing the initial register for this file, so we need to send
         * a result. Since stat() just failed, we'll send now and return since
         * we're not going to do anything further.
         */
        print_result(key, RESULT_FAILURE, finf->fobj.fo_name,
            "stat(2) failed with errno %d: %s", stat_ret, strerror(stat_ret));
        assert(final);
    }

    if (final) {
        /* we're not going to re-enable, so cleanup */
        destroy_handle(finf);
        return;
    }

    /*
     * (re)register.
     */
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
                pe.portev_events, 0);
            break;
        default:
            /*
             * Something's seriously wrong if we get events with a port source
             * other than FILE, since that's all we're adding. So abort and hope
             * there's enough state in the core.
             */
            print_error(0, ERR_UNEXPECTED_SOURCE,
                "event from unexpected source: %s", strerror(errno));
            abort();
        }

        /*
         * The actual work of freeing finf objects is done in this thread so
         * that there aren't any race conditions while accessing
         * free_list->fobj.fo_name in the check_and_rearm_event function
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
 * in the main thread right before an event in the secondary threat would try to
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
int
watch_path(char *pathname, uint32_t key, uint64_t start_timestamp)
{
    struct fileinfo *finf;
    /* port is global */

    finf = malloc(sizeof (struct fileinfo));
    if (finf == NULL) {
        print_error(key, ERR_CANNOT_ALLOCATE, "failed to allocate memory for "
            "new watcher errno %d: %s", errno, strerror(errno));
        /* XXX abort(); ? */
        return (ERR_CANNOT_ALLOCATE);
    }

    if ((finf->fobj.fo_name = strdup(pathname)) == NULL) {
        print_error(key, ERR_CANNOT_ALLOCATE, "strdup failed w/ errno %d: %s",
            errno, strerror(errno));
        /* XXX abort(); ? */
        free_handle(finf);
        return (ERR_CANNOT_ALLOCATE);
    }

    /* From here on we'll need to cleanup finf when done with it. */

    mutex_lock(&handles_mutex);

    if (find_handle(pathname) != NULL) {
        /* early-return: already watching so unlock and return success */
        mutex_unlock(&handles_mutex);

        print_result(key, RESULT_SUCCESS, pathname, "already watching");
        free_handle(finf);
        return (0);
    }


    insert_handle(finf);

    mutex_unlock(&handles_mutex);

    /*
     * Event types to watch.
     */
    finf->events = FILE_MODIFIED;

    /*
     * Start to monitor this file.
     */
    check_and_rearm_event(key, finf->fobj.fo_name, 0, start_timestamp);

    return (0);
}

/*
 * Only called from main thread. Attempts to unwatch pathname.
 */
int
unwatch_path(char *pathname, uint32_t key)
{
    struct fileinfo *finf;
    struct file_obj *fobjp;
    int ret;

    mutex_lock(&handles_mutex);

    finf = find_handle(pathname);
    if (finf == NULL) {
        mutex_unlock(&handles_mutex);
        print_result(key, RESULT_FAILURE, pathname, "not watching '%s', cannot "
            "unwatch", pathname);
        return (0);
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
    uint64_t start_timestamp;

    handles = calloc(sizeof (struct fileinfo *), HANDLES_MASK);

    if ((port = port_create()) == -1) {
        print_error(SYSTEM_KEY, ERR_PORT_CREATE, "port_create failed(%d): %s",
            errno, strerror(errno));
        exit(ERR_PORT_CREATE);
    }

    /* Create a worker thread to process events. */
    pthread_create(&tid, NULL, wait_for_events, NULL);

    while (1) {
        if (fgets(str, MAX_CMD_LEN + 1, stdin) == NULL) {
            if (!feof(stdin)) {
                print_error(SYSTEM_KEY, ERR_GET_STDIN, "fswatcher: error on "
                    "stdin (errno: %d): %s\n", errno, strerror(errno));
            }
            /* In EOF case we don't print, this this is normal termination. */
            break;
        }

        start_timestamp = 0;

        /* read one character past MAX_KEY_LEN so we know it's too long */
        snprintf(sscanf_fmt, MAX_FMT_LEN, "%%%ds %%s %%s %%llu",
            MAX_KEY_LEN + 1);
        res = sscanf(str, sscanf_fmt, key_str, cmd, path, &start_timestamp);
        if (res != 3 && res != 4) {
            print_error(SYSTEM_KEY, ERR_INVALID_COMMAND,
                "invalid command line");
            continue;
        }
        key = strtoul(key_str, NULL, 10);
        if ((strlen(key_str) > MAX_KEY_LEN) ||
            (key == ULONG_MAX && errno == ERANGE)) {

            print_error(SYSTEM_KEY, ERR_INVALID_KEY,
                "invalid key: > ULONG_MAX");
            continue;
        }
        if (key == 0) {
            print_error(SYSTEM_KEY, ERR_INVALID_KEY, "invalid key: 0");
            continue;
        }

#ifdef DEBUG
        fprintf(stderr, "DEBUG key: %u cmd: %s path: %s\n", key, cmd, path);
#endif

        if (strcmp("UNWATCH", cmd) == 0) {
            /* unwatch_path() will print an object to stdout */
            res = unwatch_path(path, key);
            if (res != 0) {
                /*
                 * An error occured and unwatch_path() will have written an
                 * error object to stdout. Break the loop so we can exit.
                 */
                exit_code = res;
                break;
            }
        } else if (strcmp("WATCH", cmd) == 0) {
            /* watch_path() will print an object to stdout */
            res = watch_path(path, key, start_timestamp);
            if (res != 0) {
                /*
                 * An error occured and watch_path() will have written an error
                 * object to stdout. Break the loop so we can exit.
                 */
                exit_code = res;
                break;
            }
        } else {
            /* XXX if they include crazy garbage, this may include non-JSON */
            print_error(key, ERR_UNKNOWN_COMMAND, "unknown command '%s'", cmd);
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

    free(handles);

    exit(exit_code);
}
