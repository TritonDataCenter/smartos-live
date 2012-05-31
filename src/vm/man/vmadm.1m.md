vmadm(1m) -- Manage SmartOS virtual machines
============================================

## SYNOPSIS
    /usr/vm/sbin/vmadm <command> [-d] [-v] [command-specific arguments]

## DESCRIPTION

The vmadm tool allows you to interact with virtual machines on a SmartOS system.
Both OS Virtual Machines (zones) and KVM Virtual Machines can be managed. vmadm
allows you to create, inspect, modify and delete virtual machines on the local
system.

The primary reference for a VM is its UUID. Most commands operate on VMs by
UUID. In SmartOS, there are included bash tab-completion rules so that you can
tab-complete UUIDs rather than having to type them out for every command.

## COMMANDS

    The following commands and options are supported:

      create [-f <filename>]

        Create a new VM on the system. Any images/datasets referenced must
        already exist on the target zpool. Input must be JSON You can either
        pass in a file with the -f parameter or redirect stdin from something
        with JSON. Create will refuse to create a VM if no file is specified
        and stdin is a tty.

        See the 'PROPERTIES' or 'EXAMPLES' sections below for details on what
        to put in the JSON payload.

      console <uuid>

        Connect to the text console for a running VM. For OS VMs, this will be
        the zone console. For KVM VMs, this will be the serial console and your
        VM will need to be setup with getty or similar running on the first
        serial device.

        To end the serial console session hit CTRL-]. For OS VMs, you'll need
        to do this at the start of a line, so generally this means pressing:
        ENTER then CTRL-] then a dot character. For KVM VMs you should just need
        to press CTRL-] by itself.

      delete <uuid>

        Delete the VM with the specified UUID. The VM and any associated storage
        including zvols and the zone filesystem will be removed.

        Note: this command is not interactive, take care to delete the right VM.

      get <uuid>

        Output the JSON object describing a VM. The JSON object will be dumped
        to stdout. The output object can then be further handled by the json(1)
        command if desired.

      info <uuid> [type,...]

        The info command operates on running KVM VMs only. It talks to the
        vmadmd(1m) daemon and requests some information about the running VM.
        The information is output to stdout as a JSON object with member
        objects for each type specified. If no types are specified, all info
        is included. The type values can be separated either by commas or
        spaces.

        The info types available are:

        all:
            Explicitly include all of the other types.

        block:
            Information about the block devices attached to this VM.

        blockstats:
            Counters for blocks read/written, number of operations and highest
            write offset for each block device.

        chardev:
            Information about the special character devices attached to this VM.

        cpus:
            Information about the virtual CPUs attached to this VM.

        kvm:
            Information about the availability of the KVM driver in this VM.

        pci:
            Information about each device on the virtual PCI bus attached to
            this VM.

        spice:
            The IP, port and VNC display number for the TCP socket we're
            listening on for this VM. If spice is enabled.

        version:
            Qemu version information.

        vnc:
            The IP, port and VNC display number for the TCP socket we're
            listening on for this VM. If VNC is enabled.


      list [-p] [-H] [-o field,...] [-s field,...] [field=value ...]

        The list command can list the VMs on a system in a variety of ways. The
        filters, order and sort options are all based on the properties of VMs.
        See the PROPERTIES section below for the list of keys allowed. All those
        listed there as 'listable' can be used as keys for filtering, sorting or
        ordering.

        The list command always operates on a set of VMs which is limited by a
        filter. By default the filter is empty so all VMs are listed. You add
        filters by specifying key=value pairs on the cmdline. You can also match
        filters by regular expression by using key=~value and making value be a
        regular expression.  You can add as many filters as you want and only
        VMs that match all the filter parameters will be shown.

        The fields output are controlled with the -o option which specifies the
        order.  The default order is 'uuid,type,ram,state,alias'. If you specify
        your own order with the -o option, this order is replaced so any fields
        from the default you want to keep in your output you'll have to add them
        to your list of fields.

        The order of the rows in the output is controlled through the -s option
        which determines the sort order. The default sort order is 'ram,uuid'
        which means VMs will be first sorted by RAM and then VMs which have
        the same RAM value will be sorted by uuid. You can also choose to have
        a field sorted in descending order by prefixing that field name with a
        '-' character. Thus an order like '-ram,uuid' would do the same as the
        default except be sorted with the highest RAM value first.

        The two other options which you can specify for the list command are
        '-p' which chooses parsable output. With this flag set, output is
        separated by ':' characters instead of being lined up in columns. This
        option also disables printing of the header.

        If you would like to disable the printing of the header in the normal
        output for some reason, you can do so with the '-H' option.

        You can see several examples using order, sort and selection in the
        EXAMPLES section below.

      lookup [-j|-1] [field=value ...]

        The lookup command is designed to help you find VMs. It takes a set of
        filter options in the same format as the list command. This means you
        specify them with key=value pairs on the command line and can use the
        key=~value format to specify a regular expression value. The VMs which
        match all of your filter parameters will be output.

        The default output is a single column list of UUIDs for VMs that match
        the filter. This allows you to do things like:

            for vm in $(vmadm lookup type=KVM state=running); do
                echo -n "${vm} "
                vmadm info ${vm} vnc | json vnc.display
            done

        based on the output. If you want to use the output as JSON, you can add
        the -j parameter. With that flag set, the output will be a JSON array of
        VM objects containing the same JSON data as the 'get' command for each
        VM matched.

        If you pass the -1 parameter, lookup should only return 1 result. If
        multiple results are matched or 0 results are matched, an error will
        be returned and the exit status will be non-zero.

        See the PROPERTIES section below for the list of keys allowed. All those
        listed there as 'listable' can be used as keys for filtering.

      reboot <uuid> [-F]

        Reboot a VM. The default reboot will attempt a graceful stop of the VM
        and when the VM has stopped, it will be booted again. This ensures that
        processes within the VM are given an opportunity to shut down correctly
        in attempt to minimize data loss.

        For OS VMs, the shutdown command will be run within the zone with the
        cmdline '/usr/sbin/shutdown -y -g 0 -i 6' which will cause the VM to
        reboot after shutting down.

        For KVM VMs, vmadmd will act as a helper here for the reboot in the same
        manner as described below for the 'stop' command.

        If for some reason you are unable or do not want to do a graceful reboot
        you can add the '-F' parameter to do a forced reboot. This reboot will
        be much faster but will not necessarily give the VM any time to shut
        down its processes.

      start <uuid> [option=value ...]

        Start a VM which is in the 'off' state. For OS VMs, this doesn't take
        any arguments. For KVM VMs, it is possible to specify some additional
        boot parameters for the VM with this tool. These can be:

          order=cdn[,once=d]

            This option allows you to change the boot order for the VM for the
            current boot.  The order options are 'c' for the hard disk, 'd'
            for the first CD-ROM drive and 'n' for network boot. So the order
            'cdn' means boot the hard disk and if that fails try cdrom and if
            that fails try network boot.

            You can also add a ',once=X' option where 'X' is one of the same
            order options. This will set the boot order once and if the VM is
            rebooted (even from inside) the order will go back to the default.
            This is especially useful for installation media, since you can add
            ,once=d to boot off an ISO image once and then after the install
            is complete you will boot on the hard drive.

          cdrom=/path/to/image.iso,[ide|scsi|virtio]

            This option lets you add a virtual CD-ROM disk to a VM for this boot
            only. The path specified is evaluated within the zoneroot of the VM
            so /image.iso will actually be something like the path
            /zones/<uuid>/root/image.iso from the global zone.

            The second part of this parameter (after the comma) indicates which
            model the CD-ROM drive should be. You should choose ide in most
            cases.

          disk=/path/to/disk,[ide|scsi|virtio]

            This option lets you add an additional disk to a VM for this boot
            only.  The path specified is evaluated within the zoneroot of the VM
            so /raw.img will actually be something like the path
            /zones/<uuid>/root/raw.img from the global zone.

            The second part of this parameter (after the comma) indicates which
            model the virtual drive should be. You should choose virtio when you
            know that the VM supports it, and ide or scsi otherwise depending on
            the drivers supported in the guest.

      stop <uuid> [-F]

        Stop a VM. The default stop will attempt to be graceful.  This ensures
        that processes within the VM are given an opportunity to shut down
        correctly in attempt to minimize data loss.

        For OS VMs, the shutdown command will be run within the zone with the
        cmdline '/usr/sbin/shutdown -y -g 0 -i 5' which will cause the VM to
        go to the 'off' state after shutting down all processes.

        For KVM VMs, vmadmd will act as a helper here. We send a powerdown
        message via vmadmd to the running qemu process. Qemu then sends the
        ACPI signal to the guest kernel telling it to shut down. In case the
        guest kernel ignores this or for some reason does not receive this
        request we mark the VM with a transition property indicating that we
        tried to shut it down. This transition marker also includes an expiry.
        If vmadmd sees a VM that has a transition but reaches the expiry before
        actually turning off, it re-sends the stop command with the -F option.

        If for some reason you are unable or do not want to do a graceful stop
        you can also add the '-F' parameter via to do a forced stop. This stop
        will be much faster (especially for KVM) but will not necessarily give
        the VM any time to shut down its processes.

      sysrq <uuid> <nmi|screenshot>

        This command is only available for KVM VMs. For those it exposes the
        ability to send the guest OS Kernel an non maskable interrupt (NMI) or
        take a screenshot of the virtual console.

        To send an NMI, you can run: vmadm sysrq <uuid> nmi

        To take a screenshot: vmadm sysrq <uuid> screenshot

        Screenshots will end up under the directory zonepath for the VM, at:
        <zonepath>/root/tmp/vm.ppm from the global zone.

      update <uuid> [-f <filename>]
      update <uuid> property=value [property=value ...]

        This command allows you to update properties of an existing VM. The
        properties which can be updated are listed below in the PROPERTIES
        section with the 'updatable: yes' property.

        To update properties, you can either pass a file containing a JSON
        object as the argument to the -f option on the cmdline, send a JSON
        object on stdin (though it will refuse work if stdin is a tty), or
        pass property=value arguments on the cmdline.

        If you pass in a JSON object, that object should be formatted in the
        same manner as a create payload. The only exception is with fields
        that are themselves objects: VM NICs, KVM VM disks, customer_metadata,
        internal_metadata, tags.  In the the case of the "simple" properties
        'tags', 'customer_metadata' and 'internal_metadata' which are key-value
        pairs, there are 2 special payload members:

          set_tags || set_customer_metadata || set_internal_metadata
          remove_tags || remove_customer_metadata || remove_internal_metadata

        which can add/update or remove entries from key/value sets. To add an
        entry, include it in the set_X object with a simple string value. To
        remove an object from these dictionaries, include its name in a list
        as the value to remove_X. For example, to add a tag 'hello' with value
        'world', your JSON would look like this:

          {"set_tags": {"hello": "world"}}

        then to change the value for this key you'd do:

          {"set_tags": {"hello": "universe"}}

        and finally to remove this key you'd do:

          {"remove_tags": ["hello"]}

        The same pattern is used for customer_metadata and internal_metadata.

        In the case of nics and disks, there are 3 special objects:

          add_disks || add_nics
          remove_disks || remove_nics
          update_disks || update_nics

        For NICs for example, you can include an array of NIC objects with the
        parameter add_nics in your input. Those NICs would get added to the VM.
        For update you also pass in a new NIC object but only need to specify
        the "mac" parameter (to identify which NIC to update) and the properties
        that you want to change. If you need to change the MAC address itself,
        you'll need to add a new NIC with the same properties and a different
        MAC, and remove the existing one. To remove a NIC, the remove_nics
        property should be an array of MAC addresses only (not NIC objects).

        For updating disks, you use the same format as described above for NICs
        except that the options are add_disks, remove_disks and update_disks
        and instead of "mac" these will be keyed on "path".

        Those fields marked in the PROPERTIES section below as updatable and
        modified with '(live update)' mean that when you update the property
        the change takes effect immediately for the VM without the VM being
        restarted. Other properties will require a reboot in order to take
        effect.

