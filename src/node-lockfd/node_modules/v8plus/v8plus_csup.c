/*
 * Copyright (c) 2013 Joyent, Inc.  All rights reserved.
 */

#include <sys/ccompile.h>
#include <sys/debug.h>
#include <sys/queue.h>
#include <sys/types.h>
#include <sys/atomic.h>
#include <stdarg.h>
#include <string.h>
#include <strings.h>
#include <errno.h>
#include <uv.h>
#include <node_version.h>
#include <pthread.h>
#include "v8plus_glue.h"

__thread v8plus_errno_t _v8plus_errno;
__thread char _v8plus_errmsg[V8PLUS_ERRMSG_LEN];
static uint_t init_done;

typedef struct v8plus_uv_ctx {
	void *vuc_obj;
	void *vuc_ctx;
	void *vuc_result;
	v8plus_worker_f vuc_worker;
	v8plus_completion_f vuc_completion;
} v8plus_uv_ctx_t;

static STAILQ_HEAD(v8plus_callq_head, v8plus_async_call) _v8plus_callq =
    STAILQ_HEAD_INITIALIZER(_v8plus_callq);
static pthread_mutex_t _v8plus_callq_mtx;
static pthread_t _v8plus_uv_event_thread;
static uv_async_t _v8plus_uv_async;

static int _v8plus_eventloop_refcount;

typedef enum v8plus_async_call_type {
	ACT_OBJECT_CALL = 1,
	ACT_OBJECT_RELEASE,
	ACT_JSFUNC_CALL,
	ACT_JSFUNC_RELEASE,
	ACT_EVENTLOOP_RELEASE
} v8plus_async_call_type_t;

typedef enum v8plus_async_call_flags {
	ACF_COMPLETED	= 0x01,
	ACF_NOREPLY	= 0x02
} v8plus_async_call_flags_t;


typedef struct v8plus_async_call {
	v8plus_async_call_type_t vac_type;
	v8plus_async_call_flags_t vac_flags;

	/*
	 * For ACT_OBJECT_{CALL,RELEASE}:
	 */
	void *vac_cop;
	const char *vac_name;
	/*
	 * For ACT_JSFUNC_{CALL,RELEASE}:
	 */
	v8plus_jsfunc_t vac_func;

	/*
	 * Common call arguments:
	 */
	const nvlist_t *vac_lp;
	nvlist_t *vac_return;

	pthread_cond_t vac_cv;
	pthread_mutex_t vac_mtx;

	STAILQ_ENTRY(v8plus_async_call) vac_callq_entry;
} v8plus_async_call_t;

boolean_t
v8plus_in_event_thread(void)
{
	return (_v8plus_uv_event_thread == pthread_self() ? B_TRUE : B_FALSE);
}

static void
v8plus_async_callback(uv_async_t *async __UNUSED, int status __UNUSED)
{
	if (v8plus_in_event_thread() != B_TRUE)
		v8plus_panic("async callback called outside of event loop");

	for (;;) {
		v8plus_async_call_t *vac = NULL;

		/*
		 * Fetch the next queued method:
		 */
		if (pthread_mutex_lock(&_v8plus_callq_mtx) != 0)
			v8plus_panic("could not lock async queue mutex");
		if (!STAILQ_EMPTY(&_v8plus_callq)) {
			vac = STAILQ_FIRST(&_v8plus_callq);
			STAILQ_REMOVE_HEAD(&_v8plus_callq, vac_callq_entry);
		}
		if (pthread_mutex_unlock(&_v8plus_callq_mtx) != 0)
			v8plus_panic("could not unlock async queue mutex");

		if (vac == NULL)
			break;

		/*
		 * Run the queued method:
		 */
		if (vac->vac_flags & ACF_COMPLETED)
			v8plus_panic("async call already run");

		switch (vac->vac_type) {
		case ACT_OBJECT_CALL:
			vac->vac_return = v8plus_method_call_direct(
			    vac->vac_cop, vac->vac_name, vac->vac_lp);
			break;
		case ACT_OBJECT_RELEASE:
			v8plus_obj_rele_direct(vac->vac_cop);
			break;
		case ACT_JSFUNC_CALL:
			vac->vac_return = v8plus_call_direct(
			    vac->vac_func, vac->vac_lp);
			break;
		case ACT_JSFUNC_RELEASE:
			v8plus_jsfunc_rele_direct(vac->vac_func);
			break;
		case ACT_EVENTLOOP_RELEASE:
			v8plus_eventloop_rele_direct();
			break;
		}

		if (vac->vac_flags & ACF_NOREPLY) {
			/*
			 * The caller posted this event and is not sleeping
			 * on a reply.  Just free the call structure and move
			 * on.
			 */
			free(vac);
			if (vac->vac_lp != NULL)
				nvlist_free((nvlist_t *)vac->vac_lp);
			continue;
		}

		if (pthread_mutex_lock(&vac->vac_mtx) != 0)
			v8plus_panic("could not lock async call mutex");
		vac->vac_flags |= ACF_COMPLETED;
		if (pthread_cond_broadcast(&vac->vac_cv) != 0)
			v8plus_panic("could not signal async call condvar");
		if (pthread_mutex_unlock(&vac->vac_mtx) != 0)
			v8plus_panic("could not unlock async call mutex");
	}
}

