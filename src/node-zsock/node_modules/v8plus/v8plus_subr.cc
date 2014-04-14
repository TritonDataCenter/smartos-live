/*
 * Copyright (c) 2014 Joyent, Inc.  All rights reserved.
 */

#include <sys/types.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <alloca.h>
#include <dlfcn.h>
#include <libnvpair.h>
#include <node.h>
#include <v8.h>
#include <unordered_map>
#include <string>
#include "v8plus_c_impl.h"
#include "v8plus_impl.h"

#define	V8_EXCEPTION_CTOR_FMT \
	"_ZN2v89Exception%u%sENS_6HandleINS_6StringEEE"

typedef struct cb_hdl {
	v8::Handle<v8::Function> ch_hdl;
	v8::Persistent<v8::Function> ch_phdl;
	uint_t ch_refs;
	boolean_t ch_persist;

/*
 * It's no longer possible in 0.11.3+ to assign or copy a Persistent value
 * so in order to use this type with STL maps etc. we must provide our own
 * copy-constructor and assignment, the former of which is actually used by
 * the internal STL code when manipulating objects in the data structure.
 */
#if NODE_VERSION_AT_LEAST(0, 11, 3)
	cb_hdl() {};
	cb_hdl(const struct cb_hdl &src) {
		if (src.ch_persist) {
			this->ch_phdl.Reset(v8::Isolate::GetCurrent(),
			    src.ch_phdl);
		} else {
			this->ch_hdl = src.ch_hdl;
		}
		this->ch_refs = src.ch_refs;
		this->ch_persist = src.ch_persist;
	}
	struct cb_hdl &operator=(const struct cb_hdl &src) {
		if (src.ch_persist) {
			this->ch_phdl.Reset(v8::Isolate::GetCurrent(),
			    src.ch_phdl);
		} else {
			this->ch_hdl = src.ch_hdl;
		}
		this->ch_refs = src.ch_refs;
		this->ch_persist = src.ch_persist;

		return (*this);
	};
#endif
} cb_hdl_t;

static std::unordered_map<uint64_t, cb_hdl_t> cbhash;
static uint64_t cbnext;
static void (*__real_nvlist_free)(nvlist_t *);
static int nvlist_add_v8_Value(nvlist_t *,
    const char *, const v8::Handle<v8::Value> &);

static const char *
cstr(const v8::String::Utf8Value &v)
{
	return (*v);
}

/*
 * Convenience macros for adding stuff to an nvlist and returning on failure.
 */
#define	LA_U(_l, _n, _e) \
	if (((_e) = nvlist_add_boolean((_l), (_n))) != 0) \
		return (_e)

#define	LA_N(_l, _n, _e) \
	if (((_e) = nvlist_add_byte((_l), (_n), 0)) != 0) \
		return (_e)

