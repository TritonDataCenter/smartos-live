/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 */

#include <sys/types.h>
#include <sys/debug.h>
#include <string.h>
#include <new>
#include <unordered_map>
#include <stdlib.h>
#include <node.h>
#include "v8plus_impl.h"
#include "v8plus_glue.h"

extern "C" {
typedef struct v8plus_func_ctx {
	v8plus_module_defn_t *vfc_defn;
	const v8plus_method_descr_t *vfc_method;
	const v8plus_static_descr_t *vfc_static;
	v8::Persistent<v8::Function> vfc_ctor;
} v8plus_func_ctx_t;
}

std::unordered_map<void *, v8plus::ObjectWrap *> v8plus::ObjectWrap::_objhash;

/*
 * There are three degrees of freedom that together determine how we are
 * initialised:
 *
 * Old vs New API: The old API requires the consumer to provide various data
 * structures with fixed variable names and no .init registration call.  The
 * new API requires the consumer to invoke v8plus_module_register() from .init
 * context and pass it a pointer to a structure instead.
 *
 * Integrated vs Library Model: The integrated model, which is the only model
 * supported by the old API, builds v8plus and the consumer into a single
 * object that functions as a regular Node C++ module.  The library model
 * builds v8plus as a library (or as part of Node) and allows any number of
 * C module consumers to share its functionality.  The library model requires
 * node 0.11.9 or later.
 *
 * Node version: The members of node::node_module changed in module version 13
 * and again in module 14.  Also, module versions 13 and older require a fixed
 * name node::node_module structure to exist and to have global visibility,
 * while version 14 and later require calling a registration function from
 * .init context and passing it a pointer to a node::node_module.
 *
 * The preferred mechanism here is simply to use the new API, in which case
 * the consumer will call v8plus_module_register() which in turn calls
 * node_module_register() from .init.  All the rest of this is for compatibility
 * with various combinations of older v8plus consumers and older node.  These
 * are the valid permutations:
 *
 * Old + Integrated + Node module version 0-12
 * Old + Integrated + Node module version 13
 * Old + Integrated + Node module version 14
 * New + Integrated + Node module version 0-12
 * New + Integrated + Node module version 13
 * New + Integrated + Node module version 14
 * New + Library + Node module version 14
 *
 * This code will need to be adjusted for future node module API versions.
 */

#if NODE_MODULE_VERSION - 14 < 0
static v8plus_module_defn_t *integrated_module;
#elif defined(V8PLUS_LIBRARY)
#error	"The v8plus library model is supported only by node.js 0.11.10 or later"
#endif

#if NODE_MODULE_VERSION - 14 < 0
#define	NODE_MODULE_NAME_HELPER(_x)	_x ## _module
#define	NODE_MODULE_NAME(_x)		NODE_MODULE_NAME_HELPER(_x)
extern "C" NODE_MODULE_STRUCT NODE_MODULE_NAME(MODULE);
NODE_MODULE_STRUCT NODE_MODULE_NAME(MODULE);
static NODE_MODULE_STRUCT *node_module = &NODE_MODULE_NAME(MODULE);
#define	__UNUSED_BEFORE_14	__UNUSED
#else	/* NODE_MODULE_VERSION >= 14 */
static NODE_MODULE_STRUCT *node_module __UNUSED;
#define	__UNUSED_BEFORE_14	/* nothing */
#endif

/*
 * This function is called in .init context in ALL cases.  In the new API cases
 * it is called by the consumer; in the old API cases, we call it ourselves
 * below.
 */
extern "C" void
v8plus_module_register(v8plus_module_defn_t *mdp)
{
	V8PLUS_REGISTER_NODE_MODULE(mdp, node_module);
}

