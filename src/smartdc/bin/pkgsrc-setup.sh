#!/bin/bash
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
# Copyright 2021 Joyent, Inc.
#

function fatal () {
    printf '%s' "$*"
    exit 1
}

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi

root="/${1}"

BOOTSTRAP_TAR="bootstrap-trunk-tools-20201019.tar.gz"
BOOTSTRAP_SHA="9b7a6daff5528d800e8cea20692f61ccd3b81471"

cd /tmp || fatal 'cd to /tmp failed'

printf 'Downloading pkgsrc bootstrap...\n'
curl -# -kO https://pkgsrc.joyent.com/packages/SmartOS/bootstrap/${BOOTSTRAP_TAR}
DOWNLOADED_SHA="$(/bin/digest -a sha1 ${BOOTSTRAP_TAR})"

if ! [[ "${BOOTSTRAP_SHA}" = "${DOWNLOADED_SHA}" ]]; then
    fatal "ERROR: pkgsrc bootstrap checksum failure"
fi

if [[ -d "$root" ]]; then
    tar -zxpf ${BOOTSTRAP_TAR} -C "${root}"
fi

if [[ ${#root} == 1 ]]; then
    printf 'The pkgsrc-tools collection is now ready for use. It will be in\n'
    printf 'your PATH the next time you log in.\n'
fi
