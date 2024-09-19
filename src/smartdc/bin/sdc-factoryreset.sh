#!/usr/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
# Copyright 2024 MNX Cloud, Inc.
#

#
# Sets a ZFS property to perform a factory reset, that is, discards all state on
# this machine and runs setup again.
#

set -o errexit
set -o pipefail

myname=$(basename $0)

function abort()
{
	printf "\nFactory reset aborted.\n"
	exit 1
}

function usage()
{
	printf "\nUsage: $myname [-h | --help]\n\n"
	printf "Resets a machine to its originally installed state.  See "
	printf "sdc-factoryreset(1)\nfor more information.\n"
	exit 1
}

function wipe_bootpools()
{
	# disable booting on all pools
	for pool in $(piadm bootable | grep -v non-bootable | awk '{print $1}')
	do
		piadm bootable -d $pool
	done
}

if [[ -n $1 ]] && [[ $1 = "--help" ]]; then
	usage
fi

shutdown="0"

while getopts "hs" opt
do
	case "$opt" in
		h)	usage;;
		s)	shutdown="1";;
		*)	usage;;
	esac
done

trap abort SIGINT

printf "WARNING: This machine will reboot and destroy its ZFS pools after "
printf "rebooting.\n"

read -p "Do you want to proceed with the factory reset? (y/n) " -n 1

if [[ $REPLY =~ ^[Yy]$ ]]; then
	printf "\n\nThis will destroy ALL DATA on the system, including "
	printf "potential customer data.\n"

	read -p "Are you sure? (y/n) " -n 1

	if [[ $REPLY =~ ^[Yy]$ ]]; then
		printf "\n\nRebooting in 5 seconds ... "
		sleep 5
		printf "now!\n"

		SYS_ZPOOL=$(svcprop -p config/zpool smartdc/init)
		[[ -n ${SYS_ZPOOL} ]] || SYS_ZPOOL=zones

		zfs set smartdc:factoryreset=yes ${SYS_ZPOOL}/var
		wipe_bootpools
		if [[ $shutdown == "1" ]]; then
			poweroff
		else
			reboot
		fi
	else
		abort
	fi
else
	abort
fi

exit 0
