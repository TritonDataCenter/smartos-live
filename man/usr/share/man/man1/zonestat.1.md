zonestat(1) -- report active zone statistics.
=============================================

## SYNOPSIS
    zonestat [-z zonelist] [-r reslist] [-n namelist] [-T u | d | i]
          [-R reports] [-q] [-p [-P lines]] [-S cols]
          interval [duration [report]]

## DESCRIPTION
The zonestat utility reports on the cpu, memory, and resource
control utilization of the currently running zones.  Each zone's
utilization is reported both as a percentage of system resources
and the zone's configured limits.

The zonestat utility prints a series of interval reports at the
specified interval.  It optionally also prints one or more summary
reports at a specified interval.

The default output is a summary of cpu, physical, and virtual
memory utilization.  The -r option can be used to choose detailed
output for specific resources.

## SECURITY
When run from within a non-global zone (NGZ), only processor sets
visible to the NGZ are reported.  The NGZ output will include all
of other system resources, such as memory and limits.

For all reported resources, the NGZ's usage will be outputted.
Usage of each resource by the system, global zone, and all other
zones, will be reported as used by [system].

## OPTIONS
The following options are supported:

-z zonename[,zonename]:

    Specify a list of zones on which to report.  By default all
    zones are reported.  In addition to a comma-separated list,
    multiple -z options can be specified to report on a set of
    zones.  The output will include any resources which have usage
    by the specified zone(s).

-r resource[,resource]:

    Specify resource types on which to report.  The available
    resources are:

        physical-memory, virtual-memory, locked-memory,
        processor-sets, processes, lwps, shm-memory, shm-ids,
        sem-ids, msg-ids, lofi

    The following nicknames can also be specified as resource
    names:

        summary:      A summary of cpu, physical-memory, and
                      virtual memory usage.

        memory:       physical-memory, virtual-memory, and
                      locked memory.

        psets:        processor-sets

        default-pset  The default pset only.

        limits:       processes, lwps, lofi

        sysv:         shm-memory, shm-ids, sem-ids msg-ids

        all:          all resource types.

    By default the summary resource is printed.

    In addition to a comma-separated list, multiple -r options can
    be specified to report on a set of resources types.

    The system's cpus can be partitioned into processor sets
    (psets)  By default, all cpus are in a single pset named
    "pset_default".

    Memory is not partition-able into sets.  The zonestat utility
    output for these resources will show them as named
    "mem_default" and "vm_default".

    The "all" resource specifies that all resource types should
    be reported.

-n name[,name]

    Specify a list resource names on which to report.  For pset
    resources, this is the name of the processor set.  For
    physical-memory, locked-memory, and virtual-memory resources,
    the only names are "mem_default" and "vm_default".

    Dedicated-cpu processor sets can be specified by their pset
    name ("SUNWtmp_<zonename>"), or by just their zonename.

    Processor sets created by psrset can be specified by their pool
    pset name "(SUNWlegacy_<psetid>)", or just by their psetid.

    In addition to a comma-separated list, multiple -n options can
    be specified to report on a set of resources.

-T u | d | i

    Include timestamp of each report.  The following formats are
    supported:

    u
        A printed representation of the internal representation of
        time. See time(2).  This is also known as unix time.

    d
        Standard date format.  See date(1).  This option is not
        valid with -p.

    i
        Time formatted as the ISO 8601 compliant format:

            YYYYMMDDThhmmssZ

-R report[,report]

    Print a summary report.  The supported report types are
    described below.  In addition to a comma-separated list,
    multiple -R's may be specified for a set of summary reports.

    total

        Prints a summary report detailing the following for each
        resource:

        psets
            Total cpu used since start of command invocation.  The
            percent used for each zone includes time that a zone
            was not running.  For instance, if a zone used 100% of
            the cpu while it was running, but the zone was halted
            for half of the intervals, then the summary report
            will show the zone used 50% of the cpu time.

        memory, limits, sysv
            Average resource used of all intervals reported since
            command invocation.  This average factors in intervals
            in which a zone was not running.  For example if a zone
            used on average of 100M of physical memory while it was
            running, and was only running for half the intervals,
            then the summary report will show that the zone used
            50M of physical memory on average.

    average

       Similar to "total", but only intervals in which a zone is
       running are factored in.  For example, if a zone was only
       running for a single interval, and during that interval,
       the zone used 200M of virtual memory, then it's average
       virtual-memory will be 200M, regardless of the number of
       intervals reported before the summary report.

    high

       Print a summary report detailing the highest usage of each
       resource and zone during any interval of the zonestat
       utility invocation.

