#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <fcntl.h>
#include <errno.h>
#include <unistd.h>
#include <pthread.h>

#include <libnvpair.h>

#include "v8plus_glue.h"

typedef struct lockfd_args {
	v8plus_jsfunc_t lfa_cb;
	int lfa_fd;
	struct flock lfa_flock;
	boolean_t lfa_run_sync;
} lockfd_args_t;

static const char *
errno_to_code(int en)
{
	return (en == EAGAIN ? "EAGAIN" :
	    en == ENOLCK ? "ENOLCK" :
	    en == EINTR ? "EINTR" :
	    en == EDEADLK ? "EDEADLK" :
	    "");
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
	    V8PLUS_TYPE_NUMBER, "0", (double) ret,
	    V8PLUS_TYPE_STRING, "1", strerror(en),
	    V8PLUS_TYPE_STRING, "2", errno_to_code(en),
	    V8PLUS_TYPE_NONE);
	(void) v8plus_call(lfa->lfa_cb, ap);
	nvlist_free(ap);

	if (!lfa->lfa_run_sync) {
		/*
		 * Release our callback, held from the ititial call:
		 */
		v8plus_jsfunc_rele(lfa->lfa_cb);
	}

	free(lfa);

	return (NULL);
}

/*
 * Primary entrypoint from Javascript:
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
		 * Create a thread for the blocking fcntl(F_SETLKW) call:
		 */
		if (pthread_create(&newthr, NULL, lockfd_thread, lfa) != 0) {
			return (v8plus_error(V8PLUSERR_UNKNOWN,
			    "could not create thread"));
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
		sd_name: "lock_fd",
		sd_c_func: lockfd_lockfd
	}
};
const uint_t v8plus_static_method_count =
    sizeof (v8plus_static_methods) / sizeof (v8plus_static_methods[0]);