/*
 * As we cannot manipulate v8plus/V8/Node structures directly from outside the
 * event loop thread, we push the call arguments onto a queue and post to the
 * event loop thread.  We then sleep on our condition variable until the event
 * loop thread makes the call for us and wakes us up.
 *
 * This routine implements the parts of this interaction common to all
 * variants.
 */
static nvlist_t *
v8plus_cross_thread_call(v8plus_async_call_t *vac)
{
	/*
	 * Common call structure initialisation:
	 */
	if (pthread_mutex_init(&vac->vac_mtx, NULL) != 0)
		v8plus_panic("could not init async call mutex");
	if (pthread_cond_init(&vac->vac_cv, NULL) != 0)
		v8plus_panic("could not init async call condvar");
	vac->vac_flags &= ~(ACF_COMPLETED);

	/*
	 * Post request to queue:
	 */
	if (pthread_mutex_lock(&_v8plus_callq_mtx) != 0)
		v8plus_panic("could not lock async queue mutex");
	STAILQ_INSERT_TAIL(&_v8plus_callq, vac, vac_callq_entry);
	if (pthread_mutex_unlock(&_v8plus_callq_mtx) != 0)
		v8plus_panic("could not unlock async queue mutex");
	uv_async_send(&_v8plus_uv_async);

	if (vac->vac_flags & ACF_NOREPLY) {
		/*
		 * The caller does not care about the reply, and has allocated
		 * the v8plus_async_call_t structure from the heap.  The
		 * async callback will free the storage when it completes.
		 */
		return (NULL);
	}

	/*
	 * Wait for our request to be serviced on the event loop thread:
	 */
	if (pthread_mutex_lock(&vac->vac_mtx) != 0)
		v8plus_panic("could not lock async call mutex");
	while (!(vac->vac_flags & ACF_COMPLETED)) {
		if (pthread_cond_wait(&vac->vac_cv, &vac->vac_mtx) != 0)
			v8plus_panic("could not wait on async call condvar");
	}
	if (pthread_mutex_unlock(&vac->vac_mtx) != 0)
		v8plus_panic("could not unlock async call mutex");

	if (pthread_cond_destroy(&vac->vac_cv) != 0)
		v8plus_panic("could not destroy async call condvar");
	if (pthread_mutex_destroy(&vac->vac_mtx) != 0)
		v8plus_panic("could not destroy async call mutex");

	return (vac->vac_return);
}

nvlist_t *
v8plus_method_call(void *cop, const char *name, const nvlist_t *lp)
{
	v8plus_async_call_t vac;

	if (v8plus_in_event_thread() == B_TRUE) {
		/*
		 * We're running in the event loop thread, so we can make the
		 * call directly.
		 */
		return (v8plus_method_call_direct(cop, name, lp));
	}

	bzero(&vac, sizeof (vac));
	vac.vac_type = ACT_OBJECT_CALL;
	vac.vac_cop = cop;
	vac.vac_name = name;
	vac.vac_lp = lp;

	return (v8plus_cross_thread_call(&vac));
}

