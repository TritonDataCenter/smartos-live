/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * This program serves as 'init' for a docker zone when running on SmartOS.
 *
 * It reads control parameters from the metadata service and then attempts to:
 *
 *  - mount /proc
 *  - setup networking
 *  - switch users/groups (based on docker:user)
 *  - setup environment
 *  - setup cmdline
 *  - exec requested cmd
 *
 * If successful, the zone's cmd will replace this process as init for the zone
 * after exec. If any error is encountered, this will exit non-zero and the zone
 * should fail to start.
 *
 * A log is also written to /var/log/sdc-dockerinit.log in order to debug
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
#include "../mdata-client/common.h"
#include "../mdata-client/dynstr.h"
#include "../mdata-client/plat.h"
#include "../mdata-client/proto.h"

#define DEFAULT_TERM "TERM=xterm"
#define IPMGMTD_DOOR_OS "/etc/svc/volatile/ipadm/ipmgmt_door"
#define IPMGMTD_DOOR_LX "/native/etc/svc/volatile/ipadm/ipmgmt_door"
#define LOGFILE "/var/log/sdc-dockerinit.log"
#define RTMBUFSZ sizeof (struct rt_msghdr) + (3 * sizeof (struct sockaddr_in))

typedef enum {
    ARRAY_CMD,
    ARRAY_ENTRYPOINT,
    ARRAY_ENV
} array_type_t;

typedef enum {
    ERR_UNEXPECTED = 1, /* special case, in this case we abort() */
    ERR_CHDIR,
    ERR_EXEC_FAILED,
    ERR_FORK_FAILED,
    ERR_GID_NAN,
    ERR_INITGROUPS,
    ERR_INVALID_BRAND,
    ERR_MDATA_FAIL,
    ERR_MDATA_INIT,
    ERR_MISSING_LEN,
    ERR_MOUNT_LXPROC,
    ERR_NO_BRAND,
    ERR_NO_COMMAND,
    ERR_NO_GROUP,
    ERR_NO_PATH,
    ERR_NO_USER,
    ERR_NOT_FOUND,
    ERR_OPEN,
    ERR_OPEN_CONSOLE,
    ERR_PARSE_JSON,
    ERR_PARSE_NVPAIR_STRING,
    ERR_RENAME_FAILED,
    ERR_SETGID,
    ERR_SETUID,
    ERR_STAT_CMD,
    ERR_STAT_DIR,
    ERR_STAT_EXEC,
    ERR_STRDUP,
    ERR_UID_NAN,
    ERR_WRITE_MTAB,
    ERR_IPADM_DOOR,
    ERR_PLUMB_IF,
    ERR_RAISE_IF,
    ERR_CHROOT_FAILED,
    ERR_CHILD_NET,
    ERR_DOOR_INFO,
    ERR_IPMGMTD_EXIT,
    ERR_IPMGMTD_DIED,
    ERR_IPMGMTD_CRASHED,
    ERR_MOUNT_DEVFD
} dockerinit_err_t;

typedef enum {
    LX = 0,
    JOYENT_MINIMAL = 1
} brand_t;

void addValues(char **array, int *idx, array_type_t type, nvlist_t *nvl);
void buildCmdEnv();
void buildCmdline();
void execCmdline();
void getBrand();
void getMdataArray(char *key, nvlist_t **nvl, uint32_t *len);
void fatal(dockerinit_err_t code, char *fmt, ...);
void getUserGroupData();
void dlog(const char *fmt, ...);
void killIpmgmtd();
const char *mdataGet(const char *keyname);
void mountLXProc();
void mountOSDevFD();
void runIpmgmtd(char *cmdline[], char *env[]);
void setupInterface(nvlist_t *data);
void setupInterfaces();
void setupWorkdir();
void openIpadmHandle();
void closeIpadmHandle();
void plumbIf(const char *);
int raiseIf(char *, char *, char *);
int addRoute(const char *, const char *, const char *);

/* global metadata client bits */
int initialized_proto = 0;
mdata_proto_t *mdp;

/* global data */
brand_t brand;
char **cmdline;
char **env;
char fallback[] = "1970-01-01T00:00:00.000Z";
ipadm_handle_t iph;
char *ipmgmtd_door;
char *path = NULL;
struct passwd *pwd;
struct group *grp;
char timestamp[32];

