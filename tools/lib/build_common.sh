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
# Copyright 2015 Joyent, Inc.
#

case "${bi_type}" in
usb|vmware|iso)
	;;
*)
	printf 'ERROR: $bi_type set to invalid value: "%s"\n' "${bi_type}" >&2
	exit 1
	;;
esac

if [[ -z "${bi_wsroot}" ]]; then
	printf 'ERROR: $bi_wsroot not set\n' >&2
	exit 1
fi

bi_platform_dir="output/"
bi_platform_name=
bi_platform=
bi_tmpdir="/tmp/build_$bi_type-$USER.$$"
bi_output_dir="output-$bi_type"

bi_dont_leave_me_hanging=0
if [[ ! -t 1 ]] || ! bi_columns=$(tput cols); then
	bi_columns=80
fi
bi_emit_fmt="%-$((bi_columns - 20))s... "
bi_last_start=

function bi_emit_newline
{
	if [[ ${bi_dont_leave_me_hanging} = 1 ]]; then
		printf '\n'
		bi_dont_leave_me_hanging=0
	fi
}

function bi_emit_start
{
	printf "${bi_emit_fmt}" "$1"
	bi_dont_leave_me_hanging=1
	bi_last_start="$1"
}

function bi_emit_done
{
	if [[ ${bi_dont_leave_me_hanging} = 0 ]]; then
		#
		# Intervening output has occurred; refresh the user's memory.
		#
		bi_emit_start "(cont.) ${bi_last_start}"
	fi

	printf 'done\n'
	bi_dont_leave_me_hanging=0
}

function bi_emit_info
{
	local msg
	msg="$1:"
	shift

	bi_emit_newline
	printf '  * %s "%s"\n' "${msg}" "$*"
}

function fail
{
	bi_emit_newline

	#
	# This cleanup function should be defined in the program, so that
	# program-specific cleanup can be performed on exit.
	#
	if ! fail_cleanup; then
		printf 'ERROR: "fail_cleanup" function did not succeed\n' >&2
	fi

	#
	# Print the final error message:
	#
	local msg="$*"
	[[ -z "$msg" ]] && msg="failed"
	printf '%s: ERROR: %s\n' "$bi_arg0" "$msg" >&2
	exit 1
}

function bi_get_build
{
	#
	# The build process updates a "platform-latest" symlink to the
	# most recently built platform directory.  We use that symlink
	# to decide which platform to bundle into the ISO or USB image.
	#
	bi_emit_start 'Determining platform'
	if [[ ! -L "${bi_platform_dir}/platform-latest" ]]; then
		fail '"platform-latest" symlink does not exist'
	fi

	if ! bi_platform_name=$(/usr/bin/readlink \
	    "${bi_platform_dir}/platform-latest"); then
		fail 'failed to read "platform-latest" symlink'
	fi

	bi_platform="${bi_platform_dir}${bi_platform_name}"
	if [[ -z "${bi_platform_name}" || ! -d "${bi_platform}" ]]; then
		fail '"platform-latest" symlink does not point to directory'
	fi

	bi_emit_done
	bi_emit_info 'Using platform' "${bi_platform_name}"
}

function bi_setup_work_dir
{
	bi_emit_start 'Creating temporary directory...'
	if ! mkdir $bi_tmpdir >/dev/null; then
		fail "failed to make temporary directory"
	fi
	bi_emit_done

	if [[ $bi_type == usb ]]; then
		bi_generate_usb_file
	fi
}

function bi_cleanup_work_dir
{
	[[ $bi_dont_clean -eq 1 ]] && return
	bi_emit_start 'Removing temporary directory...'
	[[ ! -d $bi_tmpdir ]] && return
	rm -rf $bi_tmpdir/*
	[[ $? -eq 0 ]] || fail "failed to remove temporary directory contents"
	rmdir $bi_tmpdir
	[[ $? -eq 0 ]] || fail "failed to remove temporary directory"
	bi_emit_done
}
