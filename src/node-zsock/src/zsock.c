/*
 * Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
 * Copyright 2013 Joyent, Inc.  All rights reserved.
 */
#ifdef __sun
#include <sys/contract/process.h>
#include <sys/ctfs.h>
#include <sys/fork.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <time.h>
#include <unistd.h>
#include <limits.h>
#include <fcntl.h>
#include <alloca.h>
#include <errno.h>
#include <libcontract.h>
#include <libzonecfg.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#endif

#include <v8plus_glue.h>

#ifdef __sun

typedef struct zsock_create_ctx {
	char *zcc_path;
	char *zcc_zone;
	int zcc_backlog;
	v8plus_jsfunc_t zcc_callback;
	const char *zcc_syscall;
	int zcc_errno;
	int zcc_fd;
} zsock_create_ctx_t;

static const int BUF_SZ = 27;
static const char *PREFIX = "%s GMT T(%d) %s: ";
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

static void chomp(char *s) {
  while (*s && *s != '\n' && *s != '\r')
    s++;
  *s = 0;
}

static void debug(const char *fmt, ...) {
  char *buf = NULL;
  struct tm tm;
  time_t now;
  va_list alist;

  if (getenv("ZSOCK_DEBUG") == NULL) return;

  if ((buf = (char *)alloca(BUF_SZ)) == NULL)
    return;

  bzero(&tm, sizeof (tm));

  now = time(0);
  gmtime_r(&now, &tm);
  asctime_r(&tm, buf);
  chomp(buf);

  va_start(alist, fmt);

  fprintf(stderr, PREFIX, buf, pthread_self(), "DEBUG");
  vfprintf(stderr, fmt, alist);
  va_end(alist);
}

static int init_template(void) {
  int fd = 0;
  int err = 0;

  fd = open(CTFS_ROOT "/process/template", O_RDWR);
  if (fd == -1)
    return (-1);

  err |= ct_tmpl_set_critical(fd, 0);
  err |= ct_tmpl_set_informative(fd, 0);
  err |= ct_pr_tmpl_set_fatal(fd, CT_PR_EV_HWERR);
  err |= ct_pr_tmpl_set_param(fd, CT_PR_PGRPONLY | CT_PR_REGENT);
  if (err || ct_tmpl_activate(fd)) {
    (void) close(fd);
    return (-1);
  }

  return (fd);
}

static int contract_latest(ctid_t *id) {
  int cfd = 0;
  int r = 0;
  ct_stathdl_t st = {0};
  ctid_t result = {0};

  if ((cfd = open(CTFS_ROOT "/process/latest", O_RDONLY)) == -1)
    return (errno);
  if ((r = ct_status_read(cfd, CTD_COMMON, &st)) != 0) {
    (void) close(cfd);
    return (r);
  }

  result = ct_status_get_id(st);
  ct_status_free(st);
  (void) close(cfd);

  *id = result;
  return (0);
}

static int close_on_exec(int fd) {
  int flags = fcntl(fd, F_GETFD, 0);
  if ((flags != -1) && (fcntl(fd, F_SETFD, flags | FD_CLOEXEC) != -1))
    return (0);
  return (-1);
}

static int contract_open(ctid_t ctid,
			 const char *type,
			 const char *file,
			 int oflag) {
  char path[PATH_MAX];
  unsigned int n = 0;
  int fd = 0;

  if (type == NULL)
    type = "all";

  n = snprintf(path, PATH_MAX, CTFS_ROOT "/%s/%ld/%s", type, ctid, file);
  if (n >= sizeof(path)) {
    errno = ENAMETOOLONG;
    return (-1);
  }

  fd = open(path, oflag);
  if (fd != -1) {
    if (close_on_exec(fd) == -1) {
      int err = errno;
      (void) close(fd);
      errno = err;
      return (-1);
    }
  }
  return (fd);
}

static int contract_abandon_id(ctid_t ctid) {
  int fd = 0;
  int err = 0;

  fd = contract_open(ctid, "all", "ctl", O_WRONLY);
  if (fd == -1)
    return (errno);

  err = ct_ctl_abandon(fd);
  (void) close(fd);

  return (err);
}

static ssize_t read_fd(int fd, void *ptr, size_t nbytes, int *recvfd) {
  struct msghdr msg;
  struct iovec iov[1];
  ssize_t n = -1;
  union {
    struct cmsghdr cm;
    char control[CMSG_SPACE(sizeof(int))];
  } control_un;
  struct cmsghdr *cmptr = NULL;

  msg.msg_control = control_un.control;
  msg.msg_controllen = sizeof(control_un.control);
  msg.msg_name = NULL;
  msg.msg_namelen = 0;

  iov[0].iov_base = ptr;
  iov[0].iov_len = nbytes;
  msg.msg_iov = iov;
  msg.msg_iovlen = 1;

  if ((n = recvmsg(fd, &msg, 0)) <= 0) {
    return (n);
  }

  if ((cmptr = CMSG_FIRSTHDR(&msg)) != NULL &&
      cmptr->cmsg_len == CMSG_LEN(sizeof(int))) {
    if (cmptr->cmsg_level != SOL_SOCKET ||
	cmptr->cmsg_type != SCM_RIGHTS) {
      *recvfd = -1;
      errno = EINVAL;
      return (-1);
    }

    *recvfd = *(int *)CMSG_DATA(cmptr);
  } else {
    *recvfd = -1;
  }

  return (n);
}

