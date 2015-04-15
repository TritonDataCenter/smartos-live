/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * This program serves as 'init' for a docker zone when running on SmartOS.
 *
 * It reads control parameters from the metadata service and then attempts to:
 *
 *  - mount /proc
 *  - setup networking
 *  - switch users/groups (based on docker:user)
 *  - setup environment
 *  - setup cmdline
 *  - exec requested cmd
 *
 * If successful, the zone's cmd will replace this process as init for the zone
 * after exec. If any error is encountered, this will exit non-zero and the zone
 * should fail to start.
 *
 * A log is also written to /var/log/sdc-dockerinit.log in order to debug
 * problems.
 */

#include <door.h>
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <libipadm.h>
#include <libinetutil.h>
#include <libnvpair.h>
#include <limits.h>
#include <pwd.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <termios.h>
#include <unistd.h>

#include <arpa/inet.h>

#include <net/if.h>
#include <net/route.h>
#include <netinet/in.h>

#include <sys/types.h>
#include <sys/mount.h>
#include <sys/mntent.h>
#include <sys/socket.h>
#include <sys/sockio.h>
#include <sys/wait.h>
#include <sys/stat.h>

#include "../json-nvlist/json-nvlist.h"
#include "../mdata-client/common.h"
#include "../mdata-client/dynstr.h"
#include "../mdata-client/plat.h"
#include "../mdata-client/proto.h"

#include "docker-common.h"

#define IPMGMTD_DOOR_OS "/etc/svc/volatile/ipadm/ipmgmt_door"
#define IPMGMTD_DOOR_LX "/native/etc/svc/volatile/ipadm/ipmgmt_door"
#define LOGFILE "/var/log/sdc-dockerinit.log"
#define RTMBUFSZ sizeof (struct rt_msghdr) + (3 * sizeof (struct sockaddr_in))
#define ATTACH_CHECK_INTERVAL 200000 // 200ms

int addRoute(const char *, const char *, const char *);
void buildCmdline();
void closeIpadmHandle();
void execCmdline();
void getBrand();
void getStdinStatus();
void killIpmgmtd();
void mountLXProc();
void mountOSDevFD();
void openIpadmHandle();
void plumbIf(const char *);
int raiseIf(char *, char *, char *);
void runIpmgmtd(char *cmdline[], char *env[]);
void setupHostname();
void setupInterface(nvlist_t *data);
void setupInterfaces();
void setupTerminal();
void waitIfAttaching();

/* global metadata client bits */
int initialized_proto = 0;
mdata_proto_t *mdp;

/* global data */
brand_t brand;
char **cmdline;
char **env;
char *hostname = NULL;
ipadm_handle_t iph;
char *ipmgmtd_door;
FILE *log_stream = stderr;
int open_stdin = 0;
char *path = NULL;
struct passwd *pwd = NULL;
struct group *grp = NULL;

const char *ROUTE_ADDR_MSG =
    "WARN addRoute: invalid %s address \"%s\" for %s: %s\n";
const char *ROUTE_WRITE_ERR_MSG =
    "WARN addRoute: socket write error "
    "(if=\"%s\", gw=\"%s\", dst=\"%s\": %s)\n";
const char *ROUTE_WRITE_LEN_MSG =
    "WARN addRoute: wrote %d/%d to socket "
    "(if=\"%s\", gw=\"%s\", dst=\"%s\": %s)\n";

/*
 * Special variables for a special ipmgmtd
 */
char *IPMGMTD_CMD_LX[] = {"/native/lib/inet/ipmgmtd", "ipmgmtd", NULL};
char *IPMGMTD_ENV_LX[] = {
    /* ipmgmtd thinks SMF is awesome */
    "SMF_FMRI=svc:/network/ip-interface-management:default",
    /*
     * Need to perform some tricks because ipmgmtd is going to mount
     * things in /etc/svc/volatile and setup a door there as well.
     * If we don't use thunk, we'll end up using the LX's /etc/svc
     * but other native commands (such as ifconfig-native) will try
     * to use /native/etc/svc/volatile.
     */
    "LD_NOENVIRON=1",
    "LD_NOCONFIG=1",
    "LD_LIBRARY_PATH_32=/native/lib:/native/usr/lib",
    "LD_PRELOAD_32=/native/usr/lib/brand/lx/lx_thunk.so.1",
    NULL
};
char *IPMGMTD_CMD_OS[] = {"/lib/inet/ipmgmtd", "ipmgmtd", NULL};
char *IPMGMTD_ENV_OS[] = {
    /* ipmgmtd thinks SMF is awesome */
    "SMF_FMRI=svc:/network/ip-interface-management:default",
    NULL
};