void
v8plus::ObjectWrap::init(v8::Handle<v8::Object> target,
    v8::Handle<v8::Value> ignored __UNUSED, void *priv __UNUSED_BEFORE_14)
{
	uint_t i;
	const char *name;
	v8plus_func_ctx_t *fcp;
	v8plus_module_defn_t *mdp =
#if NODE_MODULE_VERSION - 13 > 0
	    reinterpret_cast<v8plus_module_defn_t *>(priv);
#else
	    integrated_module;
#endif

	for (i = 0; i < mdp->vmd_static_method_count; i++) {
		fcp = new (std::nothrow) v8plus_func_ctx_t;
		name = mdp->vmd_static_methods[i].sd_name;

		if (fcp == NULL) {
			v8plus_panic("out of memory for context for [%s]%s.%s",
			    mdp->vmd_modname, mdp->vmd_js_class_name,
			    mdp->vmd_static_methods[i].sd_name);
		}

		fcp->vfc_defn = mdp;
		fcp->vfc_static = &mdp->vmd_static_methods[i];
		fcp->vfc_method = NULL;

		v8::Local<v8::External> ext =
		    v8::External::New(reinterpret_cast<void*>(fcp));
		v8::Local<v8::FunctionTemplate> fth =
			    v8::FunctionTemplate::New(_static_entry, ext);
		v8::Local<v8::Function> fh = fth->GetFunction();

		fh->SetName(v8::String::New(name));
		target->Set(v8::String::NewSymbol(name), fh);
	}

	if (mdp->vmd_method_count > 0) {
		fcp = new (std::nothrow) v8plus_func_ctx_t;

		if (fcp == NULL) {
			v8plus_panic("out of memory for context for [%s]%s",
			    mdp->vmd_modname, mdp->vmd_js_class_name);
		}

		fcp->vfc_defn = mdp;
		fcp->vfc_static = NULL;
		fcp->vfc_method = NULL;

		v8::Local<v8::External> ext =
		    v8::External::New(reinterpret_cast<void *>(fcp));

		v8::Local<v8::FunctionTemplate> tpl =
		    v8::FunctionTemplate::New(_new, ext);

		tpl->SetClassName(v8::String::NewSymbol(
		    mdp->vmd_js_class_name));
		tpl->InstanceTemplate()->SetInternalFieldCount(
		    mdp->vmd_method_count);

		for (i = 0; i < mdp->vmd_method_count; i++) {
			v8plus_func_ctx_t *mfcp =
			    new (std::nothrow) v8plus_func_ctx_t;
			name = mdp->vmd_methods[i].md_name;

			if (mfcp == NULL) {
				v8plus_panic("out of memory for context for "
				    "[%s]%s.%s", mdp->vmd_modname,
				    mdp->vmd_js_class_name, name);
			}

			mfcp->vfc_defn = mdp;
			mfcp->vfc_static = NULL;
			mfcp->vfc_method = &mdp->vmd_methods[i];

			v8::Local<v8::External> fext =
			    v8::External::New(reinterpret_cast<void *>(mfcp));

			v8::Local<v8::FunctionTemplate> fth =
			    v8::FunctionTemplate::New(_entry, fext);
			v8::Local<v8::Function> fh = fth->GetFunction();

			fh->SetName(v8::String::New(name));

			tpl->PrototypeTemplate()->Set(
			    v8::String::NewSymbol(name), fh);
		}

		V8_PF_ASSIGN(fcp->vfc_ctor, tpl->GetFunction());

		target->Set(v8::String::NewSymbol(mdp->vmd_js_factory_name),
		    v8::FunctionTemplate::New(
		    v8plus::ObjectWrap::cons, ext)->GetFunction());
	}

	v8plus_crossthread_init();
}

V8_JS_FUNC_DEFN(v8plus::ObjectWrap::_new, args)
{
	HANDLE_SCOPE(scope);
	v8::Local<v8::Value> data = args.Data();
	VERIFY(data->IsExternal());
	v8::Local<v8::External> ext = data.As<v8::External>();
	v8plus_func_ctx_t* fcp =
	    reinterpret_cast<v8plus_func_ctx_t *>(ext->Value());
	v8plus_c_ctor_f cp = fcp->vfc_defn->vmd_ctor;
	v8plus::ObjectWrap *op = new v8plus::ObjectWrap();
	nvlist_t *c_excp;
	nvlist_t *c_args;

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());

	c_excp = cp(c_args, &op->_c_impl);
	nvlist_free(c_args);
	if (op->_c_impl == NULL) {
		if (c_excp == NULL)
			V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());
		else
			V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DECORATED(c_excp));
	}

	op->_defn = fcp->vfc_defn;
	_objhash.insert(std::make_pair(op->_c_impl, op));
	op->Wrap(args.This());

	V8_JS_FUNC_RETURN(args, args.This());
}

v8plus::ObjectWrap::~ObjectWrap()
{
	v8plus_module_defn_t *mdp =
	    reinterpret_cast<v8plus_module_defn_t *>(_defn);

	mdp->vmd_dtor(_c_impl);
	(void) _objhash.erase(_c_impl);
}