nvlist_t *
v8plus_call(v8plus_jsfunc_t func, const nvlist_t *lp)
{
	v8plus_async_call_t vac;

	if (v8plus_in_event_thread() == B_TRUE) {
		/*
		 * We're running in the event loop thread, so we can make the
		 * call directly.
		 */
		return (v8plus_call_direct(func, lp));
	}

	bzero(&vac, sizeof (vac));
	vac.vac_type = ACT_JSFUNC_CALL;
	vac.vac_func = func;
	vac.vac_lp = lp;

	return (v8plus_cross_thread_call(&vac));
}

void
v8plus_obj_rele(const void *cop)
{
	v8plus_async_call_t *vac;

	if (v8plus_in_event_thread() == B_TRUE) {
		return (v8plus_obj_rele_direct(cop));
	}

	vac = calloc(1, sizeof (*vac));
	if (vac == NULL)
		v8plus_panic("could not allocate async call structure");

	vac->vac_type = ACT_OBJECT_RELEASE;
	vac->vac_flags = ACF_NOREPLY;
	vac->vac_cop = (void *)cop;

	(void) v8plus_cross_thread_call(vac);
}

void
v8plus_jsfunc_rele(v8plus_jsfunc_t f)
{
	v8plus_async_call_t *vac;

	if (v8plus_in_event_thread() == B_TRUE) {
		return (v8plus_jsfunc_rele_direct(f));
	}

	vac = calloc(1, sizeof (*vac));
	if (vac == NULL)
		v8plus_panic("could not allocate async call structure");

	vac->vac_type = ACT_JSFUNC_RELEASE;
	vac->vac_flags = ACF_NOREPLY;
	vac->vac_func = f;

	(void) v8plus_cross_thread_call(vac);
}

/*
 * Initialise structures for off-event-loop method calls.
 *
 * Note that uv_async_init() must be called inside the libuv event loop, so we
 * do it here.  We also want to record the thread ID of the Event Loop thread
 * so as to determine what kind of method calls to make later.
 */
void
v8plus_crossthread_init(void)
{
	if (atomic_swap_uint(&init_done, 1) != 0)
		return;

	_v8plus_uv_event_thread = pthread_self();
	if (uv_async_init(uv_default_loop(), &_v8plus_uv_async,
	    v8plus_async_callback) != 0)
		v8plus_panic("unable to initialise uv_async_t");
	if (pthread_mutex_init(&_v8plus_callq_mtx, NULL) != 0)
		v8plus_panic("unable to initialise mutex");

	/*
	 * If we do not unreference the async handle, then its mere
	 * existence will keep the event loop open forever.  If the consumer
	 * _wants_ this behaviour, they may call v8plus_eventloop_hold()
	 * from the event loop thread.
	 */
	uv_unref((uv_handle_t *)&_v8plus_uv_async);
}

void
v8plus_eventloop_hold(void)
{
	++_v8plus_eventloop_refcount;
	uv_ref((uv_handle_t *)&_v8plus_uv_async);
}

void
v8plus_eventloop_rele_direct(void)
{
	if (--_v8plus_eventloop_refcount < 1) {
		_v8plus_eventloop_refcount = 0;
		uv_unref((uv_handle_t *)&_v8plus_uv_async);
	}
}

void
v8plus_eventloop_rele(void)
{
	v8plus_async_call_t *vac;

	if (v8plus_in_event_thread() == B_TRUE) {
		return (v8plus_eventloop_rele_direct());
	}

	vac = calloc(1, sizeof (*vac));
	if (vac == NULL)
		v8plus_panic("could not allocate async call structure");

	vac->vac_type = ACT_EVENTLOOP_RELEASE;
	vac->vac_flags = ACF_NOREPLY;

	(void) v8plus_cross_thread_call(vac);
}

