# nictagadm(1m) -- Manage SmartOS nic tags.


## SYNOPSIS

    nictagadm [-v] list
    nictagadm [-v] list -l
    nictagadm [-v] list -L
    nictagadm [-v] add <tag name> <MAC>
    nictagadm [-v] add -l <tag name>
    nictagadm [-v] update <tag name> <MAC>
    nictagadm [-v] delete [-f] <tag name>
    nictagadm [-v] vms <tag name>


## DESCRIPTION

The nictagadm tool allows you to add, update, delete and display information
about SmartOS nic tags. Both standard nic tags and local-only etherstubs can
be managed.

Nic tags are used in SmartOS to refer to a physical nic without needing its
underlying MAC address or interface name. Both vmadm(1m) and the SmartOS
config file use them as identifiers.

For nodes with /usbkey present, nictagadm will update /usbkey/config as
appropriate, and attempt to mount the original USB key and update its copy
as well. This allows the nic tags to persist across reboots.

For nodes without /usbkey present, nic tags will not persist across reboots
unless the nic tag parameters are passed in as boot parameters at the next
reboot.


## OPTIONS

**-v**
    Output verbose diagnostic information

**-?**
    Print help and exit.

**-?**
    Print help and exit.


## COMMANDS

    The following commands and options are supported:

      add [-l] <name> [MAC address]

        Create a new nic tag on the system. If the '-l' option is specified,
        the nic tag will be an etherstub, and the MAC address is not needed.


      delete <tag name>

        Deletes an existing tag on the system, unless it's in use by any VMs.

        Options:
            -f          Force delete - do not check if it is in use by VMs.


      list [<options>]

        List nic tags on the system.

        Options:
            -l          List etherstubs only.
            -L          List normal nic tags only.
            -p          Parseable output.
            -d delim    Change the delimiter for parseable output. The
                        default delimiter is ':'.


      update <tag name> <new MAC address>

        Updates the MAC address associated with a nic tag.


      vms <tag name>

        Lists UUIDs of VMs using a nic tag.


## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.


## SEE ALSO

    dladm(1m), sysinfo(1m), vmadm(1m)

