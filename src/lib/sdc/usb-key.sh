#!/usr/bin/bash
#
# Utilities for dealing with the USB key. In general, sdc-usbkey should be used.
# These routines are for use prior to sdc-usbkey being installed.
#
# Copyright 2021, Joyent, Inc.
#

#
# Identify the version of this USB key (if it is indeed a USB key).
#
# We do this by sniffing fixed offset within the MBR. If we have a (legacy)
# grub MBR, then we can look at offset 0x3e for COMPAT_VERSION_MAJOR and
# COMPAT_VERSION_MINOR (and we'll presume 3.2 as a minimum).
#
# If we're talking about a loader-based key, we'll peek at 0xfa AKA
# STAGE1_MBR_VERSION for format_image's IMAGE_MAJOR, which we expect to be 2.
#
# Unfortunately there's no standard way to find a version for other MBRs such as
# grub2's. In these cases we'll end up with a potentially random version here,
# so this key should not be trusted as ours until mounted and the path
# .joyusbkey is found.
#
function usb_key_version()
{
	local readonly devpath=$1
	local readonly mbr_sig_offset=0x1fe
	local readonly mbr_grub_offset=0x3e
	local readonly mbr_stage1_offset=0xfa
	local readonly mbr_grub_version=0203
	local readonly mbr_sig=aa55

	sig=$(echo $(/usr/bin/od -t x2 \
	    -j $mbr_sig_offset -A n -N 2 $devpath) )

	if [[ "$sig" != $mbr_sig ]]; then
		echo "unknown"
		return
	fi

	grub_val=$(echo $(/usr/bin/od -t x2 \
	    -j $mbr_grub_offset -A n -N 2 $devpath) )
	loader_major=$(echo $(/usr/bin/od -t x1 \
	    -j $mbr_stage1_offset -A n -N 1 $devpath) )

	if [[ "$grub_val" = $mbr_grub_version ]]; then
		echo "1"
		return
	fi

	echo $(( 0x$loader_major ))
}

function extract_mountpath()
{
	local mnt=$1

	if [[ -z "$mnt" ]]; then
		mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
		    "svc:/system/filesystem/smartdc:default")
	fi

	echo "$mnt"
}

#
# Mount the Head Node's bootable pool's bootfs as the "USB Key"
#
function mount_bootpool_fake_usbkey()
{
	local mnt=$1
	local pool=$(/bin/bootparams | awk -F= '/^triton_bootpool=/ {print $2}')
	local bootfs="$pool/boot"

	# First some reality checks...
	if [[ "$pool" == "" ]]; then
		echo "Boot pool is not specified in triton_bootpool" >&2
		return 1
	fi

	if [[ ! -d /"$bootfs"/. ]]; then
		echo "Boot filesystem $bootfs is not available" >&2
		return 1
	fi

	if [[ ! -f /"$bootfs"/.joyliveusb ]]; then
		echo "Boot filesystem $bootfs does not have .joyliveusb" >&2
		return 1
	fi

	# Use lofs to actually MOUNT the $bootfs on to $mnt.  This
	# way, unmount_usb_key() works regardless whether or not we
	# booted from a pool or a USB key.
	if ! /usr/sbin/mount -F lofs /"$bootfs" $mnt 2>/dev/null; then
		echo "Failed to lofs-mount /$bootfs to $mnt" >&2
		return 1
	fi

	echo $mnt
	return 0
}

# Evil twins of the {,un}mount_usb_key functions.  These are specific
# to ISO/hsfs (aka. {C,DV,B}D-ROM) disks.  We may be able to factor-out
# even more common bits from the usb_key functions, but not today.
# Now declared prior to mount_usb_key because a Triton installer ISO may
# wish to mount itself to make a fake "USB key".
function mount_ISO
{
	local mnt=$(extract_mountpath "$1")

	mapfile -t disks < <(disklist -r)
	for disk in "${disks[@]}"; do
		mount -F hsfs /dev/dsk/${disk}s0 $mnt
		if [[ $? -ne 0 ]]; then
			continue
		fi
		if [[ -d ${mnt}/boot ]]; then
			return 0
		fi
		if ! umount $mnt; then
			echo "Failed to unmount $mnt">&2
			return 1
		fi
	done

	echo "Couldn't find an ISO" >&2
	return 1
}

