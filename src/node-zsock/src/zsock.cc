// Copyright 2011 Mark Cavage <mcavage@gmail.com> All rights reserved.
#ifdef SunOS
#include <alloca.h>
#include <errno.h>
#include <fcntl.h>
#include <libcontract.h>
#include <libzonecfg.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/contract/process.h>
#include <sys/ctfs.h>
#include <sys/fork.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include <exception>
#endif

#include <node.h>
#include <v8.h>

#ifdef SunOS
static const int BUF_SZ = 27;
static const char *PREFIX = "%s GMT T(%d) %s: ";
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

// Node Macros require these
using v8::Persistent;
using v8::String;

#define RETURN_EXCEPTION(MSG)                                           \
  return v8::ThrowException(v8::Exception::Error(v8::String::New(MSG)))

#define RETURN_ARGS_EXCEPTION(MSG)                                      \
  return v8::ThrowException(v8::Exception::TypeError(v8::String::New(MSG)))

#define RETURN_ERRNO_EXCEPTION(MSG)             \
  return v8::ThrowException(node::ErrnoException(errno, MSG));

#define REQUIRE_ARGS(ARGS)                      \
  if (ARGS.Length() == 0)                       \
    RETURN_ARGS_EXCEPTION("missing arguments");

#define REQUIRE_INT_ARG(ARGS, I, VAR)                                   \
  REQUIRE_ARGS(ARGS);                                                   \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsNumber())                     \
    RETURN_ARGS_EXCEPTION("argument " #I " must be an integer");        \
  v8::Local<v8::Integer> _ ## VAR(ARGS[I]->ToInteger());                \
  int VAR = _ ## VAR->Value();

#define REQUIRE_STRING_ARG(ARGS, I, VAR)                        \
  REQUIRE_ARGS(ARGS);                                           \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsString())             \
    RETURN_ARGS_EXCEPTION("argument " #I " must be a string");  \
  v8::String::Utf8Value VAR(ARGS[I]->ToString());

#define REQUIRE_FUNCTION_ARG(ARGS, I, VAR)                              \
  REQUIRE_ARGS(ARGS);                                                   \
  if (ARGS.Length() <= (I) || !ARGS[I]->IsFunction())                   \
    RETURN_EXCEPTION("argument " #I " must be a function");             \
  v8::Local<v8::Function> VAR = v8::Local<v8::Function>::Cast(ARGS[I]);


static void chomp(char *s) {
  while (*s && *s != '\n' && *s != '\r')
    s++;
  *s = 0;
}

static void debug(const char *fmt, ...) {
  char *buf = NULL;
  struct tm tm = {};
  time_t now;
  va_list alist;

  if (getenv("ZSOCK_DEBUG") == NULL) return;

  if ((buf = (char *)alloca(BUF_SZ)) == NULL)
    return;

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

  fd = open64(CTFS_ROOT "/process/template", O_RDWR);
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

  if ((cfd = open64(CTFS_ROOT "/process/latest", O_RDONLY)) == -1)
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

  fd = open64(path, oflag);
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

    *recvfd = *(reinterpret_cast<int *>(CMSG_DATA(cmptr)));
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
  *(reinterpret_cast<int *>(CMSG_DATA(cmptr))) = sendfd;

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
  struct sockaddr_un addr = {0};
  size_t addr_len = 0;

  if (zoneid < 0) {
    return (-1);
  }

  if (path == NULL) {
    return (-1);
  }

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

// Start Node Specific things
class eio_baton_t {
 public:
  eio_baton_t(): _path(NULL),
                 _syscall(NULL),
                 _zone(NULL),
                 _backlog(5),
                 _errno(0),
                 _fd(-1) {}

  virtual ~eio_baton_t() {
    _callback.Dispose();

    if (_zone != NULL) free(_zone);
    if (_path != NULL) free(_path);
    if (_syscall != NULL) free(_syscall);

    _zone = NULL;
    _path = NULL;
    _syscall = NULL;

    _fd = -1;
  }

  void setErrno(const char *syscall, int errorno) {
    if (_syscall != NULL) {
      free(_syscall);
    }
    _syscall = strdup(syscall);
    _fd = -1;
    _errno = errorno;
  }

  char *_path;
  char *_syscall;
  char *_zone;
  int _backlog;
  int _errno;
  int _fd;

  v8::Persistent<v8::Function> _callback;

 private:
  eio_baton_t(const eio_baton_t &);
  eio_baton_t &operator=(const eio_baton_t &);
};

static void EIO_ZSocket(uv_work_t *req) {
  eio_baton_t *baton = static_cast<eio_baton_t *>(req->data);

  zoneid_t zoneid = getzoneidbyname(baton->_zone);
  if (zoneid < 0) {
    baton->setErrno("getzoneidbyname", errno);
    return;
  }
  int sock_fd = -1;
  int attempts = 1;
  do {
    // This call suffers from EINTR, so just retry
    sock_fd = zsocket(zoneid, baton->_path);
  } while (attempts++ < 3 && sock_fd < 0);
  if (sock_fd < 0) {
    baton->setErrno("zsocket", errno);
    return;
  }

  if (listen(sock_fd, baton->_backlog) != 0) {
    baton->setErrno("listen", errno);
    return;
  }

  baton->_fd = sock_fd;

  return;
}

static void EIO_After(uv_work_t *req) {
  v8::HandleScope scope;
  eio_baton_t *baton = static_cast<eio_baton_t *>(req->data);
  delete (req);

  int argc = 1;
  v8::Local<v8::Value> argv[2];

  if (baton->_fd < 0) {
    argv[0] = node::ErrnoException(baton->_errno, baton->_syscall);
  } else {
    argc = 2;
    argv[0] = v8::Local<v8::Value>::New(v8::Null());
    argv[1] = v8::Integer::New(baton->_fd);
  }

  v8::TryCatch try_catch;

  baton->_callback->Call(v8::Context::GetCurrent()->Global(), argc, argv);

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }

  delete baton;
}

static v8::Handle<v8::Value> ZSocket(const v8::Arguments& args) {
  v8::HandleScope scope;

  REQUIRE_STRING_ARG(args, 0, zone);
  REQUIRE_STRING_ARG(args, 1, path);
  REQUIRE_INT_ARG(args, 2, backlog);
  REQUIRE_FUNCTION_ARG(args, 3, callback);

  eio_baton_t *baton = new eio_baton_t();
  baton->_zone = strdup(*zone);
  if (baton->_zone == NULL) {
    delete baton;
    RETURN_EXCEPTION("OutOfMemory");
  }

  baton->_path = strdup(*path);
  if (baton->_path == NULL) {
    delete baton;
    RETURN_EXCEPTION("OutOfMemory");
  }

  baton->_backlog = backlog;
  baton->_callback = v8::Persistent<v8::Function>::New(callback);

  uv_work_t *req = new uv_work_t;
  req->data = baton;
  uv_queue_work(uv_default_loop(), req, EIO_ZSocket, EIO_After);

  return v8::Undefined();
}
#endif
extern "C" {
  void init(v8::Handle<v8::Object> target) {
    v8::HandleScope scope;
#ifdef SunOS
    NODE_SET_METHOD(target, "zsocket", ZSocket);
#endif
  }
}
