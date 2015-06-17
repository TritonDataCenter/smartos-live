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
 * Copyright 2015 Joyent, Inc.
 */

/*
 * This program forms a private interface between the LX brand in
 * illumos-joyent and the route configuration information stored by vmadm(1M)
 * in SmartOS/SDC.
 *
 * When an LX branded zone boots, a special replacement for init(1M) is used,
 * viz.  "/usr/lib/brand/lx/lxinit".  This program is responsible for
 * configuring basic networking settings before starting the emulated Linux
 * "init".  Some of these settings are stored in the zone configuration, but
 * static routes are not; they are stored by vmadm(1M) in a form that requires
 * some processing at runtime.   The route configuration is, thus, accessed
 * through the "sdc:routes" metadata key from within the zone.
 *
 * This program, shipped as "/usr/lib/brand/lx/routeinfo", is executed by
 * "lxinit" to discover the current static route configuration.
 */


#include <stdio.h>
#include <stdlib.h>
#include <err.h>

#include <libnvpair.h>
#include <libcmdutils.h>

#include <json-nvlist/json-nvlist.h>
#include <mdata-client/common.h>
#include <mdata-client/dynstr.h>
#include <mdata-client/plat.h>
#include <mdata-client/proto.h>

#define	SDC_ROUTES_KEY		"sdc:routes"

int
print_routes(nvlist_t *nvl)
{
	uint32_t len;

	/*
	 * The JSON stored in the route configuration is an array of
	 * objects.  Walk that array:
	 */
	if (nvlist_lookup_uint32(nvl, "length", &len) != 0) {
		fprintf(stderr, "ERROR: could not find \"length\" key\n");
		return (-1);
	}

	for (uint32_t i = 0; i < len; i++) {
		char idx[32];
		nvlist_t *route;
		boolean_t linklocal;
		char *dst;
		char *gateway;

		(void) snprintf(idx, sizeof (idx), "%u", i);

		if (nvlist_lookup_nvlist(nvl, idx, &route) != 0) {
			fprintf(stderr, "ERROR: could not find route[%s]\n",
			    idx);
			return (-1);
		}

		if (nvlist_lookup_boolean_value(route, "linklocal",
		    &linklocal) != 0 ||
		    nvlist_lookup_string(route, "dst", &dst) != 0 ||
		    nvlist_lookup_string(route, "gateway", &gateway) != 0) {
			fprintf(stderr, "ERROR: route[%s] did not have "
			    "all of \"linklocal\", \"dst\" and \"gateway\"\n",
			    idx);
			return (-1);
		}

		fprintf(stdout, "%s|%s|%s\n", gateway, dst, linklocal ?
		    "true" : "false");
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

	if (proto_execute(mdp, "GET", SDC_ROUTES_KEY, &mdr, &data) != 0) {
		errx(EXIT_FAILURE, "could not get \"%s\" mdata",
		    SDC_ROUTES_KEY);
	}

	if (nvlist_parse_json(dynstr_cstr(data), dynstr_len(data),
	    &nvl, 0, &nje) != 0) {
		errx(EXIT_FAILURE, "could not parse \"%s\" mdata as JSON: %s",
		    SDC_ROUTES_KEY, nje.nje_message);
	}

	if (print_routes(nvl) != 0) {
		errx(EXIT_FAILURE, "could not print routes from \"%s\" mdata",
		    SDC_ROUTES_KEY);
	}

	nvlist_free(nvl);
	return (EXIT_SUCCESS);
}
