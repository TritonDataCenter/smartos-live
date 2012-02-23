// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#ifndef ZONE_H_
#define ZONE_H_

class Zone {
 public:
  virtual ~Zone();

  static void Initialize(v8::Handle<v8::Object> target);

  static v8::Handle<v8::Value> GetZone(const v8::Arguments &args);
  static v8::Handle<v8::Value> GetZoneById(const v8::Arguments &args);
  static v8::Handle<v8::Value> GetZoneByName(const v8::Arguments &args);
  static v8::Handle<v8::Value> ListZones(const v8::Arguments &args);

 protected:
  Zone();

 private:
  Zone(const Zone &);
  Zone &operator=(const Zone &);
};

#endif  // ZONE_CFG_H_
