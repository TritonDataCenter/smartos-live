#!/bin/ksh -p
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
# Copyright 2012 Joyent, Inc.  All rights reserved.
# Use is subject to license terms.
#

final_setup()
{
	ZRAM=$(zonecfg -z ${ZONENAME} info attr name=ram | \
		grep "value: " | cut -d ':' -f2 | tr -d ' ')

	if [[ -z ${ZRAM} ]]; then
		echo "Unable to find RAM value for KVM VM"
		exit $ZONE_SUBPROC_FATAL
	fi

	# 100G unless the VM has 80G or more DRAM, in which case: DRAM + 20G.
	CORE_QUOTA=102400
	if [[ ${ZRAM} -gt 81920 ]]; then
		CORE_QUOTA=$((${ZRAM} + 20480))
	fi

	# The cores quota exists to control run-away zones. As such we make it
	# such that it will protect the system from a single run-away, but
	# still allow us to get most cores.
	rm -rf $ZONEPATH/cores
	zfs create -o quota=${CORE_QUOTA}m -o mountpoint=/zones/$bname/cores \
	    zones/cores/$bname
}
