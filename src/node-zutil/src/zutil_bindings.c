/*
 * Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
 * Copyright 2014 Joyent, Inc.  All rights reserved.
 */

#include <v8plus_glue.h>

extern nvlist_t *zutil_get_zone(const nvlist_t *);
extern nvlist_t *zutil_get_zone_by_id(const nvlist_t *);
extern nvlist_t *zutil_get_zone_by_name(const nvlist_t *);
extern nvlist_t *zutil_list_zones(const nvlist_t *);

extern nvlist_t *zutil_get_zone_attribute(const nvlist_t *);
extern nvlist_t *zutil_get_zone_attributes(const nvlist_t *);
extern nvlist_t *zutil_get_zone_state(const nvlist_t *);

static v8plus_static_descr_t zutil_static[] = {
	{
		.sd_name = "getZone",
		.sd_c_func = zutil_get_zone
	},
	{
		.sd_name = "getZoneById",
		.sd_c_func = zutil_get_zone_by_id
	},
	{
		.sd_name = "getZoneByName",
		.sd_c_func = zutil_get_zone_by_name
	},
	{
		.sd_name = "listZones",
		.sd_c_func = zutil_list_zones
	},
	{
		.sd_name = "getZoneAttribute",
		.sd_c_func = zutil_get_zone_attribute
	},
	{
		.sd_name = "getZoneAttributes",
		.sd_c_func = zutil_get_zone_attributes
	},
	{
		.sd_name = "getZoneState",
		.sd_c_func = zutil_get_zone_state
	}
};

static v8plus_module_defn_t _zutil_mod = {
	.vmd_version = V8PLUS_MODULE_VERSION,
	.vmd_modname = "zutil_bindings",
	.vmd_filename = __FILE__,
	.vmd_nodeflags = 0,
	.vmd_link = NULL,
	.vmd_ctor = NULL,
	.vmd_dtor = NULL,
	.vmd_js_factory_name = "invalid_zutil_ctor",
	.vmd_js_class_name = "invalid_zutil_class",
	.vmd_methods = NULL,
	.vmd_method_count = 0,
	.vmd_static_methods = zutil_static,
	.vmd_static_method_count =
	    sizeof (zutil_static) / sizeof (zutil_static[0]),
	.vmd_node = { 0 }
};

static void _register_module(void) __attribute__((constructor));
static void
_register_module(void)
{
	v8plus_module_register(&_zutil_mod);
}
