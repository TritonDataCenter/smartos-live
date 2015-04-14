/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * This program acts as an 'exec' helper for a docker zone on SmartOS. When
 * `docker exec` is run this is used to:
 *
 *  - switch users/groups (based on docker:user)
 *  - setup environment
 *  - setup cmdline
 *  - exec requested cmd
 *
 * If successful, the exec cmd will replace this process running in the zone.
 * If any error is encountered, this will exit non-zero and the exec session
 * should fail to start.
 *
 * A log is also written to /var/log/sdc-dockerexec.log in order to debug
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
#include <unistd.h>

#include <arpa/inet.h>

#include <net/if.h>
#include <net/route.h>
#include <netinet/in.h>

#include <sys/types.h>
#include <sys/mount.h>
#include <sys/mntent.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <sys/stat.h>

#include "../json-nvlist/json-nvlist.h"
#include "../mdata-client/common.h"
#include "../mdata-client/dynstr.h"
#include "../mdata-client/plat.h"
#include "../mdata-client/proto.h"

#include "docker-common.h"

#define LOGFILE "/var/log/sdc-dockerexec.log"

/* global metadata client bits */
int initialized_proto = 0;
mdata_proto_t *mdp;

/* global data */
char **cmdline;
char **env;
char *hostname = NULL;
FILE *log_stream = stderr;
char *path = NULL;
struct passwd *pwd = NULL;
struct group *grp = NULL;

int
main(int argc, char *argv[])
{
    char *execname;

    /*
     * We write the log to stderr and expect cn-agent to log/parse the output.
     * It can know that dockerexec finished when it sees either a line that
     * starts with:
     *
     * <timestamp> FATAL
     *
     * or:
     *
     * <timestamp> EXEC
     *
     * the former indicating that we failed and the latter that the next action
     * will be execve().
     */
    log_stream = stderr;

    if (argc < 2) {
        fatal(ERR_NO_COMMAND, "no command specified on cmdline, argc: %d\n",
            argc);
    }

    /* NOTE: all of these will call fatal() if there's a problem */
    getUserGroupData();
    setupWorkdir();
    buildCmdEnv();

    /* cleanup mess from mdata-client */
    close(4); /* /dev/urandom from mdata-client */
    close(5); /* event port from mdata-client */
    close(6); /* /native/.zonecontrol/metadata.sock from mdata-client */
    /* TODO: ensure we cleaned up everything else mdata created for us */

    // TODO: close any descriptors which are not to be attached to this
    //       exec cmd? Or let the zlogin caller deal with that?

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

    // find execname from argv[1] (w/ path), then execute it.
    execname = execName(argv[1]); // calls fatal() if fails

    // Message for cn-agent that dockerexec is done and child should start
    // now.
    dlog("EXEC\n");

    execve(execname, argv+1, env);

    // If execve() has failed, this next message should go to the user since
    // stdout and stderr should now be connected to them.
    fatal(ERR_EXEC_FAILED, "execve(%s) failed: %s\n", argv[1],
        strerror(errno));

    /* NOTREACHED */
    abort();
}
