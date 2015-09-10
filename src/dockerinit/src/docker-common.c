/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * This program acts as an 'exec' helper for a docker zone on SmartOS. When
 * `docker exec` is run this is used to:
 *
 *  - switch users/groups (based on docker:user)
 *  - setup environment
 *  - setup cmdline
 *  - exec requested cmd
 *
 * If successful, the exec cmd will replace this process running in the zone.
 * If any error is encountered, this will exit non-zero and the exec session
 * should fail to start.
 *
 * A log is also written to /var/log/sdc-dockerexec.log in order to debug
 * problems.
 */

#include <door.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <libgen.h>
#include <libipadm.h>
#include <libinetutil.h>
#include <libnvpair.h>
#include <limits.h>
#include <pwd.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <unistd.h>

#include <arpa/inet.h>

#include <net/if.h>
#include <net/route.h>
#include <netinet/in.h>

#include <sys/types.h>
#include <sys/mount.h>
#include <sys/mntent.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/stat.h>

#include "../json-nvlist/json-nvlist.h"
#include "../mdata-client/base64.h"
#include "../mdata-client/common.h"
#include "../mdata-client/dynstr.h"
#include "../mdata-client/plat.h"
#include "../mdata-client/proto.h"
#include "strlist.h"
#include "strpath.h"

#include "docker-common.h"

/* global metadata client bits */
extern int initialized_proto;
extern mdata_proto_t *mdp;

/* other global bits we fill in for callers */
extern char *hostname;
extern FILE *log_stream;
extern struct passwd *pwd;
extern struct group *grp;

char fallback[] = "1970-01-01T00:00:00.000Z";
char timestamp[32];

/*
 * The callback function type for forEachStringInArray().  This function
 * is passed the following parameters for each string in the array:
 *   - array name (provided by caller)
 *   - index of current string element
 *   - current string element
 *   - void *arg0 and *arg1 (provided by caller)
 */
typedef void forEachStringCb_t(const char *, unsigned int, const char *,
  void *, void *);

static void insertOrReplaceEnv(strlist_t *, const char *, const char *);
static void splitEnvEntry(const char *, char **, char **);
static void forEachStringInArray(const char *, nvlist_t *, forEachStringCb_t *,
  void *, void *);
static int getPathList(strlist_t *, strlist_t *, const char *);

char *
getTimestamp()
{
    char fmt[32];
    struct timeval tv;
    struct tm *tm;

    /*
     * XXX we don't call fatal() or dlog() because we don't want to create a
     * loop, and having logs but no timestamp is better than having no logs.
     */

    if (gettimeofday(&tv, NULL) != 0) {
        perror("gettimeofday()");
        return (fallback);
    }
    if ((tm = gmtime(&tv.tv_sec)) == NULL) {
        perror("gmtime()");
        return (fallback);
    }
    if (strftime(fmt, sizeof (fmt), "%Y-%m-%dT%H:%M:%S.%%03uZ", tm) == 0) {
        perror("strftime()");
        return (fallback);
    }
    if (snprintf(timestamp, sizeof (timestamp), fmt, (tv.tv_usec / 1000)) < 0) {
        perror("snprintf()");
        return (fallback);
    }

    return (timestamp);
}

/*
 * This function is used to handle fatal errors. It takes a standard printf(3c)
 * format and arguments and outputs to stderr. It then either:
 *
 *  - Calls abort() if the error code is 'ERR_UNEXPECTED'
 *  - Calls exit(code) for any other error code
 *
 * As such, it never returns control to the caller.
 */
void
fatal(dockerinit_err_t code, char *fmt, ...)
{
     va_list ap;
     va_start(ap, fmt);

     (void) fprintf(log_stream, "%s FATAL (code: %d): ",
         getTimestamp(), (int)code);
     (void) vfprintf(log_stream, fmt, ap);
     fflush(log_stream);
     va_end(ap);

    if (code == ERR_UNEXPECTED) {
        (void) abort();
    } else {
        exit((int) code);
    }
}

void
dlog(const char *fmt, ...)
{
     va_list ap;
     va_start(ap, fmt);
     (void) fprintf(log_stream, "%s ", getTimestamp());
     (void) vfprintf(log_stream, fmt, ap);
     fflush(log_stream);
     va_end(ap);
}