void
runIpmgmtd(char *cmd[], char *env[])
{
    pid_t pid;
    int status;

    pid = fork();
    if (pid == -1) {
        fatal(ERR_FORK_FAILED, "fork() failed: %s\n", strerror(errno));
    }

    if (pid == 0) {
        /* child */
        execve(cmd[0], cmd + 1, env);
        fatal(ERR_EXEC_FAILED, "execve(%s) failed: %s\n", cmd[0],
            strerror(errno));
    }

    /* parent */

    dlog("INFO started ipmgmtd[%d]\n", (int)pid);

    while (wait(&status) != pid) {
        /* EMPTY */;
    }

    if (WIFEXITED(status)) {
        dlog("INFO ipmgmtd[%d] exited: %d\n", (int)pid, WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        fatal(ERR_IPMGMTD_DIED, "ipmgmtd[%d] died on signal: %d\n",
            (int)pid, WTERMSIG(status));
    } else {
        fatal(ERR_IPMGMTD_CRASHED, "ipmgmtd[%d] failed in unknown way\n",
            (int)pid);
    }
}

void
setupTerminal() {
    int _stdin, _stdout, _stderr;
    int ctty = 0;
    const char *data;

    data = mdataGet("docker:tty");
    if (data != NULL && strcmp("true", data) == 0) {
        ctty = 1;
    }

    dlog("SWITCHING TO /dev/zfd/*\n");

    /*
     * If 'OpenStdin' is set on the container we reopen stdin as connected to
     * the zfd. Otherwise we leave it opened as /dev/null.
     */
    if (open_stdin) {
        if (close(0) == -1) {
            fatal(ERR_CLOSE, "failed to close(0): %s\n", strerror(errno));
        }

        _stdin = open("/dev/zfd/0", O_RDWR);
        if (_stdin == -1) {
            if (errno == ENOENT) {
                _stdin = open("/dev/null", O_RDONLY);
                if (_stdin == -1) {
                    fatal(ERR_OPEN_CONSOLE, "failed to open /dev/null: %s\n",
                        strerror(errno));
                }
            } else {
                fatal(ERR_OPEN_CONSOLE, "failed to open /dev/zfd/0: %s\n",
                    strerror(errno));
            }
        }
    }

    if (close(1) == -1) {
        fatal(ERR_CLOSE, "failed to close(1): %s\n", strerror(errno));
    }
    if (close(2) == -1) {
        fatal(ERR_CLOSE, "failed to close(2): %s\n", strerror(errno));
    }

    if (ctty) {
        /* Configure output as a controlling terminal */
        _stdout = open("/dev/zfd/0", O_WRONLY);
        if (_stdout == -1) {
            fatal(ERR_OPEN_CONSOLE, "failed to open /dev/zfd/0: %s\n",
                strerror(errno));
        }
        _stderr = open("/dev/zfd/0", O_WRONLY);
        if (_stderr == -1) {
            fatal(ERR_OPEN_CONSOLE, "failed to open /dev/zfd/0: %s\n",
                strerror(errno));
        }

        if (setsid() < 0) {
            fatal(ERR_OPEN_CONSOLE, "failed to create process session: %s\n",
                strerror(errno));
        }
        if (ioctl(_stdout, TIOCSCTTY, NULL) < 0) {
            fatal(ERR_OPEN_CONSOLE, "failed set controlling tty: %s\n",
                strerror(errno));
        }
    } else {
        /* Configure individual pipe style output */
        _stdout = open("/dev/zfd/1", O_WRONLY);
        if (_stdout == -1) {
            fatal(ERR_OPEN_CONSOLE, "failed to open /dev/zfd/1: %s\n",
                strerror(errno));
        }
        _stderr = open("/dev/zfd/2", O_WRONLY);
        if (_stderr == -1) {
            fatal(ERR_OPEN_CONSOLE, "failed to open /dev/zfd/2: %s\n",
                strerror(errno));
        }
    }
}

void
execCmdline()
{
    char *execname;

    execname = execName(cmdline[0]);

    /*
     * We need to drop privs *after* we've setup /dev/zfd/[0-2] since that
     * requires being root.
     */
    dlog("DROP PRIVS\n");

    if (grp != NULL) {
        if (setgid(grp->gr_gid) != 0) {
            fatal(ERR_SETGID, "setgid(%d): %s\n", grp->gr_gid, strerror(errno));
        }
    }
    if (pwd != NULL) {
        if (initgroups(pwd->pw_name, grp->gr_gid) != 0) {
            fatal(ERR_INITGROUPS, "initgroups(%s,%d): %s\n", pwd->pw_name,
                grp->gr_gid, strerror(errno));
        }
        if (setuid(pwd->pw_uid) != 0) {
            fatal(ERR_SETUID, "setuid(%d): %s\n", pwd->pw_uid, strerror(errno));
        }
    }

    execve(execname, cmdline, env);

    fatal(ERR_EXEC_FAILED, "execve(%s) failed: %s\n", cmdline[0],
        strerror(errno));
}

void
setupInterface(nvlist_t *data)
{
    char *iface, *gateway, *netmask, *ip;
    boolean_t primary;
    int ret;

    ret = nvlist_lookup_string(data, "interface", &iface);
    if (ret == 0) {
        plumbIf(iface);

        ret = nvlist_lookup_string(data, "ip", &ip);
        if (ret == 0) {
            ret = nvlist_lookup_string(data, "netmask", &netmask);
            if (ret == 0) {
                if (raiseIf(iface, ip, netmask) != 0) {
                    fatal(ERR_RAISE_IF, "Error bringing up interface %s",
                        iface);
                }
            }
            ret = nvlist_lookup_boolean_value(data, "primary", &primary);
            if ((ret == 0) && (primary == B_TRUE)) {
                ret = nvlist_lookup_string(data, "gateway", &gateway);
                if (ret == 0) {
                    (void) addRoute(iface, gateway, "0.0.0.0");
                }
            }
        }
    }
}

void
setupInterfaces()
{
    const char *json;
    int ret;
    nvlist_t *data, *nvl;
    nvpair_t *pair;

    json = mdataGet("sdc:nics");
    if (json == NULL) {
        dlog("WARN no NICs found in sdc:nics\n");
        return;
    }

    ret = nvlist_parse_json((char *)json, strlen(json), &nvl,
        NVJSON_FORCE_INTEGER);
    if (ret != 0) {
        fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
            " for sdc:nics, code: %d\n", ret);
    }

    for (pair = nvlist_next_nvpair(nvl, NULL); pair != NULL;
        pair = nvlist_next_nvpair(nvl, pair)) {

        if (nvpair_type(pair) == DATA_TYPE_NVLIST) {
            ret = nvpair_value_nvlist(pair, &data);
            if (ret != 0) {
                fatal(ERR_PARSE_JSON, "failed to parse nvpair json"
                    " for NIC code: %d\n", ret);
            }
            setupInterface(data);
        }
    }

    nvlist_free(nvl);
}

