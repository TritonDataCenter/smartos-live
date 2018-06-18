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
# Copyright (c) 2017, Joyent, Inc.
#

case "${bi_type}" in
usb|vmware|iso|live)
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
bi_tmpdir="/tmp/build_$bi_type-$UID.$$"
bi_output_dir="output-$bi_type"

bi_dont_leave_me_hanging=0
if [[ ! -t 1 ]] || ! bi_columns=$(tput cols); then
	bi_columns=80
fi
bi_emit_fmt="%-$((bi_columns - 20))s... "
bi_last_start=
bi_last_start_time=

#
# If this variable is populated on failure, we'll emit the contents after the
# error message.  The variable will be cleared whenever you start a new
# section with "bi_emit_start()".
#
bi_extra=

bi_exit_reached=false

function bi_early_exit
{
	if [[ $bi_exit_reached != true ]]; then
		bi_exit_reached=true
		fail 'unexpected early exit'
	fi
}

function bi_exit
{
	bi_exit_reached=true
	exit $1
}

function bi_interrupt
{
	bi_exit_reached=true
	fail 'interrupted by signal'
}

function bi_stack_trace
{
	for (( i = 0; i < ${#FUNCNAME[@]}; i++ )); do
		#
		# Elide the stack trace printer from the stack trace:
		#
		if [[ ${FUNCNAME[i]} == "fail" ||
		    ${FUNCNAME[i]} == "bi_stack_trace" ]]; then
			continue
		fi

		printf '  [%3d] %s\n' "${i}" "${FUNCNAME[i]}" >&2
		if (( i > 0 )); then
			line="${BASH_LINENO[$((i - 1))]}"
		else
			line="${LINENO}"
		fi
		printf '        (file "%s" line %d)\n' "${BASH_SOURCE[i]}" \
		    "${line}" >&2
	done
}

function bi_big_banner
{
	printf '\n'
	printf '### %s #########################################\n' "$*"
	printf '\n'
}

function bi_emit_newline
{
	if [[ ${bi_dont_leave_me_hanging} = 1 ]]; then
		if [[ ! -t 0 || ! -t 1 ]]; then
			printf '\n'
		fi
		bi_dont_leave_me_hanging=0
	fi
}

function bi_emit_start
{
	printf "${bi_emit_fmt}" "$1"
	if [[ -t 0 && -t 1 ]]; then
		printf '\n'
	fi
	bi_dont_leave_me_hanging=1
	bi_last_start="$1"
	bi_last_start_time=$SECONDS
	bi_extra=
}

function bi_emit_done
{
	local bi_delta=$(( SECONDS - $bi_last_start_time ))

	if [[ ${bi_dont_leave_me_hanging} = 0 ]]; then
		#
		# Intervening output has occurred; refresh the user's memory.
		#
		bi_emit_start "(cont.) ${bi_last_start}"
	fi

	if [[ -t 0 && -t 1 ]]; then
		printf '\e[A\e[%dG' "$((bi_columns - 15))"
	fi
	if (( bi_delta > 1 )); then
		printf 'done (%ds)\n' "$bi_delta"
	else
		printf 'done\n'
	fi
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

function bi_log_tee
{
	if [[ -n ${BASH_XTRACEFD:-} ]]; then
		/usr/bin/tee -a "/dev/fd/$BASH_XTRACEFD" || true
	else
		/usr/bin/cat
	fi
}

function bi_log_setup
{
	PS4=
	PS4="${PS4}"'[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: '
	PS4="${PS4}"'${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
	exec 4>>"$1"
	export BASH_XTRACEFD=4
	set -o xtrace
}

function fail
{
	bi_exit_reached=true
	bi_emit_newline
	printf '\nBUILD FAILURE:\n' >&2
	bi_stack_trace
	printf '\n' >&2

	#
	# This cleanup function should be defined in the program, so that
	# program-specific cleanup can be performed on exit.
	#
	printf 'CLEANING UP ON FAILURE ...\n' >&2
	if ! fail_cleanup 2>&1 | sed 's/^/| /'; then
		printf 'ERROR: "fail_cleanup" function did not succeed\n' >&2
	fi
	printf '... DONE\n\n' >&2

	#
	# Print the final error message:
	#
	local msg="$*"
	[[ -z "$msg" ]] && msg="failed"
	printf '%s: ERROR: %s\n' "$bi_arg0" "$msg" | bi_log_tee >&2
	if [[ -n $bi_extra ]]; then
		printf '%s\n' "$bi_extra" | sed 's/^/  | /' |
		    bi_log_tee >&2
	fi
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
	bi_emit_info 'Temporary Directory' "$bi_tmpdir"
	bi_emit_done

	if [[ $bi_type == usb ]]; then
		bi_generate_usb_file
	fi
}

function bi_cleanup_work_dir
{
	if [[ ${bi_dont_clean:-} -eq 1 ]]; then
		return 0
	fi

	bi_emit_start 'Removing temporary directory...'
	[[ ! -d $bi_tmpdir ]] && return
	rm -rf $bi_tmpdir/*
	[[ $? -eq 0 ]] || fail "failed to remove temporary directory contents"
	rmdir $bi_tmpdir
	[[ $? -eq 0 ]] || fail "failed to remove temporary directory"
	bi_emit_done
}
