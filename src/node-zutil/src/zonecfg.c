/*
 * Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

#include <errno.h>
#ifdef __sun
#include <libzonecfg.h>
#include <zone.h>
#endif
#include <stdlib.h>
#include <strings.h>
#include <string.h>

#include <v8plus_glue.h>

#ifdef __sun
typedef struct zone_attrtab zone_attrtab_t;

typedef struct zone_attr_ctx {
	zone_attrtab_t **zac_attrs;
	uint_t zac_attr_count;
	uint_t zac_attr_alloc;

	int zac_errno;
	const char *zac_api;

	char *zac_zone;
	char *zac_attr;
	v8plus_jsfunc_t zac_callback;
} zone_attr_ctx_t;

static void
zone_attr_ctx_init(zone_attr_ctx_t *acp)
{
	bzero(acp, sizeof (zone_attr_ctx_t));
}

static void
zone_attr_ctx_fini(zone_attr_ctx_t *acp)
{
	uint_t i;

	for (i = 0; i < acp->zac_attr_count; i++)
		free(acp->zac_attrs[i]);

	free(acp->zac_attrs);
	v8plus_jsfunc_rele(acp->zac_callback);
}

static void
zone_attr_ctx_error(zone_attr_ctx_t *acp, int err, const char *api)
{
	acp->zac_errno = err;
	acp->zac_api = api;
}

static int
zone_attr_ctx_push(zone_attr_ctx_t *acp, zone_attrtab_t *zap)
{
	if (acp->zac_attr_alloc == 0) {
		acp->zac_attrs = calloc(16, sizeof (zone_attrtab_t *));
		if (acp->zac_attrs == NULL) {
			zone_attr_ctx_error(acp, errno, "calloc");
			return (-1);
		}
		acp->zac_attr_alloc = 16;
	} else if (acp->zac_attr_alloc == acp->zac_attr_alloc) {
		void *np = realloc(acp->zac_attrs,
		    acp->zac_attr_alloc * 2 * sizeof (zone_attrtab_t *));

		if (np == NULL) {
			zone_attr_ctx_error(acp, errno, "realloc");
			return (-1);
		}
		bzero(np + acp->zac_attr_alloc * sizeof (zone_attrtab_t *),
		    acp->zac_attr_alloc * sizeof (zone_attrtab_t *));
		acp->zac_attrs = np;
		acp->zac_attr_alloc *= 2;
	}
	acp->zac_attrs[acp->zac_attr_count++] = zap;

	return (0);
}

static void *
get_zone_attrs_worker(void *op __UNUSED, void *ctxp)
{
	zone_attr_ctx_t *acp = ctxp;
	int rc = 0;
	zone_attrtab_t *attrtab = NULL;
	zone_dochandle_t handle = zonecfg_init_handle();

	if (handle == NULL) {
		zone_attr_ctx_error(acp, ENOMEM, "zonecfg_init_handle");
		goto out;
	}

	if ((rc = zonecfg_get_handle(acp->zac_zone, handle)) != Z_OK) {
		zone_attr_ctx_error(acp, rc, "zonecfg_get_handle");
		goto out;
	}

	if ((rc = zonecfg_setattrent(handle)) != Z_OK) {
		zone_attr_ctx_error(acp, rc, "zonecfg_setattrent");
		goto out;
	}

	for (;;) {
		attrtab = (zone_attrtab_t *)calloc(1, sizeof(zone_attrtab_t));
		if (attrtab == NULL) {
			zone_attr_ctx_error(acp, ENOMEM, "calloc");
			break;
		}

		rc = zonecfg_getattrent(handle, attrtab);
		if (rc != Z_OK) {
			free(attrtab);
			break;
		}

		if (acp->zac_attr == NULL) {
			if (zone_attr_ctx_push(acp, attrtab) != 0)
				break;
			acp->zac_attrs[acp->zac_attr_count++] = attrtab;
		} else {
			if (strcasecmp(acp->zac_attr,
			    attrtab->zone_attr_name) == 0) {
				acp->zac_attrs[acp->zac_attr_count++] = attrtab;
				break;
			} else {
				free(attrtab);
			}
		}
	}

out:
	if (handle != NULL) {
		zonecfg_endattrent(handle);
		zonecfg_fini_handle(handle);
	}

	return (NULL);
}

static void
get_zone_attrs_cb(void *op __UNUSED, void *ctxp, void *resp __UNUSED)
{
	zone_attr_ctx_t *acp = ctxp;
	zone_attrtab_t *attr;
	uint_t i;
	char idxbuf[11];
	nvlist_t *ap = NULL;
	nvlist_t *rp, *sp;

	if (acp->zac_errno != 0) {
		ap = v8plus_obj(
		    V8PLUS_TYPE_INL_OBJECT, "0",
			V8PLUS_TYPE_STRING, ".__v8plus_type", "Error",
			V8PLUS_TYPE_NUMBER, "errno", (double)acp->zac_errno,
			V8PLUS_TYPE_STRING, "message", strerror(acp->zac_errno),
			V8PLUS_TYPE_STRING, "syscall", acp->zac_api,
			V8PLUS_TYPE_NONE,
		    V8PLUS_TYPE_NONE);
	} else if (acp->zac_attr == NULL) {
		rp = v8plus_obj(V8PLUS_TYPE_STRING, ".__v8plus_type", "Array");
		if (rp == NULL)
			goto out;

		for (i = 0; i < acp->zac_attr_count; i++) {
			attr = acp->zac_attrs[i];
			(void) snprintf(idxbuf, sizeof (idxbuf), "%u", i);
			sp = v8plus_obj(
			    V8PLUS_TYPE_STRING, "name", attr->zone_attr_name,
			    V8PLUS_TYPE_STRING, "type", attr->zone_attr_type,
			    V8PLUS_TYPE_STRING, "value", attr->zone_attr_value,
			    V8PLUS_TYPE_NONE);
			if (sp == NULL)
				goto out;
			if (v8plus_obj_setprops(rp,
			    V8PLUS_TYPE_OBJECT, idxbuf, sp) != 0) {
				goto out;
			}
		}

		ap = v8plus_obj(
		    V8PLUS_TYPE_NULL, "0",
		    V8PLUS_TYPE_OBJECT, "1", rp,
		    V8PLUS_TYPE_NONE);
	} else if (acp->zac_attr != NULL && acp->zac_attr_count > 0) {
		attr = acp->zac_attrs[0];

		ap = v8plus_obj(
		    V8PLUS_TYPE_NULL, "0",
		    V8PLUS_TYPE_INL_OBJECT, "1",
			V8PLUS_TYPE_STRING, "name", attr->zone_attr_name,
			V8PLUS_TYPE_STRING, "type", attr->zone_attr_type,
			V8PLUS_TYPE_STRING, "value", attr->zone_attr_value,
			V8PLUS_TYPE_NONE,
		    V8PLUS_TYPE_NONE);
	} else {
		ap = v8plus_obj(
		    V8PLUS_TYPE_NULL, "0",
		    V8PLUS_TYPE_NULL, "1",
		    V8PLUS_TYPE_NONE);
	}

out:
	zone_attr_ctx_fini(acp);
	free(acp);

	if (ap == NULL) {
		v8plus_rethrow_pending_exception();
		return;
	}

	rp = v8plus_call(acp->zac_callback, ap);
	nvlist_free(ap);

	if (rp == NULL)
		v8plus_rethrow_pending_exception();
	else
		nvlist_free(rp);
}

nvlist_t *
zutil_get_zone_attribute(const nvlist_t *ap)
{
	char *zone;
	char *attr;
	v8plus_jsfunc_t callback;
	zone_attr_ctx_t *acp;

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_STRING, &zone,
	    V8PLUS_TYPE_STRING, &attr,
	    V8PLUS_TYPE_JSFUNC, &callback,
	    V8PLUS_TYPE_NONE) != 0) {
		return (NULL);
	}

	acp = malloc(sizeof (zone_attr_ctx_t));
	if (acp == NULL)
		return (NULL);
	zone_attr_ctx_init(acp);

	if ((acp->zac_zone = strdup(zone)) == NULL) {
		free(acp);
		return (v8plus_throw_errno_exception(errno, "strdup",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}
	if ((acp->zac_attr = strdup(attr)) == NULL) {
		free(acp->zac_zone);
		free(acp);
		return (v8plus_throw_errno_exception(errno, "strdup",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	acp->zac_callback = callback;

	v8plus_defer(NULL, acp, get_zone_attrs_worker, get_zone_attrs_cb);

	return (v8plus_void());
}

nvlist_t *
zutil_get_zone_attributes(const nvlist_t *ap)
{
	char *zone;
	v8plus_jsfunc_t callback;
	zone_attr_ctx_t *acp;

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_STRING, &zone,
	    V8PLUS_TYPE_JSFUNC, &callback,
	    V8PLUS_TYPE_NONE) != 0) {
		return (NULL);
	}

	acp = malloc(sizeof (zone_attr_ctx_t));
	if (acp == NULL)
		return (NULL);
	zone_attr_ctx_init(acp);

	if ((acp->zac_zone = strdup(zone)) == NULL) {
		free(acp);
		return (v8plus_throw_errno_exception(errno, "strdup",
		    NULL, NULL, V8PLUS_TYPE_NONE));
	}

	acp->zac_callback = callback;

	v8plus_defer(NULL, acp, get_zone_attrs_worker, get_zone_attrs_cb);

	return (v8plus_void());
}

nvlist_t *
zutil_get_zone_state(const nvlist_t *ap)
{
	char *name;
	zone_state_t state;
	char *statestr = NULL;
	int ret;

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_STRING, &name,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	if ((ret = zone_get_state(name, &state)) != 0) {
		return (v8plus_throw_exception("Error", zonecfg_strerror(ret),
		    V8PLUS_TYPE_NONE));
	}
	statestr = zone_state_str(state);

	return (v8plus_obj(V8PLUS_TYPE_STRING, "res", statestr,
	    V8PLUS_TYPE_NONE));
}

#endif
