
/*
 * Copyright 2016, Joyent, Inc.
 */

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/file.h>

#include <libnvpair.h>

#include "v8plus_glue.h"

typedef struct lockfd_args {
	v8plus_jsfunc_t lfa_cb;
	int lfa_fd;
	struct flock lfa_flock;
	boolean_t lfa_run_sync;
} lockfd_args_t;

typedef struct flock_args {
	v8plus_jsfunc_t fla_cb;
	int fla_fd;
	int fla_op;
	boolean_t fla_run_sync;
} flock_args_t;

static const char *
errno_to_code(int en)
{
	switch (en) {
	case EAGAIN:
		return ("EAGAIN");
	case ENOLCK:
		return ("ENOLCK");
	case EINTR:
		return ("EINTR");
	case EDEADLK:
		return ("EDEADLK");
	case EBADF:
		return ("EBADF");
	case EINVAL:
		return ("EINVAL");
	case EOPNOTSUPP:
		return ("EOPNOTSUPP");
	default:
		return ("<unknown errno>");
	}
}

/*
 * Worker thread for blocking fcntl() calls:
 */
static void *
lockfd_thread(void *arg)
{
	lockfd_args_t *lfa = arg;
	nvlist_t *ap;
	int ret, en = 0;

	errno = 0;
	if ((ret = fcntl(lfa->lfa_fd, F_SETLKW, &lfa->lfa_flock)) == -1)
		en = errno;

	/*
	 * Call back into JS:
	 */
	ap = v8plus_obj(
	    V8PLUS_TYPE_NUMBER, "0", (double)ret,
	    V8PLUS_TYPE_STRING, "1", strerror(en),
	    V8PLUS_TYPE_STRING, "2", errno_to_code(en),
	    V8PLUS_TYPE_NONE);
	(void) v8plus_call(lfa->lfa_cb, ap);
	nvlist_free(ap);

	if (!lfa->lfa_run_sync) {
		/*
		 * Release our callback, held from the initial call:
		 */
		v8plus_jsfunc_rele(lfa->lfa_cb);
	}

	free(lfa);

	return (NULL);
}

/*
 * Worker thread for blocking flock() calls:
 */
static void *
flock_worker(void *cop, void *arg)
{
	flock_args_t *fla = arg;
	nvlist_t *ap;
	int ret, en = 0;

	errno = 0;
	while ((ret = flock(fla->fla_fd, fla->fla_op)) == -1) {
		if (errno != EINTR) {
			en = errno;
			break;
		}
	}

	/*
	 * Create object to pass back into JS:
	 */
	ap = v8plus_obj(
	    V8PLUS_TYPE_NUMBER, "0", (double)ret,
	    V8PLUS_TYPE_STRING, "1", strerror(en),
	    V8PLUS_TYPE_STRING, "2", errno_to_code(en),
	    V8PLUS_TYPE_NONE);

	return (ap);
}

/*
 * Function called upon completion of the flock_worker() thread
 */
static void
flock_completion(void *cop, void *arg, void *resp)
{
	flock_args_t *fla = arg;
	nvlist_t *ap = resp;

	/*
	 * Call callback with response object, if object allocation succeeded.
	 * An exception will have been queued if it failed.
	 */
	if (ap != NULL) {
		(void) v8plus_call(fla->fla_cb, ap);
		nvlist_free(ap);
	}

	if (!fla->fla_run_sync) {
		/* Release our callback, held from the initial call: */
		v8plus_jsfunc_rele(fla->fla_cb);
	}

	free(fla);
}

static void *
flock_thread(void *fla)
{
	flock_completion(NULL, fla, flock_worker(NULL, fla));
	return (NULL);
}

/*
 * Primary entrypoint from Javascript to lock_fd function:
 */