nvlist_t *
v8plus_verror(v8plus_errno_t e, const char *fmt, va_list ap)
{
	if (fmt == NULL) {
		if (e == V8PLUSERR_NOERROR) {
			*_v8plus_errmsg = '\0';
		} else {
			(void) snprintf(_v8plus_errmsg, V8PLUS_ERRMSG_LEN,
			    "%s", v8plus_strerror(e));
		}
	} else {
		(void) vsnprintf(_v8plus_errmsg, V8PLUS_ERRMSG_LEN, fmt, ap);
	}
	_v8plus_errno = e;

	return (NULL);
}

nvlist_t *
v8plus_error(v8plus_errno_t e, const char *fmt, ...)
{
	va_list ap;

	va_start(ap, fmt);
	(void) v8plus_verror(e, fmt, ap);
	va_end(ap);

	return (NULL);
}

static void __NORETURN
v8plus_vpanic(const char *fmt, va_list ap)
{
	(void) vfprintf(stderr, fmt, ap);
	(void) fflush(stderr);
	abort();
}

void
v8plus_panic(const char *fmt, ...)
{
	va_list ap;

	va_start(ap, fmt);
	v8plus_vpanic(fmt, ap);
	va_end(ap);
}

nvlist_t *
v8plus_nverr(int nverr, const char *member)
{
	(void) snprintf(_v8plus_errmsg, V8PLUS_ERRMSG_LEN,
	    "nvlist manipulation error on member %s: %s",
	    member == NULL ? "<none>" : member, strerror(nverr));

	switch (nverr) {
	case ENOMEM:
		_v8plus_errno = V8PLUSERR_NOMEM;
		break;
	case EINVAL:
		_v8plus_errno = V8PLUSERR_YOUSUCK;
		break;
	default:
		_v8plus_errno = V8PLUSERR_UNKNOWN;
		break;
	}

	return (NULL);
}

nvlist_t *
v8plus_syserr(int syserr, const char *fmt, ...)
{
	v8plus_errno_t e;
	va_list ap;

	switch (syserr) {
	case ENOMEM:
		e = V8PLUSERR_NOMEM;
		break;
	case EBADF:
		e = V8PLUSERR_BADF;
		break;
	default:
		e = V8PLUSERR_UNKNOWN;
		break;
	}

	va_start(ap, fmt);
	(void) v8plus_verror(e, fmt, ap);
	va_end(ap);

	return (NULL);
}

/*
 * The NULL nvlist with V8PLUSERR_NOERROR means we are returning void.
 */
nvlist_t *
v8plus_void(void)
{
	return (v8plus_error(V8PLUSERR_NOERROR, NULL));
}

v8plus_type_t
v8plus_typeof(const nvpair_t *pp)
{
	data_type_t t = nvpair_type((nvpair_t *)pp);

	switch (t) {
	case DATA_TYPE_DOUBLE:
		return (V8PLUS_TYPE_NUMBER);
	case DATA_TYPE_STRING:
		return (V8PLUS_TYPE_STRING);
	case DATA_TYPE_NVLIST:
		return (V8PLUS_TYPE_OBJECT);
	case DATA_TYPE_BOOLEAN_VALUE:
		return (V8PLUS_TYPE_BOOLEAN);
	case DATA_TYPE_BOOLEAN:
		return (V8PLUS_TYPE_UNDEFINED);
	case DATA_TYPE_BYTE:
	{
		uchar_t v;
		if (nvpair_value_byte((nvpair_t *)pp, &v) != 0 || v != 0)
			return (V8PLUS_TYPE_INVALID);
		return (V8PLUS_TYPE_NULL);
	}
	case DATA_TYPE_UINT64_ARRAY:
	{
		uint64_t *vp;
		uint_t nv;
		if (nvpair_value_uint64_array((nvpair_t *)pp, &vp, &nv) != 0 ||
		    nv != 1) {
			return (V8PLUS_TYPE_INVALID);
		}
		return (V8PLUS_TYPE_JSFUNC);
	}
	default:
		return (V8PLUS_TYPE_INVALID);
	}
}

