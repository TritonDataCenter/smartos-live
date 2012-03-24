// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#ifdef SunOS
#include <zone.h>
#endif

#include <node.h>
#include <v8.h>

#include <exception>
#include <vector>

#include "zutil_common.h"
#include "zone.h"

#ifdef SunOS

static v8::Handle<v8::Value> _v8Zone(zoneid_t id, const char *name) {
  v8::Local<v8::Object> zone = v8::Object::New();
  zone->Set(v8::String::New("id"), v8::Integer::New(id));
  zone->Set(v8::String::New("name"), v8::String::New(name));
  return zone;
}


v8::Handle<v8::Value> Zone::GetZone(const v8::Arguments &args) {
  v8::HandleScope scope;

  zoneid_t zoneid = -1;
  char buffer[ZONENAME_MAX] = {0};

  zoneid = getzoneid();
  if (zoneid < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "getzoneid", strerror(errno));
  }
  if (getzonenamebyid(zoneid, buffer, ZONENAME_MAX) < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "getzonenamebyid", strerror(errno));
  }

  return _v8Zone(zoneid, buffer);
}


v8::Handle<v8::Value> Zone::GetZoneById(const v8::Arguments &args) {
  v8::HandleScope scope;

  REQUIRE_INT_ARG(args, 0, zoneid);
  char buffer[ZONENAME_MAX] = {0};

  if (getzonenamebyid(zoneid, buffer, ZONENAME_MAX) < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "getzonenamebyid", strerror(errno));
  }

  return _v8Zone(zoneid, buffer);
}


v8::Handle<v8::Value> Zone::GetZoneByName(const v8::Arguments &args) {
  v8::HandleScope scope;

  REQUIRE_STRING_ARG(args, 0, name);
  zoneid_t zoneid = -1;

  zoneid = getzoneidbyname(*name);
  if (zoneid < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "getzoneidbyname", strerror(errno));
  }

  return _v8Zone(zoneid, *name);
}


v8::Handle<v8::Value> Zone::ListZones(const v8::Arguments &args) {
  char buf[ZONENAME_MAX] = {0};
  uint_t save = 0;
  uint_t nzones = 0;
  zoneid_t *zids = NULL;

 again:
  if (zone_list(NULL, &nzones) < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "zone_list", strerror(errno));
  }
  save = nzones;

  zids = (zoneid_t *)calloc(nzones, sizeof(zoneid_t));
  if (zids == NULL) {
    RETURN_OOM_EXCEPTION();
  }

  if (zone_list(zids, &nzones) < 0) {
    RETURN_ERRNO_EXCEPTION(errno, "zone_list", strerror(errno));
  }

  if (nzones > save) {
    free(zids);
    goto again;
  }


  v8::Local<v8::Array> zones = v8::Array::New(nzones);
  for (uint_t i = 0; i < nzones; i++) {
    if (getzonenamebyid(zids[i], buf, ZONENAME_MAX) < 0) {
      RETURN_ERRNO_EXCEPTION(errno, "getzonenamebyid", strerror(errno));
    }
    zones->Set(v8::Integer::New(i), _v8Zone(zids[i], buf));
    memset(buf, '\0', ZONENAME_MAX);
  }

  return zones;
}
#endif

void Zone::Initialize(v8::Handle<v8::Object> target) {
  v8::HandleScope scope;
#ifdef SunOS
  NODE_SET_METHOD(target, "getZone", GetZone);
  NODE_SET_METHOD(target, "getZoneById", GetZoneById);
  NODE_SET_METHOD(target, "getZoneByName", GetZoneByName);
  NODE_SET_METHOD(target, "listZones", ListZones);
#endif
}
