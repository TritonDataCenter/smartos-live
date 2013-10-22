/*
 * Copyright (c) 2012 Joyent, Inc.  All rights reserved.
 */

#include <sys/types.h>
#include <string.h>
#include <new>
#include <unordered_map>
#include <stdlib.h>
#include <node.h>
#include "v8plus_impl.h"
#include "v8plus_glue.h"

#define	METHOD_NAME_FMT	"__v8plus_%s_%s"

v8::Persistent<v8::Function> v8plus::ObjectWrap::_constructor;
v8plus_method_descr_t *v8plus::ObjectWrap::_mtbl;
v8plus_static_descr_t *v8plus::ObjectWrap::_stbl;
std::unordered_map<void *, v8plus::ObjectWrap *> v8plus::ObjectWrap::_objhash;

static char *
function_name(const char *lambda)
{
	char *fn;
	size_t len;

	len = snprintf(NULL, 0, METHOD_NAME_FMT,
	    v8plus_js_class_name, lambda);
	if ((fn = (char *)malloc(len + 1)) == NULL)
		v8plus_panic("out of memory for function name for %s", lambda);

	(void) snprintf(fn, len + 1, METHOD_NAME_FMT,
		    v8plus_js_class_name, lambda);

	return (fn);
}

void
v8plus::ObjectWrap::init(v8::Handle<v8::Object> target)
{
	uint_t i;

	if (v8plus_static_method_count > 0) {
		const v8plus_static_descr_t *sdp;

		_stbl = new (std::nothrow)
		    v8plus_static_descr_t[v8plus_static_method_count];
		if (_stbl == NULL)
			v8plus_panic("out of memory for static method table");

		for (i = 0; i < v8plus_static_method_count; i++) {
			v8::Local<v8::FunctionTemplate> fth =
			    v8::FunctionTemplate::New(_static_entry);
			v8::Local<v8::Function> fh = fth->GetFunction();
			sdp = &v8plus_static_methods[i];

			_stbl[i].sd_name = function_name(sdp->sd_name);
			_stbl[i].sd_c_func = sdp->sd_c_func;

			fh->SetName(v8::String::New(_stbl[i].sd_name));

			target->Set(v8::String::NewSymbol(sdp->sd_name), fh);
		}
	}


	if (v8plus_method_count > 0) {
		v8::Local<v8::FunctionTemplate> tpl =
		    v8::FunctionTemplate::New(_new);
		const v8plus_method_descr_t *mdp;

		_mtbl = new (std::nothrow)
		    v8plus_method_descr_t[v8plus_method_count];
		if (_mtbl == NULL)
			v8plus_panic("out of memory for method table");

		tpl->SetClassName(v8::String::NewSymbol(v8plus_js_class_name));
		tpl->InstanceTemplate()->SetInternalFieldCount(
		    v8plus_method_count);

		for (i = 0; i < v8plus_method_count; i++) {
			v8::Local<v8::FunctionTemplate> fth =
			    v8::FunctionTemplate::New(_entry);
			v8::Local<v8::Function> fh = fth->GetFunction();
			mdp = &v8plus_methods[i];

			_mtbl[i].md_name = function_name(mdp->md_name);
			_mtbl[i].md_c_func = mdp->md_c_func;

			fh->SetName(v8::String::New(_mtbl[i].md_name));

			tpl->PrototypeTemplate()->Set(
			    v8::String::NewSymbol(mdp->md_name), fh);
		}

		_constructor =
		    v8::Persistent<v8::Function>::New(tpl->GetFunction());

		target->Set(v8::String::NewSymbol(v8plus_js_factory_name),
		    v8::FunctionTemplate::New(
		    v8plus::ObjectWrap::cons)->GetFunction());
	}

	v8plus_crossthread_init();
}

v8::Handle<v8::Value>
v8plus::ObjectWrap::_new(const v8::Arguments &args)
{
	v8::HandleScope scope;
	v8plus::ObjectWrap *op = new v8plus::ObjectWrap();
	nvlist_t *c_excp;
	nvlist_t *c_args;

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		return (V8PLUS_THROW_DEFAULT());

	c_excp = v8plus_ctor(c_args, &op->_c_impl);
	nvlist_free(c_args);
	if (op->_c_impl == NULL) {
		if (c_excp == NULL) {
			return (V8PLUS_THROW_DEFAULT());
		} else {
			return (V8PLUS_THROW_DECORATED(c_excp));
		}
	}

	_objhash.insert(std::make_pair(op->_c_impl, op));
	op->Wrap(args.This());

	return (args.This());
}

v8plus::ObjectWrap::~ObjectWrap()
{
	v8plus_dtor(_c_impl);
	(void) _objhash.erase(_c_impl);
}

v8::Handle<v8::Value>
v8plus::ObjectWrap::cons(const v8::Arguments &args)
{
	v8::HandleScope scope;
	const unsigned argc = 1;
	v8::Handle<v8::Value> argv[argc] = { args[0] };
	v8::Local<v8::Object> instance = _constructor->NewInstance(argc, argv);

	return (scope.Close(instance));
}

v8plus::ObjectWrap *
v8plus::ObjectWrap::objlookup(const void *cop)
{
	std::unordered_map<void *, v8plus::ObjectWrap *>::iterator it;

	if ((it = _objhash.find(const_cast<void *>(cop))) == _objhash.end())
		v8plus_panic("unable to find C++ wrapper for %p\n", cop);

	return (it->second);
}

