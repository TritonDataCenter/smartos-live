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

declare -a allbootable
declare -a numbootable
getbootable() {
    allbootable=$(zpool get -H bootfs $pool | grep -vw default | awk '{print $3}')
    numbootable=${#allbootable[@]}
}

poolpresent() {
    zpool list $1 > /dev/null 2>&1
    if [[ $? -ne 0 ]]; then
	echo "Pool $1 not present"
	usage
    fi
}

install_tarball() {
    tarball=$1
    bootfs=$2

    tdir=`mktemp -d`
    pushd $tdir > /dev/null
    gtar -xzf $1

    ## XXX KEBE SAYS INSPECT THE untarred directory for integrity, etc.
    ## For now, however, assume:
    ## - tarball only extracts to one directory.
    ## - $DIR/etc/version/platform has `pistamp`.
    ## - All of the other bits are in place properly (unix, boot archive, etc.)
	
    stamp=`cat */etc/version/platform`
    if [[ -e /$bootfs/platform-$stamp ]]; then
	echo "PI-stamp $stamp appears to exist on /$bootfs"
	echo "Use:   piadm remove $stamp    before installing this one."
	popd > /dev/null
	/bin/rm -rf $tdir
	usage
    fi
    mv * /$bootfs/platform-$stamp
    popd > /dev/null
    rmdir $tdir
}

# Well-known source of SmartOS Platform Images
URL_PREFIX=https://us-east.manta.joyent.com/Joyent_Dev/public/SmartOS/

install() {
    ### XXX KEBE SAYS REFACTOR HERE...
    getbootable
    if [[ $numbootable -ne 1 && "$2" == "" ]]; then
	echo "Multiple bootable pools are available, please specify one"
	usage
    elif [[ $numbootable -eq 1 ]]; then
	bootfs=$allbootable
	pool=$(echo $bootfs | awk -F/ '{print $1}')
    else
	pool=$2
	bootfs=""
	for check in $allbootable; do
	    thispool=$(echo $check | awk -F/ '{print $1}')
	    if [[ $thispool == $pool ]]; then
		bootfs=$check
		break
	    fi
	done
	if [[ "$bootfs" == "" ]]; then
	    echo "Pool $pool does not appear to be bootable."
	    usage
	fi
    fi
    poolpresent $pool

    # echo "Installing $1 on pool $pool"

    if [[ "$1" == "" ]]; then
	echo "Must specify a Platform Image"
	usage
    fi
    ### XXX KEBE SAYS END REFACTOR


    # If .tgz, expand it.
    if [[ -f $1 ]]; then
	install_tarball $1 $bootfs
	return 0
    fi

    # Special-case of "latest"
    if [[ "$1" == "latest" ]]; then
	# Well-known URL for the latest PI using conventions from URL_PREFIX.
	url=${URL_PREFIX}/platform-latest.tgz
    else
	# Confirm this is a legitimate build stamp.
	# Use conventions from site hosted in URL_PREFIX.
	checkurl=${URL_PREFIX}/$1/index.html
	curl -s $checkurl | head | grep -qv "not found"
	if [[ $? -ne 0 ]]; then
	    echo "PI-stamp $1 is invalid for download from $URL_PREFIX"
	    usage
	fi
	pitar=`curl -s $checkurl | grep platform-release | grep tgz | awk -F\" '{print $2}'`
	url=${URL_PREFIX}/$1/$pitar
    fi

    tfile=`mktemp`
    curl -o $tfile $url
    if [[ $? -ne 0 ]]; then
	/bin/rm -f $tfile
	echo "FETCH FAILED: curl -o $tfile $url"
	usage
    fi
    mv $tfile ${tfile}.tgz
    install_tarball ${tfile}.tgz $bootfs
    /bin/rm -f ${tfile}.tgz
}

list() {
    if [[ $1 == "-H" ]]; then
	pool=$2
    else
	printf "%-18s %-30s %-12s %-12s \n" "PI STAMP" "BOOTABLE FILESYSTEM"  \
	       "BOOTED NOW" "BOOTS NEXT"
	pool=$1
    fi

    poolpresent $pool

    getbootable
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

remove() {
    ### XXX KEBE SAYS REFACTOR HERE...
    getbootable
    if [[ $numbootable -ne 1 && "$2" == "" ]]; then
	echo "Multiple bootable pools are available, please specify one"
	usage
    elif [[ $numbootable -eq 1 ]]; then
	bootfs=$allbootable
	pool=$(echo $bootfs | awk -F/ '{print $1}')
    else
	pool=$2
	bootfs=""
	for check in $allbootable; do
	    thispool=$(echo $check | awk -F/ '{print $1}')
	    if [[ $thispool == $pool ]]; then
		bootfs=$check
		break
	    fi
	done
	if [[ "$bootfs" == "" ]]; then
	    echo "Pool $pool does not appear to be bootable."
	    usage
	fi
    fi
    poolpresent $pool

    if [[ "$1" == "" ]]; then
	echo "Must specify a Platform Image"
	usage
    fi
    ### XXX KEBE SAYS END REFACTOR

    pistamp=$1
    cd /$bootfs
    bootstamp=$(file -h platform | awk '{print $5}' | sed 's/\.\/platform-//g')

    if [[ -d platform-$pistamp ]]; then
	if [[ $bootstamp == $pistamp ]]; then
	    echo "$pistamp is the current active PI. Please activate another PI"
	    echo "using    piadm activate <other-PI-stamp>    first."
	    usage
	fi
	/bin/rm -rf platform-$pistamp
    else
	echo "$pistamp is not a stamp for a PI on pool $pool"
	usage
    fi
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
    install $@
    ;;

list )
    list $@
    ;;

remove )
    remove $@
    ;;

*)
    usage
    ;;

esac

exit 0
