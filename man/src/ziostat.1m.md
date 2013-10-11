ziostat(1M) -- Report ZFS read I/O activity
=============================================

## SYNOPSIS
    ziostat [-hIMrzZ] [interval [count]]

## DESCRIPTION
The ziostat utility reports a summary of ZFS read I/O operations.
It first prints all activity since boot, then reports activity
over a specified interval.

When run from a non-global zone (NGZ), only activity from that NGZ
can be observed.  When run from a the global zone (GZ), activity
from the GZ and all other NGZs can be observed.

This tool is useful for determining if disk I/O is a source of
application latency.  Combined with vfsstat(1M), ziostat(1M) shows
the relative contribution of disk I/O latency to overall I/O (and
therefore application) latency.

## OUTPUT
The ziostat utility reports the following information:

	r/s	reads per second

	kr/s	kilobytes read per second

	actv	average number of ZFS read I/O operations being
			handled by the disk

	wsvc_t	average wait time per I/O, in milliseconds

	asvc_t	average disk service time per I/O, in milliseconds

	%b	percent of time there is  an I/O operation pending

## OPTIONS
The following options are supported:

-h	Show help message and exit

-I	Print results per interval, rather than per second (where
	applicable)

-M	Print results in MB/s instead of KB/s

-r	Show results in a comma-separated format

-z	Hide zones with no read I/O activity

-Z	Print results for all zones, not just the current zone

## OPERANDS
interval

Specifies the length in seconds to pause between each interval
report.  If not specified, ziostat will print a summary since boot
and exit.

count

Specifies the number of intervals to report.  Defaults to
unlimited if not specified.

## SEE ALSO
    iostat(1M), vfsstat(1M), mpstat(1M)

## NOTES

This utility does not show any ZFS write I/O activity.  Most write
operations are asynchronous, so the latency of those operations
committing to disk is much less important that read latency.

The output format from ziostat may change over time; use the
comma-separated output for a stable output format.
