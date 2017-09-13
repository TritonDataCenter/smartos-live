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
 * This program forms a private interface between the LX brand in
 * illumos-joyent and the volume configuration information stored by vmadm(1M)
 * in SmartOS/SDC.
 *
 * When an LX branded zone boots, a special replacement for init(1M) is used,
 * viz.  "/usr/lib/brand/lx/lxinit".  This program is responsible for
 * configuring basic networking settings before starting the emulated Linux
 * "init".  Some of these settings are stored in the zone configuration, but
 * volumes are not; they are stored by vmadm(1M) in a form that requires
 * some processing at runtime.   The volume configuration is, thus, accessed
 * through the "sdc:volumes" metadata key from within the zone.
 *
 * This program, shipped as "/usr/lib/brand/lx/volumeinfo", is executed by
 * "lxinit" to discover the current volume configuration.
 */


#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <err.h>

#include <libnvpair.h>

#include <json-nvlist/json-nvlist.h>
#include <mdata-client/common.h>
#include <mdata-client/dynstr.h>
#include <mdata-client/plat.h>
#include <mdata-client/proto.h>

#define SDC_VOLUMES_KEY "sdc:volumes"

int
print_volumes(nvlist_t *nvl)
{
    uint32_t len;

    /*
     * The JSON stored in the volumes configuration is an array of
     * objects.  Walk that array:
     */
    if (nvlist_lookup_uint32(nvl, "length", &len) != 0) {
        fprintf(stderr, "ERROR: could not find \"length\" key\n");
        return (-1);
    }

    for (uint32_t i = 0; i < len; i++) {
        char idx[32];
        nvlist_t *volume;
        char *mode;
        char *mountpoint;
        char *name;
        char *nfsvolume;
        char *type;

        (void) snprintf(idx, sizeof (idx), "%u", i);

        if (nvlist_lookup_nvlist(nvl, idx, &volume) != 0) {
            fprintf(stderr, "ERROR: could not find volume[%s]\n", idx);
            return (-1);
        }

        if (nvlist_lookup_string(volume, "type", &type) != 0) {
            fprintf(stderr, "ERROR: volume[%s] missing type\n", idx);
            return (-1);
        }

        if (strncmp(type, "tritonnfs", 9) != 0) {
            fprintf(stderr, "ERROR: volume[%s] has unsupported type (%s)\n",
                idx, type);
            continue;
        }

        if (nvlist_lookup_string(volume, "mode", &mode) != 0) {
            fprintf(stderr, "ERROR: volume[%s] missing mode\n", mode);
            return (-1);
        }

        if (nvlist_lookup_string(volume, "mountpoint", &mountpoint) != 0) {
            fprintf(stderr, "ERROR: volume[%s] missing mountpoint\n", idx);
            return (-1);
        }

        if (nvlist_lookup_string(volume, "name", &name) != 0) {
            fprintf(stderr, "ERROR: volume[%s] missing name\n", idx);
            return (-1);
        }

        if (nvlist_lookup_string(volume, "nfsvolume", &nfsvolume) != 0) {
            fprintf(stderr, "ERROR: volume[%s] missing nfsvolume\n", idx);
            return (-1);
        }

        fprintf(stdout, "%s|%s|%s|%s|%s\n",
            type, nfsvolume, mountpoint, name, mode);
        fflush(stdout);
    }

    return (0);
}

int
main(int argc, char *argv[])
{
    nvlist_t *nvl = NULL;
    char *errmsg = NULL;
    mdata_proto_t *mdp;
    mdata_response_t mdr;
    string_t *data;
    nvlist_parse_json_error_t nje;

    if (proto_init(&mdp, &errmsg) != 0) {
        errx(EXIT_FAILURE, "could not initialise mdata: %s",
            errmsg == NULL ?  "?" : errmsg);
    }

    if (proto_execute(mdp, "GET", SDC_VOLUMES_KEY, &mdr, &data) != 0) {
        errx(EXIT_FAILURE, "could not get \"%s\" mdata",
            SDC_VOLUMES_KEY);
    }

    if (nvlist_parse_json(dynstr_cstr(data), dynstr_len(data),
        &nvl, 0, &nje) != 0) {
        errx(EXIT_FAILURE, "could not parse \"%s\" mdata as JSON: %s",
            SDC_VOLUMES_KEY, nje.nje_message);
    }

    if (print_volumes(nvl) != 0) {
        errx(EXIT_FAILURE, "could not print volumes from \"%s\" mdata",
            SDC_VOLUMES_KEY);
    }

    nvlist_free(nvl);
    return (EXIT_SUCCESS);
}
