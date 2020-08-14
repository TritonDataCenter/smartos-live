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

. /lib/sdc/usb-key.sh

eecho() {
	echo $@ 1>&2
}

err() {
	eecho $@
	exit 1
}

fatal() {
	eecho
	if [[ -n "$1" ]]; then
		eecho "ERROR: $1"
	fi
	eecho
	exit 2
}

corrupt() {
	eecho $@
	exit 3
}

usage() {
	eecho ""
	eecho "Usage: piadm [-v] <command> [command-specific arguments]"
	eecho ""
	eecho "    piadm activate|assign <PI-stamp> [ZFS-pool-name]"
	eecho "    piadm bootable [-d] [-e [-i <source>]] [-r] [ZFS-pool-name]"
	eecho "    piadm install <source> [ZFS-pool-name]"
	eecho "    piadm list <-H> [ZFS-pool-name]"
	eecho "    piadm remove <PI-stamp> [ZFS-pool-name]"
	err ""
}

vecho() {
	if [[ $VERBOSE -eq 1 ]]; then
		# Verbose echoes invoked by -v go to stdout, not stderr.
		echo $@
	fi
}

declare bootfs
declare -a allbootfs
declare numbootfs
#
# Inventory pools and bootable file systems.
#
getbootable() {
	IFS=" "
	# Use `mapfile -t` so bash array constructs can work.
	mapfile -t allbootfs < <(zpool list -Ho name,bootfs | \
		awk '{if ($2 != "-") print $2 }')
	numbootfs=${#allbootfs[@]}
}

declare activestamp
activestamp=$(uname -v | sed 's/joyent_//g')
declare installstamp

poolpresent() {
	# Works for an empty $1, which is "all of them" or "unspecified"
	zpool list $1 > /dev/null 2>&1
	if [[ $? -ne 0 ]]; then
		eecho "Pool $1 not present"
		usage
	fi
}

# Common-code to obtain the bootable filesystem, and setting $bootfs
# to it.  Also checks that the PI stamp or source name is not empty.
# Takes a PI name or source name (which must not be blank) AND a pool
# (which can).
piname_present_get_bootfs() {
	if [[ "$1" == "" ]]; then
		eecho "Must specify a Platform Image"
		usage
	fi

	poolpresent $pool

	getbootable
	if [[ $numbootfs -gt 1 && "$2" == "" ]]; then
		eecho "Multiple bootable pools are available, please specify one"
		usage
	elif [[ "$2" == "" ]]; then
		# If we reach here, no more than one bootable pool.
		bootfs=$allbootfs
		if [[ "$bootfs" == "" ]]; then
			eecho "No bootable pools available..."
			usage
		fi
		pool=$(echo $bootfs | awk -F/ '{print $1}')
		vecho "Selecting lone boot pool $pool by default."
	else
		# If we reach here, the CLI specifies a known-present (passes
		# poolpresent()) pool in $2 and we have at least one to check
		# against..
		pool=$2
		bootfs=""
		for check in ${allbootfs[@]}; do
			thispool=$(echo $check | awk -F/ '{print $1}')
			if [[ $thispool == $pool ]]; then
			    bootfs=$check
			    break
			fi
		done
		if [[ "$bootfs" == "" ]]; then
			eecho "Pool $pool does not appear to be bootable."
			usage
		fi
	fi
}

# Defined as a variable in case we need to add parameters (like -s) to it.
# WARNING:  Including -k for now.
CURL="curl -ks"

# Well-known source of SmartOS Platform Images
DEFAULT_URL_PREFIX=https://us-east.manta.joyent.com/Joyent_Dev/public/SmartOS/

# Can be overridden by the user's PIADM_URL_PREFIX.
URL_PREFIX=${PIADM_URL_PREFIX:-${DEFAULT_URL_PREFIX}}

# Scan for available installation media and mount it.
mount_installmedia() {
	tfile=$(mktemp)
	tfile2=$(mktemp)

	mntdir=$1

	# Try the USB key first, quietly and without $mntdir/.joyentusb check
	mount_usb_key $mntdir skip > $tfile 2>&1
	if [[ $? -ne 0 ]]; then
		# If that fails, try mounting the ISO.
		mount_ISO $mntdir > $tfile2 2>&1
		if [[ $? -ne 0 ]]; then
			if [[ $VERBOSE -eq 1 ]]; then
			    eecho "Can't find install media: USB stick errors:"
			    eecho ""
			    cat $tfile 1>&2
			    eecho ""
			    eecho "ISO errors"
			    eecho ""
			    cat $tfile2 1>&2
			fi
			rm -f $tfile $tfile2
			return 1
		fi
	fi

	rm -f $tfile $tfile2
	return 0
}

# Install a Platform Image.
#
# XXX WARNING - there is a security discussion to be had about the integrity
# of the source.
install() {
	piname_present_get_bootfs $1 $2
	tdir=$(mktemp -d)
	mkdir ${tdir}/mnt

	# $1 contains a "source".  Deal with it correctly in the big
	# if/elif/else block.  Once done, we can copy over bits into $tdir or
	# ${tdir}/mnt.
	# 

	# Special-case of "latest"
	if [[ "$1" == "latest" ]]; then
		# Well-known URL for the latest PI using conventions from
		# URL_PREFIX.  Grab the latest-version ISO. Before proceeding,
		# make sure it's the current one.
		iso=yes
		${CURL} -o ${tdir}/smartos.iso ${URL_PREFIX}/smartos-latest.iso
		if [[ $? -ne 0 ]]; then
			code=$?
			/bin/rm -rf ${tdir}
			fatal "Curl exit code $code"
		fi
		mount -F hsfs ${tdir}/smartos.iso ${tdir}/mnt

		# For now, assume boot stamp and PI stamp are the same on an ISO...
		stamp=$(cat ${tdir}/mnt/etc/version/boot)
	elif [[ "$1" == "media" ]]; then
		# Scan the available media to find what we seek.  Same advice
		# about making sure it's the current one.
		iso=yes
		mount_installmedia ${tdir}/mnt
		if [[ $? -ne 0 ]]; then
			/bin/rm -rf ${tdir}
			err "Cannot find install media"
		fi

		# For now, assume boot stamp and PI stamp are the same on
		# install media.
		stamp=$(cat ${tdir}/mnt/etc/version/boot)
	elif [[ -f $1 ]]; then
		# File input!  Check for what kind, etc. etc.

		# WARNING:  Depends GREATLY on the output of file(1)
		filetype=$(file $1 | awk '{print $2}')
		if [[ "$filetype" == "ISO" ]]; then
			# Assume .iso file.
			iso=yes
			mount -F hsfs $1 ${tdir}/mnt
			stamp=$(cat ${tdir}/mnt/etc/version/boot)
		elif [[ "$filetype" == "gzip" ]]; then
			# SmartOS PI.  Let's confirm it's actually a .tgz...
			gtar -xzOf $1 > /dev/null 2>&1
			if [[ $? -ne 0 ]]; then
				/bin/rm -rf ${tdir}
				err "File $1 is not an ISO or a .tgz file."
			fi
			# We're most-likely good here.  NOTE: SmartOS/Triton
			# PI files expand to platform-$STAMP.  Fix it here
			# before proceeding.
			gtar -xzf $1 -C ${tdir}/mnt
			mv ${tdir}/mnt/platform-* ${tdir}/mnt/platform
			iso=no
			stamp=$(cat ${tdir}/mnt/platform/etc/version/platform)
		else
			/bin/rm -rf ${tdir}
			err "Unknown file type for $1"
		fi
	else
		# Explicit boot stamp or URL.

		# Do a URL reality check.
		${CURL} -o ${tdir}/download $1
		if [[ -e ${tdir}/download ]]; then
			# Recurse with the downloaded file.
			dload=$(mktemp)
			mv -f ${tdir}/download $dload
			/bin/rm -rf ${tdir}

			# in case `install` exits out early...
			( pwait $$ ; rm -f $dload ) &
			vecho "Installing $1"
			vecho "	   (downloaded to $dload)"
			install $dload $2
			return 0
		fi
		# Else we treat it like a boot stamp.

		# Now that we think it's a boot stamp, check if it's the
		# current one or if it exists.
		if [[ -d ${bootfs}/platform-${1} ]]; then
			/bin/rm -rf ${tdir}
			eecho "PI-stamp $1 appears to be already on /${bootfs}"
			err "Use  piadm remove $1  to remove any old copies."
		fi

		# Confirm this is a legitimate build stamp.
		# Use conventions from site hosted in URL_PREFIX.
		checkurl=${URL_PREFIX}/$1/index.html
		${CURL} $checkurl | head | grep -qv "not found"
		if [[ $? -ne 0 ]]; then
			eecho "PI-stamp $1" \
				"is invalid for download from $URL_PREFIX"
			usage
		fi
		${CURL} -o ${tdir}/smartos.iso \
			${URL_PREFIX}/$1/smartos-${1}.iso
		if [[ $? -ne 0 ]]; then
			code=$?
			/bin/rm -rf ${tdir}
			fatal "PI-stamp $1 -- curl exit code $code"
		fi
		mount -F hsfs ${tdir}/smartos.iso ${tdir}/mnt
		if [[ $? -ne 0 ]]; then
			code=$?
			/bin/rm -rf ${tdir}
			fatal "PI-stamp $1 -- mount exit code $code"
		fi
		iso=yes
		stamp=$1
		# Reality-check boot stamp.
		bstamp=$(cat ${tdir}/mnt/etc/version/boot)
		if [[ "$stamp" != "$bstamp" ]]; then
			umount ${tdir}/mnt
			/bin/rm -rf ${tdir}
			err "Boot bits stamp says $bstamp," \
			    "vs. argument stamp $stamp"
		fi
	fi

	vecho "Installing PI $stamp"

	# At this point we have ${tdir}/mnt which contains at least
	# "platform".  If "iso" is yes, it also contains "boot",
	# "boot.catalog" and "etc", but we only really care about boot.catalog
	# and boot. These may be mounted as read-only, so we can't do mv.

	if [[ "$iso" == "yes" ]]; then
		# Match-check boot stamp and platform stamp.
		pstamp=$(cat ${tdir}/mnt/platform/etc/version/platform)
		if [[ "$stamp" != "$pstamp" ]];	then
			umount ${tdir}/mnt
			/bin/rm -rf ${tdir}
			err "Boot stamp $stamp mismatches platform stamp" \
				"$pstamp"
		fi

		if [[ -e /${bootfs}/boot-${stamp} ]]; then
			umount ${tdir}/mnt
			/bin/rm -rf ${tdir}
			eecho "PI-stamp $stamp has boot bits already" \
				"on /${bootfs}"
			err "Use  piadm remove $stamp " \
				"to remove any old copies."
		fi
		mkdir /${bootfs}/boot-${stamp} || \
			eecho "Can't mkdir /${bootfs}/boot-${stamp}"
		tar -cf - -C ${tdir}/mnt/boot . | \
			tar -xf - -C /${bootfs}/boot-${stamp} || \
			eecho "Problem in tar of boot bits"
	fi

	if [[ -e /${bootfs}/platform-${stamp} ]]; then
		if [[ "$iso" == "yes" ]]; then
			umount ${tdir}/mnt
		fi
		/bin/rm -rf ${tdir}
		eecho "PI-stamp $stamp appears to be already on /${bootfs}"
		err "Use   piadm remove $stamp	 to remove any old copies."
	fi
	mkdir /${bootfs}/platform-${stamp} || \
		eecho "Can't mkdir /${bootfs}/platform-${stamp}"
	tar -cf - -C ${tdir}/mnt/platform . | \
		tar -xf - -C /${bootfs}/platform-${stamp} || \
		eecho "Problem in tar of platform bits"

	if [[ "$iso" == "yes" ]]; then
		umount ${tdir}/mnt
	fi
	/bin/rm -rf ${tdir}

	if [[ ! -d /${bootfs}/platform-${stamp} ]]; then
		fatal "Installation problem (no ${bootfs}/platform-${stamp})"
	fi
	if [[ ! -d /${bootfs}/boot-${stamp} && "$iso" == "yes" ]]; then
		fatal "Installation problem (no ${bootfs}/boot-${stamp}" \
			"from ISO)"
	fi

	# Global variable for enablepool() usage...
	installstamp=$stamp
	return 0
}

list() {
	if [[ $1 == "-H" ]]; then
		pool=$2
	else
		printf "%-18s %-30s %-12s %-5s %-5s \n" "PI STAMP" \
			"BOOTABLE FILESYSTEM" "BOOT BITS?" "NOW" "NEXT"
		pool=$1
	fi

	poolpresent $pool

	getbootable
	for bootfs in ${allbootfs[@]}; do
		bfspool=$(echo $bootfs | awk -F/ '{print $1}')
		if [[ "$pool" != "" && "$bfspool" != "$pool" ]]; then
			# If we specify a pool for listing, skip ones not in
			# the pool.
			continue
		fi
		if [[ ! -L /$bootfs/platform ]]; then
			corrupt "WARNING: Bootable filesystem $bootfs" \
				"has non-symlink platform"
		fi
		cd /$bootfs
		bootbitsstamp=$(cat etc/version/boot)
		bootstamp=$(cat platform/etc/version/platform)
		mapfile -t pis \
			< <(cd /$bootfs ; cat platform-*/etc/version/platform)
		for pi in ${pis[@]}; do
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
			if [[ $bootbitsstamp == $pi ]]; then
				bootbits="next"
			elif [[ -d boot-$pi ]]; then
				bootbits="available"
			else
				bootbits="none"
			fi
			printf "%-18s %-30s %-12s %-5s %-5s\n" \
				$pi $bootfs $bootbits $active $booting
		done
	done
}

update_boot_sectors() {
	pool=$1
	bootfs=$2

	# XXX WARNING -- illumos#12894 will allow slogs.  We will need to
	# alter the generation of boot_devices accordingly.  Generate the
	# pool's boot devices now, in case we did something hyper-clever for
	# the pool.  s1 may be created, but not yet PCFS...
	mapfile -t boot_devices < <(zpool list -vHP "$pool" | \
		grep -E 'c[0-9]+' | awk '{print $1}' | sed -E 's/s[0-9]+//g')

	# Reality check the pool was created with -B.
	# First way to do this is to check for the `bootsize` property not
	# its default, which is NO bootsize.
	if [[ $(zpool list -Ho bootsize $pool) == "-" ]]; then
		# No bootsize is a first-cut test.  It passes if the pool was
		# created with `zpool create -B`. There's one other that needs
		# to be performed, because some bootable pools are manually
		# configured to share slices with other functions (slog,
		# l2arc, dedup):

		# Use fstyp to confirm if this is a manually created EFI
		# System Partition (ESP)
		type=$(fstyp /dev/dsk/${boot_devices[0]}s0)
		if [[ "$type" == "pcfs" ]]; then
			# If we detect PCFS on s0, it's LIKELY an EFI System
			# Partition that was crafted manually.  Use s1 if it's
			# ZFS, or bail if it's not.

			s1type=$(fstyp /dev/dsk/${boot_devices[0]}s1)
			if [[ "$s1type" != "zfs" ]]; then
				fatal "Unusual configuration," \
					"${boot_devices[0]}s1 not ZFS"
			fi
			suffix=s1
		else
			suffix=s0
		fi
	else
		# Guaranteed that s0 is EFI System Partition, ZFS lives on s1.
		suffix=s1
	fi

	some=0
	for a in "${boot_devices[@]}"; do
		# Plow through devices, even if some fail.  installboot also
		# does loader-into-EFI-System-Partition this way.  Trailing /
		# is important in the -b argument because boot is actually a
		# symlink.
		installboot -m -b /${bootfs}/boot/ /${bootfs}/boot/pmbr \
			/${bootfs}/boot/gptzfsboot \
			/dev/rdsk/${a}${suffix} > /dev/null 2>&1 || \
			eecho "WARNING: Can't installboot on ${a}${suffix}"
		if [[ $? -eq 0 ]]; then
			some=1
		fi
	done
	if [[ $some -eq 0 ]]; then
		fatal "Could not installboot(1M) on ANY vdevs of pool $2"
	fi
}

activate() {
	pistamp=$1
	piname_present_get_bootfs $pistamp $2
	pool=$(echo $bootfs | awk -F/ '{print $1}')

	cd /$bootfs
	if [[ -d platform-$pistamp ]]; then
		if [[ -f platform/etc/version/platform ]]; then
			bootstamp=$(cat platform/etc/version/platform)
		else
			bootstamp=""
		fi
		if [[ $bootstamp == $pistamp ]]; then
			vecho "NOTE: $pistamp is the current active PI."
			return
		fi
	else
		eecho "$pistamp is not a stamp for a PI on pool $pool"
		usage
	fi

	vecho "Platform Image $pistamp will be loaded on next boot,"

	# Okay, at this point we have the platform sorted out.  Let's see if
	# we can do the same with the boot.
	if [[ -d boot-$pistamp ]]; then
		rm -f boot
		ln -s ./boot-$pistamp boot
		mkdir -p etc/version
		echo $pistamp > etc/version/boot
		update_boot_sectors $pool $bootfs
		grep -q 'fstype="ufs"' ./boot/loader.conf
		if [[ $? -ne 0 ]]; then
			# Fix the loader.conf for keep-the-ramdisk booting.
			echo 'fstype="ufs"' >> ./boot/loader.conf
		fi
		vecho "    with a new boot image,"
	else
		vecho "	   WARNING: $pistamp has no matching boot image, using"
		if [[ ! -f etc/version/boot ]]; then
			fatal "No boot version available on /$bootfs"
		elif [[ ! -d boot/. ]]; then
			fatal "No boot bits directory on /$bootfs"
		fi
	fi

	vecho "    boot image " $(cat etc/version/boot)

	rm -f platform
	ln -s ./platform-$pistamp platform
}

remove() {
	pistamp=$1
	piname_present_get_bootfs $pistamp $2
	cd /$bootfs
	bootstamp=$(cat platform/etc/version/platform)

	if [[ -d platform-$pistamp ]]; then
		if [[ $bootstamp == $pistamp ]]; then
			eecho "$pistamp is the next-booting PI." \
		    		"Please activate another PI"
			eecho "using 'piadm activate <other-PI-stamp>' first."
			usage
		fi

		# Boot image processing.
		if [[ -d boot-$pistamp ]]; then
			# Boot bits may be older than the current PI, and the
			# current PI may not have matching boot bits for some
			# reason. Guard against shooting yourself in the foot.
			grep -q $pistamp etc/version/boot
			if [[ $? -eq 0 ]]; then
				eecho "$pistamp is the current set of boot" \
					"binaries.  Please"
				eecho "activate another pi using" \
					"'piadm activate <other-PI-stamp>'" \
					"first."
				usage
			fi
			/bin/rm -rf boot-$pistamp
		fi

		/bin/rm -rf platform-$pistamp
	else
		eecho "$pistamp is not a stamp for a PI on pool $pool"
		usage
	fi
}

ispoolenabled() {
	pool=$1
	poolpresent $pool

	# SmartOS convention is $POOL/boot.
	currbootfs=$(zpool list -Ho bootfs $pool)
	if [[ "$currbootfs" == "${pool}/boot" ]]; then
		output=$(zfs list -H $currbootfs 2>&1)
		if [[ $? -eq 0 ]]; then
			# We're bootable (at least bootable enough)
			return 0
		fi
		# else drop out to not-bootable, but this shouldn't happen.
		vecho ".... odd, ${pool}/boot is pool's bootfs," \
			"but isn't a filesystem"
	elif [[ "$currbootfs" != "-" ]]; then
		eecho "It appears pool $pool has a different boot filesystem" \
			"than the"
		eecho "standard SmartOS filesystem of ${pool}/boot. It will" \
			"need manual"
		corrupt "intervention."
	fi

	# Not bootable.
	return 1
}

enablepool() {
	if [[ $1 == "-i" ]]; then
		if [[ "$2" == "" || "$3" == "" ]]; then
			eecho "-i must take an option," \
				"and then a pool must be specified."
			usage
		fi
		installsource=$2
		pool=$3
	elif [[ -z $1 ]]; then
		eecho "To enable a pool for booting, please specify at least" \
			"a pool"
		usage
	else
		installsource="media"
		pool=$1
	fi

	bootfs=${pool}/boot

	ispoolenabled $pool
	if [[ $? -eq 0 ]]; then
		if [[ -d /${bootfs}/platform/. && -d /${bootfs}/boot/. ]]; then
			vecho "Pool $pool appears to be bootable."
			vecho "Use 'piadm install' or 'piadm activate' to" \
				"change PIs."
			return 0
		fi
		# One or both of "platform" or "boot" aren't there.
		# For now, proceed clobber-style.
	fi

	output=$(zfs list -H $bootfs 2>&1)
	if [[ $? -ne 0 ]]; then
		# Create a new bootfs and set it.
		# NOTE:	 Encryption should be turned off for this dataset.
		zfs create -o encryption=off $bootfs
		if [[ $? -ne 0 ]]; then
			fatal "Cannot create $bootfs dataset"
		fi
	fi
	# We MAY need to do some reality checking if the `zfs list` shows
	# $bootfs. For now, just wing it. and plow forward.

	# At this point we have an existing SmartOS-standard boot filesystem,
	# but it's not specified as bootfs in the pool.  Test if bootfs can be
	# set...
	zpool set bootfs=${bootfs} ${pool}
	if [[ $? -ne 0 ]]; then
		fatal "Cannot set bootfs for $pool"
	fi
	# Reset our view of available bootable pools.
	getbootable

	install $installsource $pool

	# install set 'installstamp' on our behalf.
	activate $installstamp $pool
}

refreshpool() {
	pool=$1

	if [[ -z $pool ]]; then
		eecho "Must specify a pool for refresh"
		usage
	fi

	currbootfs=""
	# ispoolenabled sets currbootfs as a side-effect.
	ispoolenabled $pool
	if [[ $? -ne 0 ]]; then
		err "Pool $pool is not bootable, and cannot be refreshed"
	fi

	update_boot_sectors $pool $currbootfs

	return 0
}

bootable() {
	if [[ "$1" == "-d" ]]; then
		if [[ "$2" == "" ]]; then
			eecho "To disable a pool for booting, please specify" \
				"a pool."
			usage
		fi

		# Reality check for bad pool name.
		poolpresent $2
		# Reality check for REALLY messed-up bootfs...
		ispoolenabled $2

		# Eventually we may need to do more complicated things like
		# wipe the boot sectors clean or some other such cleanup.  For
		# now, disabling is merely unsetting `bootfs` in the pool.
		zpool set bootfs="" $2
	
		return
	elif [[ "$1" == "-e" ]]; then
		shift 1
		enablepool $@
		return
	elif [[ "$1" == "-r" ]]; then
		refreshpool $2
		return
	fi

	# If we reach here, we're querying about a pool.

	if [[ "$1" == "" ]]; then
		allpools=$(zpool list -Ho name)
	else
		# Reality check for bad pool name.
		poolpresent $1
		# Or have a list of one pool...
		allpools=$1
	fi

	# We're guaranteed that, modulo background processes, $allpools has a
	# list of actual pools, even if it's a list-of-one.

	for pool in $allpools; do
		zpool list -Ho bootfs $pool | grep -q ${pool}/boot
		if [[ $? -eq 0 ]]; then
			bootable="BIOS"
			# Check for pcfs partition on pool disks.
			mapfile -t boot_devices < \
				<(zpool list -vHP "${pool}" | \
				grep -E 'c[0-9]+' | awk '{print $1}')
			for a in "${boot_devices[@]}"; do
				noslice=$(echo $a | sed -E 's/s[0-9]+//g')
				tdir=$(mktemp -d)
				# Assume that s0 on the physical disk would be
				# where the EFI System Partition (ESP) lives.
				# A pcfs mount, ALONG WITH a check for a
				# bootx64.efi executable, can confirm/deny
				# it. Do this instead of just checking for
				# bootsize because we can further
				# integrity-check here if need be.
				mount -F pcfs /dev/dsk/${noslice}s0 $tdir \
					> /dev/null 2>&1
				if [[ $? -eq 0 && \
					-f $tdir/EFI/Boot/bootx64.efi ]]; then
					efi="and UEFI"
					umount $tdir
				else
					efi=""
				fi
				rmdir $tdir
			done
		else
			bootable="non-bootable"
			efi=""
		fi
			   
		printf "%-30s ==> %s %s\n" "$pool" "$bootable" "$efi"
	done
}

if [[ "$1" == "-v" ]]; then
	VERBOSE=1
	shift 1
elif [[ "$1" == "-vv" ]]; then
	set -x
	VERBOSE=1
	shift 1
else
	VERBOSE=0
fi

cmd=$1
shift 1

case $cmd in
	activate | assign )
		activate $@
		;;

	bootable )
		bootable $@
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
