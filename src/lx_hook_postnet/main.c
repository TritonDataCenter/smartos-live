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
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * This program acts as a post-networking hook for lxinit on SmartOS.
 *
 * It assumes:
 *
 *  - this is an LX zone and networking is setup successfully
 *  - messages written to stdout will eventually go to the console
 *  - that if it exits non-zero the zone will not continue to boot
 *
 * It reads control parameters from the metadata service and then attempts to:
 *
 *   - mount any NFS Volumes that may have been found in sdc:volumes
 *
 * It will write an error message to stdout (should be the console when being
 * run from lxinit) when there's an error in which case it will also exit
 * non-zero.
 *
 */

#include <err.h>
#include <errno.h>
#include <libgen.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <unistd.h>
#include <zone.h>

#include <sys/stat.h>
#include <sys/mount.h>
#include <sys/wait.h>

#include <libnvpair.h>

#include <json-nvlist/json-nvlist.h>
#include <mdata-client/common.h>
#include <mdata-client/dynstr.h>
#include <mdata-client/plat.h>
#include <mdata-client/proto.h>
#include "../dockerinit/src/docker-common.h"

#define NFS_MOUNT "/usr/lib/fs/nfs/mount"
#define SDC_VOLUMES_KEY "sdc:volumes"

/* global metadata client bits */
int initialized_proto = 0;
mdata_proto_t *mdp;
FILE *log_stream = stderr; // lxinit attaches our stderr to /dev/console

/* not actually used, but needed for docker-common.c */
char *hostname = NULL;
struct passwd *pwd = NULL;
struct group *grp = NULL;


void
makePath(const char *base, char *out, size_t outsz)
{
    const char *zroot = zone_get_nroot();

    (void) snprintf(out, outsz, "%s%s", zroot != NULL ? zroot : "", base);
}

static void
doNfsMount(const char *nfsvolume, const char *mountpoint, const char *mode)
{
    pid_t pid;
    pid_t waitee;
    int status;
    int ret;
    char opts[MAX_MNTOPT_STR];

    if (strlcpy(opts, "vers=3,sec=sys,", sizeof (opts)) >= sizeof (opts)) {
        /* too long (something's busted. ERR_UNEXPECTED so we get a core) */
        fatal(ERR_UNEXPECTED,
            "internal error: strlcpy() opts not long enough");
    }
    if (strlcat(opts, mode, sizeof (opts)) >= sizeof (opts)) {
        /* too long (something's busted. ERR_UNEXPECTED so we get a core) */
        fatal(ERR_UNEXPECTED,
            "internal error: strlcat() opts not long enough");
    }

    /* ensure the directory exists */
    ret = mkdir(mountpoint, 0755);
    if (ret == -1 && errno != EEXIST) {
        fatal(ERR_MKDIR, "failed to mkdir(%s): (%d) %s\n", mountpoint,
            errno, strerror(errno));
    }

    /* do the mount */

    if ((pid = fork()) == -1) {
        fatal(ERR_FORK_FAILED, "fork() failed: %s\n", strerror(errno));
    }

    if (pid == 0) {
        /* child */
        char cmd[MAXPATHLEN];
        char *const argv[] = {
            "mount",
            "-o",
            opts,
            (char *)nfsvolume,
            (char *)mountpoint,
            NULL
        };

        makePath(NFS_MOUNT, cmd, sizeof (cmd));

        execv(cmd, argv);
        fatal(ERR_EXEC_FAILED, "execv(%s) failed: %s\n", cmd, strerror(errno));
    }

    /* parent */

    while ((waitee = waitpid(pid, &status, 0)) != pid) {
        if (waitee == -1 && errno != EINTR) {
            fatal(ERR_EXEC_FAILED, "failed to get exit status of %d: %s",
                (int) pid, strerror(errno));
        }
    }

    if (WIFEXITED(status)) {
        if (WEXITSTATUS(status) != 0) {
            fatal(ERR_MOUNT_NFS_VOLUME, "mount[%d] exited non-zero (%d)\n",
                (int)pid, WEXITSTATUS(status));
        }
    } else if (WIFSIGNALED(status)) {
        fatal(ERR_EXEC_FAILED, "mount[%d] died on signal: %d\n",
            (int)pid, WTERMSIG(status));
    } else {
        fatal(ERR_EXEC_FAILED, "mount[%d] failed in unknown way\n",
            (int)pid);
    }
}

static void
mountNfsVolume(nvlist_t *data)
{
    char *mode = NULL;
    char *mountpoint = NULL;
    char *nfsvolume = NULL;
    int ret;
    char *type = NULL;

    ret = nvlist_lookup_string(data, "type", &type);
    if (ret == 0) {
        if (strcmp(type, "tritonnfs") != 0) {
            fatal(ERR_UNKNOWN_VOLUME_TYPE, "invalid volume type %s", type);
        }
        ret = nvlist_lookup_string(data, "nfsvolume", &nfsvolume);
        if (ret == 0) {
            ret = nvlist_lookup_string(data, "mountpoint", &mountpoint);
            if (ret == 0) {
                ret = nvlist_lookup_string(data, "mode", &mode);
                if (ret != 0) {
                    mode = "rw";
                }
                doNfsMount(nfsvolume, mountpoint, mode);
                return;
            }
        }
    }

    fatal(ERR_INVALID_NFS_VOLUMES, "invalid nfsvolumes");
}

static void
mountNfsVolumes()
{
    char *json;
    nvlist_t *data;
    nvlist_t *nvl;
    nvpair_t *pair;
    data_type_t pair_type;
    char *pair_name;
    int r;

    if ((json = mdataGet(SDC_VOLUMES_KEY)) == NULL) {
        /*
         * No volumes, nothing to mount.
         */
        return;
    }

    r = nvlist_parse_json(json, strlen(json), &nvl, NVJSON_FORCE_INTEGER, NULL);
    if (r != 0) {
        fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
            " for %s: %s\n", SDC_VOLUMES_KEY, strerror(errno));
    }
    free(json);

    for (pair = nvlist_next_nvpair(nvl, NULL); pair != NULL;
        pair = nvlist_next_nvpair(nvl, pair)) {

        pair_name = nvpair_name(pair);
        pair_type = nvpair_type(pair);

        if (pair_type == DATA_TYPE_NVLIST) {
            if (nvpair_value_nvlist(pair, &data) != 0) {
                fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
                    " for NFS volume: %s\n", strerror(errno));
            }
            mountNfsVolume(data);
        } else if (strcmp(pair_name, ".__json_array") != 0 &&
            strcmp(pair_name, "length") != 0) {

            /*
             * If it's anything other than the "decoration" that json-nvlist
             * adds, we don't know what to do with it so we will die with an
             * ERR_UNEXPECTED which will cause an abort so we'll get a core.
             */
            fatal(ERR_UNEXPECTED,
                "internal error: unexpected nvpair (name: %s, type: %d)",
                pair_name, (int) pair_type);
        }
    }

    nvlist_free(nvl);
}

int
main(int argc, char *argv[])
{
    mountNfsVolumes();
    return (EXIT_SUCCESS);
}
