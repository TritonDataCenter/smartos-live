#include "dtrace_provider.h"
#include <v8.h>

#include <node.h>

namespace node {
  
  using namespace v8;

  Persistent<FunctionTemplate> DTraceProbe::constructor_template;

  void DTraceProbe::Initialize(Handle<Object> target) {
    HandleScope scope;
    
    Local<FunctionTemplate> t = FunctionTemplate::New(DTraceProbe::New);
    constructor_template = Persistent<FunctionTemplate>::New(t);
    constructor_template->InstanceTemplate()->SetInternalFieldCount(1);
    constructor_template->SetClassName(String::NewSymbol("DTraceProbe"));
    
    NODE_SET_PROTOTYPE_METHOD(constructor_template, "fire", DTraceProbe::Fire);
    
    target->Set(String::NewSymbol("DTraceProbe"), constructor_template->GetFunction());
  }

  Handle<Value> DTraceProbe::New(const Arguments& args) {
    DTraceProbe *probe = new DTraceProbe();
    probe->Wrap(args.This());
    return args.This();
  }  

  Handle<Value> DTraceProbe::Fire(const Arguments& args) {
    HandleScope scope;
    DTraceProbe *pd = ObjectWrap::Unwrap<DTraceProbe>(args.Holder());
    return pd->_fire(args[0]);
  }
  
  Handle<Value> DTraceProbe::_fire(v8::Local<v8::Value> argsfn) {

    if (usdt_is_enabled(this->probedef->probe) == 0) {
      return Undefined();
    }

    // invoke fire callback
    TryCatch try_catch;

    if (!argsfn->IsFunction()) {
      return ThrowException(Exception::Error(String::New(
        "Must give probe value callback as argument")));
    }
    
    Local<Function> cb = Local<Function>::Cast(argsfn);
    Local<Value> probe_args = cb->Call(this->handle_, 0, NULL);

    // exception in args callback?
    if (try_catch.HasCaught()) {
      FatalException(try_catch);
      return Undefined();
    }

    // check return
    if (!probe_args->IsArray()) {
      return Undefined();
    }

    Local<Array> a = Local<Array>::Cast(probe_args);
    void *argv[USDT_ARG_MAX];

    // limit argc to the defined number of probe args
    size_t argc = a->Length();
    if (argc > this->probedef->argc)
      argc = this->probedef->argc;
    
    for (size_t i = 0; i < argc; i++) {
      if (this->probedef->types[i] == USDT_ARGTYPE_STRING) {
	// char *
	String::AsciiValue str(a->Get(i)->ToString());
	argv[i] = (void *) strdup(*str);
      }
      else {
	// int
#ifdef __x86_64__
	argv[i] = (void *)(long) a->Get(i)->ToInteger()->Value();
#else
	argv[i] = (void *)(int) a->Get(i)->ToInt32()->Value();
#endif        
      }
    }

    usdt_fire_probe(this->probedef->probe, argc, argv);

    return True();
  }

} // namespace node
