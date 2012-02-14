// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#include <node.h>
#include <v8.h>

#include "zone.h"
#include "zonecfg.h"

extern "C" {
  void init(v8::Handle<v8::Object> target) {
    v8::HandleScope scope;

    Zone::Initialize(target);
    ZoneCfg::Initialize(target);
  }
}