-S col[,col]

    Sort zones utilizing each resource.  The following sorting
    columns can be specified.

     name
          Sort alphanumerically by zone name.

     used
          Sort by quantity of resource used.

     cap
          Sort by configured cap.

     pcap
          Sort by percent of cap used.

     shr
          Sort by allocated share.

     pshru
          Sort by percent of share used.

     By default, output is sorted by quantity of resource used.

-q Quiet mode.

    Only print summary reports (requires -R).  All interval reports
    are omitted.

-p Parseable output.

    Print output in stable, machine--parseable format.  Individual
    fields will be delimited with ":".  The line format is:

        <report type>:<resource>:<field>[:<field>]*

    If -T is specified each line is prefixed with a timestamp:

        <timestamp>:<report type>:<resource>:<field>[:<field>]*

    The report types are:
        report-total, report-average, report-high, interval

    The resource types are:
        header, footer, summary, physical-memory, virtual-memory,
        locked-memory, processor-set, processes, lwps,
        sysv-shared-memory, sysv-shmids, sysv-semids, sysv-msgids,
        lofi

    The "header" resource is a special resource used to state the
    beginning of an interval or summary report.  All output lines
    between header resources belong to the same report.  Each
    header has a matching footer.

    The remaining fields are resource type specific.  See the
    zonestat utility output for details.

    All existing output fields are stable.  Future versions may
    introduce new report and resource types.  Future versions may
    also add additional new fields to the end of existing output
    lines.

-P line[,line]

    For parseable output, specify lines to output in parseable
    output.  One or more of the following line types can be
    chosen:

    resource
        The lines describing each resource.

    total
        The total utilization of each resource.

    system
        The utilization of each resource by the system.  This
        includes the kernel, and any resource consumption not
        contributable to a specific zone.  When zonestat is run
        from within a non-global-zone, this value will be the
        aggregate resource consumed by the system and all other
        zones.

    zones
        Lines detailing the per-zone utilization of each resource.

    header, footer
        For each interval, and summary report has a header, which
        prints details such as the interval and count information.
        After each report, and footer is also printed