void
mountLXProc()
{
    dlog("MOUNT /proc (lx_proc)\n");

    (void) mkdir("/proc", 0555);

    if (mount("proc", "/proc", MS_DATA, "lx_proc", NULL, 0) != 0) {
        fatal(ERR_MOUNT_LXPROC, "failed to mount /proc: %s\n", strerror(errno));
    }
}

void
mountOSDevFD()
{
    dlog("MOUNT /dev/fd (fd)\n");

    if (mount("fd", "/dev/fd", MS_DATA, "fd", NULL, 0) != 0) {
        fatal(ERR_MOUNT_DEVFD, "failed to mount /dev/fd: %s\n",
            strerror(errno));
    }
}

void
buildCmdline()
{
    int idx;
    uint32_t cmd_len, entrypoint_len;
    nvlist_t *nvlc, *nvle;

    getMdataArray("docker:cmd", &nvlc, &cmd_len);
    getMdataArray("docker:entrypoint", &nvle, &entrypoint_len);

    if ((entrypoint_len + cmd_len) < 1) {
        /*
         * No ENTRYPOINT or CMD, docker prevents this at the API but if
         * something somehow gets in this state, it's an error.
         */
        fatal(ERR_NO_COMMAND, "No command specified\n");
    }

    cmdline = malloc((sizeof (char *)) * (entrypoint_len + cmd_len + 1));
    if (cmdline == NULL) {
        fatal(ERR_UNEXPECTED, "malloc() failed for cmdline[%d]: %s\n",
            (entrypoint_len + cmd_len + 1), strerror(errno));
    }

    /*
     * idx will be used for keeping track of where we are in cmdline. It
     * should point to the next writable index.
     */
    idx = 0;
    addValues(cmdline, &idx, ARRAY_ENTRYPOINT, nvle);
    addValues(cmdline, &idx, ARRAY_CMD, nvlc);
    /* cap it off with a NULL */
    cmdline[idx] = NULL;

    /*
     * NOTE: we don't nvlist_free(nvlc,nvle); here because we need this memory
     * for execve().
     */
}

