#!/bin/sh
#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License (the "License").
# You may not use this file except in compliance with the License.
#
# You can obtain a copy of the license at usr/src/OPENSOLARIS.LICENSE
# or http://www.opensolaris.org/os/licensing.
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at usr/src/OPENSOLARIS.LICENSE.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright 2012, Joyent, Inc.  All rights reserved.
#

PATH=/usr/bin:/usr/sbin
export PATH
unset LD_LIBRARY_PATH

OPT_V=0
OPT_X=0
DIR=/var/audit
while getopts "d:R:vx" opt
do
	case "$opt" in
		d)	DIR="$OPTARG";;
		R)	DAYS="$OPTARG";;
		v)	OPT_V="1";;
		x)	OPT_X="1";;
		*)	echo "usage: [-d path] [-R days] [-v] [-x]"
			exit 1
			;;
	esac
done
shift OPTIND-1

if [[ -n $DAYS ]]; then
	if [ "$DIR" != "/var/audit" ]; then
		echo "-R is not valid with -d"
		exit 1
	fi
	# Rotate and trim the audit logs
	audit -n
	cd "$DIR" || exit 1
	find . -type f -mtime +$DAYS -print0 2>/dev/null | xargs -0 rm -f
	exit 0
fi

f=`ls $DIR/* | wc -l`
if [ $f -eq 0 ]; then
	echo "no audit files"
	exit 0
fi

if [ $OPT_X -eq 1 ]; then
	files=$DIR/*
else
	files=`ls -t $DIR/*not* | head -1`
fi

for i in $files
do
    praudit -x $i | nawk -v verbose=$OPT_V '{
	if ($1 == "<record") {
		pos = index($0, "iso8601=");
		if (pos == 0) {
			dt = "ND";
		} else {
			tstr=substr($0, pos + 9)
			split(tstr, da);
			dt = da[1] " " da[2];
		}
		printf("%s ", dt);

		if ($3 == "event=\"login")
			cmd="<login>";
		else if ($3 == "event=\"logout\"")
			cmd="<logout>";
		else if ($3 == "event=\"system")
			cmd="- - <boot>";
	} else if ($1 == "<subject") {
		pos = index($0, "tid=");
		if (pos == 0) {
			id = "NID";
		} else {
			tstr=substr($0, pos + 5)
			tstr=substr(tstr, 1, length(tstr) - 3)
			split(tstr, addr);
			id = addr[1] " " addr[3];
		}
		printf("%s ", id);
	} else if (substr($1, 1, 6) == "<path>") {
		if (verbose == 1)
			next;
		cmd=substr($1, 7);
		cmd=substr(cmd, 1, length(cmd) - 7);

	} else if (substr($1, 1, 11) == "<exec_args>") {
		if (verbose == 0)
			next;
		cmd=substr($0, 17)
		pos = index(cmd, "</arg><arg>");
		while (pos != 0) {
			head=substr(cmd, 1, pos - 1);
			tail=substr(cmd, pos + 11, length(cmd));
			cmd=head " " tail;
			pos = index(cmd, "</arg><arg>");
		}
	} else if ($1 == "</record>") {
		printf("%s\n", cmd);
	}
    }'
done