/*
 * Contact the hypervisor metadata agent and request the value for the provided
 * key name.  Returns a C string if a value is found, NULL if no value is
 * found, or aborts the program on any other condition.  The caller is expected
 * to call free(3C) on the returned string.
 */
char *
mdataGet(const char *keyname)
{
    char *errmsg = NULL;
    string_t *mdata = NULL;
    mdata_response_t mdr;
    char *out;

    if (initialized_proto == 0) {
        if (proto_init(&mdp, &errmsg) != 0) {
            fatal(ERR_MDATA_INIT, "could not initialize metadata: %s\n",
                errmsg);
        }
        initialized_proto = 1;
    }

    if (proto_execute(mdp, "GET", keyname, &mdr, &mdata) != 0) {
        fatal(ERR_UNEXPECTED, "failed to get metadata for '%s': unknown "
          "error\n", keyname);
    }

    switch (mdr) {
    case MDR_SUCCESS:
        if ((out = strdup(dynstr_cstr(mdata))) == NULL) {
            fatal(ERR_STRDUP, "strdup failure\n");
        }
        dynstr_free(mdata);
        dlog("MDATA %s=%s\n", keyname, out);
        return (out);

    case MDR_NOTFOUND:
        dlog("INFO no metadata for '%s'\n", keyname);
        dynstr_free(mdata);
        return (NULL);

    case MDR_UNKNOWN:
        fatal(ERR_MDATA_FAIL, "failed to get metadata for '%s': %s\n",
            keyname, dynstr_cstr(mdata));
        break;

    case MDR_INVALID_COMMAND:
        fatal(ERR_MDATA_FAIL, "failed to get metadata for '%s': %s\n",
            keyname, "host does not support GET");
        break;

    default:
        fatal(ERR_UNEXPECTED, "GET[%s]: unknown response\n", keyname);
        break;
    }

    /* NOTREACHED */
    abort();
    return (NULL);
}

void
mdataPut(const char *keyname, const char *value)
{
    string_t *data;
    char *errmsg = NULL;
    mdata_response_t mdr;
    string_t *req = dynstr_new();

    if (initialized_proto == 0) {
        if (proto_init(&mdp, &errmsg) != 0) {
            fatal(ERR_MDATA_INIT, "could not initialize metadata: %s\n",
                errmsg);
        }
        initialized_proto = 1;
    }

    base64_encode(keyname, strlen(keyname), req);
    dynstr_appendc(req, ' ');
    base64_encode(value, strlen(value), req);

    if (proto_version(mdp) < 2) {
        fatal(ERR_MDATA_TOO_OLD, "mdata protocol must be >= 2 for PUT");
    }

    if (proto_execute(mdp, "PUT", dynstr_cstr(req), &mdr, &data) != 0) {
        fatal(ERR_MDATA_FAIL, "failed to PUT");
    }

    dynstr_free(req);

    dlog("MDATA PUT %s=%s\n", keyname, value);
}

void
mdataDelete(const char *keyname)
{
    string_t *data;
    char *errmsg = NULL;
    mdata_response_t mdr;

    if (initialized_proto == 0) {
        if (proto_init(&mdp, &errmsg) != 0) {
            fatal(ERR_MDATA_INIT, "could not initialize metadata: %s\n",
                errmsg);
        }
        initialized_proto = 1;
    }

    if (proto_version(mdp) < 2) {
        fatal(ERR_MDATA_TOO_OLD, "mdata protocol must be >= 2 for DELETE");
    }

    if (proto_execute(mdp, "DELETE", keyname, &mdr, &data) != 0) {
        fatal(ERR_MDATA_FAIL, "failed to DELETE");
    }

    dlog("MDATA DELETE %s\n", keyname);
}

/*
 * This callback is called for each string in the provided environment vector.
 * The string is inserted into the provided strlist, replacing any existing
 * list entry with the same variable name.
 */
void
cbEachEnvEntry(const char *array_name __GNU_UNUSED, unsigned int idx
  __GNU_UNUSED, const char *val, void *arg0, void *arg1 __GNU_UNUSED)
{
    strlist_t *env = arg0;
    char *env_name = NULL;
    char *env_val = NULL;

    splitEnvEntry(val, &env_name, &env_val);

    insertOrReplaceEnv(env, env_name, env_val);

    free(env_name);
    free(env_val);
}

