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

#ifndef DOCKER_COMMON_H
#define DOCKER_COMMON_H

#include <libnvpair.h>
#include <libcmdutils.h>
#include "../json-nvlist/json-nvlist.h"
#include "strlist.h"

#define DEFAULT_PATH "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin" \
    ":/sbin:/bin"
#define DEFAULT_TERM "xterm"

typedef enum {
    ARRAY_CMD,
    ARRAY_ENTRYPOINT,
    ARRAY_ENV,
    ARRAY_LINK_ENV
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
    ERR_UP_IP6,
    ERR_CHILD_NET,
    ERR_DOOR_INFO,
    ERR_IPMGMTD_EXIT,
    ERR_IPMGMTD_DIED,
    ERR_IPMGMTD_CRASHED,
    ERR_MOUNT_DEVFD,
    ERR_FDOPEN_LOG,
    ERR_CLOSE,
    ERR_ATTACH_NOT_TIMESTAMP,
    ERR_ATTACH_GETTIME,
    ERR_ATTACH_TIMEDOUT,
    ERR_MDATA_TOO_OLD,
    ERR_UNLINK_MTAB,
    ERR_NO_MEMORY,
    ERR_MKDIR,
    ERR_UNKNOWN_LOG_DRIVER,
    ERR_OPEN_ZFD,
    ERR_STAT_ZFD,
    ERR_IOCTL_ZFD,
    ERR_DUP2,
    ERR_CONTRACT
} dockerinit_err_t;

typedef enum {
    BRAND_LX = 0,
    BRAND_JOYENT_MINIMAL = 1
} brand_t;

void addValues(char **array, int *idx, array_type_t type, nvlist_t *nvl);
int buildCmdEnv(strlist_t *);
int buildCmdline(strlist_t *);
void dlog(const char *fmt, ...);
custr_t *execName(const char *cmd, strlist_t *, const char *);
void fatal(dockerinit_err_t code, char *fmt, ...);
void getMdataArray(const char *key, nvlist_t **nvl, uint32_t *len);
char *getTimestamp();
void getUserGroupData();
void mdataDelete(const char *keyname);
char *mdataGet(const char *);
void mdataPut(const char *keyname, const char *value);
void setupWorkdir();

#endif /* DOCKER_COMMON_H */
