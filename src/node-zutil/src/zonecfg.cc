// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.

#include <errno.h>
#ifdef SunOS
#include <libzonecfg.h>
#include <zone.h>
#endif
#include <stdlib.h>
#include <string.h>

#include <node.h>
#include <v8.h>

#include <exception>
#include <vector>

#include "zutil_common.h"
#include "zonecfg.h"

#ifdef SunOS
typedef struct zone_attrtab zone_attrtab_t;


// Start Node Specific things
struct eio_attr_baton_t {
  eio_attr_baton_t(): _attrs(0),
                      _errno(-1),
                      _api(NULL),
                      _err_msg(NULL),
                      _zone(NULL),
                      _attr(NULL) {}

  virtual ~eio_attr_baton_t() {
    std::vector<zone_attrtab_t *>::iterator it;
    for (it = _attrs.begin(); it < _attrs.end(); it++) {
      if (*it) {
        free(*it);
      }
      *it = NULL;
    }
    _attrs.clear();

    _errno = -1;
    _api = NULL;
    _err_msg = NULL;

    if (_attr != NULL) {
      free(_attr);
    }
    _attr = NULL;
    if (_zone != NULL) {
      free(_zone);
    }
    _zone = NULL;
    _callback.Dispose();
  }

  void set_error(int err, const char *api, const char *msg) {
    _errno = err;
    _api = api;
    _err_msg = msg;
  }

  // Returned values
  std::vector<zone_attrtab_t *> _attrs;

  // Error Messaging
  int _errno;
  const char *_api;
  const char *_err_msg;

  // In
  char *_zone;
  char *_attr;
  v8::Persistent<v8::Function> _callback;

 private:
  eio_attr_baton_t(const eio_attr_baton_t &);
  eio_attr_baton_t &operator=(const eio_attr_baton_t &);
};

void ZoneCfg::EIO_GetZoneAttrs(eio_req *req) {
  eio_attr_baton_t *baton = static_cast<eio_attr_baton_t *>(req->data);
  int rc = 0;

  zone_attrtab_t *attrtab = NULL;
  zone_dochandle_t handle = zonecfg_init_handle();
  if (handle == NULL) {
    baton->set_error(ENOMEM, "zonecfg_init_handle", zonecfg_strerror(ENOMEM));
    goto out;
  }

  if ((rc = zonecfg_get_handle(baton->_zone, handle)) != Z_OK) {
    baton->set_error(rc, "zonecfg_get_handle", zonecfg_strerror(ENOMEM));
    goto out;
  }

  if ((rc = zonecfg_setattrent(handle)) != Z_OK) {
    baton->set_error(rc, "zonecfg_setattrent", zonecfg_strerror(rc));
    goto out;
  }

  attrtab = (zone_attrtab_t *)calloc(1, sizeof(zone_attrtab_t));
  if (attrtab == NULL) {
    baton->set_error(ENOMEM, "calloc", strerror(ENOMEM));
    goto out;
  }

  while (zonecfg_getattrent(handle, attrtab) == Z_OK) {
    if (baton->_attr == NULL) {
      baton->_attrs.push_back(attrtab);
    } else {
      if (strcasecmp(baton->_attr, attrtab->zone_attr_name) == 0) {
        baton->_attrs.push_back(attrtab);
        break;
      } else {
        free(attrtab);
      }
    }

    attrtab = (zone_attrtab_t *)calloc(1, sizeof(zone_attrtab_t));
    if (attrtab == NULL) {
      baton->set_error(ENOMEM, "calloc", strerror(ENOMEM));
      goto out;
    }
  }

 out:
  // There's always one extra element from the loop above, so clear it out.
  // This is hacky, but it avoids me doing a lot of extra copies. If you
  // want to fix it, knock yourself out. Unless of course this was for a
  // single attribute, then there's not.  Like I said, knock yourself out.
  if (attrtab != NULL && baton->_attr == NULL) {
    free(attrtab);
  }

  if (handle != NULL) {
    zonecfg_endattrent(handle);
    zonecfg_fini_handle(handle);
  }
}