## PROPERTIES

    Every VM has a number of properties. The properties for a VM can be listed
    with the 'vmadm get <uuid>' command. Some of these properties can be
    included in a create payload, some can be included in the output or be used
    to sort output for the 'vmadm list' command. Not all fields will be included
    for all VMs. Below the fields are marked as:

        type -- type of the properties value.

        vmtype -- types of VM (OS and/or KVM) for which this property applies.

        listable -- if they can be included in the -o or -s lists for the
                    'vmadm list' command.

        create -- if the field can be included in a create payload.

        update -- if the field can be updated using the 'vmadm update' command.
                  Some fields are also marked (live update) in which case,
                  updates affect the behaviour of the running machine. Other
                  updatable fields will either not affect VM operation or
                  require a reboot of the VM to do so.

        default -- if the field has a default value, this will explain what
                   that value is.


    alias:

        An alias for a VM which is for display/lookup purposes only. Not
        required to be unique.

        type: string
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes

    autoboot:

        Controls whether or not a VM is booted when the system is rebooted. This
        property can be set with the initial create but any time the VM is
        started this will also get set true and when the VM is stopped it will
        get set false. This is to ensure that the compute node will always
        reboot into the intended state.

        type: boolean
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes

    billing_id:

        An identifier intended to help identify which billing category this VM
        should fall into.

        type: string (UUID)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes
        default: dataset_uuid if provided, otherwise 00000000-0000-0000-0000-000000000000

    boot:

        This option allows you to set the boot order for KVM VMs. The format is
        the same as described above for the order parameter to the 'start'
        command.

        type: string
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: 'order=cd'

    brand:

        This will be one of 'joyent' or 'joyent-minimal' for OS virtualization
        and 'kvm' for full hardware virtualization. This is a required value for
        VM creation.

        type: string (joyent|joyent-minimal|kvm)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: no

    cpu_cap:

        Sets a limit on the amount of CPU time that can be used by a VM. The
        unit used is the percentage of a single CPU that can be used by the VM.
        Eg. a value of 300 means up to 3 full CPUs.

        type: integer (percentage of single CPUs)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)

    cpu_shares:

        Sets a limit on the number of fair share scheduler (FSS) CPU shares for
        a VM. This value is relative to all other VMs on the system, so a value
        only has meaning in relation to other VMs. If you have one VM with a
        a value 10 and another with a value of 50, the VM with 50 will get 5x as
        much time from the scheduler as the one with 10 when there is
        contention.

        type: integer (number of shares)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: 100

    cpu_type:

        For KVM VMs, this controls the type of the virtual CPU exposed to the
        guest. If the value is 'host' the guest will see the same CPU type and
        flags as are seen on the host.

        type: string (qemu64|host)
        listable: yes
        vmtype: KVM
        create: yes
        update: yes
        default: qemu64

    create_timestamp:

        The time at which the VM was created in ISO 8601 format.

        type: string (format: '2011-12-31T06:38:42.457Z')
        vmtype: OS,KVM
        listable: yes
        create: no (automatically added)
        update: no
        default: always set to current time at VM.create().

    server_uuid:

        This is the UUID of the compute node on which the VM currently exists.
        It is most useful when pulled from sources external to the GZ (whether
        in the VM, or from another node).

        type: string (compute node's UUID)
        vmtype: OS,KVM
        listable: no
        create: no
        update: no
        default: this is always pulled when the object is loaded.

    customer_metadata:

        This field allows metadata to be set and associated with this VM. The
        value should be an object with only top-level key=value pairs.

        type: JSON Object (key: value)
        vmtype: OS,KVM
        listable: no
        create: yes
        update: yes (but see special notes on update command)
        default: {}

    dataset_uuid:

        This should be a UUID identifying the image for the VM if a VM was
        created from an image.

        type: string (UUID)
        vmtype: OS,KVM
        listable: yes
        create: yes (if passed, this sets the default for the billing_id option)
        update: no

    datasets:

        If a VM has extra datasets available to it (eg. if you specified the
        delegate_dataset option when creating) the list and get output will
        include the information about that dataset under this key.

        type: string (dataset name)
        vmtype: OS
        listable: no
        create: no (use delegate_dataset to include one)
        update: no

    delegate_dataset:

        This property indicates whether we should delegate a ZFS dataset to an
        OS VM. If true, the VM will get a dataset /data which it will be able
        to manage.

        type: boolean
        vmtype: OS
        listable: no
        create: yes
        update: no
        default: false

    disks:

        When creating a KVM VM or getting a KVM VM's JSON, you will use this
        property. This is an array of 'disk' objects. The properties available
        are listed below under the disks.*.<property> options. If you want to
        update disks, see the special notes in the section above about the
        'upgrade' command.

        When adding or removing disks, the disks will be available to the VM in
        the order that the disks are included in the disks or add_disks array.

        To use these properties in a list output or lookup, use the format:

          disks.*.size   # for lookup matching any disk
          disks.0.size   # for list output or lookup of a specific disk

    disks.*.block_size:

        Specifies the block size for the disk. This property can only be set at
        disk creation time and cannot be changed without destroying the disk and
        creating a new one.

        Important: this property cannot be set on disks that have an image_uuid
        parameter as the image being cloned will already have the ZFS
        volblocksize property set.

        type: integer (block size in bytes, 512 to 131072, must be power of 2)
        vmtype: KVM
        listable: no
        create: yes
        update: no (except when adding new disks)
        default: 8192

    disks.*.boot:

        Specifies whether this disk should be bootable (only one disk should).

        type: boolean
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.image_name:

        Name of dataset from which to clone this VM's disk. You should specify
        either this and 'image_size' and 'image_uuid', or 'size' for a disk.

        type: string
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.image_size:

        The size of the image from which we will create this disk.

        type: integer (size in MiB)
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.image_uuid:

        UUID of dataset from which to clone this VM's disk.

        type: string (UUID)
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.size:

        Size of disk in MiB. You should only specify this parameter if you've
        not included the image_* parameters. It will show up in get requests
        for all disks whether you've specified or not as a means to determine
        the size of the zvol.

        type: integer (size in MiB)
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.media:

        Specify whether this disk is a 'disk' or 'cdrom'.

        type: string (one of ['disk','cdrom'])
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.model:

        Specify the driver for this disk. If your image supports it, you should
        use virtio. If not, use ide or scsi depending on the drivers in your
        guest.

        type: string (one of ['virtio','ide','scsi'])
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: the value of the disk_driver parameter for this VM

    disks.*.compression:

        Specifies a compression algorithm used for this disk. This has the same
        details, warnings and caveats as the global zfs_root_compression option
        below but only affects a single disk on the VM.

        See zfs_root_compression section below for more details.

        type: string one of: "on,off,lzjb,gzip,gzip-N,zle"
        vmtype: KVM
        listable: no
        create: yes
        update: yes (see caveat in zfs_root_compression section below)
        default: off

    disks.*.zpool:

        The zpool in which to create this zvol.

        type: string (zpool name)
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: zones

    disk_driver:

        This specifies the default values for disks.*.model for disks attached to
        this VM.

        type: string (one of ['virtio','ide','scsi'])
        vmtype: KVM
        listable: no
        create: yes
        update: yes

    do_not_inventory:

        This specifies that the VM should not be counted or automatically
        imported into external management tools. The primary use-case is for
        test zones that are created but you don't want their existence
        propagated up to a management system since they'll be short-lived.

        Note: this property will only show up in a 'vmadm get' when it's set
        true. When set false the property will not appear.

        type: boolean
        vmtype: OS,KVM
        listable: no
        create: yes
        update: yes

    dns_domain:

        For OS VMs this specifies the domain value for /etc/hosts that gets set
        at create time. Updating this after create will have no effect.

        type: string (domain name)
        vmtype: OS
        listable: yes
        create: yes
        update: no
        default: local

    filesystems:

        This property can be used to mount additional filesystems into an OS VM.
        It is primarily intended for SDC special VMs.  The value is an array of
        objects. Those objects can have the following properties: source, target,
        raw (optional), type and options.  These are described below:

    filesystem.type:

        For OS VMs this specifies the type of the filesystem being mounted in.
        Example: lofs

        type: string (fs type)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystem.source:

        For OS VMs this specifies the directory in the global zone of the
        filesystem being mounted in.  Example: /pool/somedirectory

        type: string (path)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystem.target:

        For OS VMs this specifies the directory inside the Zone where this
        filesystem should be mounted.  Example: /somedirectory

        type: string (path)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystem.raw:

        For OS VMs this specifies the additional raw device that should be
        associated with the source filesystem.  Example: /dev/rdsk/somedisk

        type: string (device)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystem.options:

        For OS VMs this specifies the array of mount options for this filesystem
        when it is mounted into the zone.  Examples of options include: "ro" and
        "nodevices".

        type: array of strings (each string is an option)
        vmtype: OS
        listable: no
        create: yes
        update: no

    fs_allowed:

        This option allows you to specify filesystem types this zone is allowed
        to mount.  For example on a zone for building SmartOS you probably want
        to set this to: "ufs,pcfs,tmpfs".  To unset this property, set the value
        to the empty string.

        type: string (comma separated list of filesystem types)
        vmtype: OS
        listable: no
        create: yes
        update: yes (requires zone reboot to take effect)

    hostname:

        For KVM VMs, this value will be handed out via DHCP as the hostname for
        the VM. For OS VMs, this value will get set in several files at creation
        time, but changing it later will do nothing.

        type: string (hostname)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (but does nothing for OS VMs)
        default: the value of zonename

    internal_metadata:

        This field allows metadata to be set and associated with this VM. The
        value should be an object with only top-level key=value pairs. The
        intention is that customer_metadata contain customer modifiable keys
        whereas internal_metadata is for operator generated keys.

        type: JSON Object (key: value)
        vmtype: OS,KVM
        listable: no
        create: yes
        update: yes (but see special notes on update command)
        default: {}

    limit_priv:

        This sets a list of privileges that will be available to the Zone that
        contains this VM. See privileges(5) for details on possible privileges.

        type: string (comma separated list of zone privileges)
        vmtype: OS,KVM
        listable: no
        create: yes
        update: yes
        OS default: "default"
        KVM default: "default,-file_link_any,-net_access,-proc_fork,-proc_info,-proc_session"


    max_locked_memory:

        The total amount of physical memory in the host than can be locked for
        this VM. This value cannot be higher than max_physical_memory.

        type: integer (number of MiB)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: value of max_physical_memory

    max_lwps:

        The maximum number of lightweight processes this VM is allowed to have
        running on the host.

        type: integer (number of LWPs)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: 2000

    max_physical_memory:

        The maximum amount of memory on the host that the VM is allowed to use.
        For KVM VMs, this value cannot be lower than 'ram' and should be
        ram + 1024.

        type: integer (number of MiB)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: 256 for OS VMs, (ram size + 1024) for KVM VMs.

    max_swap:

        The maximum amount of virtual memory the VM is allowed to use.  This
        cannot be lower than max_physical_memory.

        type: integer (number of MiB)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: value of max_physical_memory

    nics:

        When creating a KVM VM or getting a KVM VM's JSON, you will use this
        property. This is an array of 'nic' objects. The properties available
        are listed below under the nics.*.<property> options. If you want to
        update nics, see the special notes in the section above about the
        'upgrade' command.

        When adding or removing NICs, the NIC names will be created in the order
        the interfaces are in the nics or add_nics array.

        To use these properties in a list output or lookup, use the format:

          nics.*.ip   # for lookup matching any interface
          nics.0.ip   # for list output or lookup of a specific interface

    nics.*.allow_dhcp_spoofing:

        With this property set to true, this VM will be able to operate as a
        DHCP server on this interface.  Without this, some of the packets
        required of a DHCP server will not get through.

        type: boolean
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_ip_spoofing:

        With this property set to true, this VM will be able to send and
        receive packets over this nic that don't match the IP address
        specified by the ip property.

        type: boolean
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_mac_spoofing:

        With this property set to true, this VM will be able to send packets
        from this nic with MAC addresses that don't match the mac property.

        type: boolean
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_restricted_traffic:

        With this property set to true, this VM will be able to send
        restricted network traffic (packets that are not IPv4, IPv6, or ARP)
        from this nic.

        type: boolean
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_unfiltered_promisc:

        With this property set to true, this VM will be able to have multiple
        MAC addresses (eg. running SmartOS with VNICs).  Without this option
        these packets will not be picked up as only those unicast packets
        destined for the VNIC's MAC will get through.  Warning: do not enable
        this option unless you fully understand the security implications.

        type: boolean
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.blocked_outgoing_ports:

        Array of ports on which this nic is prevented from sending traffic.

        type: array
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.dhcp_server:

        With this property set to true, this VM will be able to operate as a
        DHCP server on this interface.  Without this, some of the packets
        required of a DHCP server will not get through.

        type: boolean
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.gateway:

        The IPv4 router on this network (not required if using DHCP)

        type: string (IPv4 address)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.interface:

        This is the interface name the the VM will see for this interface. It
        will always be in the format netX where X is an integer >= 0.

        type: string (netX)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: no

    nics.*.ip:

        IPv4 unicast address for this NIC, or 'dhcp' to obtain address via DHCP.

        type: string (IPv4 address or 'dhcp')
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.mac:

        MAC address of virtual NIC.

        type: string (MAC address)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: no (see 'update' command description)
        default: we'll generate one

    nics.*.model:

        The driver for this NIC [virtio|e1000|rtl8136|...]

        type: string (one of ['virtio','e1000','rtl8136'])
        vmtype: KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: the value of the nic_driver property on the VM

    nics.*.netmask

        The netmask for this NIC's network (not required if using DHCP)

        type: string (IPv4 netmask, eg. 255.255.255.0)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.nic_tag

        This option for a NIC determines which host NIC the VMs nic will be
        attached to. The value can be either a nic tag as listed in the 'NIC
        Names' field in `sysinfo`, or an etherstub or device name.

        type: string (device name or nic tag name)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update yes (requires zone stop/boot)

    nics.*.primary

        This option selects which NIC's default gateway and nameserver values
        will be used for this VM. If a VM has any nics, there must always be
        exactly one primary.  Setting a new primary will unset the old. Trying
        to set two nics to primary is an error.

        type: boolean (only true is valid)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes (setting primary=true on one NIC removes the flag from the
            current primary, and sets on the new)

    nics.*.vlan_id:

        The vlan with which to tag this NIC's traffic (0 = none).

        type: integer (0-4095)
        vmtype: OS,KVM
        listable: yes (see above)
        create: yes
        update: yes
        default: 0

    nic_driver:

        This specifies the default values for nics.*.model for NICs attached to
        this VM.

        type: string (one of ['virtio','e1000','rtl8136'])
        vmtype: KVM
        listable: no
        create: yes
        update: yes

    nowait:

        This parameter is accepted when provisioning OS VMs and considers the
        provision complete when the VM is first started rather than waiting for
        the VM to be rebooted.

        type: boolean
        vmtype: OS
        listable: no
        create: yes
        update: no
        default: false

    owner_uuid:

        This parameter can be used for defining the UUID of an 'owner' for this
        VM. It serves no functional purpose inside the system itself, but can
        be used to tie this system to others.

        type: string (UUID)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes
        default: 00000000-0000-0000-0000-000000000000

    package_name:

        This is a private field intended for use by Joyent's SDC product.  Other
        users can ignore this field.

        type: string
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes

    package_version:

        This is a private field intended for use by Joyent's SDC product.  Other
        users can ignore this field.

        type: string
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes

    pid:

        For KVM VMs that are currently running, this field indicates the PID of
        the qemu process for the zone.

        type: integer (PID)
        vmtype: KVM
        listable: yes
        create: no
        update: no

    qemu_opts:

        This parameter allows one to specify additional arguments to be passed
        to the hypervisor. This is primarily designed to be used for debugging
        and should not be used beyond that. important: this replaces *all* of
        the options listed, so you need to include those from the default list
        that you want to keep. NOTE: setting this also overrides any SPICE
        options you might have set.

        type: string (space-separated options for qemu)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default:
            if vnc_password.length != 0:
                '-vnc unix:/tmp/vm.vnc,password -parallel none -usb -usbdevice tablet -k en-us'
            else
                '-vnc unix:/tmp/vm.vnc -parallel none -usb -usbdevice tablet -k en-us'

    qemu_extra_opts:

        This allows you to specify additional qemu cmdline arguments, this
        string (if set) will be appended to the end of the qemu cmdline. It is
        intended for debugging and not for general use.

        type: string (space-separated options for qemu)
        vmtype: KVM
        listable: no
        create: yes
        update: yes

    quota:

        This sets a quota on the zone filesystem. For OS VMs, this value is the
        space actually visible/usable in the guest. For KVM VMs, this value is
        the quota for the Zone containing the VM, which is not directly
        available to users.

        type: integer (number of GiB)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)

    ram:

        For KVM VMs this is the amount of virtual RAM that will be available to
        the guest kernel. For OS VMs this will be the same as the property
        max_physical_memory.

        type: integer (number of MiB)
        vmtype: KVM
        listable: yes
        create: KVM VMs only
        update: KVM VMs only, for OS VMs update max_physical_memory instead.
        default: 256

    resolvers:

        For OS VMs, this value sets the initial resolvers which get put into the
        config files on first boot. For KVM VMs these will get passed as the
        resolvers with DHCP responses.

        type: array
        vmtype: OS,KVM
        listable: no
        create: yes
        update: yes (but unused after create for OS VMs)

    spice_opts (EXPERIMENTAL):

        This property allows you to add additional -spice options when you are
        using SPICE. NOTE: SPICE support requires your KVM zone to be using a
        zone dataset with the zone_dataset_uuid and that dataset must know what
        to do with these special options.

        type: string (-spice XXX options)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: <unset>

    spice_password (EXPERIMENTAL):

        This property allows you to set a password which will be required when
        connecting to the SPICE port when SPICE is enabled. NOTE: SPICE support
        requires your KVM zone to be using a zone dataset with the
        zone_dataset_uuid and that dataset must know what to do with these
        special options. IMPORTANT: this password will be visible from the GZ
        of the CN and anyone with access to the serial port in the guest. Set
        to an empty string (default) to not require a password at this level.

        type: string (8 chars max)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: <unset>

    spice_port (EXPERIMENTAL):

        This specifies the TCP port to listen on for the SPICE server. By
        default SPICE is not enabled. NOTE: SPICE support requires your KVM
        zone to be using a zone dataset with the zone_dataset_uuid and that
        dataset must know what to do with these special options. If set to
        zero, a port will be chosen at random. Set to -1 to disable TCP
        listening for SPICE.

        type: integer (0 for random, -1 for disabled)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: <unset>

    state:

        This property exposes the current state of a VM.

        type: string
        vmtype: OS,KVM
        listable: yes
        create: no
        update: no

    tmpfs:

        This property specifies how much of the VM's memory will be available
        for the /tmp filesystem. This is only available for OS VMs, and doesn't
        make any sense for KVM VMs.

        vmtype: OS
        listable: yes
        create: yes
        update: yes
        default: 256

    transition_expire:

        When a KVM VM is in transition from running to either 'off' (in the case
        of stop) or 'start' (in the case of reboot), the transition_expire field
        will be set. This value will indicate the time at which the current
        transaction will time out. When the transaction has timed out, vmadmd
        will force the VM into the correct state and remove the transition.

        type: integer (unix epoch timestamp)
        vmtype: KVM
        listable: no
        create: no (will show automatically)
        update: no

    transition_to:

        When a KVM VM is in transition from running to either 'off' (in the case
        of stop) or 'start' (in the case of reboot), the transition_to field
        will be set to indicate which state the VM is transitioning to.

        type: string value, one of: ['stopped', 'start']
        vmtype: KVM
        listable: no
        create: no
        update: no

    type:

        This is a virtual field and cannot be updated. It will be 'OS' when the
        brand=='joyent*' and 'KVM' when the brand=='kvm'.

        type: string value, one of: ['OS', 'KVM']
        vmtype: OS,KVM
        listable: yes
        create: no, set by 'brand' property.
        update: no

    uuid:

        This is the unique identifer for the VM. If one is not passed in with
        the create request, a new UUID will be generated. It cannot be changed
        after a VM is created.

        type: string (UUID)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: no
        default: a new one is generated

    vcpus:

        For KVM VMs this parameter defines the number of virtual CPUs the guest
        will see. Generally recommended to be a multiple of 2.

        type: integer (number of CPUs)
        vmtype: KVM
        listable: yes
        create: KVM only
        update: KVM only (requires VM reboot to take effect)
        default: 1

    vga:

        This property allows one to specify the VGA emulation to be used by
        KVM VMs. The default is 'cirrus'. NOTE: with the Qemu bundled in SmartOS
        qxl and xenfb do not work.

        type: string (one of: 'cirrus','std','vmware','qxl','xenfb')
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: 'cirrus'

    virtio_txburst:

        This controls how many packets can be sent on a single flush of the tx
        queue. This applies to all the vnics attached to this VM using the
        virtio model.

        type: integer
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: 128

    virtio_txtimer:

        This sets the timeout for the TX timer.  It applies to all the vnics
        attached to this VM using the virtio model.

        type: integer (in nanoseconds)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: 200000

    vnc_password:

        This property allows you to set a password which will be required when
        connecting to the VNC port. IMPORTANT: this password will be visible
        from the GZ of the CN and anyone with access to the serial port in the
        guest. Set to an empty string (default) to not require a password at
        this level.

        type: string (8 chars max)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: <unset>

    vnc_port:

        This specifies the TCP port to listen on for the VNC server, the default
        is zero which means a port will be chosen at random. Set to -1 to
        disable TCP listening.

        type: integer (0 for random, -1 for disabled)
        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default: 0

    zfs_data_compression:

        Specifies a compression algorithm used for this VM's data dataset. This
        option affects only the delegated dataset and therefore only makes sense
        when the VM has been created with the delegate_dataset option.

        The caveats and warnings in the zfs_root_compression section below also
        apply to this option.

        type: string one of: "on,off,lzjb,gzip,gzip-N,zle"
        vmtype: OS
        listable: no
        create: yes
        update: yes (see warning in zfs_root_compression section)
        default: off

    zfs_data_recsize:

        This specifies the suggested block size for files in the delegated
        dataset's filesystem. It can only be set when your zone has a data
        dataset as added by the delegate_dataset option.

        The warnings and caveats for zfs_root_recsize also apply to this option.
        You should read and understand those before using this.

        type: integer (record size in bytes, 512 to 131072, must be power of 2)
        vmtype: OS (and only with a delegated dataset)
        listable: no
        create: yes
        update: yes (see caveat below under zfs_root_recsize)
        default: 131072 (128k)

    zfs_io_priority:

        This sets an IO throttle priority value relative to other VMs. If one
        VM has a value X and another VM has a value 2X, the machine with the
        X value will have some of its IO throttled when both try to use all
        available IO.

        type: integer (relative value)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes (live update)
        default: 100

    zfs_root_compression:

        Specifies a compression algorithm used for this VM's root dataset. This
        option affects only the zoneroot dataset. Setting to 'on' is equivalent
        to setting to 'lzjb'. If you want more information about the specific
        compression types, see the man page for zfs(1m).

        WARNING: If you change this value for an existing VM, only *new* data
        will be compressed. It will not rewrite existing data compress.

        NOTE: to change this property for KVM, see disks.*.zfs_compression
        above.

        type: string one of: "on,off,lzjb,gzip,gzip-N,zle"
        vmtype: OS
        listable: no
        create: yes
        update: yes (see warning above)
        default: off

    zfs_root_recsize:

        Specifies a suggested block size for files in the root file system. This
        property is designed solely for use with database workloads that access
        files in fixed-size records. ZFS automatically tunes block sizes
        according to internal algorithms optimized for typical access patterns.
        If you have a delegated dataset (with the delegate_dataset option) you
        should consider leaving this unset and setting zfs_data_recsize instead.

        WARNING: Use this property only if you know exactly what you're doing
        as it is very possible to have an adverse effect performance when
        setting this incorrectly. Also, when doing an update, keep in mind that
        changing the file system's recordsize affects only files created
        after the setting is changed; existing files are unaffected.

        NOTE: to change this property for KVM, see disks.*.zfs_recsize above.

        type: integer (record size in bytes, 512 to 131072, must be power of 2)
        vmtype: OS
        listable: no
        create: yes
        update: yes (see caveat above)
        default: 131072 (128k)

    zone_state:

        This property will show up when fetching a VMs JSON.  this shows the
        state of the zone in which this VM is contained. eg. 'running'.  It
        can be different from the 'state' value in several cases.

        type: string
        vmtype: KVM
        listable: yes
        create: no
        update: no

    zonepath:

        This property will show up in JSON representing a VM. It describes the
        path in the filesystem where you will find the VMs zone dataset. For OS
        VMs all VM data will be under this path, for KVM VMs this is where
        you'll find things such as the logs and sockets for a VM.

        type: string (path)
        vmtype: OS,KVM
        listable: no
        create: no (automatic)
        update: no

    zonename:

        This property indicates the zonename of a VM. The zonename is a private
        property and not intended to be used directly. For OS VMs you can set
        this property with the create payload, but such use is discouraged.

        type: string
        vmtype: OS,KVM
        listable: yes
        create: yes (OS VMs only)
        update: no
        default: value of uuid

    zoneid:

        This property will show up in a JSON payload and can be included in list
        output. It is however a value that is used internally to the system and
        primarily exists to aid debugging. This value will change whenever the
        VM is stopped or started. Do not rely on this value.

        type: integer
        vmtype: OS,KVM
        listable: yes
        create: no
        update: no

    zpool:

        This defines which ZFS pool the VM's zone dataset will be created in
        For OS VMs, this dataset is where all the data in the zone will live.
        For KVM VMs, this is only used by the zone shell that the VM runs in.

        type: string (zpool name)
        vmtype: OS,KVM
        listable: yes
        create: yes
        update: no
        default: zones