const char *ROUTE_ADDR_MSG =
    "WARN addRoute: invalid %s address \"%s\" for %s: %s\n";
const char *ROUTE_WRITE_ERR_MSG =
    "WARN addRoute: socket write error "
    "(if=\"%s\", gw=\"%s\", dst=\"%s\": %s)\n";
const char *ROUTE_WRITE_LEN_MSG =
    "WARN addRoute: wrote %d/%d to socket "
    "(if=\"%s\", gw=\"%s\", dst=\"%s\": %s)\n";

/*
 * Special variables for a special ipmgmtd
 */
char *IPMGMTD_CMD_LX[] = {"/native/lib/inet/ipmgmtd", "ipmgmtd", NULL};
char *IPMGMTD_ENV_LX[] = {
    /* ipmgmtd thinks SMF is awesome */
    "SMF_FMRI=svc:/network/ip-interface-management:default",
    /*
     * Need to perform some tricks because ipmgmtd is going to mount
     * things in /etc/svc/volatile and setup a door there as well.
     * If we don't use thunk, we'll end up using the LX's /etc/svc
     * but other native commands (such as ifconfig-native) will try
     * to use /native/etc/svc/volatile.
     */
    "LD_NOENVIRON=1",
    "LD_NOCONFIG=1",
    "LD_LIBRARY_PATH_32=/native/lib:/native/usr/lib",
    "LD_PRELOAD_32=/native/usr/lib/brand/lx/lx_thunk.so.1",
    NULL
};
char *IPMGMTD_CMD_OS[] = {"/lib/inet/ipmgmtd", "ipmgmtd", NULL};
char *IPMGMTD_ENV_OS[] = {
    /* ipmgmtd thinks SMF is awesome */
    "SMF_FMRI=svc:/network/ip-interface-management:default",
    NULL
};


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

     (void) fprintf(stderr, "%s FATAL (code: %d): ", getTimestamp(), (int)code);
     (void) vfprintf(stderr, fmt, ap);
     fflush(stderr);
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
     (void) fprintf(stderr, "%s ", getTimestamp());
     (void) vfprintf(stderr, fmt, ap);
     fflush(stderr);
     va_end(ap);
}

