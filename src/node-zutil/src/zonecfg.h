// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#ifndef ZONE_CFG_H_
#define ZONE_CFG_H_

class ZoneCfg {
 public:
  virtual ~ZoneCfg();

  static void Initialize(v8::Handle<v8::Object> target);

  static v8::Handle<v8::Value> GetZoneAttribute(const v8::Arguments &args);
  static v8::Handle<v8::Value> GetZoneAttributes(const v8::Arguments &args);
  static v8::Handle<v8::Value> GetZoneState(const v8::Arguments &args);

 protected:
  ZoneCfg();
  static void  EIO_GetZoneAttrs(eio_req *req);
  static int EIO_AfterGetZoneAttrs(eio_req *req);

 private:
  ZoneCfg(const ZoneCfg &);
  ZoneCfg &operator=(const ZoneCfg &);
};

#endif  // ZONE_CFG_H_