## OPERANDS
interval

    Specifies the length in seconds to pause between each
    interval report. An interval of "default" will use the
    configured interval of the zones monitoring service
    (see zonestatd(1M).

    Interval is required.  An interval of zero is not
    permitted.  The interval can be specified as
    [nh][nm][ns], such as 10s or 1m.

duration

    Specifies the number of intervals to report.  Defaults to
    infinity if not specified.  The command duration is
    (interval * duration).  A duration of zero is invalid.  A
    value of "inf" can also be specified to explicitly choose
    infinity.

    Duration can also be specified as [nh][nm][ns].  In this
    case, duration will be interpreted as the duration of
    execution time.  The actual duration will be rounded up
    to the nearest multiple of the interval.

report
    Specify the summary report period.  For instance, a
    report of 4 would produce reports every 4 intervals.  If
    the command duration is not a multiple of report, then
    the last report will be of any remaining intervals.

    Report can also be specified as [nh][nm][ns].  In this
    case, reports will be outputted at the specified time
    period, rounded up to the nearest interval.  If the
    command duration is not a multiple of report, then the
    last report will be of any remaining intervals.

    Requires -R.  If -R is specified and report is not, the
    report period will be the entire command duration,
    producing the specified reports at the end of execution.

## OUTPUT
The following list defines the column heading of the command output:

    SYSTEM-MEMORY

        The total amount of memory available on the physical host.

    SYSTEM-LIMIT

        The maximum amount of resource available on the physical host.

    CPUS

        The number of cpus allocated to a processor set.

    ONLINE

        Of the cpus allocated to a processor set, the number of cpus
        which can execute processes.

    MIN/MAX

        The minimum and maximum number of cpus which may be allocated
        to the processor set by the system.

    ZONE

        The zone using the resource.  In addition to zone names, this
        column may also contain:

        [total]    The total quantity of resource used system-wide.

        [system]   The quantity of resource used by the kernel or
                   in a manner not associated with any particular
                   zone.

                   When zonestat is used within a non-global zone,
                   [system] designates the aggregate resource used
                   by the system and by all other zones.

    USED

        The amount of resource used.

    PCT

        The amount of resource used as a percent of the total resource.

    %PART

        The amount of cpu uses as a percentage of the total cpu in
        a processor-set to which the zone is bound.  A zone can only
        have processes bound to multiple processor sets if it is the
        global zone, or if psrset(1M) psets are used.  If multiple
        binding are found for a zone, it's %PART will be the fraction
        used of all bound psets.  For [total] and [system],
        %PART is the percent used of all cpus on the system.

    CAP

        If a zone is configured to have a cap on the given resource,
        the cap will be displayed in this column.

    %CAP

        The amount of resource used as a percent of zone's configured
        cap.

    SHRS

        The number of shares allocated to the zone.  For the [total]
        row, this will be the total number of shares allocated to all
        zones sharing the resource.

        If a zone is not configured to use shares, and is sharing a
        resource with other zones that are configured to use shares,
        this column will contain "no-fss" for the zone.

    %SHR

        The fraction of the total shares allocated to the zone.  For
        instance, if 2 zones share a processor set, each with 10
        shares, then each zone will have a %SHR of 50%.

    %SHRU

        Of the share allocated to the zone, the fraction of resource
        used.  Zones using all of their share will have a %SHRU of
        100%.  Because shares are only enforced when there is resource
        contention, it is possible for a zone to have a %SHRU in excess
        of 100%.

## EXAMPLES
Example 1:  Summary of cpu and memory utilization every 5 seconds.

    # zonestat -z global -r physical-memory 5
    # zonestat 5 1
    SUMMARY
                 -----CPU------------- ----PHYSICAL--- ----VIRTUAL----
               ZONE USED %PART %CAP %SHRU USED  PCT  %CAP  USED  PCT %CAP
            [total] 9.74   30%    -     - 7140M  21%    - 10.6G  22%    -
           [system] 0.28  0.8%    -     - 6535M  19%    - 10.4G  21%    -
             global 9.10   28%    -     -  272M 0.8%    -  366M 0.7%    -
              zoneA 0.32  1.0%    -     -  256M 0.7%    -  265M 0.5%    -
              zoneB 0.00  0.0%    -     - 77.6M 0.2%    - 71.1M 0.1%    -


Example 2:  Using parseable output, fetching only zone usages.

    The following command will produce parseable output, printing one
    line per zone using each pset resource for a 5 second interval.

    # zonestat -p -P zones -r psets 5 1

Example 3:  Report on the default pset.

    The following command will report on the default pset once a second
    for one minute.

    # zonestat -r default-pset 1 1m

Example 4:  Report total and high utilization.

    The following command monitors silently at a 10 second interval
    for 24 hours, producing a total and high report every 1 hour.

    # zonestat -q -R total,high 10s 24h 1h

## EXIT STATUS
The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.

     3
         svc:system/zones_monitoring:default not running or not
         responding.


## ATTRIBUTES
See attributes(5) for descriptions of the  following  attributes:

     ____________________________________________________________
    |       ATTRIBUTE TYPE        |       ATTRIBUTE VALUE       |
    |_____________________________|_____________________________|
    | Availability                | system/zones                |
    |_____________________________|_____________________________|
    | Interface Stability         | See below                   |
    |_____________________________|_____________________________|

Command invocation and parsable output is Committed.  Human
readable output (default output) is uncommitted.

## SEE ALSO
    date(1), zonestatd(1M), libzonestat(3LIB), zonecfg(1M), zoneadm(1M),
    zones(5), poolcfg(1M), pooladm(1M), prctl(1M), privileges(5),
    rcapadm(1M), resource_controls(5), timezone(4)

## NOTES
The zonestat utility depends on the zones monitoring service:

    svc/system/zonestat:default

If the zonestat service is stopped while the zonestat utility is
running, the zonestat command invocation will quit without printing
additional reports.

The reports (-R) will be printed if zonestat is interrupted (by
ctrl-c, SIGINT) before reaching the next report period.

