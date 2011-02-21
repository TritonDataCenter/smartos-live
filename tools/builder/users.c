/*
* CDDL HEADER START
*
* The contents of this file are subject to the terms of the
* Common Development and Distribution License, Version 1.0 only
* (the "License").  You may not use this file except in compliance
* with the License.
*
* You can obtain a copy of the license at COPYING
* See the License for the specific language governing permissions
* and limitations under the License.
*
* When distributing Covered Code, include this CDDL HEADER in each
* file and include the License file at COPYING.
* If applicable, add the following below this CDDL HEADER, with the
* fields enclosed by brackets "[]" replaced with your own identifying
* information: Portions Copyright [yyyy] [name of copyright owner]
*
* CDDL HEADER END
*
* Copyright (c) 2010,2011 Joyent Inc.
*
*/

#include <stdio.h>
#include <string.h>

int gid_from_name(const char *group)
{
    int gid = -1;
    if (strcmp("root", group) == 0) gid = 0;
    else if (strcmp("other", group) == 0) gid = 1;
    else if (strcmp("bin", group) == 0) gid = 2;
    else if (strcmp("sys", group) == 0) gid = 3;
    else if (strcmp("adm", group) == 0) gid = 4;
    else if (strcmp("uucp", group) == 0) gid = 5;
    else if (strcmp("mail", group) == 0) gid = 6;
    else if (strcmp("tty", group) == 0) gid = 7;
    else if (strcmp("lp", group) == 0) gid = 8;
    else if (strcmp("nuucp", group) == 0) gid = 9;
    else if (strcmp("staff", group) == 0) gid = 10;
    else if (strcmp("daemon", group) == 0) gid = 12;
    else if (strcmp("sysadmin", group) == 0) gid = 14;
    else if (strcmp("games", group) == 0) gid = 20;
    else if (strcmp("smmsp", group) == 0) gid = 25;
    else if (strcmp("gdm", group) == 0) gid = 50;
    else if (strcmp("upnp", group) == 0) gid = 52;
    else if (strcmp("xvm", group) == 0) gid = 60;
    else if (strcmp("mysql", group) == 0) gid = 70;
    else if (strcmp("openldap", group) == 0) gid = 75;
    else if (strcmp("webservd", group) == 0) gid = 80;
    else if (strcmp("postgres", group) == 0) gid = 90;
    else if (strcmp("slocate", group) == 0) gid = 95;
    else if (strcmp("unknown", group) == 0) gid = 96;
    else if (strcmp("nobody", group) == 0) gid = 60001;
    else if (strcmp("noaccess", group) == 0) gid = 60002;
    else if (strcmp("nogroup", group) == 0) gid = 65534;
    else if (strcmp("netadm", group) == 0) gid = 65;

    return(gid);
};

int uid_from_name(const char *user)
{
    int uid = -1;

    if (strcmp("root", user) == 0) uid = 0;
    else if (strcmp("daemon", user) == 0) uid = 1;
    else if (strcmp("bin", user) == 0) uid = 2;
    else if (strcmp("sys", user) == 0) uid = 3;
    else if (strcmp("adm", user) == 0) uid = 4;
    else if (strcmp("lp", user) == 0) uid = 71;
    else if (strcmp("uucp", user) == 0) uid = 5;
    else if (strcmp("nuucp", user) == 0) uid = 9;
    else if (strcmp("dladm", user) == 0) uid = 15;
    else if (strcmp("netadm", user) == 0) uid = 16;
    else if (strcmp("netcfg", user) == 0) uid = 17;
    else if (strcmp("smmsp", user) == 0) uid = 25;
    else if (strcmp("listen", user) == 0) uid = 37;
    else if (strcmp("gdm", user) == 0) uid = 50;
    else if (strcmp("zfssnap", user) == 0) uid = 51;
    else if (strcmp("upnp", user) == 0) uid = 52;
    else if (strcmp("xvm", user) == 0) uid = 60;
    else if (strcmp("mysql", user) == 0) uid = 70;
    else if (strcmp("openldap", user) == 0) uid = 75;
    else if (strcmp("webservd", user) == 0) uid = 80;
    else if (strcmp("postgres", user) == 0) uid = 90;
    else if (strcmp("svctag", user) == 0) uid = 95;
    else if (strcmp("unknown", user) == 0) uid = 96;
    else if (strcmp("nobody", user) == 0) uid = 60001;
    else if (strcmp("noaccess", user) == 0) uid = 60002;
    else if (strcmp("nobody4", user) == 0) uid = 65534;

    return(uid);
};
