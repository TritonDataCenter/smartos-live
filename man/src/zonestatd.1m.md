zonestatd(1M) -- zones monitoring daemon
========================================

## SYNOPSIS
     /usr/lib/zones/zonestatd

## DESCRIPTION
     zonestatd is a system daemon that is started during system boot.
     It monitors the utilization of system resources by zones, as well
     as zone and system configuration information such as psrset psets,
     pool psets, and resource control settings.

     This daemon is started automatically by the zone management
     software and should not be invoked directly.  It does  not
     constitute  a  programming interface, but is classified as a
     private interface.

## SECURITY
     The zonestat service in the global zone must be online for the
     zonestat service in each non-global zone (NGZ) to function
     properly.  The zonestat service in each NGZ does not directly read
     system configuration and utilization data, but rather reads from
     the zonestat service on the global zone.

## ATTRIBUTES
     See attributes(5) for descriptions of the  following  attri-
     butes:

     ____________________________________________________________
    |       ATTRIBUTE TYPE        |       ATTRIBUTE VALUE       |
    |_____________________________|_____________________________|
    | Availability                | system/zones                |
    |_____________________________|_____________________________|
    | Interface Stability         | Private                     |
    |_____________________________|_____________________________|

## SEE ALSO
     zonestat(1), smf(5), zones(5),  poolcfg(1M), pooladm(1M), prctl(1M),
     rcapadm(1M), acctadm(1M)

## NOTES
    The zonestat service is managed by  the  service  management
    facility, smf(5), under the service identifier:

      svc:/system/zones-monitoring:default

    Administrative actions on this service,  such  as  enabling,
    disabling,  or  requesting  restart,  can be performed using
    svcadm(1M). The service's status can be  queried  using  the
    svcs(1) command.

    The zonestat service has the following SMF configuration property:

      config/sample_interval

	This property sets the zonestatd sample interval.  This is the
    interval used by the zones monitoring daemon, zonestatd(1M) to
    sample resource utilization.  This is also the interval used to
    determine configuration changes such as processor set changes,
    resource control changes, and zone state changes.

    The default interval is 5 seconds.

    The zonestat service makes use of extended accounting facility.  If
    not already enabled, it enables the tracking of process accounting
    resources, and configures a process accounting file.  The zonestat
    service will roll the process accounting log at its configured
    interval (see zonestatd(1M)).

    If extended process accounting is enabled externally, the zonestat
    service will use the process accounting log as configured.  It
    will not roll the accounting log, but will operate correctly if
    the accounting log is rolled externally.