void
runIpmgmtd(char *cmd[], char *env[])
{
    pid_t pid;
    int status;

    pid = fork();
    if (pid == -1) {
        fatal(ERR_FORK_FAILED, "fork() failed: %s\n", strerror(errno));
    }

    if (pid == 0) {
        /* child */
        execve(cmd[0], cmd + 1, env);
        fatal(ERR_EXEC_FAILED, "execve(%s) failed: %s\n", cmd[0],
            strerror(errno));
    }

    /* parent */

    dlog("INFO started ipmgmtd[%d]\n", (int)pid);

    while (wait(&status) != pid) {
        /* EMPTY */;
    }

    if (WIFEXITED(status)) {
        dlog("INFO ipmgmtd[%d] exited: %d\n", (int)pid, WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        fatal(ERR_IPMGMTD_DIED, "ipmgmtd[%d] died on signal: %d\n",
            (int)pid, WTERMSIG(status));
    } else {
        fatal(ERR_IPMGMTD_CRASHED, "ipmgmtd[%d] failed in unknown way\n",
            (int)pid);
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
execCmdline()
{
    int console;
    char *execname;

    dlog("DROP PRIVS\n");

    if (setgid(grp->gr_gid) != 0) {
        fatal(ERR_SETGID, "setgid(%d): %s\n", grp->gr_gid, strerror(errno));
    }
    if (initgroups(pwd->pw_name, grp->gr_gid) != 0) {
        fatal(ERR_INITGROUPS, "initgroups(%s,%d): %s\n", pwd->pw_name,
            grp->gr_gid, strerror(errno));
    }
    if (setuid(pwd->pw_uid) != 0) {
        fatal(ERR_SETUID, "setuid(%d): %s\n", pwd->pw_uid, strerror(errno));
    }

    execname = execName(cmdline[0]);

    dlog("SWITCHING TO /dev/console\n");

    close(0);
    close(1);
    close(2);

    console = open("/dev/console", O_RDWR);
    if (console == -1) {
        fatal(ERR_OPEN_CONSOLE, "failed to open /dev/console: %s\n",
            strerror(errno));
    }

    if (dup2(console, 0) == -1) {
        fatal(ERR_UNEXPECTED, "failed to dup2(console, 0): %s\n",
            strerror(errno));
    }
    if (dup2(console, 1) == -1) {
        fatal(ERR_UNEXPECTED, "failed to dup2(console, 1): %s\n",
            strerror(errno));
    }
    if (dup2(console, 2) == -1) {
        fatal(ERR_UNEXPECTED, "failed to dup2(console, 2): %s\n",
            strerror(errno));
    }

    execve(execname, cmdline, env);

    fatal(ERR_EXEC_FAILED, "execve(%s) failed: %s\n", cmdline[0],
        strerror(errno));
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
setupInterface(nvlist_t *data)
{
    char *iface, *gateway, *netmask, *ip;
    boolean_t primary;
    int ret;

    ret = nvlist_lookup_string(data, "interface", &iface);
    if (ret == 0) {
        plumbIf(iface);

        ret = nvlist_lookup_string(data, "ip", &ip);
        if (ret == 0) {
            ret = nvlist_lookup_string(data, "netmask", &netmask);
            if (ret == 0) {
                if (raiseIf(iface, ip, netmask) != 0) {
                    fatal(ERR_RAISE_IF, "Error bringing up interface %s",
                        iface);
                }
            }
            ret = nvlist_lookup_boolean_value(data, "primary", &primary);
            if ((ret == 0) && (primary == B_TRUE)) {
                ret = nvlist_lookup_string(data, "gateway", &gateway);
                if (ret == 0) {
                    (void) addRoute(iface, gateway, "0.0.0.0");
                }
            }
        }
    }
}

void
setupInterfaces()
{
    const char *json;
    int ret;
    nvlist_t *data, *nvl;
    nvpair_t *pair;

    json = mdataGet("sdc:nics");
    if (json == NULL) {
        dlog("WARN no NICs found in sdc:nics\n");
        return;
    }

    ret = nvlist_parse_json((char *)json, strlen(json), &nvl,
        NVJSON_FORCE_INTEGER);
    if (ret != 0) {
        fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
            " for sdc:nics, code: %d\n", ret);
    }

    for (pair = nvlist_next_nvpair(nvl, NULL); pair != NULL;
        pair = nvlist_next_nvpair(nvl, pair)) {

        if (nvpair_type(pair) == DATA_TYPE_NVLIST) {
            ret = nvpair_value_nvlist(pair, &data);
            if (ret != 0) {
                fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
                    " for NIC code: %d\n", ret);
            }
            setupInterface(data);
        }
    }

    nvlist_free(nvl);
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
mountLXProc()
{
    dlog("MOUNT /proc (lxproc)\n");

    if (mount("lxproc", "/proc", MS_DATA, "lxproc", NULL, 0) != 0) {
        fatal(ERR_MOUNT_LXPROC, "failed to mount /proc: %s\n", strerror(errno));
    }
}

void
mountOSDevFD()
{
    dlog("MOUNT /dev/fd (fd)\n");

    if (mount("fd", "/dev/fd", MS_DATA, "fd", NULL, 0) != 0) {
        fatal(ERR_MOUNT_DEVFD, "failed to mount /dev/fd: %s\n", strerror(errno));
    }
}

void
addValues(char **array, int *idx, array_type_t type, nvlist_t *nvl)
{
    nvpair_t *pair;
    char *field, *printf_fmt;
    char *home;
    int home_len;
    int found_home = 0;
    int found_term = 0;
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
        array[(*idx)++] = home;
        dlog("ENV[%d] %s\n", (*idx) - 1, home);
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
        dlog("ENV[%d] %s\n", (*idx) - 1, home);
    }
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

void
buildCmdline()
{
    int idx;
    uint32_t cmd_len, entrypoint_len;
    nvlist_t *nvlc, *nvle;

    getMdataArray("docker:cmd", &nvlc, &cmd_len);
    getMdataArray("docker:entrypoint", &nvle, &entrypoint_len);

    if ((entrypoint_len + cmd_len) < 1) {
        /*
         * No ENTRYPOINT or CMD, docker prevents this at the API but if
         * something somehow gets in this state, it's an error.
         */
        fatal(ERR_NO_COMMAND, "No command specified\n");
    }

    cmdline = malloc((sizeof (char *)) * (entrypoint_len + cmd_len + 1));
    if (cmdline == NULL) {
        fatal(ERR_UNEXPECTED, "malloc() failed for cmdline[%d]: %s\n",
            (entrypoint_len + cmd_len + 1), strerror(errno));
    }

    /*
     * idx will be used for keeping track of where we are in cmdline. It
     * should point to the next writable index.
     */
    idx = 0;
    addValues(cmdline, &idx, ARRAY_ENTRYPOINT, nvle);
    addValues(cmdline, &idx, ARRAY_CMD, nvlc);
    /* cap it off with a NULL */
    cmdline[idx] = NULL;

    /*
     * NOTE: we don't nvlist_free(nvlc,nvle); here because we need this memory
     * for execve().
     */
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
    } else {
        fatal(ERR_NO_USER, "failed to find user passwd structure\n");
    }

    if (grp == NULL) {
        grp = getgrgid(pwd->pw_gid);
    }

    if (grp != NULL) {
        dlog("INFO group.gr_name: %s\n", grp->gr_name);
        dlog("INFO group.gr_gid: %u\n", grp->gr_gid);
    } else {
        fatal(ERR_NO_GROUP, "failed to find group structure\n");
    }
}

void
setupWorkdir()
{
    int ret;
    char *workdir;

    workdir = (char *) mdataGet("docker:workdir");
    if (workdir != NULL) {
        /* support ~/foo */
        if (workdir[0] == '~') {
            if (asprintf(&workdir, "%s%s", pwd->pw_dir, workdir + 1) == -1) {
                fatal(ERR_UNEXPECTED, "asprintf('workdir') failed: %s\n",
                    strerror(errno));
            }
        }
    } else {
        workdir = pwd->pw_dir;
    }

    dlog("WORKDIR '%s'\n", workdir);
    ret = chdir(workdir);
    if (ret != 0) {
        fatal(ERR_CHDIR, "chdir() failed: %s\n", strerror(errno));
    }
}

void
getBrand()
{
    const char *data;

    data = mdataGet("sdc:brand");
    if (data == NULL) {
        fatal(ERR_NO_BRAND, "failed to determine brand\n");
    }

    if (strcmp("lx", data) == 0) {
        brand = LX;
    } else if (strcmp("joyent-minimal", data) == 0) {
        brand = JOYENT_MINIMAL;
    } else {
        fatal(ERR_INVALID_BRAND, "invalid brand: %s\n", data);
    }
}

void
setupMtab()
{
    FILE *fp;
    struct stat statbuf;
    int write_mtab = 0;

    /*
     * Some images (such as busybox) link /etc/mtab to /proc/mounts so we only
     * write out /etc/mtab if it doesn't exist or is a regular file.
     */
    dlog("CHECK /etc/mtab\n");
    if (lstat("/etc/mtab", &statbuf) == -1) {
        if (errno == ENOENT) {
            write_mtab = 1;
        } else {
            /*
             * This is not fatal because it's possible for an image to have
             * messed things up so we can't touch /etc/mtab, that will only
             * screw itself.
             */
            dlog("ERROR stat /etc/mtab: %s\n", strerror(errno));
        }
    } else {
        if (S_ISREG(statbuf.st_mode)) {
            write_mtab = 1;
        }
    }

    if (write_mtab) {
        dlog("WRITE /etc/mtab\n");
        fp = fopen("/etc/mtab", "w");
        if (fp == NULL) {
            fatal(ERR_WRITE_MTAB, "failed to write /etc/mtab: %s\n",
                strerror(errno));
        }
        if (fprintf(fp,
            "/ / zfs rw 0 0\nproc /proc proc rw,noexec,nosuid,nodev 0 0\n")
            < 0) {

            /* just log because we don't want zone boot failing on this */
            dlog("ERROR failed to fprintf() mtab line: %s\n", strerror(errno));
        }
        if (fclose(fp) == EOF) {
            /* just log because we don't want zone boot failing on this */
            dlog("ERROR failed to fclose() mtab file: %s\n", strerror(errno));
        }
    }
}

void
openIpadmHandle()
{
    ipadm_status_t status;

    if ((status = ipadm_open(&iph, IPH_LEGACY)) != IPADM_SUCCESS) {
        fatal(ERR_IPADM_DOOR, "Error opening ipadm handle: %s\n",
            ipadm_status2str(status));
    }

}

/*
 * If 'docker:noipmgmtd' is set to 'true' in the internal_metadata, we'll
 * kill ipmgmtd after we've setup the interfaces. Networking continues to
 * work but tools like 'ifconfig' will no longer work.
 *
 * Since this functionality is considered optional, it should avoid calling
 * fatal().
 */
void
killIpmgmtd()
{
    int door_fd;
    struct door_info info;
    pid_t ipmgmtd_pid;
    char *should_kill;

    should_kill = (char *) mdataGet("docker:noipmgmtd");
    if ((should_kill == NULL) || (strncmp(should_kill, "true", 4) != 0)) {
        /* kill not requested */
        return;
    }

    /* find the ipmgmtd pid through the door */
    if ((door_fd = open(ipmgmtd_door, O_RDONLY)) < 0) {
        dlog("ERROR (skipping kill) failed to open ipmgmtd door(%s): %s\n",
            ipmgmtd_door, strerror(errno));
        return;
    }
    if (door_info(door_fd, &info) != 0) {
        dlog("ERROR (skipping kill) failed to load info from door: %s\n",
            strerror(errno));
        return;
    }

    ipmgmtd_pid = info.di_target;
    dlog("INFO ipmgmtd PID is %d\n", ipmgmtd_pid);

    (void) close(door_fd);

    if (ipmgmtd_pid > 0 && ipmgmtd_pid != getpid()) {
        if (kill(ipmgmtd_pid, SIGTERM) != 0) {
            dlog("ERROR failed to kill ipmgmtd[%d]: %s\n", ipmgmtd_pid,
                strerror(errno));
        } else {
            dlog("KILLED ipmgmtd[%d]\n", ipmgmtd_pid);
        }
    }
}

void
closeIpadmHandle()
{
    if (iph) {
        ipadm_close(iph);
    }
}

void
plumbIf(const char *ifname)
{
    ipadm_status_t status;
    char ifbuf[LIFNAMSIZ];

    dlog("PLUMB %s\n", ifname);

    /* ipadm_create_if stomps on ifbuf, so create a copy: */
    (void) strncpy(ifbuf, ifname, sizeof (ifbuf));

    if ((status = ipadm_create_if(iph, ifbuf, AF_INET, IPADM_OPT_ACTIVE))
        != IPADM_SUCCESS) {
        fatal(ERR_PLUMB_IF, "ipadm_create_if error %d: plumbing %s: %s\n",
            status, ifname, ipadm_status2str(status));
    }
}

int
raiseIf(char *ifname, char *addr, char *netmask)
{
    ipadm_status_t status;
    ipadm_addrobj_t  ipaddr;
    char cidraddr[BUFSIZ];
    int prefixlen;
    struct sockaddr_in mask_sin;

    dlog("RAISE[%s] addr=%s, netmask=%s\n", ifname, addr, netmask);

    mask_sin.sin_family = AF_INET;
    if (inet_pton(AF_INET, netmask, &mask_sin.sin_addr) != 1) {
        dlog("WARN raiseIf: invalid netmask address: %s\n", strerror(errno));
        return (-1);
    }

    prefixlen = mask2plen((struct sockaddr *)&mask_sin);
    (void) snprintf(cidraddr, sizeof (cidraddr), "%s/%d",
            addr, prefixlen);

    if ((status = ipadm_create_addrobj(IPADM_ADDR_STATIC, ifname, &ipaddr))
        != IPADM_SUCCESS) {
        dlog("WARN ipadm_create_addrobj error %d: addr %s (%s), "
            "interface %s: %s\n", status, addr, cidraddr, ifname,
            ipadm_status2str(status));
        return (-2);
    }

    if ((status = ipadm_set_addr(ipaddr, cidraddr, AF_INET))
        != IPADM_SUCCESS) {
        dlog("WARN ipadm_set_addr error %d: addr %s (%s), interface %s: %s\n",
            status, addr, cidraddr, ifname, ipadm_status2str(status));
        return (-3);
    }

    if ((status = ipadm_create_addr(iph, ipaddr,
        IPADM_OPT_ACTIVE | IPADM_OPT_UP)) != IPADM_SUCCESS) {
        dlog("WARN ipadm_create_addr error for %s: %s\n", ifname,
            ipadm_status2str(status));
        ipadm_destroy_addrobj(ipaddr);
        return (-4);
    }

    ipadm_destroy_addrobj(ipaddr);
    return (0);
}

int
addRoute(const char *ifname, const char *gw, const char *dst)
{
    int idx;
    int len;
    char rtbuf[RTMBUFSZ];
    struct rt_msghdr *rtm = (struct rt_msghdr *)rtbuf;
    int sockfd;
    struct sockaddr_in *dst_sin = (struct sockaddr_in *)
        (rtbuf + sizeof (struct rt_msghdr));
    struct sockaddr_in *gw_sin = (struct sockaddr_in *) (dst_sin + 1);
    struct sockaddr_in *netmask_sin = (struct sockaddr_in *) (gw_sin + 1);

    dlog("ROUTE[%s] gw=%s, dst=%s\n", ifname, gw, dst);

    (void) bzero(rtm, RTMBUFSZ);
    rtm->rtm_addrs = RTA_DST | RTA_GATEWAY | RTA_NETMASK;
    rtm->rtm_flags = RTF_UP | RTF_STATIC | RTF_GATEWAY;
    rtm->rtm_msglen = sizeof (rtbuf);
    rtm->rtm_pid = getpid();
    rtm->rtm_type = RTM_ADD;
    rtm->rtm_version = RTM_VERSION;

    dst_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, dst, &(dst_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "destination", dst, ifname, strerror(errno));
        return (-1);
    }

    dst_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, gw, &(gw_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "gateway", gw, ifname, strerror(errno));
        return (-2);
    }

    netmask_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, "0.0.0.0", &(netmask_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "netmask", "0.0.0.0", ifname, strerror(errno));
        return (-3);
    }

    if ((idx = if_nametoindex(ifname)) == 0) {
        dlog("WARN addRoute: error getting interface index for %s: %s\n",
            ifname, strerror(errno));
        return (-4);
    }

    rtm->rtm_index = idx;

    if ((sockfd = socket(PF_ROUTE, SOCK_RAW, AF_INET)) < 0) {
        dlog("WARN addRoute: error opening socket: %s\n", strerror(errno));
        return (-5);
    }

    if ((len = write(sockfd, rtbuf, rtm->rtm_msglen)) < 0) {
        dlog(ROUTE_WRITE_ERR_MSG, ifname, gw, dst, strerror(errno));
        close(sockfd);
        return (-6);
    }

    if (len < rtm->rtm_msglen) {
        dlog(ROUTE_WRITE_LEN_MSG, len, rtm->rtm_msglen, ifname, gw, dst,
            strerror(errno));
        close(sockfd);
        return (-7);
    }

    close(sockfd);
    return (0);
}