V8_JS_FUNC_DEFN(v8plus::ObjectWrap::cons, args)
{
	HANDLE_SCOPE(scope);
	v8::Local<v8::Value> data = args.Data();
	VERIFY(data->IsExternal());
	v8::Local<v8::External> ext = data.As<v8::External>();
	v8plus_func_ctx_t* fcp =
	    reinterpret_cast<v8plus_func_ctx_t *>(ext->Value());
	const unsigned argc = 1;
	v8::Handle<v8::Value> argv[argc] = { args[0] };
	v8::Local<v8::Object> instance =
	    V8_LOCAL(fcp->vfc_ctor, v8::Function)->NewInstance(argc, argv);

	V8_JS_FUNC_RETURN_CLOSE(args, scope, instance);
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
V8_JS_FUNC_DEFN(v8plus::ObjectWrap::_entry, args)
{
	HANDLE_SCOPE(scope);
	v8::Local<v8::Value> data = args.Data();
	VERIFY(data->IsExternal());
	v8::Local<v8::External> ext = data.As<v8::External>();
	v8plus_func_ctx_t* fcp =
	    reinterpret_cast<v8plus_func_ctx_t *>(ext->Value());
	v8plus::ObjectWrap *op =
	    node::ObjectWrap::Unwrap<v8plus::ObjectWrap>(args.This());
	nvlist_t *c_args;
	nvlist_t *c_out;
	nvlist_t *excp;
	nvpair_t *rpp;
	v8::Local<v8::String> self = args.Callee()->GetName()->ToString();
	v8::String::Utf8Value selfsv(self);
	const char *fn = *selfsv;
	v8plus_c_method_f c_method = fcp->vfc_method->md_c_func;

	if (c_method == NULL)
		v8plus_panic("impossible method name %s\n", fn);

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());

	c_out = c_method(op->_c_impl, c_args);
	nvlist_free(c_args);

	if (c_out == NULL) {
		if (_v8plus_errno == V8PLUSERR_NOERROR)
			V8_JS_FUNC_RETURN_UNDEFINED_CLOSE(scope);
		else
			V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());
	} else {
		if (nvlist_lookup_nvlist(c_out, "err", &excp) == 0) {
			v8::Handle<v8::Value> x = V8PLUS_THROW_DECORATED(excp);
			nvlist_free(c_out);
			V8_JS_FUNC_RETURN(args, x);
		} else if (nvlist_lookup_nvpair(c_out, "res", &rpp) == 0) {
			v8::Handle<v8::Value> r =
			    v8plus::nvpair_to_v8_Value(rpp);
			nvlist_free(c_out);
			V8_JS_FUNC_RETURN_CLOSE(args, scope, r);
		} else {
			v8plus_panic("bad encoded object in return");
		}
	}

	/*NOTREACHED*/
	V8_JS_FUNC_RETURN_UNDEFINED;
}

V8_JS_FUNC_DEFN(v8plus::ObjectWrap::_static_entry, args)
{
	HANDLE_SCOPE(scope);
	v8::Local<v8::Value> data = args.Data();
	VERIFY(data->IsExternal());
	v8::Local<v8::External> ext = data.As<v8::External>();
	v8plus_func_ctx_t* fcp =
	    reinterpret_cast<v8plus_func_ctx_t *>(ext->Value());
	nvlist_t *c_args;
	nvlist_t *c_out;
	nvlist_t *excp;
	nvpair_t *rpp;
	v8::Local<v8::String> self = args.Callee()->GetName()->ToString();
	v8::String::Utf8Value selfsv(self);
	const char *fn = *selfsv;
	v8plus_c_static_f c_static = fcp->vfc_static->sd_c_func;

	if (c_static == NULL)
		v8plus_panic("impossible static method name %s\n", fn);

	if ((c_args = v8plus::v8_Arguments_to_nvlist(args)) == NULL)
		V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());

	c_out = c_static(c_args);
	nvlist_free(c_args);

	if (c_out == NULL) {
		if (_v8plus_errno == V8PLUSERR_NOERROR)
			V8_JS_FUNC_RETURN_UNDEFINED_CLOSE(scope);
		else
			V8_JS_FUNC_RETURN(args, V8PLUS_THROW_DEFAULT());
	} else {
		if (nvlist_lookup_nvlist(c_out, "err", &excp) == 0) {
			v8::Handle<v8::Value> x = V8PLUS_THROW_DECORATED(excp);
			nvlist_free(c_out);
			V8_JS_FUNC_RETURN(args, x);
		} else if (nvlist_lookup_nvpair(c_out, "res", &rpp) == 0) {
			v8::Handle<v8::Value> r =
			    v8plus::nvpair_to_v8_Value(rpp);
			nvlist_free(c_out);
			V8_JS_FUNC_RETURN_CLOSE(args, scope, r);
		} else {
			v8plus_panic("bad encoded object in return");
		}
	}

	/*NOTREACHED*/
	V8_JS_FUNC_RETURN_UNDEFINED;
}

v8::Handle<v8::Value>
v8plus::ObjectWrap::call(const char *name,
    int argc, v8::Handle<v8::Value> argv[])
{
	v8::Local<v8::Value> f = handle_->Get(v8::String::NewSymbol(name));

	/*
 	 * XXX - we'd like to throw here, but for some reason our TryCatch
 	 * block doesn't seem to handle the exception.
 	 */
	if (!f->IsFunction())
		return (v8::Undefined());

	RETURN_NODE_MAKECALLBACK(name, argc, argv);
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
