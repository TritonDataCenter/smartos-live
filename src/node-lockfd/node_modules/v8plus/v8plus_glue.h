/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 */

#ifndef	_V8PLUS_GLUE_H
#define	_V8PLUS_GLUE_H

#include <stdarg.h>
#include <libnvpair.h>
#include "v8plus_errno.h"

#ifdef	__cplusplus
extern "C" {
#endif	/* __cplusplus */

#define	__UNUSED	__attribute__((__unused__))

#define	V8PLUS_ARG_F_NOEXTRA	0x01

#define	V8PLUS_ERRMSG_LEN	512
#define	V8PLUS_JSF_COOKIE	".__v8plus_jsfunc_cookie"

#define	V8PLUS_MODULE_VERSION	1
#define	V8PLUS_STRINGIFY_HELPER(_x)	#_x
#define	V8PLUS_STRINGIFY(_x)	V8PLUS_STRINGIFY_HELPER(_x)

typedef enum v8plus_type {
	V8PLUS_TYPE_NONE = 0,		/* N/A */
	V8PLUS_TYPE_STRING,		/* char * */
	V8PLUS_TYPE_NUMBER,		/* double */
	V8PLUS_TYPE_BOOLEAN,		/* boolean_t */
	V8PLUS_TYPE_JSFUNC,		/* v8plus_jsfunc_t */
	V8PLUS_TYPE_OBJECT,		/* nvlist_t * */
	V8PLUS_TYPE_NULL,		/* -- */
	V8PLUS_TYPE_UNDEFINED,		/* -- */
	V8PLUS_TYPE_INVALID,		/* data_type_t */
	V8PLUS_TYPE_ANY,		/* nvpair_t * */
	V8PLUS_TYPE_STRNUMBER64,	/* uint64_t */
	V8PLUS_TYPE_INL_OBJECT		/* ... */
} v8plus_type_t;

typedef uint64_t v8plus_jsfunc_t;

/*
 * C constructor, destructor, and method prototypes.  See README.md.
 */
typedef nvlist_t *(*v8plus_c_ctor_f)(const nvlist_t *, void **);
typedef nvlist_t *(*v8plus_c_static_f)(const nvlist_t *);
typedef nvlist_t *(*v8plus_c_method_f)(void *, const nvlist_t *);
typedef void (*v8plus_c_dtor_f)(void *);

typedef struct v8plus_method_descr {
	const char *md_name;
	v8plus_c_method_f md_c_func;
} v8plus_method_descr_t;

typedef struct v8plus_static_descr {
	const char *sd_name;
	v8plus_c_static_f sd_c_func;
} v8plus_static_descr_t;

extern __thread v8plus_errno_t _v8plus_errno;
extern __thread char _v8plus_errmsg[V8PLUS_ERRMSG_LEN];

/*
 * Set the errno and message, indicating an error.  The code and
 * printf-formatted message, if one is given, will be used in constructing
 * an exception to be thrown in JavaScript if your method later returns NULL
 * or an nvlist with an "err" member.
 */
extern nvlist_t *v8plus_verror(v8plus_errno_t, const char *, va_list);
extern nvlist_t *v8plus_error(v8plus_errno_t, const char *, ...);

/*
 * Suicide.  It's always an option.  Try to avoid using this as it's not
 * very nice to kill the entire node process; if at all possible we need
 * to throw a JavaScript exception instead.
 */
extern void v8plus_panic(const char *, ...) __PRINTFLIKE(1) __NORETURN;

/*
 * As above, this convenience function sets the error code and message based
 * on the nvlist-generated error code in its first argument.  The second
 * argument, which may be NULL, should contain the name of the member on
 * which the error occurred.
 */
extern nvlist_t *v8plus_nverr(int, const char *);

/*
 * Similarly, for system errors.  Not all possible errno values are handled.
 */
extern nvlist_t *v8plus_syserr(int, const char *, ...);

/*
 * Clear the errno and message.  This is needed only when one wishes to return
 * NULL from a C method whose return type is effectively void.  The idiom is
 *
 * return (v8plus_void());
 */
extern nvlist_t *v8plus_void(void);

/*
 * Find the named V8 function in the nvlist.  Analogous to other lookup
 * routines; see libnvpair(3lib), with an important exception: the
 * nvlist_lookup_v8plus_jsfunc() and nvpair_value_v8plus_jsfunc() functions
 * place a hold on the underlying function object, which must be released by C
 * code when it is no longer needed.  See the documentation to understand how
 * this works.  The add routine is of very limited utility because there is no
 * mechanism for creating a JS function from C.  It can however be used to
 * return a function (or object containing one, etc.) from a deferred
 * completion routine in which a JS function has been invoked that returned
 * such a thing to us.
 */
extern int nvlist_lookup_v8plus_jsfunc(const nvlist_t *, const char *,
    v8plus_jsfunc_t *);
extern int nvpair_value_v8plus_jsfunc(const nvpair_t *, v8plus_jsfunc_t *);
extern void v8plus_jsfunc_hold(v8plus_jsfunc_t);
extern void v8plus_jsfunc_rele(v8plus_jsfunc_t);
extern void v8plus_jsfunc_rele_direct(v8plus_jsfunc_t);

/*
 * Place or release a hold on the V8 representation of the specified C object.
 * This is rarely necessary; v8plus_defer() performs this action for you, but
 * other asynchronous mechanisms may require it.  If you are returning from
 * a method call but have stashed a reference to the object somewhere and are
 * not calling v8plus_defer(), you must call this first.  Holds and releases
 * must be balanced.  Use of the object within a thread after releasing is a
 * bug.
 */
extern void v8plus_obj_hold(const void *);
extern void v8plus_obj_rele(const void *);
extern void v8plus_obj_rele_direct(const void *);

/*
 * Convenience functions for dealing with JS arguments.
 */
extern v8plus_type_t v8plus_typeof(const nvpair_t *);
extern int v8plus_args(const nvlist_t *, uint_t, v8plus_type_t t, ...);
extern nvlist_t *v8plus_obj(v8plus_type_t, ...);
extern int v8plus_obj_setprops(nvlist_t *, v8plus_type_t, ...);

/*
 * Perform a background, possibly blocking and/or expensive, task.  First,
 * the worker function will be enqueued for execution on another thread; its
 * first argument is a pointer to the C object on which to operate, and the
 * second is arbitrary per-call context, arguments, etc. defined by the caller.
 * When that worker function has completed execution, the completion function
 * will be invoked in the main thread.  Its arguments are the C object, the
 * original context pointer, and the return value from the worker function.
 * See the documentation for a typical use case.
 */
typedef void *(*v8plus_worker_f)(void *, void *);
typedef void (*v8plus_completion_f)(void *, void *, void *);

extern void v8plus_defer(void *, void *, v8plus_worker_f, v8plus_completion_f);

/*
 * Call an opaque JavaScript function from C.  The caller is responsible for
 * freeing the returned list.  The first argument is not const because it is
 * possible for the JS code to modify the function represented by the cookie.
 */
extern nvlist_t *v8plus_call(v8plus_jsfunc_t, const nvlist_t *);
extern nvlist_t *v8plus_call_direct(v8plus_jsfunc_t, const nvlist_t *);

/*
 * Call the named JavaScript function in the context of the JS object
 * represented by the native object.  Calling and return conventions are the
 * same as for the C interfaces; i.e., the nvlist will be converted into JS
 * objects and the return value or exception will be in the "res" or "err"
 * members of the nvlist that is returned, respectively.  If an internal
 * error occurs, NULL is returned and _v8plus_errno set accordingly.  The
 * results of calling a method implemented in C via this interface are
 * undefined.
 *
 * These methods can be used in concert with JS code to emit events
 * asynchronously; see the documentation.
 *
 * Note: As JavaScript functions must be called from the event loop thread,
 * v8plus_method_call() contains logic to determine whether we are in the
 * correct context or not.  If we are running on some other thread we will
 * queue the request and sleep, waiting for the event loop thread to make the
 * call.  In the simple case, where we are already in the correct thread,
 * we make the call directly.  v8plus_method_call_direct() assumes we are
 * on the correct thread and always makes the call directly.
 */
extern nvlist_t *v8plus_method_call(void *, const char *, const nvlist_t *);
extern nvlist_t *v8plus_method_call_direct(void *, const char *,
    const nvlist_t *);

/*
 * These functions allow the consumer to hold the V8 event loop open for
 * potential input from other threads.  If your process blocks in another
 * thread, e.g. an event subscription thread, you must signal to v8plus
 * that the event loop should remain active.  Calls to v8plus_eventloop_hold()
 * and v8plus_eventloop_rele() should be balanced.  It is safe to call
 * v8plus_eventloop_rele() from outside the event loop thread.
 *
 * Note: Holds obtained via v8plus_obj_hold() and v8plus_jsfunc_hold() will
 * also automatically hold the event loop, removing the need to use this
 * interface explicitly.
 */
extern void v8plus_eventloop_hold(void);
extern void v8plus_eventloop_rele(void);
extern void v8plus_eventloop_rele_direct(void);

/*
 * These methods are analogous to strerror(3c) and similar functions; they
 * translate among error names, codes, and default messages.  There is
 * normally little need for these functions in C methods, as everything
 * necessary to construct a JavaScript exception is done by v8+, but these
 * may be useful in the construction of supplementary exception decorations
 * for debugging purposes.
 */
extern const char *v8plus_strerror(v8plus_errno_t);
extern const char *v8plus_errname(v8plus_errno_t);
extern const char *v8plus_excptype(v8plus_errno_t);

typedef struct v8plus_module_defn {
	uint_t vmd_version;
	const char *vmd_modname;
	const char *vmd_filename;
	uint_t vmd_nodeflags;
	struct v8plus_module_defn *vmd_link;
	v8plus_c_ctor_f vmd_ctor;
	v8plus_c_dtor_f vmd_dtor;
	const char *vmd_js_factory_name;
	const char *vmd_js_class_name;
	const v8plus_method_descr_t *vmd_methods;
	uint_t vmd_method_count;
	const v8plus_static_descr_t *vmd_static_methods;
	uint_t vmd_static_method_count;
	void *vmd_node[64];		/* v8plus use only */
} v8plus_module_defn_t;

#ifndef V8PLUS_NEW_API

/*
 * Provided by C code.  See README.md.
 */
extern const v8plus_c_ctor_f v8plus_ctor;
extern const v8plus_c_dtor_f v8plus_dtor;
extern const char *v8plus_js_factory_name;
extern const char *v8plus_js_class_name;
extern const v8plus_method_descr_t v8plus_methods[];
extern const uint_t v8plus_method_count;
extern const v8plus_static_descr_t v8plus_static_methods[];
extern const uint_t v8plus_static_method_count;

#endif	/* V8PLUS_NEW_API */

extern void v8plus_module_register(v8plus_module_defn_t *);

/*
 * Private methods.
 */
extern boolean_t v8plus_in_event_thread(void);
extern void v8plus_crossthread_init(void);

#ifdef	__cplusplus
}
#endif	/* __cplusplus */

#endif	/* _V8PLUS_GLUE_H */