void
setupNetworking()
{
    openIpadmHandle();

    plumbIf("lo0");
    (void) raiseIf("lo0", "127.0.0.1", "255.0.0.0");

    setupInterfaces();
    closeIpadmHandle();
}

/*
 * Fork a child and run all networking-related commands in a chroot to /native.
 * This is for two reasons:
 *
 * 1) ipadm_door_call() looks for a door in /etc/, but ipmgmtd in this zone is
 *    running in native (non-LX) mode, so it opens its door in /native/etc.
 * 2) ipadm_set_addr() calls getaddrinfo(), which relies on the existence of
 *    /etc/netconfig. This file is present in /native/etc instead.
 */
void
chrootNetworking() {
    pid_t pid;
    int status;

    dlog("INFO forking child for networking chroot\n");

    pid = fork();
    if (pid == -1) {
        fatal(ERR_FORK_FAILED, "networking fork() failed: %s\n",
            strerror(errno));
    }

    if (pid == 0) {
        /* child */

        if (chroot("/native") != 0) {
            fatal(ERR_CHROOT_FAILED, "chroot() failed: %s\n", strerror(errno));
        }

        setupNetworking();

        exit(0);
    } else {
        /* parent */
        dlog("<%d> Network setup child\n", (int)pid);

        while (wait(&status) != pid) {
            /* EMPTY */;
        }

        if (WIFEXITED(status)) {
            if (WEXITSTATUS(status) != 0) {
                fatal(ERR_CHILD_NET, "<%d> Networking child exited: %d\n",
                    (int)pid, WEXITSTATUS(status));
            }

            dlog("<%d> Networking child exited: %d\n",
                (int)pid, WEXITSTATUS(status));

        } else if (WIFSIGNALED(status)) {
            fatal(ERR_CHILD_NET, "<%d> Networking child died on signal: %d\n",
                (int)pid, WTERMSIG(status));
        } else {
            fatal(ERR_CHILD_NET,
                "<%d> Networking child failed in unknown way\n", (int)pid);
        }
    }
}