int
buildCmdEnv(strlist_t *env)
{
    char *const arrays[] = {
        /*
         * Add the link environment first, so that the container environment
         * may override values from the link:
         */
        "docker:linkEnv",
        "docker:env",
        NULL
    };

    /*
     * Start with a minimum set of default environment entries.  These will be
     * overridden if they are present in the arrays loaded from metadata.
     *
     * Currently docker only sets TERM for interactive sessions, but we set a
     * default in all cases to work around OS-3579.
     */
    insertOrReplaceEnv(env, "TERM", DEFAULT_TERM);
    insertOrReplaceEnv(env, "HOME", pwd != NULL ? pwd->pw_dir : "/");
    insertOrReplaceEnv(env, "PATH", DEFAULT_PATH);
    if (hostname != NULL) {
        insertOrReplaceEnv(env, "HOSTNAME", hostname);
    }

    /*
     * Load environment passed into the zone via metadata:
     */
    for (int i = 0; arrays[i] != NULL; i++) {
        nvlist_t *nvl = NULL;

        getMdataArray(arrays[i], &nvl, NULL);

        forEachStringInArray(arrays[i], nvl, cbEachEnvEntry, env, NULL);

        nvlist_free(nvl);
    }

    /*
     * Emit a DEBUG log of each environment variable:
     */
    for (unsigned int i = 0; strlist_get(env, i) != NULL; i++) {
        dlog("ENV[%d] %s\n", i, strlist_get(env, i));
    }

    return (0);
}

custr_t *
execName(const char *cmd, strlist_t *env, const char *working_directory)
{
    strlist_t *path;
    custr_t *cu = NULL;
    boolean_t ok = B_FALSE;

    if (strlist_alloc(&path, 0) != 0 || custr_alloc(&cu) != 0) {
        fatal(ERR_NO_MEMORY, "strlist_alloc failure");
    }

    if (getPathList(env, path, working_directory) != 0) {
        fatal(ERR_UNEXPECTED, "getPathList() failed\n");
    }

    /* if cmd contains a '/' we check it exists directly */
    if (strchr(cmd, '/') != NULL) {
        struct stat statbuf;

        if (stat(cmd, &statbuf) != 0) {
            fatal(ERR_STAT_CMD, "stat(%s): %s\n", cmd, strerror(errno));
        }
        if (S_ISDIR(statbuf.st_mode)) {
            fatal(ERR_STAT_DIR, "stat(%s): is a directory\n", cmd);
        }
        if (!(statbuf.st_mode & S_IXUSR)) {
            fatal(ERR_STAT_EXEC, "stat(%s): is not executable\n", cmd);
        }

        custr_reset(cu);
        if (strpath_append(cu, cmd) != 0) {
            fatal(ERR_NO_MEMORY, "strpath_append failure");
        }

        ok = B_TRUE;
        goto out;
    }

    /*
     * The command did not contain a slash (/), so attempt to construct
     * a fully qualified path using PATH from the provided environment:
     */
    for (unsigned int i = 0; strlist_get(path, i) != NULL; i++) {
        struct stat statbuf;

        custr_reset(cu);
        if (strpath_append(cu, strlist_get(path, i)) != 0 ||
          strpath_append(cu, cmd) != 0) {
            fatal(ERR_UNEXPECTED, "strpath_append: %s\n", strerror(errno));
        }

        dlog("TRYPATH \"%s\"\n", custr_cstr(cu));

        if (stat(custr_cstr(cu), &statbuf) != 0 || S_ISDIR(statbuf.st_mode) ||
          (statbuf.st_mode & S_IXUSR) == 0) {
            /*
             * No valid executable found under this path component.  Try
             * another.
             */
            continue;
        }

        ok = B_TRUE;
        goto out;
    }

out:
    strlist_free(path);
    if (!ok) {
        fatal(ERR_NOT_FOUND, "'%s' not found in PATH\n", cmd);
    }
    return (cu);
}

void
getMdataArray(const char *key, nvlist_t **nvl, uint32_t *len)
{
    char *json;
    boolean_t do_free = B_TRUE;

    if ((json = mdataGet(key)) == NULL) {
        json = "[]";
        do_free = B_FALSE;
    }

    if (nvlist_parse_json(json, strlen(json), nvl, NVJSON_FORCE_INTEGER,
      NULL) != 0) {
        fatal(ERR_PARSE_JSON, "failed to parse JSON(%s): %s\n", key, json);
    }

    if (len != NULL) {
        if (nvlist_lookup_uint32(*nvl, "length", len) != 0) {
            fatal(ERR_UNEXPECTED, "nvl missing 'length' for %s\n", key);
        }
    }

    if (do_free) {
        free(json);
    }
}