## EXAMPLES

    Example 1: Listing KVM VMs with 128M of RAM, sorting by RAM descending and
               with customized field order.

        vmadm list -o uuid,type,ram,quota,cpu_shares,zfs_io_priority \
            -s -ram,cpu_shares type=KVM ram=128

    Example 2: Creating an OS VM.

        vmadm create <<EOF
        {
          "brand": "joyent",
          "zfs_io_priority": 30,
          "quota": 20,
          "dataset_uuid": "47e6af92-daf0-11e0-ac11-473ca1173ab0",
          "max_physical_memory": 256,
          "alias": "zone70",
          "nics": [
            {
              "nic_tag": "external",
              "ip": "10.2.121.70",
              "netmask": "255.255.0.0",
              "gateway": "10.2.121.1",
              "primary": true
            }
          ]
        }
        EOF

    Example 3: Creating a KVM VM.

        vmadm create <<EOF
        {
          "brand": "kvm",
          "vcpus": 1,
          "ram": 256,
          "disks": [
            {
              "boot": true,
              "model": "virtio",
              "image_uuid": "e173ecd7-4809-4429-af12-5d11bcc29fd8",
              "image_name": "ubuntu-10.04.2.7",
              "image_size": 5120
            }
          ],
          "nics": [
            {
              "nic_tag": "external",
              "model": "virtio",
              "ip": "10.88.88.51",
              "netmask": "255.255.255.0",
              "gateway": "10.88.88.2",
              "primary": true
            }
          ]
        }
        EOF

    Example 4: Getting JSON for the VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0.

        vmadm get 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 5: Find the VM with the IP 10.2.121.70 (second one with JSON output)

        vmadm lookup nics.*.ip=10.2.121.70
        vmadm lookup -j nics.*.ip=10.2.121.70

    Example 6: Looking up all 128M VMs with an alias that starts with 'a' or 'b'
               and then again with JSON output.

        vmadm lookup ram=128 alias=~^[ab]
        vmadm lookup -j ram=128 alias=~^[ab]

    Example 7: Set the quota to 40G for VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0 quota=40

    Example 8: Set the cpu_shares to 100 for VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        echo '{"cpu_shares": 100}' | \
            vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 9: Add a NIC to the VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0 <<EOF
        {
          "add_nics": [
            {
              "interface": "net1",
              "nic_tag": "external",
              "mac": "b2:1e:ba:a5:6e:71",
              "ip": "10.2.121.71",
              "netmask": "255.255.0.0",
              "gateway": "10.2.121.1"
            }
          ]
      }
      EOF

    Example 10: Change the IP of the NIC with MAC b2:1e:ba:a5:6e:71 for the VM
                with the UUID 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0.

        vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0 <<EOF
        {
          "update_nics": [
            {
              "mac": "b2:1e:ba:a5:6e:71",
              "ip": "10.2.121.72"
            }
          ]
        }
        EOF

    Example 11: Remove the NIC with MAC b2:1e:ba:a5:6e:71 from VM with UUID
                54f1cc77-68f1-42ab-acac-5c4f64f5d6e0.

        echo '{"remove_nics": ["b2:1e:ba:a5:6e:71"]}' | \
            vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 12: Stop VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm stop 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 13: Start VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm start 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 14: Reboot VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm reboot 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 15: Delete VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm delete 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0


## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.


## SEE ALSO

    vmadmd(1m), zonecfg(1m), zoneadm(1m), zones(5)

## NOTES

Some of the vmadm commands depend on the vmadmd(1m) service:

    svc/system/smartdc/vmadmd:default

If the vmadmd service is stopped while the vmadm utility is running, the vmadm
command behaviour will be undefined. Additionally if the service is not running,
some commands will be unavailable.

