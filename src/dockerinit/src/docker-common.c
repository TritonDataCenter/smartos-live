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

#include "docker-common.h"

/* global metadata client bits */
extern int initialized_proto;
extern mdata_proto_t *mdp;

/* other global bits we fill in for callers */
extern char **cmdline;
extern char **env;
extern char *hostname;
extern FILE *log_stream;
extern char *path;
extern struct passwd *pwd;
extern struct group *grp;

char fallback[] = "1970-01-01T00:00:00.000Z";
char timestamp[32];

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

const char *
mdataGet(const char *keyname)
{
    char *errmsg = NULL;
    const char *json;
    string_t *mdata;
    mdata_response_t mdr;

    if (initialized_proto == 0) {
        if (proto_init(&mdp, &errmsg) != 0) {
            fatal(ERR_MDATA_INIT, "could not initialize metadata: %s\n",
                errmsg);
        }
        initialized_proto = 1;
    }

    if (proto_execute(mdp, "GET", keyname, &mdr, &mdata) == 0) {
        json = dynstr_cstr(mdata);

        switch (mdr) {
        case MDR_SUCCESS:
            dlog("MDATA %s=%s\n", keyname, json);
            return (json);
        case MDR_NOTFOUND:
            dlog("INFO no metadata for '%s'\n", keyname);
            return (NULL);
        case MDR_UNKNOWN:
            fatal(ERR_MDATA_FAIL, "failed to get metadata for '%s': %s\n",
                keyname, json);
            break;
        case MDR_INVALID_COMMAND:
            fatal(ERR_MDATA_FAIL, "failed to get metadata for '%s': %s\n",
                keyname, "host does not support GET");
            break;
        default:
            fatal(ERR_UNEXPECTED, "GET[%s]: unknown response\n", keyname);
            break;
        }
    }

    fatal(ERR_UNEXPECTED, "failed to get metadata for '%s': unknown error\n",
        keyname);

    /* NOTREACHED */
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

void
buildCmdEnv()
{
    int idx;
    nvlist_t *nvl;
    uint32_t env_len;

    getMdataArray("docker:env", &nvl, &env_len);

    /*
     * NOTE: We allocate two extra char * in case we're going to add 'HOME'
     * and/or 'TERM'
     */
    env = malloc((sizeof (char *)) * (env_len + 3));
    if (env == NULL) {
        fatal(ERR_UNEXPECTED, "malloc() for env[%d] failed: %s\n", env_len + 3,
            strerror(errno));
    }

    idx = 0;
    addValues(env, &idx, ARRAY_ENV, nvl);
    env[idx] = NULL;

    /*
     * NOTE: we don't nvlist_free(nvl); here because we need this memory
     * for execve() and when we execve() things get cleaned up anyway.
     */
}

void
addValues(char **array, int *idx, array_type_t type, nvlist_t *nvl)
{
    nvpair_t *pair;
    char *field, *printf_fmt;
    char *home;
    int home_len = 0;
    char *hostname_env;
    int hostname_env_len;
    int found_home = 0;
    int found_hostname = 0;
    int found_path = 0;
    int found_term = 0;
    char *new_path;
    int ret;
    char *term;
    char *value;

    switch (type) {
        case ARRAY_CMD:
            field = "docker:cmd";
            printf_fmt = "ARGV[%d]:CMD %s\n";
            break;
        case ARRAY_ENTRYPOINT:
            field = "docker:entrypoint";
            printf_fmt = "ARGV[%d]:ENTRYPOINT %s\n";
            break;
        case ARRAY_ENV:
            field = "docker:env";
            printf_fmt = "ENV[%d] %s\n";
            break;
        default:
            fatal(ERR_UNEXPECTED, "unexpected array type: %d\n", type);
            break;
    }

    for (pair = nvlist_next_nvpair(nvl, NULL); pair != NULL;
        pair = nvlist_next_nvpair(nvl, pair)) {

        if (nvpair_type(pair) == DATA_TYPE_STRING) {
            ret = nvpair_value_string(pair, &value);
            if (ret == 0) {
                if ((type == ARRAY_ENTRYPOINT) && (*idx == 0) &&
                    (value[0] != '/')) {

                    /*
                     * XXX if first component is not an absolute path, we want
                     * to make sure we're exec'ing something that is. In docker
                     * they do an exec.LookPath, but for now we'll just run
                     * under /bin/sh -c
                     */
                    array[(*idx)++] = "/bin/sh";
                    dlog(printf_fmt, *idx, array[(*idx)-1]);
                    array[(*idx)++] = "-c";
                    dlog(printf_fmt, *idx, array[(*idx)-1]);
                }
                array[*idx] = value;
                if ((type == ARRAY_ENV) && (strncmp(value, "HOME=", 5) == 0)) {
                    found_home = 1;
                }
                if ((type == ARRAY_ENV) && (strncmp(value, "TERM=", 5) == 0)) {
                    found_term = 1;
                }
                if ((type == ARRAY_ENV) && (strncmp(value, "PATH=", 5) == 0)) {
                    path = (value + 5);
                    found_path = 1;
                }
                if ((type == ARRAY_ENV) &&
                    (strncmp(value, "HOSTNAME=", 9) == 0)) {

                    found_hostname = 1;
                }
                dlog(printf_fmt, *idx, array[*idx]);
                (*idx)++;
            } else {
                fatal(ERR_PARSE_NVPAIR_STRING, "failed to parse nvpair string"
                    " code: %d\n", ret);
            }
        } else if (nvpair_type(pair) == DATA_TYPE_BOOLEAN) {
            /* decorate_array adds this, ignore. */
        } else if (nvpair_type(pair) == DATA_TYPE_UINT32) {
            /* decorate_array adds this, it's the length of the array. */
        } else {
            dlog("WARNING: unknown type parsing '%s': %d\n", field,
                nvpair_type(pair));
        }
    }

    /*
     * If HOME was not set in the environment, we'll add it here based on the
     * pw_dir value from the passwd file.
     */
    if ((type == ARRAY_ENV) && !found_home) {
        if (pwd != NULL) {
            home_len = (strlen(pwd->pw_dir) + 6);
            home = malloc(sizeof (char) * home_len);
            if (home == NULL) {
                fatal(ERR_UNEXPECTED, "malloc() for home[%d] failed: %s\n",
                    home_len, strerror(errno));
            }
            if (snprintf(home, home_len, "HOME=%s", pwd->pw_dir) < 0) {
                fatal(ERR_UNEXPECTED, "snprintf(HOME=) failed: %s\n",
                    strerror(errno));
            }
        } else {
            home = "HOME=/";
        }
        array[(*idx)++] = home;
        dlog("ENV[%d] %s\n", (*idx) - 1, home);
    }

    /*
     * If HOSTNAME was not set in the environment, but we've looked it up, we
     * set it here based on the looked up value.
     */
    if ((type == ARRAY_ENV) && !found_hostname && (hostname != NULL)) {
        hostname_env_len = (strlen(hostname) + 10);
        hostname_env = malloc(sizeof (char) * hostname_env_len);
        if (hostname_env == NULL) {
            fatal(ERR_UNEXPECTED, "malloc() for hostname[%d] failed: %s\n",
                hostname_env_len, strerror(errno));
        }
        if (snprintf(hostname_env, hostname_env_len, "HOSTNAME=%s",
            hostname) < 0) {

            fatal(ERR_UNEXPECTED, "snprintf(HOSTNAME=) failed: %s\n",
                strerror(errno));
        }
        array[(*idx)++] = hostname_env;
        dlog("ENV[%d] %s\n", (*idx) - 1, hostname_env);
    }

    /*
     * If TERM was not set we also add that now. Currently docker only sets TERM
     * for interactive sessions, but we set in all cases if not passed in to
     * work around OS-3579.
     */
    if ((type == ARRAY_ENV) && !found_term) {
        if ((term = strdup(DEFAULT_TERM)) == NULL) {
            fatal(ERR_UNEXPECTED, "strdup(TERM=) failed: %s\n",
                strerror(errno));
        }
        array[(*idx)++] = term;
        dlog("ENV[%d] %s\n", (*idx) - 1, term);
    }

    /*
     * If PATH was not set, we'll use docker's default path.
     */
    if ((type == ARRAY_ENV) && !found_path) {
        if ((new_path = strdup(DEFAULT_PATH)) == NULL) {
            fatal(ERR_UNEXPECTED, "strdup(PATH=) failed: %s\n",
                strerror(errno));
        }
        array[(*idx)++] = new_path;
        path = (new_path + 5);
        dlog("ENV[%d] %s\n", (*idx) - 1, new_path);
    }
}

char *
execName(char *cmd)
{
    char *path_copy;
    char *result;
    struct stat statbuf;
    char testpath[PATH_MAX+1];
    char *token;

    /* if cmd contains a '/' we check it exists directly */
    if (strchr(cmd, '/') != NULL) {
        if (stat(cmd, &statbuf) != 0) {
            fatal(ERR_STAT_CMD, "stat(%s): %s\n", cmd, strerror(errno));
        }
        if (S_ISDIR(statbuf.st_mode)) {
            fatal(ERR_STAT_DIR, "stat(%s): is a directory\n", cmd);
        }
        if (!(statbuf.st_mode & S_IXUSR)) {
            fatal(ERR_STAT_EXEC, "stat(%s): is not executable\n", cmd);
        }
        return (cmd);
    }

    /* cmd didn't contain '/' so we'll check PATH */

    if (path == NULL) {
        fatal(ERR_NO_PATH, "PATH not set, cannot find executable '%s'\n", cmd);
    }

    /* make a copy before strtok destroys it */
    path_copy = strdup(path);
    if (path_copy == NULL) {
        fatal(ERR_STRDUP, "failed to strdup(%s): %s\n", path, strerror(errno));
    }

    token = strtok(path_copy, ":");
    while (token != NULL) {
        if (snprintf(testpath, PATH_MAX+1, "%s/%s", token, cmd) == -1) {
            fatal(ERR_UNEXPECTED, "snprintf(testpath): %s\n", strerror(errno));
        }
        if ((stat(testpath, &statbuf) == 0) && !S_ISDIR(statbuf.st_mode) &&
            (statbuf.st_mode & S_IXUSR)) {

            /* exists! so return it. we're done. */
            result = strdup(testpath);
            if (result == NULL) {
                fatal(ERR_STRDUP, "failed to strdup(%s): %s\n", testpath,
                    strerror(errno));
            }
            return (result);
        }

        token = strtok(NULL, ":");
    }

    fatal(ERR_NOT_FOUND, "'%s' not found in PATH\n", cmd);

    /* not reached */
    return (NULL);
}

void
getMdataArray(char *key, nvlist_t **nvl, uint32_t *len)
{
    char *json;
    int ret;

    json = (char *) mdataGet(key);
    if (json == NULL) {
        json = "[]";
    }

    ret = nvlist_parse_json((char *)json, strlen(json), nvl,
        NVJSON_FORCE_INTEGER);
    if (ret != 0) {
        fatal(ERR_PARSE_JSON, "failed to parse JSON(%s): %s\n", key, json);
    }
    ret = nvlist_lookup_uint32(*nvl, "length", len);
    if (ret != 0) {
        fatal(ERR_UNEXPECTED, "nvl missing 'length' for %s\n", key);
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

    user = (char *) mdataGet("docker:user");
    if (user == NULL) {
        /* default to root */
        user = "0";
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
}

void
setupWorkdir()
{
    int ret;
    char *workdir;

    workdir = (char *) mdataGet("docker:workdir");
    if (workdir != NULL && pwd != NULL) {
        /* support ~/foo */
        if (workdir[0] == '~') {
            if (asprintf(&workdir, "%s%s", pwd->pw_dir, workdir + 1) == -1) {
                fatal(ERR_UNEXPECTED, "asprintf('workdir') failed: %s\n",
                    strerror(errno));
            }
        }
    } else {
        workdir = "/";
    }

    dlog("WORKDIR '%s'\n", workdir);
    ret = chdir(workdir);
    if (ret != 0) {
        fatal(ERR_CHDIR, "chdir() failed: %s\n", strerror(errno));
    }
}