/*
 * This expects 'docker:user' to be one of:
 *
 *  "<uid>"
 *  "<uid>:<gid>"
 *  "<user>"
 *  "<user>:<group>"
 *
 * And if 'docker:user' is not set at all, will behave as though it were set to
 * "0".
 *
 * The user will be looked up against the /etc/passwd file and if a group is
 * specified, that group will be looked up (stored in global 'grp'). If no group
 * is specified, the user's default group will be used (from pwd.pw_gid).
 */
void
getUserGroupData()
{
    char *endptr;
    char *separator = ":";
    char *token;
    char *user;
    char *user_orig;
    long long int lli;
    char *group;
    boolean_t do_free = B_TRUE;

    if ((user = mdataGet("docker:user")) == NULL) {
        /* default to root */
        user = "0";
        do_free = B_FALSE;
    }
    user_orig = strdup(user);
    if (user_orig == NULL) {
        fatal(ERR_STRDUP, "failed to strdup(%s): %s\n", user, strerror(errno));
    }

    token = strtok(user, separator);
    if ((token != NULL) && (user_orig[strlen(token)] == ':'))  {
        user = token;
        group = user_orig + (strlen(token) + 1); /* skip past ':' */

        grp = getgrnam(group);
        if (grp == NULL) {
            lli = strtoll(group, &endptr, 10);
            if (lli == 0LL && endptr != NULL) {
                grp = getgrgid((gid_t) lli);
            } else {
                fatal(ERR_GID_NAN, "GID is not a number: %s\n", group);
            }
        }
        dlog("SPLIT user: '%s' group: '%s'\n", user, group);
    }

    pwd = getpwnam(user);
    if (pwd == NULL) {
        endptr = NULL;
        lli = strtoll(user, &endptr, 10);
        if (lli == 0LL && endptr != NULL) {
            pwd = getpwuid((uid_t) lli);
        } else {
            fatal(ERR_UID_NAN, "UID is not a number: %s\n", user);
        }
    }

    if (pwd != NULL) {
        dlog("INFO passwd.pw_name: %s\n", pwd->pw_name);
        dlog("INFO passwd.pw_uid: %u\n", pwd->pw_uid);
        dlog("INFO passwd.pw_gid: %u\n", pwd->pw_gid);
        dlog("INFO passwd.pw_dir: %s\n", pwd->pw_dir);
    }

    if (grp == NULL && pwd != NULL) {
        grp = getgrgid(pwd->pw_gid);
    }

    if (grp != NULL) {
        dlog("INFO group.gr_name: %s\n", grp->gr_name);
        dlog("INFO group.gr_gid: %u\n", grp->gr_gid);
    }

    if (do_free) {
        free(user);
    }
}

void
setupWorkdir(custr_t **cup)
{
    char *mdval;
    custr_t *cu;

    if (custr_alloc(&cu) != 0) {
        fatal(ERR_NO_MEMORY, "custr_alloc failure: %s\n", strerror(errno));
    }

    /*
     * Every path is anchored at the root, i.e. "/".
     */
    if (strpath_append(cu, "/") != 0) {
        fatal(ERR_UNEXPECTED, "strpath_append failure\n");
    }

    if ((mdval = mdataGet("docker:workdir")) != NULL) {
        const char *t = mdval;

        if (pwd != NULL && t[0] == '~') {
            /*
             * Expand the "~" token to the value of $HOME for this user.
             */
            if (strpath_append(cu, pwd->pw_dir) != 0) {
                fatal(ERR_UNEXPECTED, "strpath_append failure\n");
            }

            /*
             * Skip the '~' character at the front of the path.
             */
            t++;
        }

        /*
         * Append the rest of the path.
         */
        if (strpath_append(cu, t) != 0) {
            fatal(ERR_UNEXPECTED, "strpath_append failure\n");
        }

        free(mdval);
    }

    dlog("WORKDIR '%s'\n", custr_cstr(cu));

    /* Create workdir (and parents) if missing. */
    if (mkdirp(custr_cstr(cu), 0755) == -1 && errno != EEXIST) {
        fatal(ERR_MKDIR, "mkdirp(%s) failed: %s\n", custr_cstr(cu),
          strerror(errno));
    }

    if (chdir(custr_cstr(cu)) != 0) {
        fatal(ERR_CHDIR, "chdir(%s) failed: %s\n", custr_cstr(cu),
          strerror(errno));
    }

    if (cup != NULL) {
        *cup = cu;
    } else {
        custr_free(cu);
    }
}

