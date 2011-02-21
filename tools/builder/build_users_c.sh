#!/usr/bin/bash
#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License, Version 1.0 only
# (the "License").  You may not use this file except in compliance
# with the License.
#
# You can obtain a copy of the license at COPYING
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at COPYING.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright (c) 2010,2011 Joyent Inc.
#

ROOT=$1

cat <<EOF
#include <stdio.h>
#include <string.h>

int gid_from_name(const char *group)
{
    int gid = -1;
EOF
cat ${ROOT}/etc/group | awk -F':' 'NR>1{ printf "else " };{ print "if (strcmp(\"" $1 "\", group) == 0) gid = " $3 ";" }' | sed -e "s/^/    /"
cat <<EOF

    return(gid);
};

EOF

cat <<EOF
int uid_from_name(const char *user)
{
    int uid = -1;

EOF
cat ${ROOT}/etc/passwd | awk -F':' 'NR>1{ printf "else " };{ print "if (strcmp(\"" $1 "\", user) == 0) uid = " $3 ";" }' | sed -e "s/^/    /"
cat <<EOF

    return(uid);
};
EOF