static int
v8plus_arg_value(v8plus_type_t t, const nvpair_t *pp, void *vp)
{
	data_type_t dt = nvpair_type((nvpair_t *)pp);

	switch (t) {
	case V8PLUS_TYPE_NONE:
		return (-1);
	case V8PLUS_TYPE_STRING:
		if (dt == DATA_TYPE_STRING) {
			if (vp != NULL) {
				(void) nvpair_value_string((nvpair_t *)pp,
				    (char **)vp);
			}
			return (0);
		}
		return (-1);
	case V8PLUS_TYPE_NUMBER:
		if (dt == DATA_TYPE_DOUBLE) {
			if (vp != NULL) {
				(void) nvpair_value_double((nvpair_t *)pp,
				    (double *)vp);
			}
			return (0);
		}
		return (-1);
	case V8PLUS_TYPE_BOOLEAN:
		if (dt == DATA_TYPE_BOOLEAN_VALUE) {
			if (vp != NULL) {
				(void) nvpair_value_boolean_value(
				    (nvpair_t *)pp, (boolean_t *)vp);
			}
			return (0);
		}
		return (-1);
	case V8PLUS_TYPE_JSFUNC:
		if (dt == DATA_TYPE_UINT64_ARRAY) {
			uint_t nv;
			uint64_t *vpp;

			if (nvpair_value_uint64_array((nvpair_t *)pp,
			    &vpp, &nv) == 0 && nv == 1) {
				if (vp != NULL)
					*(v8plus_jsfunc_t *)vp = vpp[0];
				return (0);
			}
		}
		return (-1);
	case V8PLUS_TYPE_OBJECT:
		if (dt == DATA_TYPE_NVLIST) {
			if (vp != NULL) {
				(void) nvpair_value_nvlist((nvpair_t *)pp,
				    (nvlist_t **)vp);
			}
			return (0);
		}
		return (-1);
	case V8PLUS_TYPE_NULL:
		if (dt == DATA_TYPE_BYTE) {
			uchar_t v;

			if (nvpair_value_byte((nvpair_t *)pp, &v) == 0 &&
			    v == 0)
				return (0);
		}
		return (-1);
	case V8PLUS_TYPE_UNDEFINED:
		return (dt == DATA_TYPE_BOOLEAN ? 0 : -1);
	case V8PLUS_TYPE_ANY:
		if (vp != NULL)
			*(const nvpair_t **)vp = pp;
		return (0);
	case V8PLUS_TYPE_INVALID:
		if (vp != NULL)
			*(data_type_t *)vp = dt;
		return (0);
	case V8PLUS_TYPE_STRNUMBER64:
		if (dt == DATA_TYPE_STRING) {
			char *s;
			uint64_t v;

			(void) nvpair_value_string((nvpair_t *)pp, &s);
			errno = 0;
			v = (uint64_t)strtoull(s, NULL, 0);
			if (errno != 0)
				return (-1);
			if (vp != NULL)
				*(uint64_t *)vp = v;
			return (0);
		}
		return (-1);
	default:
		return (-1);
	}
}