function unmount_ISO
{
	local mnt=$(extract_mountpath $1)

	if ! umount $mnt; then
		echo "Failed to unmount $mnt" >&2
		return 1
	fi

	return 0
}

function mount_installer_fake_usbkey()
{
	local mnt=$(extract_mountpath $1)
	local tdir=$(TMPDIR=/etc/svc/volatile mktemp -d)

	installertype=$(/bin/bootparams | \
		awk -F= '/^triton_installer=/ {print $2}')

	# Okay, so we need to not only mount an ISO or ISO-image from
	# the installer, we ALSO need to copy it into tmpfs so it's writable
	# and THEN we lofs-mount it to $mnt above.  The only known-available
	# tmpfs at this point might be /etc/system/volatile.
	if [[ "$installertype" == "iso" ]]; then
		local tmount=$(TMPDIR=/etc/svc/volatile mktemp -d)

		mount_ISO $tmount
		if [[ $? -ne 0 ]]; then
			return $?
		fi
		# So $tmount has a read-only ISO mounted (either an actual
		# disk or an included-on-boot-archive filesystem.  We need to
		# copy it over to $tdir so it can be read-write, and THEN we
		# lofs mount it.

		echo "Triton installer copying from read-only to fake USB key."
		tar -cf - -C $tmount . | tar -xf - -C $tdir
		# Let piadm capitalize entries (for now).
		umount $tmount
		rmdir $tmount
	elif [[ "$installertype" == "ipxe" ]]; then
		# Okay, so we're a bootable image, and we need to copy over
		# any .txt files from / into $tdir.  The Triton installer
		# will know what to do.

		cp -rp /*.txt /scripts /config.inc $tdir/.
		# LIE about it.
		touch $tdir/.joyliveusb
	else
		echo "Unknown Triton installer type: $installertype" >&2
		rmdir $tdir
		return 1
	fi

	# NOTE: Because this function only gets used in an installer,
	# we will clean up $tdir in unmount_usb_key, because it's in tmpfs
	# and we might unmount (and the remount) it.
	mount -F lofs $tdir $mnt
	return $?
}

#
# Mount the usbkey at the standard mount location (or whatever is specified).
#
function mount_usb_key()
{
	local mnt=$(extract_mountpath $1)

	if [[ -f "$mnt/.joyliveusb" ]]; then
		echo $mnt
		return 0
	fi

	if ! mkdir -p $mnt; then
		echo "failed to mkdir $mnt" >&2
		return 1
	fi

	### Triton-boot-from-pool or boot-from-read-only-installer section.
	if /bin/bootparams | grep -q "^triton_bootpool=" ; then
		# Technically we shouldn't ever see "skip" here
		# because the only caller of mount_usb_key() with skip
		# is piadm(1M)'s `install`, which can't be invoked on
		# a Triton Head Node.  Checking to be safe.
		if [[ "$2" == "skip" ]]; then
			echo "Somehow a piadm(1M) install on a Head Node is" \
				"happening. This is disallowed." >&2
			return 1
		fi

		mount_bootpool_fake_usbkey $mnt
		return $?
	fi

	if /bin/bootparams | grep -q "^triton_installer=" ; then
		# Technically we shouldn't ever see "skip" here
		# because the only caller of mount_usb_key() with skip
		# is piadm(1M)'s `install`, which can't be invoked on
		# a Triton Head Node.  Checking to be safe.
		if [[ "$2" == "skip" ]]; then
			echo "Somehow a piadm(1M) install on a Head Node is" \
				"happening. This is disallowed." >&2
			return 1
		fi
		mount_installer_fake_usbkey $mnt
		return $?
	fi
	###

	readonly alldisks=$(/usr/bin/disklist -a)

	for disk in $alldisks; do
		# Can do usb_key_version safely here.
		version=$(usb_key_version "/dev/dsk/${disk}p0")

		case $version in
		1) devpath="/dev/dsk/${disk}p1" ;;
		2) devpath="/dev/dsk/${disk}s2" ;;
		*) continue ;;
		esac

		fstyp="$(/usr/sbin/fstyp $devpath 2>/dev/null)"

		if [[ "$fstyp" != "pcfs" ]]; then
			continue
		fi

		/usr/sbin/mount -F pcfs -o foldcase,noatime $devpath $mnt \
		    2>/dev/null

		if [[ $? -ne 0 ]]; then
			continue
		fi

		if [[ -f $mnt/.joyliveusb || "$2" == "skip" ]]; then
			echo $mnt
			return 0
		fi

		if ! /usr/sbin/umount $mnt; then
			echo "Failed to unmount $mnt" >&2
			return 1
		fi
	done

	echo "Couldn't find USB key" >&2
	return 1
}

function unmount_usb_key()
{
	local mnt=$(extract_mountpath $1)

	typ=$(awk -v "mnt=$mnt" '$2 == mnt { print $3 }' /etc/mnttab)

	[[ -z $typ ]] && return 0

	if [[ ! -f "$mnt/.joyliveusb" ]]; then
		echo "$mnt does not contain a USB key" >&2
		return 1
	fi

	# Check for lofs from a temp directory...
	if [[ "$typ" == "lofs" ]]; then
		nuke=$(awk -v "mnt=$mnt" '$2 == mnt { print $1 }' /etc/mnttab |\
			grep '^/etc/svc/volatile/')
	else
		nuke=""
	fi

	umount "$mnt"
	if [[ $? -ne 0 ]]; then
		echo "Can't unmount $mnt" >&2
		return 1
	fi

	if [[ "$nuke" != "" ]]; then
		/bin/rm -rf "$nuke"
	fi

	return 0
}

# replace a loader conf value
function edit_param
{
	local readonly file="$1"
	local readonly key="$2"
	local readonly value="$3"
	if ! /usr/bin/grep "^\s*$key\s*=\s*" $file >/dev/null; then
		echo "$key=\"$value\"" >>$file
		return
	fi

	/usr/bin/sed -i '' "s+^\s*$key\s*=.*+$key=\"$value\"+" $file
}

#
# Presumes a mounted USB key.
#
function usb_key_disable_ipxe()
{
	local readonly mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
	    "svc:/system/filesystem/smartdc:default")
	local readonly dev=$(mount | nawk "\$0~\"^$mnt\" { print \$3 ; }")
	local readonly dsk=${dev%[ps]?}
	local version

	# Check if mnt is lofs mounted...
	if [[ $(awk -v "mnt=$mnt" '$2 == mnt { print $3 }' /etc/mnttab) == \
		"lofs" ]]; then
		# lofs mount of the key means either zpool boot or installer
		# and tmpfs-created copy to fake out the rest.  Those are,
		# unless we go beyond loader, always loader, i.e. version 2.
		version=2
	else
		# Just check the raw disk bits for GRUB vs. Loader.
		version=$(usb_key_version ${dsk}p0)
	fi

	case $version in
	1)
		sed -i '' "s/^default.*/default 1/" $mnt/boot/grub/menu.lst.tmpl
		if [[ -f $mnt/boot/grub/menu.lst ]]; then
			sed -i '' "s/^default.*/default 1/" \
			    $mnt/boot/grub/menu.lst
		fi
		;;
	2)
		edit_param $mnt/boot/loader.conf ipxe "false"
		;;
	*)
		echo "unknown USB key version $version" >&2
		return 1
		;;
	esac
}