static nvlist_t *
lockfd_lockfd(const nvlist_t *ap)
{
	lockfd_args_t *lfa = calloc(1, sizeof (*lfa));
	pthread_t newthr;
	double double_fd;
	char *type;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_NUMBER, &double_fd,
	    V8PLUS_TYPE_STRING, &type,
	    V8PLUS_TYPE_BOOLEAN, &lfa->lfa_run_sync,
	    V8PLUS_TYPE_JSFUNC, &lfa->lfa_cb,
	    V8PLUS_TYPE_NONE) != 0) {
		free(lfa);
		return (v8plus_error(V8PLUSERR_BADARG, "bad args"));
	}
	lfa->lfa_fd = double_fd;

	/*
	 * Configure the flock struct for locking:
	 */
	if (strcmp(type, "read") == 0) {
		lfa->lfa_flock.l_type = F_RDLCK;
	} else if (strcmp(type, "write") == 0) {
		lfa->lfa_flock.l_type = F_WRLCK;
	} else if (strcmp(type, "unlock") == 0) {
		lfa->lfa_flock.l_type = F_UNLCK;
	} else {
		free(lfa);
		return (v8plus_error(V8PLUSERR_BADARG, "bad args: type"));
	}
	lfa->lfa_flock.l_whence = SEEK_SET;
	lfa->lfa_flock.l_start = 0;
	lfa->lfa_flock.l_len = 0;


	if (lfa->lfa_run_sync) {
		/*
		 * Run the blocking fcntl() call in the current thread:
		 */
		lockfd_thread(lfa);
	} else {
		/*
		 * Hold this function so that we can call it later from
		 * the other thread:
		 */
		v8plus_jsfunc_hold(lfa->lfa_cb);

		/*
		 * Create a worker thread for the blocking fcntl(F_SETLKW) call:
		 */
		if (pthread_create(&newthr, NULL, lockfd_thread, lfa) != 0) {
			return (v8plus_error(V8PLUSERR_UNKNOWN,
			    "could not create thread"));
		}
		if (pthread_detach(newthr) != 0) {
			return (v8plus_error(V8PLUSERR_UNKNOWN,
			    "could not detach thread"));
		}
	}

	return (v8plus_void());
}

/*
 * Primary entrypoint from JavaScript to flock function:
 */
static nvlist_t *
lockfd_flock(const nvlist_t *ap)
{
	flock_args_t *fla = calloc(1, sizeof (*fla));
	pthread_t newthr;
	double double_fd;
	double double_op;

	if (v8plus_args(ap, V8PLUS_ARG_F_NOEXTRA,
	    V8PLUS_TYPE_NUMBER, &double_fd,
	    V8PLUS_TYPE_NUMBER, &double_op,
	    V8PLUS_TYPE_BOOLEAN, &fla->fla_run_sync,
	    V8PLUS_TYPE_JSFUNC, &fla->fla_cb,
	    V8PLUS_TYPE_NONE) != 0) {
		free(fla);
		return (v8plus_error(V8PLUSERR_BADARG, "bad args"));
	}
	fla->fla_fd = double_fd;
	fla->fla_op = double_op;

	if (fla->fla_run_sync) {
		/*
		 * Run the blocking flock() call in the current thread:
		 */
		flock_completion(NULL, fla, flock_worker(NULL, fla));
	} else {
		/*
		 * Hold the function so that we can call it later from
		 * the deferred worker thread:
		 */
		v8plus_jsfunc_hold(fla->fla_cb);

		/*
		 * If we were using the libuv workers, this would just be:
		 *
		 * v8plus_defer(NULL, fla, flock_worker, flock_completion);
		 *
		 * But since v0.10.x has 4 workers by default, it would be very
		 * easy to queue up threads blocking on acquiring the lock, and
		 * therefore prevent any I/O from happening, which may prevent
		 * the holder of the lock from ever finishing their work. To
		 * avoid this, we create a new thread:
		 */
		if (pthread_create(&newthr, NULL, flock_thread, fla) != 0) {
			return (v8plus_error(V8PLUSERR_UNKNOWN,
			    "could not create thread"));
		}
		if (pthread_detach(newthr) != 0) {
			return (v8plus_error(V8PLUSERR_UNKNOWN,
			    "could not detach thread"));
		}
	}

	return (v8plus_void());
}

/*
 * v8plus Boilerplate
 */
const v8plus_c_ctor_f v8plus_ctor = NULL;
const v8plus_c_dtor_f v8plus_dtor = NULL;
const char *v8plus_js_factory_name = NULL;
const char *v8plus_js_class_name = NULL;

const v8plus_method_descr_t v8plus_methods[] = {};
const uint_t v8plus_method_count =
    sizeof (v8plus_methods) / sizeof (v8plus_methods[0]);

const v8plus_static_descr_t v8plus_static_methods[] = {
	{
		sd_name: "flock",
		sd_c_func: lockfd_flock
	},
	{
		sd_name: "lock_fd",
		sd_c_func: lockfd_lockfd
	}
};
const uint_t v8plus_static_method_count =
    sizeof (v8plus_static_methods) / sizeof (v8plus_static_methods[0]);
