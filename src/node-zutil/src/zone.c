/*
 * Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#ifdef __sun
#include <zone.h>
#endif

#include <v8plus_glue.h>

#ifdef __sun

static nvlist_t *
_mkzone(zoneid_t id, const char *name)
{
	return (v8plus_obj(
	    V8PLUS_TYPE_STRNUMBER64, "id", (uint64_t)id,
	    V8PLUS_TYPE_STRING, "name", name,
	    V8PLUS_TYPE_NONE));
}

nvlist_t *
zutil_get_zone(const nvlist_t *ap __UNUSED)
{
	zoneid_t zoneid = -1;
	char buffer[ZONENAME_MAX] = {0};

	zoneid = getzoneid();
	if (zoneid < 0) {
		return (v8plus_throw_errno_exception(errno, "getzoneid",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}
	if (getzonenamebyid(zoneid, buffer, ZONENAME_MAX) < 0) {
		return (v8plus_throw_errno_exception(errno, "getzonenamebyid",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	return (v8plus_obj(V8PLUS_TYPE_OBJECT, "res", _mkzone(zoneid, buffer),
	    V8PLUS_TYPE_NONE));
}

nvlist_t *
zutil_get_zone_by_id(const nvlist_t *ap)
{
	double d;
	int zoneid;
	char buffer[ZONENAME_MAX] = {0};

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_NUMBER, &d,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	zoneid = (int)d;

	if (getzonenamebyid(zoneid, buffer, ZONENAME_MAX) < 0) {
		return (v8plus_throw_errno_exception(errno, "getzonenamebyid",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	return (v8plus_obj(
	    V8PLUS_TYPE_OBJECT, "res", _mkzone(zoneid, buffer),
	    V8PLUS_TYPE_NONE));
}

nvlist_t *
zutil_get_zone_by_name(const nvlist_t *ap)
{
	char *name;
	zoneid_t zoneid = -1;

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_STRING, &name,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	zoneid = getzoneidbyname(name);
	if (zoneid < 0) {
		return (v8plus_throw_errno_exception(errno, "getzoneidbyname",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	return (v8plus_obj(V8PLUS_TYPE_OBJECT, "res", _mkzone(zoneid, name),
	    V8PLUS_TYPE_NONE));
}

nvlist_t *
zutil_list_zones(const nvlist_t *ap __UNUSED)
{
	char buf[ZONENAME_MAX] = {0};
	char propname[11];
	uint_t save = 0;
	uint_t nzones = 0;
	zoneid_t *zids = NULL;
	nvlist_t *zones;
	uint_t i;

again:
	if (zone_list(NULL, &nzones) < 0) {
		return (v8plus_throw_errno_exception(errno, "zone_list",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}
	save = nzones;

	zids = (zoneid_t *)calloc(nzones, sizeof(zoneid_t));
	if (zids == NULL) {
		return (v8plus_throw_errno_exception(ENOMEM, "malloc",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	if (zone_list(zids, &nzones) < 0) {
		return (v8plus_throw_errno_exception(errno, "zone_list",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	if (nzones > save) {
		free(zids);
		goto again;
	}

	zones = v8plus_obj(V8PLUS_TYPE_STRING, ".__v8plus_type", "Array",
	    V8PLUS_TYPE_NONE);
	if (zones == NULL)
		return (NULL);

	for (i = 0; i < nzones; i++) {
		if (getzonenamebyid(zids[i], buf, ZONENAME_MAX) < 0) {
			nvlist_free(zones);
			return (v8plus_throw_errno_exception(errno,
			    "getzonenamebyid", NULL, NULL, V8PLUS_TYPE_NONE));
		}
		(void) snprintf(propname, sizeof (propname), "%u", i);
		if (v8plus_obj_setprops(zones,
		    V8PLUS_TYPE_OBJECT, propname, _mkzone(zids[i], buf),
		    V8PLUS_TYPE_NONE) != 0) {
			nvlist_free(zones);
			return (NULL);
		}
		memset(buf, '\0', ZONENAME_MAX);
	}

	return (v8plus_obj(V8PLUS_TYPE_OBJECT, "res", zones, V8PLUS_TYPE_NONE));
}
#endif