static void
splitEnvEntry(const char *input, char **name, char **value)
{
    const char *eq;

    /*
     * Everything before the first equals ("=") is the environment variable
     * name.  Determine the length of the name:
     */
    if ((eq = strchr(input, '=')) == NULL || eq == input) {
        fatal(ERR_UNEXPECTED, "invalid env vector entry: %s\n", input);
    }

    /*
     * Copy out the name string.
     */
    if (name != NULL && (*name = strndup(input, eq - input)) == NULL) {
        fatal(ERR_STRDUP, "strdup failure: %s\n", strerror(errno));
    }

    /*
     * Copy out the value string.
     */
    if (value != NULL && (*value = strdup(eq + 1)) == NULL) {
        fatal(ERR_STRDUP, "strdup failure: %s\n", strerror(errno));
    }
}

static void
insertOrReplaceEnv(strlist_t *sl, const char *name, const char *value)
{
    boolean_t found = B_FALSE;
    unsigned int idx;
    int ret, e;
    char *insval;

    /*
     * Check for an existing environment entry by this name:
     */
    for (idx = 0; strlist_get(sl, idx) != NULL; idx++) {
        char *sname;

        splitEnvEntry(strlist_get(sl, idx), &sname, NULL);
        if (strcmp(sname, name) == 0) {
            found = B_TRUE;
        }
        free(sname);

        if (found) {
            break;
        }
    }

    /*
     * Construct the full value to insert:
     */
    if (asprintf(&insval, "%s=%s", name, value) < 0) {
        fatal(ERR_STRDUP, "asprintf failure: %s\n", strerror(errno));
    }

    if (found) {
        /*
         * Replace the existing entry with this new entry.
         */
        ret = strlist_set(sl, idx, insval);
    } else {
        /*
         * Append the new entry to the end of the list.
         */
        ret = strlist_set_tail(sl, insval);
    }

    e = errno;
    free(insval);
    if (ret != 0) {
        fatal(ERR_NO_MEMORY, "strlist failure: %s\n", strerror(e));
    }
}

/*
 * Given an nvlist_t representing a JSON array of strings, walk each string in
 * the array and call the provided callback function.  The user-provided
 * "array_name", "arg0" and "arg1" values are passed through to the callback
 * unmodified.
 */
static void
forEachStringInArray(const char *array_name, nvlist_t *array_nvl,
  forEachStringCb_t *funcp, void *arg0, void *arg1)
{
    uint32_t len;

    VERIFY(array_name != NULL);
    VERIFY(funcp != NULL);

    if (nvlist_lookup_uint32(array_nvl, "length", &len) != 0) {
        fatal(ERR_UNEXPECTED, "array \"%s\" is missing \"length\" property\n",
          array_name);
    }

    for (uint32_t i = 0; i < len; i++) {
        char idx[32];
        char *val;

        /*
         * As part of the conversion from a JSON array to an nvlist, each
         * array element is stored as a property where the name is the
         * string representation of the index; e.g., the fifth element is
         * named "4".
         */
        (void) snprintf(idx, sizeof (idx), "%u", i);

        if (nvlist_lookup_string(array_nvl, idx, &val) != 0) {
            fatal(ERR_UNEXPECTED, "array \"%s\" missing string @ index [%s]\n",
                array_name, idx);
        }

        funcp(array_name, i, val, arg0, arg1);
    }
}

/*
 * Load the PATH environment variable from this environment, or if PATH is not
 * set, load the default.  Split the value, on each delimiting colon, into an
 * ordered list of search directories.  If a search directory is not fully
 * qualified, that directory will be appended to the provided "working
 * directory".
 */