int
main(int __attribute__((unused)) argc, char __attribute__((unused)) *argv[])
{
    int fd;
    int ret;
    char **ipmgmtd_cmd;
    char **ipmgmtd_env;

    /* we'll write our log in /var/log */
    mkdir("/var", 0755);
    mkdir("/var/log", 0755);

    fd = open(LOGFILE, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd == -1) {
        fatal(ERR_OPEN, "failed to open log file: %s\n", strerror(errno));
    }

    if (dup2(fd, 1) == -1) {
        fatal(ERR_UNEXPECTED, "failed to dup2: %s\n", strerror(errno));
    }
    if (dup2(fd, 2) == -1) {
        fatal(ERR_UNEXPECTED, "failed to dup2: %s\n", strerror(errno));
    }

    getBrand();

    switch (brand) {
        case LX:
            mountLXProc();
            ipmgmtd_cmd = IPMGMTD_CMD_LX;
            ipmgmtd_env = IPMGMTD_ENV_LX;
            ipmgmtd_door = IPMGMTD_DOOR_LX;
            setupMtab();
            break;
        case JOYENT_MINIMAL:
            /*
             * joyent-minimal brand mounts /proc for us so we don't need to,
             * but without /proc being lxproc, we need to mount /dev/fd
             */
            mountOSDevFD();
            ipmgmtd_cmd = IPMGMTD_CMD_OS;
            ipmgmtd_env = IPMGMTD_ENV_OS;
            ipmgmtd_door = IPMGMTD_DOOR_OS;
            /* no need for /etc/mtab updates here either */
            break;
        default:
            fatal(ERR_UNEXPECTED, "unsupported brand after getBrand()\n");
            break;
    }

    dlog("INFO setting up networking\n");

    mkdir("/var/run", 0755);
    mkdir("/var/run/network", 0755);

    /* NOTE: will call fatal() if there's a problem */
    runIpmgmtd(ipmgmtd_cmd, ipmgmtd_env);

    if (brand == LX) {
        chrootNetworking();
    } else {
        setupNetworking();
    }

    /* kill ipmgmtd if we don't need it any more */
    killIpmgmtd();

    dlog("INFO network setup complete\n");

    /* NOTE: all of these will call fatal() if there's a problem */
    getUserGroupData();
    setupWorkdir();
    buildCmdEnv();
    buildCmdline();

    /* cleanup mess from mdata-client */
    close(3); /* /dev/urandom from mdata-client */
    close(4); /* event port from mdata-client */
    close(5); /* /native/.zonecontrol/metadata.sock from mdata-client */
    /* TODO: ensure we cleaned up everything else mdata created for us */

    /* This tells vmadm that provisioning is complete. */
    ret = rename("/var/svc/provisioning", "/var/svc/provision_success");
    if ((ret != 0) && (errno == ENOENT)) {
        dlog("INFO not renaming /var/svc/provisioning: already gone.\n");
    } else if (ret != 0) {
        fatal(ERR_RENAME_FAILED, "failed to rename /var/svc/provisioning: %s\n",
            strerror(errno));
    }

    execCmdline();

    /* NOTREACHED */
    abort();
}