#define	LA_V(_l, _t, _n, _v, _e) \
	if (((_e) = nvlist_add_##_t((_l), (_n), (_v))) != 0) \
		return (_e)

#define	LA_VA(_l, _t, _n, _v, _c, _e) \
	if (((_e) = nvlist_add_##_t##_array((_l), (_n), (_v), (_c))) != 0) \
		return (_e)

static int
v8_Object_to_nvlist(const v8::Handle<v8::Value> &vh, nvlist_t *lp)
{
	v8::Local<v8::Object> oh = vh->ToObject();
	v8::Local<v8::Array> keys = oh->GetPropertyNames();
	v8::Local<v8::String> th = oh->GetConstructorName();
	v8::String::Utf8Value tv(th);
	const char *type = cstr(tv);
	boolean_t is_excp = _B_FALSE;
	uint_t i;
	int err;

	/* XXX this is vile; can we handle this generally? */
	if (strcmp(type, "Object") != 0) {
		if (strcmp(type, "Error") == 0 ||
		    strcmp(type, "TypeError") == 0 ||
		    strcmp(type, "RangeError") == 0 ||
		    strcmp(type, "ReferenceError") == 0 ||
		    strcmp(type, "SyntaxError") == 0 ||
		    strcmp(type, "EvalError") == 0 ||
		    strcmp(type, "InternalError") == 0 ||
		    strcmp(type, "URIError") == 0) {
			is_excp = _B_TRUE;
			if ((err = nvlist_add_string(lp,
			    V8PLUS_OBJ_TYPE_MEMBER, type)) != 0) {
				return (err);
			}
		} else if (strcmp(type, "Array") == 0) {
			if ((err = nvlist_add_string(lp,
			    V8PLUS_OBJ_TYPE_MEMBER, type)) != 0) {
				return (err);
			}
		} else {
			/*
			 * XXX This is (C) programmer error.  Should
			 * we plumb up a way to throw here?
			 */
			(void) v8plus_panic("can't handle %s", type);
		}
	}

	if (is_excp) {
		v8::Local<v8::Value> mv;

		mv = oh->Get(v8::String::New("message"));

		if ((err = nvlist_add_v8_Value(lp, "message", mv)) != 0)
			return (err);
	}

	for (i = 0; i < keys->Length(); i++) {
		char knname[11];
		v8::Local<v8::Value> mk;
		v8::Local<v8::Value> mv;
		const char *k;

		(void) snprintf(knname, sizeof (knname), "%u", i);
		mk = keys->Get(v8::String::New(knname));
		mv = oh->Get(mk);
		v8::String::Utf8Value mks(mk);
		k = cstr(mks);

		if ((err = nvlist_add_v8_Value(lp, k, mv)) != 0)
			return (err);
	}

	return (0);
}

static void
v8plus_throw_v8_exception(const v8::Handle<v8::Value> &vh)
{
	nvlist_t *lp = _v8plus_alloc_exception();

	if (lp == NULL)
		return;

	(void) v8_Object_to_nvlist(vh, lp);
}

/*
 * Add an element named <name> to list <lp> with a transcoded value
 * corresponding to <vh> if possible.  Only primitive types, objects that are
 * thin wrappers for primitive types, and objects containing members whose
 * types are all any of the above can be transcoded.
 *
 * Booleans and their Object type are encoded as boolean_value.
 * Numbers and their Object type are encoded as double.
 * Strings and their Object type are encoded as C strings (and assumed UTF-8).
 * Any Object (including an Array) is encoded as an nvlist whose elements
 * are the Object's own properties.
 * Null is encoded as a byte with value 0.
 * Undefined is encoded as the valueless boolean.
 *
 * Returns EINVAL if any argument fails these tests, or any other error code
 * that may be returned by nvlist_add_XXX(3nvpair).
 */
static int
nvlist_add_v8_Value(nvlist_t *lp, const char *name,
    const v8::Handle<v8::Value> &vh)
{
	int err = 0;

	if (vh->IsBoolean()) {
		boolean_t vv = vh->BooleanValue() ? _B_TRUE : _B_FALSE;
		LA_V(lp, boolean_value, name, vv, err);
	} else if (vh->IsNumber()) {
		double vv = vh->NumberValue();
		LA_V(lp, double, name, vv, err);
	} else if (vh->IsString()) {
		v8::String::Utf8Value s(vh);
		const char *vv = cstr(s);
		LA_V(lp, string, name, vv, err);
	} else if (vh->IsUndefined()) {
		LA_U(lp, name, err);
	} else if (vh->IsNull()) {
		LA_N(lp, name, err);
	} else if (vh->IsNumberObject()) {
		double vv = vh->NumberValue();
		LA_V(lp, double, name, vv, err);
	} else if (vh->IsStringObject()) {
		v8::String::Utf8Value s(vh);
		const char *vv = cstr(s);
		LA_V(lp, string, name, vv, err);
	} else if (vh->IsBooleanObject()) {
		boolean_t vv = vh->BooleanValue() ? _B_TRUE : _B_FALSE;
		LA_V(lp, boolean_value, name, vv, err);
	} else if (vh->IsFunction()) {
		cb_hdl_t ch;

		ch.ch_hdl = v8::Handle<v8::Function>::Cast(vh);
		ch.ch_refs = 1;
		ch.ch_persist = _B_FALSE;

		/*
		 * We create the callback handle with its reference count set
		 * to 1; i.e. it is created in the held state.  Each call to
		 * v8plus_jsfunc_rele() will call v8plus_eventloop_rele() to
		 * release the event loop hold implicit in a jsfunc hold.
		 * So that our holds and releases are balanced, we take an
		 * event loop hold here:
		 */
		v8plus_eventloop_hold();

		while (cbhash.find(cbnext) != cbhash.end())
			++cbnext;
		cbhash.insert(std::make_pair(cbnext, ch));

		LA_VA(lp, string, V8PLUS_JSF_COOKIE, NULL, 0, err);
		LA_VA(lp, uint64, name, &cbnext, 1, err);
	} else if (vh->IsObject()) {
		nvlist_t *vlp;

		if ((err = nvlist_alloc(&vlp, NV_UNIQUE_NAME, 0)) != 0)
			return (err);

		if ((err = v8_Object_to_nvlist(vh, vlp)) != 0) {
			nvlist_free(vlp);
			return (err);
		}

		LA_V(lp, nvlist, name, vlp, err);
	} else {
		return (EINVAL);
	}

	return (0);
}

#undef	LA_U
#undef	LA_N
#undef	LA_V

nvlist_t *
v8plus::v8_Arguments_to_nvlist(const V8_ARGUMENTS &args)
{
	char name[16];
	nvlist_t *lp;
	int err;
	uint_t i;

	if ((err = nvlist_alloc(&lp, NV_UNIQUE_NAME, 0)) != 0)
		return (v8plus_nverr(err, NULL));

	for (i = 0; i < (uint_t)args.Length(); i++) {
		(void) snprintf(name, sizeof (name), "%u", i);
		if ((err = nvlist_add_v8_Value(lp, name, args[i])) != 0) {
			nvlist_free(lp);
			return (v8plus_nverr(err, name));
		}
	}

	return (lp);
}

static void
decorate_object(v8::Local<v8::Object> &oh, const nvlist_t *lp)
{
	nvpair_t *pp = NULL;

	while ((pp =
	    nvlist_next_nvpair(const_cast<nvlist_t *>(lp), pp)) != NULL) {
		if (strcmp(nvpair_name(pp), V8PLUS_OBJ_TYPE_MEMBER) == 0)
			continue;
		oh->Set(v8::String::New(nvpair_name(pp)),
		    v8plus::nvpair_to_v8_Value(pp));
	}
}

static v8::Handle<v8::Value>
create_and_populate(const nvlist_t *lp, const char *deftype)
{
	v8::Local<v8::Object> oh;
	const char *type;
	const char *msg;
	char *ctor_name;
	v8::Local<v8::Value> (*excp_ctor)(v8::Handle<v8::String>);
	v8::Local<v8::Value> array;
	void *obj_hdl;
	size_t len;
	boolean_t is_array = _B_FALSE;
	boolean_t is_excp = _B_FALSE;
	v8::Local<v8::Value> excp;
	v8::Local<v8::String> jsmsg;

	if (nvlist_lookup_string(const_cast<nvlist_t *>(lp),
	    V8PLUS_OBJ_TYPE_MEMBER, const_cast<char **>(&type)) != 0)
		type = deftype;

	if (strcmp(type, "Array") == 0) {
		array = v8::Array::New();
		oh = array->ToObject();
		is_array = _B_TRUE;
	} else if (strcmp(type, "Object") == 0) {
		oh = v8::Object::New();
	} else {
		msg = "";
		(void) nvlist_lookup_string(const_cast<nvlist_t *>(lp),
		    "message", const_cast<char **>(&msg));
		jsmsg = v8::String::New(msg);

		len = snprintf(NULL, 0, V8_EXCEPTION_CTOR_FMT,
		    (uint_t)strlen(type), type);
		ctor_name = reinterpret_cast<char *>(alloca(len + 1));
		(void) snprintf(ctor_name, len + 1, V8_EXCEPTION_CTOR_FMT,
		    (uint_t)strlen(type), type);

		obj_hdl = dlopen(NULL, RTLD_NOLOAD);
		if (obj_hdl == NULL)
			v8plus_panic("%s\n", dlerror());

		excp_ctor = (v8::Local<v8::Value>(*)(v8::Handle<v8::String>))(
		    dlsym(obj_hdl, ctor_name));

		if (excp_ctor == NULL) {
			(void) dlclose(obj_hdl);
			v8plus_panic("Unencodable type %s, aborting\n", type);
		}

		is_excp = _B_TRUE;
		excp = excp_ctor(jsmsg);
		(void) dlclose(obj_hdl);

		oh = excp->ToObject();
	}

	decorate_object(oh, lp);

	if (is_array)
		return (array);
	else if (is_excp)
		return (excp);

	return (oh);
}

#define	RETURN_JS(_p, _jt, _ct, _xt, _pt) \
	do { \
		_ct _v; \
		(void) nvpair_value_##_pt(const_cast<nvpair_t *>(_p), &_v); \
		return (v8::_jt::New((_xt)_v)); \
	} while (0)

v8::Handle<v8::Value>
v8plus::nvpair_to_v8_Value(const nvpair_t *pp)
{
	switch (nvpair_type(const_cast<nvpair_t *>(pp))) {
	case DATA_TYPE_BOOLEAN:
		return (v8::Undefined());
	case DATA_TYPE_BOOLEAN_VALUE:
		RETURN_JS(pp, Boolean, boolean_t, bool, boolean_value);
	case DATA_TYPE_BYTE:
	{
		uint8_t _v = (uint8_t)-1;

		if (nvpair_value_byte(const_cast<nvpair_t *>(pp), &_v) != 0 ||
		    _v != 0) {
			v8plus_panic("bad byte value %02x\n", _v);
		}

		return (v8::Null());
	}
	case DATA_TYPE_INT8:
		RETURN_JS(pp, Number, int8_t, double, int8);
	case DATA_TYPE_UINT8:
		RETURN_JS(pp, Number, uint8_t, double, uint8);
	case DATA_TYPE_INT16:
		RETURN_JS(pp, Number, int16_t, double, int16);
	case DATA_TYPE_UINT16:
		RETURN_JS(pp, Number, uint16_t, double, uint16);
	case DATA_TYPE_INT32:
		RETURN_JS(pp, Number, int32_t, double, int32);
	case DATA_TYPE_UINT32:
		RETURN_JS(pp, Number, uint32_t, double, uint32);
	case DATA_TYPE_INT64:
		RETURN_JS(pp, Number, int64_t, double, int64);
	case DATA_TYPE_UINT64:
		RETURN_JS(pp, Number, uint64_t, double, uint64);
	case DATA_TYPE_DOUBLE:
		RETURN_JS(pp, Number, double, double, double);
	case DATA_TYPE_STRING:
		RETURN_JS(pp, String, char *, const char *, string);
	case DATA_TYPE_UINT64_ARRAY:
	{
		std::unordered_map<uint64_t, cb_hdl_t>::iterator it;
		uint64_t *vp;
		uint_t nv;
		int err;

		if ((err = nvpair_value_uint64_array(const_cast<nvpair_t *>(pp),
		    &vp, &nv)) != 0)
			v8plus_panic("bad JSFUNC pair: %s", strerror(err));
		if (nv != 1)
			v8plus_panic("bad uint64 array length %u", nv);
		if ((it = cbhash.find(*vp)) == cbhash.end())
			v8plus_panic("callback hash tag %llu not found", *vp);

		return (it->second.ch_hdl);
	}
	case DATA_TYPE_NVLIST:
	{
		nvlist_t *lp;

		(void) nvpair_value_nvlist(const_cast<nvpair_t *>(pp), &lp);

		return (create_and_populate(lp, "Object"));
	}
	default:
		v8plus_panic("bad data type %d\n",
		    nvpair_type(const_cast<nvpair_t *>(pp)));
	}

	/*NOTREACHED*/
	return (v8::Undefined());
}

#undef	RETURN_JS

static uint_t
nvlist_length(const nvlist_t *lp)
{
	uint_t l = 0;
	nvpair_t *pp = NULL;

	while ((pp =
	    nvlist_next_nvpair(const_cast<nvlist_t *>(lp), pp)) != NULL)
		++l;

	return (l);
}

static void
nvlist_to_v8_argv(const nvlist_t *lp, int *argcp, v8::Handle<v8::Value> *argv)
{
	nvpair_t *pp;
	char name[16];
	int i;

	for (i = 0; i < *argcp; i++) {
		(void) snprintf(name, sizeof (name), "%u", i);
		if (nvlist_lookup_nvpair(const_cast<nvlist_t *>(lp),
		    name, &pp) != 0)
			break;
		argv[i] = v8plus::nvpair_to_v8_Value(pp);
	}

	*argcp = i;
}

v8::Handle<v8::Value>
v8plus::exception(const nvlist_t *lp)
{
	return (create_and_populate(lp, "Error"));
}

extern "C" nvlist_t *
v8plus_call_direct(v8plus_jsfunc_t f, const nvlist_t *lp)
{
	HANDLE_SCOPE(scope);
	std::unordered_map<uint64_t, cb_hdl_t>::iterator it;
	const int max_argc = nvlist_length(lp);
	int argc, err;
	v8::Handle<v8::Value> argv[max_argc];
	v8::Handle<v8::Value> res;
	nvlist_t *rp;

	if ((it = cbhash.find(f)) == cbhash.end())
		v8plus_panic("callback hash tag %llu not found", f);

	argc = max_argc;
	nvlist_to_v8_argv(lp, &argc, argv);

	if ((err = nvlist_alloc(&rp, NV_UNIQUE_NAME, 0)) != 0)
		return (v8plus_nverr(err, NULL));

	v8::TryCatch tc;
	if (it->second.ch_persist) {
		res = V8_LOCAL(it->second.ch_phdl, v8::Function)->Call(
		    v8::Context::GetCurrent()->Global(), argc, argv);
	} else {
		res = it->second.ch_hdl->Call(
		    v8::Context::GetCurrent()->Global(), argc, argv);
	}
	if (tc.HasCaught()) {
		v8plus_throw_v8_exception(tc.Exception());
		tc.Reset();
		nvlist_free(rp);
		return (NULL);
	} else if ((err = nvlist_add_v8_Value(rp, "res", res)) != 0) {
		nvlist_free(rp);
		return (v8plus_nverr(err, "res"));
	}

	return (rp);
}

extern "C" nvlist_t *
v8plus_method_call_direct(void *cop, const char *name, const nvlist_t *lp)
{
	HANDLE_SCOPE(scope);
	v8plus::ObjectWrap *op = v8plus::ObjectWrap::objlookup(cop);
	const int max_argc = nvlist_length(lp);
	int argc, err;
	v8::Handle<v8::Value> argv[max_argc];
	v8::Handle<v8::Value> res;
	nvlist_t *rp;

	if (v8plus_in_event_thread() != _B_TRUE)
		v8plus_panic("direct method call outside of event loop");

	argc = max_argc;
	nvlist_to_v8_argv(lp, &argc, argv);

	if ((err = nvlist_alloc(&rp, NV_UNIQUE_NAME, 0)) != 0)
		return (v8plus_nverr(err, NULL));

	v8::TryCatch tc;
	res = op->call(name, argc, argv);
	if (tc.HasCaught()) {
		v8plus_throw_v8_exception(tc.Exception());
		tc.Reset();
		nvlist_free(rp);
		return (NULL);
	} else if ((err = nvlist_add_v8_Value(rp, "res", res)) != 0) {
		nvlist_free(rp);
		return (v8plus_nverr(err, "res"));
	}

	return (rp);
}

extern "C" int
nvlist_lookup_v8plus_jsfunc(const nvlist_t *lp, const char *name,
    v8plus_jsfunc_t *vp)
{
	uint64_t *lvp;
	uint_t nv;
	int err;

	err = nvlist_lookup_uint64_array(const_cast<nvlist_t *>(lp),
	    name, &lvp, &nv);
	if (err != 0)
		return (err);

	if (nv != 1)
		v8plus_panic("bad array size %u for callback hash tag", nv);

	*vp = *lvp;
	return (0);
}

extern "C" void
v8plus_jsfunc_hold(v8plus_jsfunc_t f)
{
	std::unordered_map<uint64_t, cb_hdl_t>::iterator it;

	if ((it = cbhash.find(f)) == cbhash.end())
		v8plus_panic("callback hash tag %llu not found", f);

	if (!it->second.ch_persist) {
		V8_PF_ASSIGN(it->second.ch_phdl, it->second.ch_hdl);
		it->second.ch_persist = _B_TRUE;
	}
	++it->second.ch_refs;

	/*
	 * If the consumer puts a hold on a callback, we should also put a hold
	 * on the V8 event loop to prevent it dematerialising beneath us.
	 */
	v8plus_eventloop_hold();
}

extern "C" void
v8plus_jsfunc_rele_direct(v8plus_jsfunc_t f)
{
	v8::Local<v8::Function> lfh;
	std::unordered_map<uint64_t, cb_hdl_t>::iterator it;

	if ((it = cbhash.find(f)) == cbhash.end())
		v8plus_panic("callback hash tag %llu not found", f);

	if (it->second.ch_refs == 0)
		v8plus_panic("releasing unheld callback hash tag %llu", f);

	if (--it->second.ch_refs == 0) {
		if (it->second.ch_persist) {
			it->second.ch_phdl.Dispose();
		}
		cbhash.erase(it);
	}

	/*
	 * Release the event loop hold we took in v8plus_jsfunc_hold():
	 */
	v8plus_eventloop_rele_direct();
}

static size_t
library_name(const char *base, const char *version, char *buf, size_t len)
{
#ifdef __MACH__
	return (snprintf(buf, len, "lib%s.%s%sdylib", base,
	    version ? version : "", version ? "." : ""));
#else
	return (snprintf(buf, len, "lib%s.so%s%s", base,
	    version ? "." : "", version ? version : ""));
#endif
}

/*
 * This is really gross: we need to free up JS function slots when then list
 * is freed, but there's no way for us to know that's happening.  So we
 * interpose on nvlist_free() here, checking for function slots to free iff
 * this is a list that has a V8 JS function handle in it.  Lists created by
 * someone else, even if they have uint64 arrays in them, are passed through.
 * This whole thing makes me want to cry.  Why can't we just have a decent
 * JS VM?!
 */
extern "C" void
nvlist_free(nvlist_t *lp)
{
	uint64_t *vp;
	uint_t nv;
	nvpair_t *pp = NULL;

	if (lp == NULL)
		return;

	if (__real_nvlist_free == NULL) {
		char *libname;
		size_t len;
		void *dlhdl;

		len = library_name("nvpair", "1", NULL, 0) + 1;
		libname = reinterpret_cast<char *>(alloca(len));
		(void) library_name("nvpair", "1", libname, len);

		dlhdl = dlopen(libname, RTLD_LAZY | RTLD_LOCAL);
		if (dlhdl == NULL) {
			v8plus_panic("unable to dlopen libnvpair: %s",
			    dlerror());
		}
		__real_nvlist_free = (void (*)(nvlist_t *))
		    dlsym(dlhdl, "nvlist_free");
		if (__real_nvlist_free == NULL)
			v8plus_panic("unable to find nvlist_free");
	}

	if (nvlist_exists(lp, V8PLUS_JSF_COOKIE)) {
		while ((pp = nvlist_next_nvpair(lp, pp)) != NULL) {
			if (nvpair_type(pp) != DATA_TYPE_UINT64_ARRAY)
				continue;
			if (nvpair_value_uint64_array(pp, &vp, &nv) != 0) {
				v8plus_panic(
				    "unable to obtain callback hash tag");
			}
			if (nv != 1) {
				v8plus_panic(
				    "bad array size %u for callback hash tag",
				    nv);
			}
			v8plus_jsfunc_rele(*vp);
		}
	}

	__real_nvlist_free(lp);
}

extern "C" int
nvpair_value_v8plus_jsfunc(const nvpair_t *pp, v8plus_jsfunc_t *vp)
{
	uint64_t *lvp;
	uint_t nv;
	int err;

	if ((err = nvpair_value_uint64_array((nvpair_t *)pp, &lvp, &nv)) != 0)
		return (err);

	*vp = *lvp;

	return (0);
}

extern "C" void
v8plus_obj_hold(const void *cop)
{
	v8plus::ObjectWrap *op = v8plus::ObjectWrap::objlookup(cop);
	op->public_Ref();

	/*
	 * If the consumer puts a hold on an object, we should also put a hold
	 * on the V8 event loop to prevent it dematerialising beneath us.
	 */
	v8plus_eventloop_hold();
}

extern "C" void
v8plus_obj_rele_direct(const void *cop)
{
	v8plus::ObjectWrap *op = v8plus::ObjectWrap::objlookup(cop);
	op->public_Unref();

	/*
	 * Release the event loop hold we took in v8plus_obj_hold():
	 */
	v8plus_eventloop_rele_direct();
}

extern "C" void
v8plus_rethrow_pending_exception(void)
{
	V8PLUS_THROW_PENDING();
}