static ssize_t write_fd(int fd, void *ptr, size_t nbytes, int sendfd) {
  struct msghdr msg;
  struct iovec iov[1];
  union {
    struct cmsghdr cm;
    char control[CMSG_SPACE(sizeof(int))];
  } control_un;
  struct cmsghdr *cmptr = NULL;

  msg.msg_control = control_un.control;
  msg.msg_controllen = sizeof(control_un.control);

  cmptr = CMSG_FIRSTHDR(&msg);
  cmptr->cmsg_len = CMSG_LEN(sizeof(int));
  cmptr->cmsg_level = SOL_SOCKET;
  cmptr->cmsg_type = SCM_RIGHTS;
  *(int *)CMSG_DATA(cmptr) = sendfd;

  msg.msg_name = NULL;
  msg.msg_namelen = 0;
  iov[0].iov_base = ptr;
  iov[0].iov_len = nbytes;
  msg.msg_iov = iov;
  msg.msg_iovlen = 1;

  return (sendmsg(fd, &msg, 0));
}

static int zsocket(zoneid_t zoneid, const char *path) {
  char c = 0;
  ctid_t ct = -1;
  int _errno = 0;
  int pid = 0;
  int sock_fd = 0;
  int sockfd[2] = {0};
  int stat = 0;
  int tmpl_fd = 0;
  int flags;
  struct sockaddr_un addr;
  size_t addr_len = 0;

  if (zoneid < 0) {
    return (-1);
  }

  if (path == NULL) {
    return (-1);
  }

  bzero(&addr, sizeof (addr));

  pthread_mutex_lock(&lock);

  if ((tmpl_fd = init_template()) < 0) {
    pthread_mutex_unlock(&lock);
    return (-1);
  }

  if (socketpair(AF_LOCAL, SOCK_STREAM, 0, sockfd) != 0) {
    (void) ct_tmpl_clear(tmpl_fd);
    pthread_mutex_unlock(&lock);
    return (-1);
  }

  pid = fork();
  debug("fork returned: %d\n", pid);
  if (pid < 0) {
    _errno = errno;
    (void) ct_tmpl_clear(tmpl_fd);
    close(sockfd[0]);
    close(sockfd[1]);
    errno = _errno;
    pthread_mutex_unlock(&lock);
    return (-1);
  }

  if (pid == 0) {
    (void) ct_tmpl_clear(tmpl_fd);
    (void) close(tmpl_fd);
    (void) close(sockfd[0]);

    if (zone_enter(zoneid) != 0) {
      debug("CHILD: zone_enter(%d) => %s\n", zoneid, strerror(errno));
      if (errno == EINVAL) {
	_exit(0);
      }
      _exit(1);
    }

    debug("CHILD: zone_enter(%d) => %d\n", zoneid, 0);
    (void) unlink(path);
    sock_fd = socket(PF_UNIX, SOCK_STREAM, 0);
    if (sock_fd < 0) {
      debug("CHILD: socket => %d\n", errno);
      _exit(2);
    }
    fcntl(sock_fd, F_SETFL, O_NONBLOCK);
    addr.sun_family = AF_UNIX;
    addr_len = sizeof(addr.sun_family) +
	       snprintf(addr.sun_path, sizeof(addr.sun_path), path);

    if (bind(sock_fd, (struct sockaddr *) &addr, addr_len) != 0) {
      debug("CHILD: bind => %d\n", errno);
      _exit(3);
    }

    if (write_fd(sockfd[1], (void *)"", 1, sock_fd) < 0) {
      debug("CHILD: write_fd => %d\n", errno);
      _exit(4);
    }

    debug("CHILD: write_fd => %d\n", errno);
    _exit(0);
  }

  if (contract_latest(&ct) == -1) {
    ct = -1;
  }
  (void) ct_tmpl_clear(tmpl_fd);
  (void) close(tmpl_fd);
  (void) contract_abandon_id(ct);
  (void) close(sockfd[1]);
  debug("PARENT: waitforpid(%d)\n", pid);
  while ((waitpid(pid, &stat, 0) != pid) && errno != ECHILD) ;

  if (WIFEXITED(stat) == 0) {
    debug("PARENT: Child didn't exit\n");
    _errno = ECHILD;
    sock_fd = -1;
  } else {
    stat = WEXITSTATUS(stat);
    debug("PARENT: Child exit status %d\n", stat);
    if (stat == 0) {
      read_fd(sockfd[0], &c, 1, &sock_fd);
    } else {
      _errno = stat;
      sock_fd = -1;
    }
  }

  close(sockfd[0]);
  pthread_mutex_unlock(&lock);
  if (sock_fd < 0) {
    errno = _errno;
  } else {
    if ((flags = fcntl(sock_fd, F_GETFD)) != -1) {
      flags |= FD_CLOEXEC;
      (void) fcntl(sock_fd, F_SETFD, flags);
    }

    errno = 0;
  }
  debug("zsocket returning fd=%d, errno=%d\n", sock_fd, errno);
  return (sock_fd);
}