/*
 * This is the entry point for all methods.  We will start by demultiplexing
 * out the C method from the function name by which we were called.  There is
 * probably some mechanism by which overly clever JavaScript code could make
 * this not match the actual name; this will kill your Node process, so don't
 * get cute.
 */
v8::Handle<v8::Value>
v8plus::ObjectWrap::_entry(const v8::Arguments &args)
{
	v8::HandleScope scope;
	v8plus::ObjectWrap *op =
	    node::ObjectWrap::Unwrap<v8plus::ObjectWrap>(args.This());
	nvlist_t *c_args;
	nvlist_t *c_out;
	nvlist_t *excp;
	nvpair_t *rpp;
	v8::Local<v8::String> self = args.Callee()->GetName()->ToString();
	v8::String::Utf8Value selfsv(self);
	const char *fn = *selfsv;
	const v8plus_method_descr_t *mdp;
	v8plus_c_method_f c_method = NULL;
	uint_t i;

	for (i = 0; i < v8plus_method_count; i++) {
		mdp = &_mtbl[i];
		if (strcmp(mdp->md_name, fn) == 0) {
			c_method = mdp->md_c_func;
			break;
		}
	}

	if (c_method == NULL)
		v8plus_panic("impossible method name %s\n", fn);

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		return (V8PLUS_THROW_DEFAULT());

	c_out = c_method(op->_c_impl, c_args);
	nvlist_free(c_args);

	if (c_out == NULL) {
		if (_v8plus_errno == V8PLUSERR_NOERROR)
			return (scope.Close(v8::Undefined()));
		else
			return (V8PLUS_THROW_DEFAULT());
	} else {
		if (nvlist_lookup_nvlist(c_out, "err", &excp) == 0) {
			v8::Handle<v8::Value> x = V8PLUS_THROW_DECORATED(excp);
			nvlist_free(c_out);
			return (x);
		} else if (nvlist_lookup_nvpair(c_out, "res", &rpp) == 0) {
			v8::Handle<v8::Value> r =
			    v8plus::nvpair_to_v8_Value(rpp);
			nvlist_free(c_out);
			return (scope.Close(r));
		} else {
			v8plus_panic("bad encoded object in return");
		}
	}

	/*NOTREACHED*/
	return (v8::Undefined());
}

v8::Handle<v8::Value>
v8plus::ObjectWrap::_static_entry(const v8::Arguments &args)
{
	v8::HandleScope scope;
	nvlist_t *c_args;
	nvlist_t *c_out;
	nvlist_t *excp;
	nvpair_t *rpp;
	v8::Local<v8::String> self = args.Callee()->GetName()->ToString();
	v8::String::Utf8Value selfsv(self);
	const char *fn = *selfsv;
	const v8plus_static_descr_t *sdp;
	v8plus_c_static_f c_static = NULL;
	uint_t i;

	for (i = 0; i < v8plus_static_method_count; i++) {
		sdp = &_stbl[i];
		if (strcmp(sdp->sd_name, fn) == 0) {
			c_static = sdp->sd_c_func;
			break;
		}
	}

	if (c_static == NULL)
		v8plus_panic("impossible static method name %s\n", fn);

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		return (V8PLUS_THROW_DEFAULT());

	c_out = c_static(c_args);
	nvlist_free(c_args);

	if (c_out == NULL) {
		if (_v8plus_errno == V8PLUSERR_NOERROR)
			return (scope.Close(v8::Undefined()));
		else
			return (V8PLUS_THROW_DEFAULT());
	} else {
		if (nvlist_lookup_nvlist(c_out, "err", &excp) == 0) {
			v8::Handle<v8::Value> x = V8PLUS_THROW_DECORATED(excp);
			nvlist_free(c_out);
			return (x);
		} else if (nvlist_lookup_nvpair(c_out, "res", &rpp) == 0) {
			v8::Handle<v8::Value> r =
			    v8plus::nvpair_to_v8_Value(rpp);
			nvlist_free(c_out);
			return (scope.Close(r));
		} else {
			v8plus_panic("bad encoded object in return");
		}
	}

	/*NOTREACHED*/
	return (v8::Undefined());
}

v8::Handle<v8::Value>
v8plus::ObjectWrap::call(const char *name,
    int argc, v8::Handle<v8::Value> argv[])
{
	v8::Handle<v8::Value> v = v8::Undefined();
	v8::Local<v8::Value> f = handle_->Get(v8::String::NewSymbol(name));

	/*
 	 * XXX - we'd like to throw here, but for some reason our TryCatch
 	 * block doesn't seem to handle the exception.
 	 */
	if (!f->IsFunction())
		return (v8::Undefined());

#ifdef NODE_MAKECALLBACK_RETURN
	v =
#endif
	node::MakeCallback(handle_, name, argc, argv);

	return (v);
}

void
v8plus::ObjectWrap::public_Ref(void)
{
	this->Ref();
}

void
v8plus::ObjectWrap::public_Unref(void)
{
	this->Unref();
}

extern "C" void
init(v8::Handle<v8::Object> target)
{
	v8plus::ObjectWrap::init(target);
}
