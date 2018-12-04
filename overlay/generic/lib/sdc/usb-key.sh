#!/usr/bin/bash
#
# Utilities for dealing with the USB key.
#
# Copyright (c) 2018, Joyent, Inc.
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

	mbr_sig=$(echo $(/usr/bin/od -t x2 -j 0x1fe -A n -N 2 $devpath) )

	if [[ "$mbr_sig" != "aa55" ]]; then
		echo "unknown"
		return
	fi

	grub_val=$(echo $(/usr/bin/od -t x2 -j 0x3e -A n -N 2 $devpath) )
	loader_major=$(echo $(/usr/bin/od -t x1 -j 0xfa -A n -N 1 $devpath) )

	if [[ "$grub_val" = "0203" ]]; then
		echo "1"
		return
	fi

	echo $(( 0x$loader_major ))
}

#
# Mount the usbkey at the standard mount location (or whatever is specified).
#
function mount_usb_key()
{
	local readonly mnt=$1

	if [[ -z "$mnt" ]]; then
		mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
		    "svc:/system/filesystem/smartdc:default")
	fi

	if [[ -f "$mnt/.joyliveusb" ]]; then
		echo $mnt
		return 0
	fi

	if ! mkdir -p $mnt; then
		echo "failed to mkdir $mnt" 2>&1
		return 1
	fi

	readonly alldisks=$(/usr/bin/disklist -a)

	for disk in $alldisks; do
		version=$(usb_key_version "/dev/dsk/${disk}p0")

		case $version in
		1) devpath="/dev/dsk/${disk}p1" ;;
		2) devpath="/dev/dsk/${disk}s2" ;;
		*) continue ;;
		esac

		if [[ "$(/usr/sbin/fstyp $devpath 2>/dev/null)" != "pcfs" ]]; then
			continue
		fi

		/usr/sbin/mount -F pcfs -o foldcase,noatime $devpath $mnt \
		    2>/dev/null

		if [[ $? -ne 0 ]]; then
			continue
		fi

		if [[ -f $mnt/.joyliveusb ]]; then
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
	local readonly mnt=$1

	if [[ -z "$mnt" ]]; then
		mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
		    "svc:/system/filesystem/smartdc:default")
	fi

	typ=$(awk -v "mnt=$mnt" '$2 == mnt { print $3 }' /etc/mnttab)

	[[ -z $typ ]] && return 0

	if [[ ! -f "$mnt/.joyliveusb" ]]; then
		echo "$mnt does not contain a USB key" >&2
		return 1
	fi

	umount "$mnt"
}

function unmount_usb_key()
{
	local readonly mnt=$1

	if [[ -z "$mnt" ]]; then
		mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
		    "svc:/system/filesystem/smartdc:default")
	fi

	typ=$(awk -v "mnt=$mnt" '$2 == mnt { print $3 }' /etc/mnttab)

	[[ -z $typ ]] && return 0

	if [[ ! -f "$mnt/.joyliveusb" ]]; then
		echo "$mnt does not contain a USB key" >&2
		return 1
	fi

	umount "$mnt"
}

#
# Mount the EFI system partition, if there is one.  Note that since we need to
# peek at .joyliveusb to be sure, the only way to find a USB key is to mount its
# root first...
#
function mount_usb_key_esp()
{
	rootmnt=$(mount_usb_key)

	if [[ $? -ne 0 ]]; then
		return 1
	fi

	dev=$(mount | nawk "\$0~\"^$rootmnt\" { print \$3 ; }")
	dsk=${dev%[ps]?}

	mnt=/tmp/mnt.$$

	if ! mkdir -p $mnt; then
		echo "failed to mkdir $mnt" 2>&1
		return 1
	fi

	version=$(usb_key_version ${dsk}p0)

	#
	# If this key is still grub, then we don't have an ESP, but we shouldn't
	# report an error.
	#
	if [[ "$version" = "1" ]]; then
		rmdir $mnt
		return 0
	fi

	/usr/sbin/mount -F pcfs -o foldcase,noatime ${dsk}s0 $mnt

	if [[ $? -ne 0 ]]; then
		rmdir $mnt
		return 1
	fi

	echo $mnt
	return 0
}
