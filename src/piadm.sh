#!/bin/bash

#
# This file and its contents are supplied under the terms of the
# Common Development and Distribution License ("CDDL"), version 1.0.
# You may only use this file in accordance with the terms of version
# 1.0 of the CDDL.
#
# A full copy of the text of the CDDL should have accompanied this
# source.  A copy of the CDDL is also available via the Internet at
# http://www.illumos.org/license/CDDL.
#

#
# Copyright 2020 Joyent, Inc.
#

usage() {
    echo "Usage: piadm [-v] <command> [command-specific arguments]"
    echo ""
    echo "    piadm activate <PI-stamp> [ZFS-pool-name]"
    echo "    piadm assign <PI-stamp> [ZFS-pool-name]"
    echo "    piadm bootable [-d] [-e] [ZFS-pool-name]"
    echo "    piadm install <PI-stamp,PI-tarball,PI-tarball-URL> [ZFS-pool-name]"
    echo "    piadm list <-H> [ZFS-pool-name]"
    echo "    piadm remove <PI-stamp> [ZFS-pool-name]"
    echo ""
    exit 1
}

list() {
    if [[ $1 == "-H" ]]; then
	pool=$2
    else
	printf "%-18s %-30s %-12s %-12s \n" "PI STAMP" "BOOTABLE FILESYSTEM"  \
	       "BOOTED NOW" "BOOTS NEXT"
	pool=$1
    fi

    zpool list $pool > /dev/null 2>&1
    if [[ $? -ne 0 ]]; then
	echo "Pool $pool not present"
	usage
    fi

    allbootable=$(zpool get -H bootfs $pool | grep -vw default | awk '{print $3}')
    for bootfs in $allbootable; do
	if [[ ! -L /$bootfs/platform ]]; then
	    echo "WARNING: Bootable filesystem $bootfs has non-symlink platform"
	    exit 1
	fi
	cd /$bootfs
	bootstamp=$(file -h platform | awk '{print $5}' | \
			sed 's/\.\/platform-//g')
	activestamp=$(uname -v | sed 's/joyent_//g')
	pis=$(cd /$bootfs ; ls -d platform-* | sed 's/platform-//g')
	for pi in $pis; do
	    if [[ $activestamp == $pi ]]; then
		active="yes"
	    else
		active="no"
	    fi
	    if [[ $bootstamp == $pi ]]; then
		booting="yes"
	    else
		booting="no"
	    fi
	    printf "%-18s %-30s %-12s %-12s\n" $pi $bootfs $active $booting
	done
    done
}


#echo "Coming soon..."
#usage

if [[ "$1" == "-v" ]]; then
    DEBUG=1
    shift 1
else
    DEBUG=0
fi

cmd=$1
shift 1

case $cmd in
activate | assign )
    echo "Activating/assigning"
    ;;

bootable )
    echo "Doing bootable check or upgrade"
    ;;

install )
    echo "Installing"
    ;;

list )
    list $@
    ;;

remove )
    echo "Removing"
    ;;

*)
    usage
    ;;

esac