int ZoneCfg::EIO_AfterGetZoneAttrs(eio_req *req) {
  v8::HandleScope scope;

  eio_attr_baton_t *baton = static_cast<eio_attr_baton_t *>(req->data);
  ev_unref(EV_DEFAULT_UC);

  int argc = 1;
  v8::Local<v8::Value> argv[2];

  if (baton->_errno > -1) {
    argv[0] = node::ErrnoException(baton->_errno, baton->_api, baton->_err_msg);
  } else {
    argc = 2;
    argv[0] = v8::Local<v8::Value>::New(v8::Null());
    if (baton->_attr == NULL) {
      v8::Local<v8::Array> attrs = v8::Array::New(baton->_attrs.size());
      for (unsigned int i = 0; i < baton->_attrs.size(); i++) {
        zone_attrtab_t *attr = baton->_attrs[i];
        v8::Local<v8::Object> obj = v8::Object::New();
        obj->Set(String::New("name"), String::New(attr->zone_attr_name));
        obj->Set(String::New("type"), String::New(attr->zone_attr_type));
        obj->Set(String::New("value"), String::New(attr->zone_attr_value));
        attrs->Set(v8::Integer::New(i), obj);
      }
      argv[1] = attrs;
    } else {
      if (baton->_attrs.size() > 0) {
        zone_attrtab_t *attr = baton->_attrs[0];
        v8::Local<v8::Object> obj = v8::Object::New();
        obj->Set(String::New("name"), String::New(attr->zone_attr_name));
        obj->Set(String::New("type"), String::New(attr->zone_attr_type));
        obj->Set(String::New("value"), String::New(attr->zone_attr_value));
        argv[1] = obj;
      } else {
        argv[1] = v8::Local<v8::Value>::New(v8::Null());
      }
    }
  }

  v8::TryCatch try_catch;

  baton->_callback->Call(v8::Context::GetCurrent()->Global(), argc, argv);

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  delete baton;
  return 0;
}

v8::Handle<v8::Value> ZoneCfg::GetZoneAttribute(const v8::Arguments &args) {
  v8::HandleScope scope;

  REQUIRE_STRING_ARG(args, 0, zone);
  REQUIRE_STRING_ARG(args, 1, attr);
  REQUIRE_FUNCTION_ARG(args, 2, callback);

  eio_attr_baton_t *baton = new eio_attr_baton_t();
  baton->_zone = strdup(*zone);
  if (!baton->_zone) {
    delete baton;
    RETURN_OOM_EXCEPTION();
  }
  baton->_attr = strdup(*attr);
  if (!baton->_attr) {
    delete baton;
    RETURN_OOM_EXCEPTION();
  }

  baton->_callback = v8::Persistent<v8::Function>::New(callback);

  eio_custom(EIO_GetZoneAttrs, EIO_PRI_DEFAULT, EIO_AfterGetZoneAttrs, baton);
  ev_ref(EV_DEFAULT_UC);

  return v8::Undefined();
}

v8::Handle<v8::Value> ZoneCfg::GetZoneAttributes(const v8::Arguments &args) {
  v8::HandleScope scope;

  REQUIRE_STRING_ARG(args, 0, zone);
  REQUIRE_FUNCTION_ARG(args, 1, callback);

  eio_attr_baton_t *baton = new eio_attr_baton_t();
  baton->_zone = strdup(*zone);
  if (!baton->_zone) {
    delete baton;
    RETURN_OOM_EXCEPTION();
  }
  baton->_callback = v8::Persistent<v8::Function>::New(callback);

  eio_custom(EIO_GetZoneAttrs, EIO_PRI_DEFAULT, EIO_AfterGetZoneAttrs, baton);
  ev_ref(EV_DEFAULT_UC);

  return v8::Undefined();
}

v8::Handle<v8::Value> ZoneCfg::GetZoneState(const v8::Arguments &args) {
  v8::HandleScope scope;

  REQUIRE_STRING_ARG(args, 0, name);

  zone_state_t state;
  char *statestr = NULL;

  if (int ret = zone_get_state(*name, &state)) {
    RETURN_EXCEPTION(zonecfg_strerror(ret));
  }
  statestr = zone_state_str(state);

  return v8::String::New(statestr);
}

#endif

void ZoneCfg::Initialize(v8::Handle<v8::Object> target) {
  v8::HandleScope scope;

#ifdef SunOS
  NODE_SET_METHOD(target, "getZoneAttribute", GetZoneAttribute);
  NODE_SET_METHOD(target, "getZoneAttributes", GetZoneAttributes);
  NODE_SET_METHOD(target, "getZoneState", GetZoneState);
#endif
}
