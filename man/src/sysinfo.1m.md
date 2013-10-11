# sysinfo(1M) -- Output information about this SmartOS system.

## SYNOPSIS

    sysinfo [<options>]


## DESCRIPTION

The sysinfo tool allows you to gather several pieces of information about a
SmartOS host in one place.  With no arguments system info is written to stdout
as a JSON object.

As some of the data can take some time to gather and most does not change after
the system is up, the data is cached.  This allows sysinfo to return quickly
after the cache has been created.  Any scripts which modify data that is
included in the sysinfo output should run 'sysinfo -u' to update the cache after
making changes.


## OPTIONS

**-f**
    force an update of cache and then output the updated
    data

**-p**
    output parseable key=value format instead of JSON
    (JSON is the default)

**-u**
    update the cache only, do not output anything

**-?**
    Print help and exit.


## FIELDS

  The fields of the JSON output from sysinfo are listed
  below along with a brief description.  They're also
  marked as one of:

    GZ only         -- only available in sysinfo output from the global zone
    NGZ only        -- only available in sysinfo output from a non-global zone
    GZ and NGZ      -- available in sysinfo output from global or non-global
    GZ SDC only     -- same as GZ only but also only available in Joyent's SDC


  "Boot Parameters"

    An object containing key/value pairs that were passed on the kernel command
    line.

    GZ only

  "Boot Time"

    Timestamp (seconds since 1970-01-01 00:00:00 UTC) at which the system was
    booted.  For a non-global zone, this is the time the zone was booted.

    GZ and NGZ

  "CPU Physical Cores"

    Number of physical CPUs in this host.

    GZ only

  "CPU Total Cores"

    The number of CPU cores in this host.

    GZ only

  "CPU Type"

    The model of CPU in this host. Eg. "Intel(R) Xeon(R) CPU E5530 @ 2.40GHz".

    GZ only

  "CPU Virtualization"

    Which CPU Virtualization features this host supports.
    Will be one of: 'none', 'vmx', 'svm'

    GZ only

  "Datacenter Name"

    This indicates the name of the datacenter in which this node is running.

    GZ SDC Only

  "Disks"

    This is an object containing information about disks on the system.  Each
    disk is represented by another object (keyed on disk name) which includes
    the size in GB of that disk.

    GZ only

  "Hostname"

    The results of `hostname`.

    GZ and NGZ

  "Link Aggregations"

    An object with a member for each link aggregation configured on the
    machine.  Entries include the LACP mode and names of the interfaces
    in the aggregation.

    GZ only

  "Live Image"

    This is the build stamp of the current platform.

    GZ and NGZ

  "Manufacturer"

    This is the name of the Hardware Manufacturer as set in the SMBIOS.
    Eg. "Dell".

    GZ only

  "MiB of Memory"

    The amount of DRAM (in MiB) available to processes.  For the GZ this is the
    amount available to the system.  For a non-global zone, this is the cap on
    memory for this zone.

    GZ and NGZ

  "Network Interfaces"

    An object with a member for each physical NIC attached to the machine.
    Entries include the MAC, ip4addr, Link Status and NIC Names (tags) for each
    interface.

    GZ only

  "Product"

    This is the name of the Product as set by your hardware vendor in the SMBIOS
    Eg. "PowerEdge R710".

    GZ only

  "SDC Agents"

    In SDC this is an array of installed agents and their versions.

    GZ SDC only

  "SDC Version"

    The version of SDC this platform belongs to.

    GZ SDC Only

  "Serial Number"

    Manufacturers serial number as set in SMBIOS.

    GZ only

  "Setup"

    Used to indicate whether the machine has been setup and is ready for
    provisioning.

    GZ SDC only

  "System Type"

    This is the output of 'uname -s'.

    GZ and NGZ

  "UUID"

    Universally unique identifier for this machine.  In the GZ this will be the
    UUID from the SMBIOS info.  In a zone this will be the UUID of the zone.

    GZ and NGZ

  "Virtual Network Interfaces"

    An object with a member for each virtual NIC attached to the machine.
    Entries include the MAC Address, ip4addr, Link Status and VLAN for each
    interface.  In the GZ you also can see the "Host Interface" a vnic is
    attached to.

    GZ and NGZ

  "VM Capable"

    This is set to 'true' when this host can start KVM brand VMs.
    Note: This does not necessarily mean that the KVM driver will load.

    GZ only

  "ZFS Quota"

    In a non-global zone, this will give you the quota on your zone's zoneroot.

    NGZ only

  "Zpool"

    The name of the system zpool as set by smartdc-init.  (usually: 'zones')

    GZ only

  "Zpool Disks"

    This is a comma separated list of disks that are part of the zpool.

    GZ only

  "Zpool Profile"

    This displays the proile of the zpool's disks.
    Will be one of: mirror, raidz3, raidz2, raidz, striped

    GZ only

  "Zpool Size in GiB"

    The total size of the zpool in GiB.

    GZ only


## SEE ALSO

    dladm(1M), hostname(1), ifconfig(1M), prtconf(1M), psrinfo(1M), smbios(1M), uname(1), zfs(1M), zpool(1M)