int
v8plus_args(const nvlist_t *lp, uint_t flags, v8plus_type_t t, ...)
{
	v8plus_type_t nt;
	nvpair_t *pp;
	void *vp;
	va_list ap;
	uint_t i;
	char buf[32];

	va_start(ap, t);

	for (i = 0, nt = t; nt != V8PLUS_TYPE_NONE; i++) {
		switch (nt) {
		case V8PLUS_TYPE_UNDEFINED:
		case V8PLUS_TYPE_NULL:
			break;
		default:
			(void) va_arg(ap, void *);
		}

		(void) snprintf(buf, sizeof (buf), "%u", i);
		if (nvlist_lookup_nvpair((nvlist_t *)lp, buf, &pp) != 0) {
			(void) v8plus_error(V8PLUSERR_MISSINGARG,
			    "argument %u is required", i);
			return (-1);
		}

		if (v8plus_arg_value(nt, pp, NULL) != 0) {
			(void) v8plus_error(V8PLUSERR_BADARG,
			    "argument %u is of incorrect type", i);
			return (-1);
		}

		nt = va_arg(ap, data_type_t);
	}

	va_end(ap);

	if (flags & V8PLUS_ARG_F_NOEXTRA) {
		(void) snprintf(buf, sizeof (buf), "%u", i);
		if (nvlist_lookup_nvpair((nvlist_t *)lp, buf, &pp) == 0) {
			(void) v8plus_error(V8PLUSERR_EXTRAARG,
			    "superfluous extra argument(s) detected");
			return (-1);
		}
	}

	va_start(ap, t);

	for (i = 0, nt = t; nt != V8PLUS_TYPE_NONE; i++) {
		switch (nt) {
		case V8PLUS_TYPE_UNDEFINED:
		case V8PLUS_TYPE_NULL:
			vp = NULL;
			break;
		default:
			vp = va_arg(ap, void *);
		}

		(void) snprintf(buf, sizeof (buf), "%u", i);
		VERIFY(nvlist_lookup_nvpair((nvlist_t *)lp, buf, &pp) == 0);
		VERIFY(v8plus_arg_value(nt, pp, vp) == 0);

		nt = va_arg(ap, data_type_t);
	}

	va_end(ap);

	return (0);
}