void
getBrand()
{
    const char *data;

    data = mdataGet("sdc:brand");
    if (data == NULL) {
        fatal(ERR_NO_BRAND, "failed to determine brand\n");
    }

    if (strcmp("lx", data) == 0) {
        brand = LX;
    } else if (strcmp("joyent-minimal", data) == 0) {
        brand = JOYENT_MINIMAL;
    } else {
        fatal(ERR_INVALID_BRAND, "invalid brand: %s\n", data);
    }
}

void
getStdinStatus()
{
    const char *data;
    /* open_stdin is global */

    data = mdataGet("docker:open_stdin");
    if (data != NULL && strcmp("true", data) == 0) {
        open_stdin = 1;
    } else {
        open_stdin = 0;
    }
}

void
setupMtab()
{
    /*
     * Some images (such as busybox) link /etc/mtab to /proc/mounts so we only
     * write out /etc/mtab if it doesn't exist or is a regular file.
     */
    dlog("REPLACE /etc/mtab\n");
    if ((unlink("/etc/mtab") == -1) && (errno != ENOENT)) {
        fatal(ERR_UNLINK_MTAB, "failed to unlink /etc/mtab: %s\n",
            strerror(errno));
    }
    /*
     * We ignore mkdir() return since either it's failing because of EEXIST or
     * we'll fail to create symlink anyway.
     */
    (void) mkdir("/etc", 0755);
    if (symlink("/proc/mounts", "/etc/mtab") == -1) {
        fatal(ERR_WRITE_MTAB, "failed to symlink /etc/mtab: %s\n",
            strerror(errno));
    }
}

void
openIpadmHandle()
{
    ipadm_status_t status;

    if ((status = ipadm_open(&iph, IPH_LEGACY)) != IPADM_SUCCESS) {
        fatal(ERR_IPADM_DOOR, "Error opening ipadm handle: %s\n",
            ipadm_status2str(status));
    }

}

/*
 * If 'docker:noipmgmtd' is set to 'true' in the internal_metadata, we'll
 * kill ipmgmtd after we've setup the interfaces. Networking continues to
 * work but tools like 'ifconfig' will no longer work.
 *
 * Since this functionality is considered optional, it should avoid calling
 * fatal().
 */
