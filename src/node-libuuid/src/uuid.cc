#include <v8.h>
#include <node.h>
#include <node_object_wrap.h>
#include <assert.h>
#include <uuid/uuid.h>
#include <ctype.h>
#undef UUID_STR_LEN
#define UUID_STR_LEN 36
static inline void my_uuid_unparse_lower(uuid_t in, char *out) {
  int i;
  uuid_unparse(in, out);
  for(i=0;i<36;i++) out[i] = tolower(out[i]);
}

using namespace v8;
using namespace node;

class libuuid {
  public:
    static void
    Initialize(v8::Handle<v8::Object> target) {
      Local<FunctionTemplate> t = FunctionTemplate::New(libuuid::Create);
      t->InstanceTemplate()->SetInternalFieldCount(1);

      target->Set(String::NewSymbol("create"), t->GetFunction());
    }


  protected:
    static Handle<Value> Create(const Arguments& args) {
      uuid_t id;
      HandleScope scope;
      char uuid_str[37];
      uuid_generate(id);

      my_uuid_unparse_lower(id, uuid_str);
      String::New(uuid_str);

      return scope.Close(String::New(uuid_str));
    }

};

extern "C" void
init(Handle<Object> target) {
  HandleScope scope;
  libuuid::Initialize(target);
}
NODE_MODULE(uuid, init)
