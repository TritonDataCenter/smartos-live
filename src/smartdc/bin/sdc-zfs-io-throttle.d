#!/usr/sbin/dtrace -s
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Prints the calculations and activity of the ZFS I/O throttle.
 */

#pragma D option quiet

sdt:::zfs-zone-stats
{
	printf("Overall: read_t %d, writ_t %d, %d active zones, zone util %d, zone pri %d, disk util %d\n",
	    arg0, arg1, arg2, arg3, arg4, arg5);
}

sdt:::zfs-zone-throttle
/ arg1 != 0 || arg2 != 0 /
{
	printf("    Zone %d: Delay %d -> %d  Fairutil: %d, Actutil: %d\n",
	    arg0, arg1, arg2, arg3, arg4);
}

sdt:::zfs-zone-utilization
{
	printf("    Zone %d: Rops %d, Wops %d, LWops %d, Util %d, Pri %d\n",
	    arg0, arg1, arg2, arg3, arg4, arg5);
}
