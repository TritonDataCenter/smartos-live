vfsstat(1m) -- Report VFS read and write activity
=============================================

## SYNOPSIS
    vfsstat [-hIMrzZ] [interval [count]]

## DESCRIPTION
The vfsstat utility reports a summary of VFS read and write
activity per zone.  It first prints all activity since boot, then
reports activity over a specified interval.

When run from a non-global zone (NGZ), only activity from that NGZ
can be observed.  When run from a the global zone (GZ), activity
from the GZ and all other NGZs can be observed.

This tool is convenient for examining I/O performance as
experienced by a particular zone or application.  Other tools
which examine solely disk I/O do not report reads and writes which
may use the filesystem's cache.  Since all read and write system
calls pass through the VFS layer, even those which are satisfied
by the filesystem cache, this tool is a useful starting point when
looking at a potential I/O performance problem.  The vfsstat
command reports the most accurate reading of I/O performance as
experienced by an application or zone.

The calculations and output fields emulate those from iostat(1m)
as closely as possible.  When only one zone is actively performing
disk I/O, the results from iostat(1m) in the global zone and
vfsstat in the local zone should be almost identical.  Note that
many VFS read operations may be handled by the filesystem cache,
so vfsstat and iostat(1m) will be similar only when most
operations require a disk access.

As with iostat(1m), a result of 100% for VFS read and write
utilization does not mean that the VFS layer is fully saturated.
Instead, that measurement just shows that at least one operation
was pending over the last interval of time examined.  Since the
VFS layer can process more than one operation concurrently, this
measurement will frequently be 100% but the VFS layer can still
accept additional requests.

## OUTPUT
The vfsstat utility reports the following information:

	r/s	reads per second

	w/s	writes per second

	kr/s	kilobytes read per second

	kw/s	kilobytes written per second

	ractv	average number of read operations actively being
			serviced by the VFS layer

	wactv	average number of write operations actively being
			serviced by the VFS layer

	read_t	average VFS read latency

	writ_t	average VFS write latency

	%r	percent of time there is a VFS read operation
		pending

	%w	percent of time there is a VFS write operation
		pending	

	d/s	VFS operations per second delayed by the ZFS I/O
		throttle

	del_t	average ZFS I/O throttle delay, in microseconds


## OPTIONS
The following options are supported:

-h	Show help message and exit

-I	Print results per interval, rather than per second (where
	applicable)

-M	Print results in MB/s instead of KB/s

-r	Show results in a comma-separated format

-z	Hide zones with no VFS activity

-Z	Print results for all zones, not just the current zone

## OPERANDS
interval

Specifies the length in seconds to pause between each interval
report.  If not specified, vfsstat will print a summary since boot
and exit.

count

Specifies the number of intervals to report.  Defaults to
unlimited if not specified.

## SEE ALSO
    iostat(1m), ziostat(1m), mpstat(1m)

## NOTES

This command does not examine readdir or any other VFS operations,
only read and write operations.

This command does not look at network I/O, only I/O operations to
or from a file.

The output format from vfsstat may change over time; use the
comma-separated output for a stable output format.