static void
zsock_ctx_set_errno(zsock_create_ctx_t *ccp, const char *syscall, int err)
{
	if (ccp->zcc_syscall == NULL)
		ccp->zcc_syscall = syscall;

	ccp->zcc_errno = err;
}

static void *
zsocket_create(void *op __UNUSED, void *ctx)
{
	zsock_create_ctx_t *ccp = ctx;
	zoneid_t zoneid = getzoneidbyname(ccp->zcc_zone);
	int sock_fd = -1;
	int attempts = 1;

	if (zoneid < 0) {
		zsock_ctx_set_errno(ccp, "getzoneidbyname", errno);
		return (NULL);
	}

	do {
		/* This call suffers from EINTR, so just retry */
		sock_fd = zsocket(zoneid, ccp->zcc_path);
	} while (attempts++ < 3 && sock_fd < 0);

	ccp->zcc_fd = sock_fd;

	if (sock_fd < 0) {
		zsock_ctx_set_errno(ccp, "zsocket", errno);
		return (NULL);
	}

	if (listen(sock_fd, ccp->zcc_backlog) != 0) {
		zsock_ctx_set_errno(ccp, "listen", errno);
		return (NULL);
	}

	return (NULL);
}

static void
zsocket_create_done(void *op __UNUSED, void *ctx, void *res __UNUSED)
{
	zsock_create_ctx_t *ccp = ctx;
	nvlist_t *ap, *rp;
	char errmsg[128];

	if (ccp->zcc_fd < 0) {
		(void) snprintf(errmsg, sizeof (errmsg), "%s: %s",
		    ccp->zcc_syscall, strerror(ccp->zcc_errno));
		ap = v8plus_obj(
		    V8PLUS_TYPE_INL_OBJECT, "0",
			V8PLUS_TYPE_STRING, "message", errmsg,
			V8PLUS_TYPE_STRING, "name", "ErrnoException",
		    V8PLUS_TYPE_NONE,
		V8PLUS_TYPE_NONE);
	} else {
		ap = v8plus_obj(
		    V8PLUS_TYPE_NULL, "0",
		    V8PLUS_TYPE_NUMBER, "1", (double)ccp->zcc_fd,
		    V8PLUS_TYPE_NONE);
	}

	if (ap != NULL) {
		rp = v8plus_call(ccp->zcc_callback, ap);
		nvlist_free(ap);
		nvlist_free(rp);
	}

	v8plus_jsfunc_rele(ccp->zcc_callback);
	free(ccp->zcc_zone);
	free(ccp->zcc_path);
	free(ccp);
}

static nvlist_t *
zsock_bindings_zsocket(const nvlist_t *ap)
{
	char *zone;
	char *path;
	double d_backlog;
	int backlog;
	v8plus_jsfunc_t callback;
	zsock_create_ctx_t *ccp;

	if (v8plus_args(ap, 0,
	    V8PLUS_TYPE_STRING, &zone,
	    V8PLUS_TYPE_STRING, &path,
	    V8PLUS_TYPE_NUMBER, &d_backlog,
	    V8PLUS_TYPE_JSFUNC, &callback,
	    V8PLUS_TYPE_NONE) != 0)
		return (NULL);

	backlog = (int)d_backlog;

	if ((ccp = malloc(sizeof (zsock_create_ctx_t))) == NULL)
		return (v8plus_error(V8PLUSERR_NOMEM, "no memory for context"));

	bzero(ccp, sizeof (*ccp));

	ccp->zcc_zone = strdup(zone);
	ccp->zcc_path = strdup(path);
	ccp->zcc_backlog = backlog;
	v8plus_jsfunc_hold(callback);
	ccp->zcc_callback = callback;

	v8plus_defer(NULL, ccp, zsocket_create, zsocket_create_done);

	return (v8plus_void());
}
#endif

static v8plus_static_descr_t zsock_static[] = {
#ifdef	__sun
	{
		sd_name: "zsocket",
		sd_c_func: zsock_bindings_zsocket
	}
#endif
};

static v8plus_module_defn_t _zsock_mod = {
	.vmd_version = V8PLUS_MODULE_VERSION,
	.vmd_modname = "zsock_bindings",
	.vmd_filename = __FILE__,
	.vmd_nodeflags = 0,
	.vmd_link = NULL,
	.vmd_ctor = NULL,
	.vmd_dtor = NULL,
	.vmd_js_factory_name = "invalid_zsock_ctor",
	.vmd_js_class_name = "invalid_ZSocket_class",
	.vmd_methods = NULL,
	.vmd_method_count = 0,
	.vmd_static_methods = zsock_static,
	.vmd_static_method_count =
	    sizeof (zsock_static) / sizeof (zsock_static[0]),
	.vmd_node = { 0 }
};

static void _register_module(void) __attribute__((constructor));
static void
_register_module(void)
{
	v8plus_module_register(&_zsock_mod);
}