#
# This only sets os_console. Presumes a mounted USB key.
#
function usb_key_set_console()
{
	local readonly mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
	    "svc:/system/filesystem/smartdc:default")
	local readonly dev=$(mount | nawk "\$0~\"^$mnt\" { print \$3 ; }")
	local readonly dsk=${dev%[ps]?}
	local version
	local readonly console=$1

	# Check if mnt is lofs mounted...
	if [[ $(awk -v "mnt=$mnt" '$2 == mnt { print $3 }' /etc/mnttab) == \
		"lofs" ]]; then
		# lofs mount of the key means either zpool boot or installer
		# and tmpfs-created copy to fake out the rest.  Those are,
		# unless we go beyond loader, always loader, i.e. version 2.
		version=2
	else
		# Just check the raw disk bits for GRUB vs. Loader.
		version=$(usb_key_version ${dsk}p0)
	fi

	case $version in
	1)
		sed -i '' "s/^variable os_console.*/variable os_console ${console}/" \
		    $mnt/boot/grub/menu.lst.tmpl
		if [[ -f $mnt/boot/grub/menu.lst ]]; then
			sed -i '' "s/^variable os_console.*/variable os_console ${console}/" \
			    $mnt/boot/grub/menu.lst
		fi
		;;
	2)
		edit_param $mnt/boot/loader.conf os_console "$console"
		;;
	*)
		echo "unknown USB key version $version" >&2
		return 1
		;;
	esac
}
