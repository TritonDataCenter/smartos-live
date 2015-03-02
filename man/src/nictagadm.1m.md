# nictagadm(1M) -- Manage SmartOS nic tags.


## SYNOPSIS

    nictagadm add [-v] [-l] [-p prop=value,...] <name> [mac]
    nictagadm delete [-v] [-f] <name>
    nictagadm exists [-lv] <name> [name1]...
    nictagadm list [-v]  [-l | -L] [-p] [-d delim]
    nictagadm update [-v] [-p prop=value,...] <name> [mac]
    nictagadm vms [-v] <name>



## DESCRIPTION

The nictagadm tool allows you to add, update, delete and display information
about SmartOS nic tags. Both standard nic tags and local-only etherstubs can
be managed.

Nic tags are used in SmartOS to refer to a physical nic without needing its
underlying MAC address or interface name. Both vmadm(1M) and the SmartOS
config file use them as identifiers. In addition, the nic tag is used to
describe the maximum mtu of the network. When the system is started, the
physical device will be programmed with the MTU that is the maximum of
all of the specified tags. The MTU is not updated live.

For nodes with /usbkey present, nictagadm will update /usbkey/config as
appropriate, and attempt to mount the original USB key and update its copy
as well. This allows the nic tags to persist across reboots.

For nodes without /usbkey present, nic tags will not persist across reboots
unless the nic tag parameters are passed in as boot parameters at the next
reboot.


## GENERAL OPTIONS

The following options are valid for all commands.

**-v**
    Output verbose diagnostic information

**-h**
    Print help and exit.

**-?**
    Print help and exit.


## SUBCOMMANDS

    The following subcommands and options are supported:

      add [-v] [-l] [-p prop=value,...] <name> [mac]

        Create a new nic tag on the system, named *name*. If the '-l' option is
        specified, the nic tag will cause an **etherstub** to be created which
        is a virtual switch on the local host. When creating an **etherstub**,
        a mac address is not necessary.

        When creating a nic tag otherwise, the mac address is necessary. The
        mac address may either be specified in the property list or as an
        optional final argument. For a full list of valid properties, see the
        section PROPERTIES.

        -v

              See GENERAL OPTIONS above.

        -l

              Create an ethestub

        -p *prop=value*,...

              A comma-separate list of properties to set to the specified
              values.


      delete [-v] [-f] <name>

        Deletes an existing tag on the system, unless it's in use by any VMs.
        The use of -f skips this check.

         -f

               Delete the nic tag regardless of existing VMs.

         -v

              See GENERAL OPTIONS above.

      exists [-lv] <name> [name1]...

         Tests to see if a nic tag exists with *name*. If it exists, the
         program exits 0, otherwise it exists non-zero.

         -l

              Only emit the names of nic tags that don't exist to stderr.

         -v

              See GENERAL OPTIONS above.

      list [-v]  [-l | -L] [-p] [-d delim]

        List nic tags on the system.

        -v

              See GENERAL OPTIONS above.

        -l

              Only list etherstubs.

        -L

              Don't list etherstubs

        -p

              Output in a parseable form

        -d *delim*

              Sets the output delimeter to *delim*. The default delimiter is
              ':'.

      update [-v] [-p prop=value,...] <name> [mac]

        Updates the properties of a nic tag. For a full list of properties see
        the section PROPERTIES. For backwards compatibility, the mac address
        may be specified as an optional final argument. If used, it should be
        specified via -p.

        -v

              See GENERAL OPTIONS above.

        -p *prop=value*,...

              A comma-separate list of properties to set to the specified
              values.


      vms <tag name>

        Lists UUIDs of VMs using a nic tag.


## PROPERTIES

The following properties are accepted for use with the nictagadm -p options:

     mac

        Indicates the MAC address of the physical device that this nic tag
        should be created over.

     mtu

        Indicates the maximum transmission unit (mtu) to be associated with this
        nic tag. The corresponding physical network interface will have its MTU
        set to at least this value, the actual value will be the maximum of all
        of the associated nic tags.

        The valid range for the MTU of a nic tag is from 1500 to 9000 bytes.

## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.


## SEE ALSO

    dladm(1M), sysinfo(1M), vmadm(1M)