void
killIpmgmtd()
{
    int door_fd;
    struct door_info info;
    pid_t ipmgmtd_pid;
    char *should_kill;
    int status;

    should_kill = (char *) mdataGet("docker:noipmgmtd");
    if ((should_kill == NULL) || (strncmp(should_kill, "true", 4) != 0)) {
        /* kill not requested */
        return;
    }

    /* find the ipmgmtd pid through the door */
    if ((door_fd = open(ipmgmtd_door, O_RDONLY)) < 0) {
        dlog("ERROR (skipping kill) failed to open ipmgmtd door(%s): %s\n",
            ipmgmtd_door, strerror(errno));
        return;
    }
    if (door_info(door_fd, &info) != 0) {
        dlog("ERROR (skipping kill) failed to load info from door: %s\n",
            strerror(errno));
        return;
    }

    ipmgmtd_pid = info.di_target;
    dlog("INFO ipmgmtd PID is %d\n", ipmgmtd_pid);

    (void) close(door_fd);

    if (ipmgmtd_pid > 0 && ipmgmtd_pid != getpid()) {
        if (kill(ipmgmtd_pid, SIGTERM) != 0) {
            dlog("ERROR failed to kill ipmgmtd[%d]: %s\n", ipmgmtd_pid,
                strerror(errno));
        } else {
            dlog("KILLED ipmgmtd[%d]\n", ipmgmtd_pid);
            waitpid(ipmgmtd_pid, &status, 0);
        }
    }
}

void
setupHostname()
{
    hostname = (char *) mdataGet("sdc:hostname");
    if (hostname != NULL) {
        dlog("INFO setting hostname = '%s'\n", hostname);
        if (sethostname(hostname, strlen(hostname)) != 0) {
            dlog("ERROR failed to set hostname: %s\n", strerror(errno));
        }
    }
}

void
closeIpadmHandle()
{
    if (iph) {
        ipadm_close(iph);
    }
}

void
plumbIf(const char *ifname)
{
    ipadm_status_t status;
    char ifbuf[LIFNAMSIZ];

    dlog("PLUMB %s\n", ifname);

    /* ipadm_create_if stomps on ifbuf, so create a copy: */
    (void) strncpy(ifbuf, ifname, sizeof (ifbuf));

    if ((status = ipadm_create_if(iph, ifbuf, AF_INET, IPADM_OPT_ACTIVE))
        != IPADM_SUCCESS) {
        fatal(ERR_PLUMB_IF, "ipadm_create_if error %d: plumbing %s/v4: %s\n",
            status, ifname, ipadm_status2str(status));
    }

    if ((status = ipadm_create_if(iph, ifbuf, AF_INET6, IPADM_OPT_ACTIVE))
        != IPADM_SUCCESS) {
        fatal(ERR_PLUMB_IF, "ipadm_create_if error %d: plumbing %s/v6: %s\n",
            status, ifname, ipadm_status2str(status));
    }
}

void
upIPv6Addr(char *ifname)
{
    struct lifreq lifr;
    int s;

    s = socket(AF_INET6, SOCK_DGRAM, 0);
    if (s == -1) {
        fatal(ERR_UP_IP6, "socket error %d: bringing up %s: %s\n",
            errno, ifname, strerror(errno));
    }

    (void) strncpy(lifr.lifr_name, ifname, sizeof (lifr.lifr_name));
    if (ioctl(s, SIOCGLIFFLAGS, (caddr_t)&lifr) < 0) {
        fatal(ERR_UP_IP6, "SIOCGLIFFLAGS error %d: bringing up %s: %s\n",
            errno, ifname, strerror(errno));
    }

    lifr.lifr_flags |= IFF_UP;
    if (ioctl(s, SIOCSLIFFLAGS, (caddr_t)&lifr) < 0) {
        fatal(ERR_UP_IP6, "SIOCSLIFFLAGS error %d: bringing up %s: %s\n",
            errno, ifname, strerror(errno));
    }

    (void) close(s);
}

