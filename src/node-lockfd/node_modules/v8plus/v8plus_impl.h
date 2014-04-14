/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 */

#ifndef	_V8PLUS_IMPL_H
#define	_V8PLUS_IMPL_H

#include <sys/ccompile.h>
#include <stdarg.h>
#include <libnvpair.h>
#include <v8.h>
#include <node_version.h>
#include <unordered_map>
#include "v8plus_glue.h"

#if NODE_VERSION_AT_LEAST(0, 11, 3)
#include <node_object_wrap.h>
#endif

/*
 * STOP!
 *
 * Do not #include this header in code that consumes v8+.  This is a private
 * implementation header for use by v8+ internal C++ code.  It cannot be
 * included from C code and contains nothing usable by consumers.
 */

#define	V8PLUS_THROW(_t, _e, _f, _args...) \
    v8::ThrowException(v8plus::exception((_t), (_e), (_f), ## _args))
#define	V8PLUS_THROW_DEFAULT()		V8PLUS_THROW(NULL, NULL, NULL)
#define	V8PLUS_THROW_DECORATED(_e)	V8PLUS_THROW(NULL, (_e), NULL)

/*
 * This is all very gross.  V8 has a lot of pointless churn in the form of
 * changes that are simply text transforms (as evidenced by the fact that
 * these simple macros are sufficient to accommodate them).  In order to work
 * on node 0.6-0.12, many of the basic things one must do to work with V8
 * are forced to be macros.  The Node guys have followed suit in a few places
 * as well.  This makes the code harder to read.
 *
 * Way to go, Google.
 */
#if NODE_VERSION_AT_LEAST(0, 11, 3)
#define	RETURN_NODE_MAKECALLBACK(_f, _c, _v)	\
do {						\
	node::MakeCallback(handle(), _f, _c, _v);	\
	return (v8::Undefined());		\
} while (0)
#elif NODE_VERSION_AT_LEAST(0, 8, 0)
#define	RETURN_NODE_MAKECALLBACK(_f, _c, _v)	\
    return (node::MakeCallback(handle_, _f, _c, _v))
#else
#define	RETURN_NODE_MAKECALLBACK(_f, _c, _v)	\
do {						\
	node::MakeCallback(handle_, _f, _c, _v);	\
	return (v8::Undefined());		\
} while (0)
#endif

#if NODE_VERSION_AT_LEAST(0, 11, 3)

#define	handle_	handle()
#define	V8_LOCAL(_p, _t)	\
({				\
	v8::Local<_t> _l = v8::Local<_t>::New(v8::Isolate::GetCurrent(), (_p));\
	_l;			\
})

#define	V8_JS_FUNC_DECL(_f)	\
void _f(const v8::FunctionCallbackInfo<v8::Value> &)

#define	V8_JS_FUNC_DEFN(_f, _p)	\
void \
_f(const v8::FunctionCallbackInfo<v8::Value> &_p)

#define	HANDLE_SCOPE(_x)	v8::HandleScope _x(v8::Isolate::GetCurrent())
#define	V8_ARGUMENTS		v8::FunctionCallbackInfo<v8::Value>
#define	V8_PF_ASSIGN(_d, _s)	(_d).Reset(v8::Isolate::GetCurrent(), (_s))

#define	V8_JS_FUNC_RETURN(_a, _v)	\
do {					\
	_a.GetReturnValue().Set(_v);	\
	return;				\
} while (0)

#define	V8_JS_FUNC_RETURN_CLOSE(_a, _s, _v)	\
do {						\
	_a.GetReturnValue().Set(_v);		\
	return;					\
} while (0)

#define	V8_JS_FUNC_RETURN_UNDEFINED	return
#define	V8_JS_FUNC_RETURN_UNDEFINED_CLOSE(_s)	V8_JS_FUNC_RETURN_UNDEFINED

#else	/* < 0.11.3 */

#define	V8_LOCAL(_p, _t)	(_p)

#define	V8_JS_FUNC_DECL(_f)	\
v8::Handle<v8::Value> _f(const v8::Arguments &)

#define	V8_JS_FUNC_DEFN(_f, _p)	\
v8::Handle<v8::Value> \
_f(const v8::Arguments &_p)

#define	HANDLE_SCOPE(_x)	v8::HandleScope _x
#define	V8_ARGUMENTS		v8::Arguments
#define	V8_PF_ASSIGN(_d, _s)	_d = v8::Persistent<v8::Function>::New(_s)

#define	V8_JS_FUNC_RETURN(_a, _v)	return (_v)
#define	V8_JS_FUNC_RETURN_CLOSE(_a, _s, _v)	return ((_s).Close(_v))

#define	V8_JS_FUNC_RETURN_UNDEFINED	V8_JS_FUNC_RETURN(_u, v8::Undefined())
#define	V8_JS_FUNC_RETURN_UNDEFINED_CLOSE(_s)	\
    V8_JS_FUNC_RETURN_CLOSE(_u, _s, v8::Undefined())

#endif	/* NODE_VERSION */

/*
 * Likewise, there are three major eras of node module structure definitions.
 * 14+ has prefixed member names and context-aware registration.
 * 13+ has only context-aware registration.
 * 12 and older have neither.
 */
#if NODE_MODULE_VERSION - 13 > 0
#define	NODE_MODULE_STRUCT	node::node_module
#define	V8PLUS_REGISTER_NODE_MODULE(_d, _n)	\
do {						\
	v8plus_module_defn_t *_mdp = (_d);	\
						\
	NODE_MODULE_STRUCT *_nmp = 		\
	    reinterpret_cast<NODE_MODULE_STRUCT *>(&_mdp->vmd_node[0]);	\
	if (sizeof (NODE_MODULE_STRUCT) > sizeof (mdp->vmd_node))	\
		v8plus_panic("out of space for node module data");	\
	_nmp->nm_version = NODE_MODULE_VERSION;	\
	_nmp->nm_flags = _mdp->vmd_nodeflags;	\
	_nmp->nm_dso_handle = NULL;		\
	_nmp->nm_filename = _mdp->vmd_filename;	\
	_nmp->nm_register_func =		\
	    (node::addon_register_func)v8plus::ObjectWrap::init;	\
	_nmp->nm_context_register_func = NULL;	\
	_nmp->nm_modname = _mdp->vmd_modname;	\
	_nmp->nm_priv = _mdp;			\
	_nmp->nm_link = NULL;			\
						\
	node_module_register(_nmp);		\
} while (0)
#elif NODE_MODULE_VERSION - 12 > 0
#define	NODE_MODULE_STRUCT	node::node_module_struct
#define	V8PLUS_REGISTER_NODE_MODULE(_d, _n)	\
do {						\
	v8plus_module_defn_t *_mdp = (_d);	\
	NODE_MODULE_STRUCT *_nmp = (_n);	\
	_nmp->version = NODE_MODULE_VERSION;	\
	_nmp->dso_handle = NULL;		\
	_nmp->filename = _mdp->vmd_filename;	\
	_nmp->register_func =		\
	    (node::addon_register_func)v8plus::ObjectWrap::init;	\
	_nmp->register_context_func = NULL;	\
	_nmp->modname = _mdp->vmd_modname;	\
	integrated_module = _mdp;		\
} while (0)
#elif NODE_VERSION_AT_LEAST(0, 9, 8)
#define	NODE_MODULE_STRUCT	node::node_module_struct
#define	V8PLUS_REGISTER_NODE_MODULE(_d, _n)	\
do {						\
	v8plus_module_defn_t *_mdp = (_d);	\
	NODE_MODULE_STRUCT *_nmp = (_n);	\
	_nmp->version = NODE_MODULE_VERSION;	\
	_nmp->dso_handle = NULL;		\
	_nmp->filename = _mdp->vmd_filename;	\
	_nmp->register_func =			\
	    (node::addon_register_func)v8plus::ObjectWrap::init;\
	_nmp->modname = _mdp->vmd_modname;	\
	integrated_module = _mdp;		\
} while (0)
#else	/* NODE_MODULE_VERSION <= 12 */
#define	NODE_MODULE_STRUCT	node::node_module_struct
#define	V8PLUS_REGISTER_NODE_MODULE(_d, _n)	\
do {						\
	v8plus_module_defn_t *_mdp = (_d);	\
	NODE_MODULE_STRUCT *_nmp = (_n);	\
	_nmp->version = NODE_MODULE_VERSION;	\
	_nmp->dso_handle = NULL;		\
	_nmp->filename = _mdp->vmd_filename;	\
	_nmp->register_func =			\
	    (void (*)(v8::Handle<v8::Object>))v8plus::ObjectWrap::init;\
	_nmp->modname = _mdp->vmd_modname;	\
	integrated_module = _mdp;		\
} while (0)
#endif	/* NODE_MODULE_VERSION */

namespace v8plus {

class ObjectWrap;

class ObjectWrap : public node::ObjectWrap {
public:
	static void init(v8::Handle<v8::Object>, v8::Handle<v8::Value>, void *);
	static V8_JS_FUNC_DECL(cons);
	static ObjectWrap *objlookup(const void *);
	v8::Handle<v8::Value> call(const char *, int, v8::Handle<v8::Value>[]);
	void public_Ref(void);
	void public_Unref(void);

private:
	static std::unordered_map<void *, ObjectWrap *> _objhash;
	void *_c_impl;
	void *_defn;

	ObjectWrap() : _c_impl(NULL) {};
	~ObjectWrap();

	static V8_JS_FUNC_DECL(_new);
	static V8_JS_FUNC_DECL(_entry);
	static V8_JS_FUNC_DECL(_static_entry);
};

extern nvlist_t *v8_Arguments_to_nvlist(const V8_ARGUMENTS &);
extern v8::Handle<v8::Value> nvpair_to_v8_Value(const nvpair_t *);
extern v8::Local<v8::Value> exception(const char *, const nvlist_t *,
    const char *, ...) __PRINTFLIKE(3);

}; /* namespace v8plus */

#endif	/* _V8PLUS_IMPL_H */
