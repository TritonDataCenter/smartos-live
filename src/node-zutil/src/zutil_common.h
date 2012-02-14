// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#ifndef ZUTIL_COMMON_H_
#define ZUTIL_COMMON_H_

#include <errno.h>

#include <node.h>
#include <node_buffer.h>
#include <v8.h>

// Node Macros require these
using v8::Persistent;
using v8::String;

#define RETURN_EXCEPTION(MSG)                                           \
  return v8::ThrowException(v8::Exception::Error(v8::String::New(MSG)))

#define RETURN_ARGS_EXCEPTION(MSG)                                      \
  return v8::ThrowException(v8::Exception::TypeError(v8::String::New(MSG)))

#define RETURN_ERRNO_EXCEPTION(RC, API, MSG)                    \
  return v8::ThrowException(node::ErrnoException(RC, API, MSG))

#define RETURN_OOM_EXCEPTION()                                  \
  RETURN_ERRNO_EXCEPTION(ENOMEM, "malloc", strerror(ENOMEM))

#define REQUIRE_ARGS(ARGS)                      \
  if (ARGS.Length() == 0)                       \
    RETURN_ARGS_EXCEPTION("missing arguments");

#define REQUIRE_INT_ARG(ARGS, I, VAR)                                   \
  REQUIRE_ARGS(ARGS);                                                   \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsNumber())                     \
    RETURN_ARGS_EXCEPTION("argument " #I " must be an Integer");        \
  v8::Local<v8::Integer> _ ## VAR(ARGS[I]->ToInteger());                \
  int VAR = _ ## VAR->Value();

#define REQUIRE_STRING_ARG(ARGS, I, VAR)                        \
  REQUIRE_ARGS(ARGS);                                           \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsString())             \
    RETURN_ARGS_EXCEPTION("argument " #I " must be a String");  \
  v8::String::Utf8Value VAR(ARGS[I]->ToString());

#define REQUIRE_FUNCTION_ARG(ARGS, I, VAR)                              \
  REQUIRE_ARGS(ARGS);                                                   \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsFunction())                   \
    RETURN_EXCEPTION("argument " #I " must be a Function");             \
  v8::Local<v8::Function> VAR = v8::Local<v8::Function>::Cast(ARGS[I]);


#define REQUIRE_OBJECT_ARG(ARGS, I, VAR)                        \
  REQUIRE_ARGS(ARGS);                                           \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsObject())             \
    RETURN_EXCEPTION("argument " #I " must be an Object");      \
  v8::Local<v8::Object> VAR(ARGS[I]->ToObject());

#endif  // ZUTIL_COMMON_H__