int
raiseIf(char *ifname, char *addr, char *netmask)
{
    ipadm_status_t status;
    ipadm_addrobj_t  ipaddr;
    char cidraddr[BUFSIZ];
    int prefixlen;
    struct sockaddr_in mask_sin;

    dlog("RAISE[%s] addr=%s, netmask=%s\n", ifname, addr, netmask);

    mask_sin.sin_family = AF_INET;
    if (inet_pton(AF_INET, netmask, &mask_sin.sin_addr) != 1) {
        dlog("WARN raiseIf: invalid netmask address: %s\n", strerror(errno));
        return (-1);
    }

    prefixlen = mask2plen((struct sockaddr *)&mask_sin);
    (void) snprintf(cidraddr, sizeof (cidraddr), "%s/%d",
            addr, prefixlen);

    if ((status = ipadm_create_addrobj(IPADM_ADDR_STATIC, ifname, &ipaddr))
        != IPADM_SUCCESS) {
        dlog("WARN ipadm_create_addrobj error %d: addr %s (%s), "
            "interface %s: %s\n", status, addr, cidraddr, ifname,
            ipadm_status2str(status));
        return (-2);
    }

    if ((status = ipadm_set_addr(ipaddr, cidraddr, AF_INET))
        != IPADM_SUCCESS) {
        dlog("WARN ipadm_set_addr error %d: addr %s (%s), interface %s: %s\n",
            status, addr, cidraddr, ifname, ipadm_status2str(status));
        return (-3);
    }

    if ((status = ipadm_create_addr(iph, ipaddr,
        IPADM_OPT_ACTIVE | IPADM_OPT_UP)) != IPADM_SUCCESS) {
        dlog("WARN ipadm_create_addr error for %s: %s\n", ifname,
            ipadm_status2str(status));
        ipadm_destroy_addrobj(ipaddr);
        return (-4);
    }

    upIPv6Addr(ifname);

    ipadm_destroy_addrobj(ipaddr);
    return (0);
}

int
addRoute(const char *ifname, const char *gw, const char *dst)
{
    int idx;
    int len;
    char rtbuf[RTMBUFSZ];
    struct rt_msghdr *rtm = (struct rt_msghdr *)rtbuf;
    int sockfd;
    struct sockaddr_in *dst_sin = (struct sockaddr_in *)
        (rtbuf + sizeof (struct rt_msghdr));
    struct sockaddr_in *gw_sin = (struct sockaddr_in *) (dst_sin + 1);
    struct sockaddr_in *netmask_sin = (struct sockaddr_in *) (gw_sin + 1);

    dlog("ROUTE[%s] gw=%s, dst=%s\n", ifname, gw, dst);

    (void) bzero(rtm, RTMBUFSZ);
    rtm->rtm_addrs = RTA_DST | RTA_GATEWAY | RTA_NETMASK;
    rtm->rtm_flags = RTF_UP | RTF_STATIC | RTF_GATEWAY;
    rtm->rtm_msglen = sizeof (rtbuf);
    rtm->rtm_pid = getpid();
    rtm->rtm_type = RTM_ADD;
    rtm->rtm_version = RTM_VERSION;

    dst_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, dst, &(dst_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "destination", dst, ifname, strerror(errno));
        return (-1);
    }

    dst_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, gw, &(gw_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "gateway", gw, ifname, strerror(errno));
        return (-2);
    }

    netmask_sin->sin_family = AF_INET;
    if ((inet_pton(AF_INET, "0.0.0.0", &(netmask_sin->sin_addr))) != 1) {
        dlog(ROUTE_ADDR_MSG, "netmask", "0.0.0.0", ifname, strerror(errno));
        return (-3);
    }

    if ((idx = if_nametoindex(ifname)) == 0) {
        dlog("WARN addRoute: error getting interface index for %s: %s\n",
            ifname, strerror(errno));
        return (-4);
    }

    rtm->rtm_index = idx;

    if ((sockfd = socket(PF_ROUTE, SOCK_RAW, AF_INET)) < 0) {
        dlog("WARN addRoute: error opening socket: %s\n", strerror(errno));
        return (-5);
    }

    if ((len = write(sockfd, rtbuf, rtm->rtm_msglen)) < 0) {
        dlog(ROUTE_WRITE_ERR_MSG, ifname, gw, dst, strerror(errno));
        close(sockfd);
        return (-6);
    }

    if (len < rtm->rtm_msglen) {
        dlog(ROUTE_WRITE_LEN_MSG, len, rtm->rtm_msglen, ifname, gw, dst,
            strerror(errno));
        close(sockfd);
        return (-7);
    }

    close(sockfd);
    return (0);
}