static int
getPathList(strlist_t *env, strlist_t *path, const char *working_directory)
{
    char *r = NULL;
    boolean_t dofree = B_TRUE;
    custr_t *cu = NULL;
    custr_t *searchdir = NULL;

    if (custr_alloc(&cu) != 0 || custr_alloc(&searchdir) != 0) {
        fatal(ERR_NO_MEMORY, "custr_alloc failure");
    }

    /*
     * Check environment array for PATH value.
     */
    for (unsigned int idx = 0; strlist_get(env, idx) != NULL; idx++) {
        char *sname;
        char *svalue;

        splitEnvEntry(strlist_get(env, idx), &sname, &svalue);
        if (strcmp(sname, "PATH") != 0) {
            free(sname);
            free(svalue);
            continue;
        }

        free(sname);
        r = svalue;
        break;
    }

    /*
     * If no PATH was found, fall back to the default:
     */
    if (r == NULL) {
        r = DEFAULT_PATH;
        dofree = B_FALSE;
    }

    /*
     * Parse PATH (i.e., split on ":" characters).
     */
    for (unsigned int i = 0; ; i++) {
        char c = r[i];
        if (c != ':' && c != '\0') {
            /*
             * This is neither the end of an element of the colon-separated
             * PATH list, nor the end of the entire list.  Save the character
             * in the working buffer.
             */
            if (custr_appendc(cu, c) != 0) {
                fatal(ERR_NO_MEMORY, "custr_appendc failure");
            }
            continue;
        }

        /*
         * All paths must be fully-qualified, so start from "/".
         */
        custr_reset(searchdir);
        if (strpath_append(searchdir, "/") != 0) {
            fatal(ERR_NO_MEMORY, "strpath_append failure");
        }

        if (custr_len(cu) < 1 || custr_cstr(cu)[0] != '/') {
            /*
             * This path is not fully-qualified, or is the empty string.
             * Prepend the working directory.
             */
            if (strpath_append(searchdir, working_directory) != 0) {
                fatal(ERR_NO_MEMORY, "strpath_append failure");
            }
        }

        if (custr_len(cu) > 0) {
            /*
             * Append the remainder of the path.
             */
            if (strpath_append(searchdir, custr_cstr(cu)) != 0) {
                fatal(ERR_NO_MEMORY, "strpath_append failure");
            }
        }
        custr_reset(cu);

        /*
         * Store the path in the list.
         */
        if (strlist_set_tail(path, custr_cstr(searchdir)) != 0) {
            fatal(ERR_NO_MEMORY, "strlist_set_tail failure");
        }

        if (c == '\0') {
            break;
        }
    }

    free(dofree ? r : NULL);
    custr_free(cu);
    custr_free(searchdir);
    return (0);
}

/*
 * Called for each entry in the CMD and ENTRYPOINT arrays.  Copies the string
 * into the next available slot in the combined command string list.
 */
void
cbEachCmdEntry(const char *array_name __GNU_UNUSED, unsigned int idx
  __GNU_UNUSED, const char *val, void *arg0, void *arg1)
{
    strlist_t *cmdline = arg0;
    const char *typ = arg1;

    if (strlist_set_tail(cmdline, val) != 0) {
        fatal(ERR_NO_MEMORY, "strlist failure: %s\n", strerror(errno));
    }

    dlog("ARGV[%u]:%s \"%s\"\n", strlist_contig_count(cmdline) - 1, typ, val);
}

int
buildCmdline(strlist_t *cmdline)
{
    struct {
        const char *ad_name;
        const char *ad_key;
    } const arraydefs[] = {
        /*
         * The ENTRYPOINT array is read first, followed by the CMD array.
         */
        { "ENTRYPOINT",     "docker:entrypoint" },
        { "CMD",            "docker:cmd" },
        { NULL,             NULL }
    };

    for (int i = 0; arraydefs[i].ad_name != NULL; i++) {
        nvlist_t *nvl = NULL;

        getMdataArray(arraydefs[i].ad_key, &nvl, NULL);

        forEachStringInArray(arraydefs[i].ad_key, nvl, cbEachCmdEntry, cmdline,
          (void *)arraydefs[i].ad_name);

        nvlist_free(nvl);
    }

    if (strlist_contig_count(cmdline) < 1) {
        /*
         * No ENTRYPOINT or CMD, docker prevents this at the API but if
         * something somehow gets in this state, it's an error.
         */
        fatal(ERR_NO_COMMAND, "No command specified\n");
    }

    return (0);
}
