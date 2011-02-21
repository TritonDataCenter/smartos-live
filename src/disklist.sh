#!/bin/sh
#
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

REMDISKS=""
NONREMDISKS=""

ALLDISKS=`/usr/bin/ls /dev/dsk | /usr/bin/awk "/s2$/ {print}" | /usr/bin/sed "s/s2//"`

for disk in $ALLDISKS; 
do
    pfexec removable_disk /dev/rdsk/${disk}p0 2>&1 >> /dev/null
    case "$?" in
    0)
        REMDISKS=$REMDISKS" "$disk;
        ;;
    1)
        NONREMDISKS=$NONREMDISKS" "$disk;
        ;;
    esac;
done

while getopts 'anrs' OPTION
do
    case $OPTION in
        a)
            echo $REMDISKS" "$NONREMDISKS
            ;;
        n)
            echo $NONREMDISKS
            ;;
        r)
            echo $REMDISKS
            ;;
        s)
            for disk in $NONREMDISKS; do
                size=`pfexec disk_size /dev/rdsk/${disk}p0`
                echo "${disk}=${size}"
            done
            ;;
        ?)
            printf "Usage: %s: [-anr]\n" $(basename $0) >&2
            exit 2
            ;;
    esac
done