void
setupNetworking()
{
    openIpadmHandle();

    plumbIf("lo0");
    (void) raiseIf("lo0", "127.0.0.1", "255.0.0.0");

    setupInterfaces();
    closeIpadmHandle();
}

/*
 * Fork a child and run all networking-related commands in a chroot to /native.
 * This is for two reasons:
 *
 * 1) ipadm_door_call() looks for a door in /etc/, but ipmgmtd in this zone is
 *    running in native (non-LX) mode, so it opens its door in /native/etc.
 * 2) ipadm_set_addr() calls getaddrinfo(), which relies on the existence of
 *    /etc/netconfig. This file is present in /native/etc instead.
 */
void
chrootNetworking() {
    pid_t pid;
    int status;

    dlog("INFO forking child for networking chroot\n");

    pid = fork();
    if (pid == -1) {
        fatal(ERR_FORK_FAILED, "networking fork() failed: %s\n",
            strerror(errno));
    }

    if (pid == 0) {
        /* child */

        if (chroot("/native") != 0) {
            fatal(ERR_CHROOT_FAILED, "chroot() failed: %s\n", strerror(errno));
        }

        setupNetworking();

        exit(0);
    } else {
        /* parent */
        dlog("<%d> Network setup child\n", (int)pid);

        while (wait(&status) != pid) {
            /* EMPTY */;
        }

        if (WIFEXITED(status)) {
            if (WEXITSTATUS(status) != 0) {
                fatal(ERR_CHILD_NET, "<%d> Networking child exited: %d\n",
                    (int)pid, WEXITSTATUS(status));
            }

            dlog("<%d> Networking child exited: %d\n",
                (int)pid, WEXITSTATUS(status));

        } else if (WIFSIGNALED(status)) {
            fatal(ERR_CHILD_NET, "<%d> Networking child died on signal: %d\n",
                (int)pid, WTERMSIG(status));
        } else {
            fatal(ERR_CHILD_NET,
                "<%d> Networking child failed in unknown way\n", (int)pid);
        }
    }
}

long long
currentTimestamp()
{
    struct timeval tv;

    if (gettimeofday(&tv, NULL) != 0) {
        dlog("gettimeofday(): %s\n", strerror(errno));
        return (0LL);
    }

    return (((long long) tv.tv_sec) * 1000LL) + (long long) (tv.tv_usec / 1000);
}

void
waitIfAttaching()
{
    int did_put = 0;
    int display_freq;
    int done = 0;
    unsigned int loops = 0;
    char *timeout;
    long long timestamp;
    long long now;

    if (ATTACH_CHECK_INTERVAL > 1000000) {
        display_freq = 1;
    } else {
        display_freq = (1000000 / ATTACH_CHECK_INTERVAL);
    }

    while (!done) {
        loops++;
        timeout = (char *) mdataGet("docker:wait_for_attach");
        if (timeout == NULL) {
            done = 1;
        } else {
            timestamp = strtoll((const char *) timeout, NULL, 10);
            if (timestamp <= 0LL) {
                fatal(ERR_ATTACH_NOT_TIMESTAMP,
                    "Invalid value for 'docker:wait_for_attach'\n");
            }
            now = currentTimestamp();
            if (now <= 0LL) {
                fatal(ERR_ATTACH_GETTIME, "Unable to determine current time\n");
            }

            if (!did_put) {
                mdataPut("__dockerinit_waiting_for_attach", timeout);
                did_put = 1;
            }

            if (loops == 1 || ((loops % display_freq) == 0)) {
                dlog("INFO Waiting until %lld for attach, currently: %lld\n",
                    timestamp, now);
            }

            if (timestamp < now) {
                fatal(ERR_ATTACH_TIMEDOUT, "Timed out waiting for attach\n");
            }

            (void) usleep(ATTACH_CHECK_INTERVAL);
        }
    }

    if (did_put) {
        mdataDelete("__dockerinit_waiting_for_attach");
    }
}

