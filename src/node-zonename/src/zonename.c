/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015, Joyent, Inc.
 */

#include <errno.h>
#include <libnvpair.h>
#include <string.h>
#include <zone.h>

#include "v8plus_glue.h"

static nvlist_t *
zonename_getzoneid(const nvlist_t *ap __UNUSED)
{
	zoneid_t zoneid = getzoneid();
	return (v8plus_obj(V8PLUS_TYPE_NUMBER, "res", (double)zoneid,
	    V8PLUS_TYPE_NONE));
}

static nvlist_t *
zonename_getzoneidbyname(const nvlist_t *ap)
{
	char *zonename;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_STRING, &zonename,
	    V8PLUS_TYPE_NONE) != 0)
		return (v8plus_error(V8PLUSERR_BADARG, "bad args"));

	zoneid_t zoneid = getzoneidbyname(zonename);
	if (zoneid < 0) {
		char errbuf[128];

		snprintf(errbuf, sizeof (errbuf),
		    "getzoneidbyname: %s", strerror(errno));

		return (v8plus_error(V8PLUSERR_UNKNOWN,
		    errbuf));
	}

	return (v8plus_obj(V8PLUS_TYPE_NUMBER, "res", (double)zoneid,
	    V8PLUS_TYPE_NONE));
}

static nvlist_t *
zonename_getzonenamebyid(const nvlist_t *ap)
{
	double zoneid;
	char zonename[ZONENAME_MAX];

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_NUMBER, &zoneid,
	    V8PLUS_TYPE_NONE) != 0)
		return (v8plus_error(V8PLUSERR_BADARG, "bad args"));

	if (getzonenamebyid(zoneid, zonename, ZONENAME_MAX) < 0) {
		char errbuf[128];

		snprintf(errbuf, sizeof (errbuf),
		    "getzonenamebyid: %s", strerror(errno));

		return (v8plus_error(V8PLUSERR_UNKNOWN,
		    errbuf));
	}

	return (v8plus_obj(V8PLUS_TYPE_STRING, "res", zonename,
	    V8PLUS_TYPE_NONE));
}

/*
 * v8plus Boilerplate
 */
const v8plus_c_ctor_f v8plus_ctor = NULL;
const v8plus_c_dtor_f v8plus_dtor = NULL;
const char *v8plus_js_factory_name = NULL;
const char *v8plus_js_class_name = NULL;

const v8plus_method_descr_t v8plus_methods[] = {};
const uint_t v8plus_method_count =
    sizeof (v8plus_methods) / sizeof (v8plus_methods[0]);

const v8plus_static_descr_t v8plus_static_methods[] = {
	{
		sd_name: "getzoneidbyname",
		sd_c_func: zonename_getzoneidbyname
	},
	{
		sd_name: "getzonenamebyid",
		sd_c_func: zonename_getzonenamebyid
	},
	{
		sd_name: "getzoneid",
		sd_c_func: zonename_getzoneid
	}
};
const uint_t v8plus_static_method_count =
    sizeof (v8plus_static_methods) / sizeof (v8plus_static_methods[0]);
