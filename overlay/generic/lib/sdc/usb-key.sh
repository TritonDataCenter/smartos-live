#!/usr/bin/bash
#
# Utilities for dealing with the USB key. In general, sdc-usbkey should be used.
# These routines are for use prior to sdc-usbkey being installed.
#
# Copyright (c) 2019, Joyent, Inc.
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

#
# Mount the usbkey at the standard mount location (or whatever is specified).
#
function mount_usb_key()
{
	local mnt=$1

	if [[ -z "$mnt" ]]; then
		mnt=/mnt/$(svcprop -p "joyentfs/usb_mountpoint" \
		    "svc:/system/filesystem/smartdc:default")
	fi

	if [[ -f "$mnt/.joyliveusb" ]]; then
		echo $mnt
		return 0
	fi

	if ! mkdir -p $mnt; then
		echo "failed to mkdir $mnt" >&2
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

		fstyp="$(/usr/sbin/fstyp $devpath 2>/dev/null)"

		if [[ "$fstyp" != "pcfs" ]]; then
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
	local mnt=$1

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
	local readonly version=$(usb_key_version ${dsk}p0)

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
	local readonly version=$(usb_key_version ${dsk}p0)
	local readonly console=$1

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