static int
v8plus_obj_vsetprops(nvlist_t *lp, v8plus_type_t t, va_list *ap)
{
	v8plus_type_t nt = t;
	char *name;
	int err;

	/*
	 * Do not call va_start() or va_end() in this function!  We are limited
	 * to a single traversal of the arguments so that we can recurse to
	 * handle embedded object definitions.
	 */

	while (nt != V8PLUS_TYPE_NONE) {
		name = va_arg(*ap, char *);

		switch (nt) {
		case V8PLUS_TYPE_STRING:
		{
			char *s = va_arg(*ap, char *);
			if ((err = nvlist_add_string(lp, name, s)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_NUMBER:
		{
			double d = va_arg(*ap, double);
			if ((err = nvlist_add_double(lp, name, d)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_BOOLEAN:
		{
			boolean_t b = va_arg(*ap, boolean_t);
			if ((err = nvlist_add_boolean_value(lp,
			    name, b)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_JSFUNC:
		{
			v8plus_jsfunc_t j = va_arg(*ap, v8plus_jsfunc_t);
			if ((err = nvlist_add_uint64_array(lp,
			    name, &j, 1)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			if ((err = nvlist_add_string_array(lp,
			    V8PLUS_JSF_COOKIE, NULL, 0)) != 0) {
				(void) v8plus_nverr(err, V8PLUS_JSF_COOKIE);
				return (-1);
			}
			v8plus_jsfunc_hold(j);
			break;
		}
		case V8PLUS_TYPE_OBJECT:
		{
			const nvlist_t *op = va_arg(*ap, const nvlist_t *);
			if ((err = nvlist_add_nvlist(lp, name,
			    (nvlist_t *)op)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_NULL:
			if ((err = nvlist_add_byte(lp, name, 0)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		case V8PLUS_TYPE_UNDEFINED:
			if ((err = nvlist_add_boolean(lp, name)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		case V8PLUS_TYPE_ANY:
		{
			nvpair_t *pp = va_arg(*ap, nvpair_t *);
			if ((err = nvlist_add_nvpair(lp, pp)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_STRNUMBER64:
		{
			uint64_t v = va_arg(*ap, uint64_t);
			char s[32];
			(void) snprintf(s, sizeof (s), "%" PRIu64, v);
			if ((err = nvlist_add_string(lp, name, s)) != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_INL_OBJECT:
		{
			nvlist_t *slp;

			nt = va_arg(*ap, v8plus_type_t);
			err = nvlist_alloc(&slp, NV_UNIQUE_NAME, 0);
			if (err != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			if (v8plus_obj_vsetprops(slp, nt, ap) != 0)
				return (-1);

			err = nvlist_add_nvlist(lp, name, slp);
			nvlist_free(slp);
			if (err != 0) {
				(void) v8plus_nverr(err, name);
				return (-1);
			}
			break;
		}
		case V8PLUS_TYPE_INVALID:
		default:
			(void) v8plus_error(V8PLUSERR_YOUSUCK,
			    "invalid property type %d", nt);
			return (-1);
		}

		nt = va_arg(*ap, v8plus_type_t);
	}

	return (0);
}

nvlist_t *
v8plus_obj(v8plus_type_t t, ...)
{
	nvlist_t *rp;
	va_list ap;
	int err;

	if ((err = nvlist_alloc(&rp, NV_UNIQUE_NAME, 0)) != 0)
		return (v8plus_nverr(err, NULL));

	va_start(ap, t);
	err = v8plus_obj_vsetprops(rp, t, &ap);
	va_end(ap);

	if (err != 0) {
		nvlist_free(rp);
		rp = NULL;
	}

	return (rp);
}

int
v8plus_obj_setprops(nvlist_t *lp, v8plus_type_t t, ...)
{
	va_list ap;
	int err;

	va_start(ap, t);
	err = v8plus_obj_vsetprops(lp, t, &ap);
	va_end(ap);

	return (err);
}

static void
v8plus_uv_worker(uv_work_t *wp)
{
	v8plus_uv_ctx_t *cp = wp->data;

	cp->vuc_result = cp->vuc_worker(cp->vuc_obj, cp->vuc_ctx);
}

static void
#if NODE_VERSION_AT_LEAST(0, 9, 4)
v8plus_uv_completion(uv_work_t *wp, int ignored __UNUSED)
#else
v8plus_uv_completion(uv_work_t *wp)
#endif
{
	v8plus_uv_ctx_t *cp = wp->data;

	cp->vuc_completion(cp->vuc_obj, cp->vuc_ctx, cp->vuc_result);
	v8plus_obj_rele(cp->vuc_obj);
	free(cp);
	free(wp);
}

void
v8plus_defer(void *cop, void *ctxp, v8plus_worker_f worker,
    v8plus_completion_f completion)
{
	uv_work_t *wp = malloc(sizeof (uv_work_t));
	v8plus_uv_ctx_t *cp = malloc(sizeof (v8plus_uv_ctx_t));

	bzero(wp, sizeof (uv_work_t));
	bzero(cp, sizeof (v8plus_uv_ctx_t));

	v8plus_obj_hold(cop);
	cp->vuc_obj = cop;
	cp->vuc_ctx = ctxp;
	cp->vuc_worker = worker;
	cp->vuc_completion = completion;
	wp->data = cp;

	uv_queue_work(uv_default_loop(), wp, v8plus_uv_worker,
	    v8plus_uv_completion);
}

#ifndef V8PLUS_NEW_API

/*
 * The old API only ever supports a single integrated module.
 */
#ifdef V8PLUS_LIBRARY_MODEL
#error	"The old v8plus API is incompatible with the library model."
#endif

static void _v8plus_init(void) __attribute__((constructor));
static void
_v8plus_init(void)
{
	static v8plus_module_defn_t _v8plus_module;

	_v8plus_module.vmd_version = V8PLUS_MODULE_VERSION;
	_v8plus_module.vmd_modname = NODE_STRINGIFY(MODULE);
	_v8plus_module.vmd_filename = __FILE__;
	_v8plus_module.vmd_nodeflags = 0;
	_v8plus_module.vmd_link = NULL;
	_v8plus_module.vmd_ctor = v8plus_ctor;
	_v8plus_module.vmd_dtor = v8plus_dtor;
	_v8plus_module.vmd_js_factory_name = v8plus_js_factory_name;
	_v8plus_module.vmd_js_class_name = v8plus_js_class_name;
	_v8plus_module.vmd_methods = v8plus_methods;
	_v8plus_module.vmd_method_count = v8plus_method_count;
	_v8plus_module.vmd_static_methods = v8plus_static_methods;
	_v8plus_module.vmd_static_method_count = v8plus_static_method_count;

	v8plus_module_register(&_v8plus_module);
}

#endif