int
main(int __attribute__((unused)) argc, char __attribute__((unused)) *argv[])
{
    int fd;
    int ret;
    int tmpfd;
    char **ipmgmtd_cmd;
    char **ipmgmtd_env;

    /* we'll write our log in /var/log */
    mkdir("/var", 0755);
    mkdir("/var/log", 0755);

    /* start w/ descriptors 0,1,2 attached to /dev/null */
    if ((tmpfd = open("/dev/null", O_RDONLY)) != 0) {
        fatal(ERR_OPEN, "failed to open stdin as /dev/null: %d: %s\n", tmpfd,
            strerror(errno));
    }
    if ((tmpfd = open("/dev/null", O_WRONLY)) != 1) {
        fatal(ERR_OPEN, "failed to open stdout as /dev/null: %d: %s\n", tmpfd,
            strerror(errno));
    }
    if ((tmpfd = open("/dev/null", O_WRONLY)) != 2) {
        fatal(ERR_OPEN, "failed to open stderr as /dev/null: %d: %s\n", tmpfd,
            strerror(errno));
    }

    fd = open(LOGFILE, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd == -1) {
        fatal(ERR_OPEN, "failed to open log file: %s\n", strerror(errno));
    }

    log_stream = fdopen(fd, "w");
    if (log_stream == NULL) {
        log_stream = stderr;
        fatal(ERR_FDOPEN_LOG, "failed to fdopen(2): %s\n", strerror(errno));
    }

    getBrand();

    switch (brand) {
        case LX:
            mountLXProc();
            ipmgmtd_cmd = IPMGMTD_CMD_LX;
            ipmgmtd_env = IPMGMTD_ENV_LX;
            ipmgmtd_door = IPMGMTD_DOOR_LX;
            setupMtab();
            break;
        case JOYENT_MINIMAL:
            /*
             * joyent-minimal brand mounts /proc for us so we don't need to,
             * but without /proc being lxproc, we need to mount /dev/fd
             */
            mountOSDevFD();
            ipmgmtd_cmd = IPMGMTD_CMD_OS;
            ipmgmtd_env = IPMGMTD_ENV_OS;
            ipmgmtd_door = IPMGMTD_DOOR_OS;
            /* no need for /etc/mtab updates here either */
            break;
        default:
            fatal(ERR_UNEXPECTED, "unsupported brand after getBrand()\n");
            break;
    }

    dlog("INFO setting up networking\n");

    mkdir("/var/run", 0755);
    mkdir("/var/run/network", 0755);

    /* NOTE: will call fatal() if there's a problem */
    runIpmgmtd(ipmgmtd_cmd, ipmgmtd_env);

    if (brand == LX) {
        chrootNetworking();
    } else {
        setupNetworking();
    }

    /* kill ipmgmtd if we don't need it any more */
    killIpmgmtd();

    dlog("INFO network setup complete\n");

    /* NOTE: all of these will call fatal() if there's a problem */
    setupHostname();
    getUserGroupData();
    setupWorkdir();
    buildCmdEnv();
    buildCmdline();
    getStdinStatus();
    /*
     * In case we're going to read from stdin w/ attach, we want to open the zfd
     * _now_ so it won't return EOF on reads.
     */
    setupTerminal();
    waitIfAttaching();

    /* cleanup mess from mdata-client */
    close(4); /* /dev/urandom from mdata-client */
    close(5); /* event port from mdata-client */
    close(6); /* /native/.zonecontrol/metadata.sock from mdata-client */
    /* TODO: ensure we cleaned up everything else mdata created for us */

    /* This tells vmadm that provisioning is complete. */
    ret = rename("/var/svc/provisioning", "/var/svc/provision_success");
    if ((ret != 0) && (errno == ENOENT)) {
        dlog("INFO not renaming /var/svc/provisioning: already gone.\n");
    } else if (ret != 0) {
        fatal(ERR_RENAME_FAILED, "failed to rename /var/svc/provisioning: %s\n",
            strerror(errno));
    }

    execCmdline();

    /* NOTREACHED */
    abort();
}
