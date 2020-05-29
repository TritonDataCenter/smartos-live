vmadm(1M) -- Manage SmartOS virtual machines
============================================

## SYNOPSIS
    /usr/vm/sbin/vmadm <command> [-d] [-v] [command-specific arguments]

## DESCRIPTION

The vmadm tool allows you to interact with virtual machines on a SmartOS
system. It allows you to create, inspect, modify and delete virtual
machines on the local system.

IMPORTANT: Support for LX VMs is currently limited and experimental. This means
it is very likely to change in major ways without notice. Also: not all the LX
functionality that *is* implemented is documented yet. The documentation will
be updated as things stabilize. Most properties that apply to OS VMs also
apply to LX VMs.

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

      create-snapshot <uuid> <snapname>

        Support for snapshots is currently experimental. It only works for bhyve
        VMs and OS VMs which also have no additional datasets.

        The <snapname> parameter specifies the name of the snapshot to take
        of the specified VM. The snapname must be 64 characters or less and
        must only contain alphanumeric characters and characters in the set
        [-_.:%] to comply with ZFS restrictions.

        You can use delete-snapshot or rollback-snapshot in the future on a
        snapshot you've created with create-snapshot, so long as that snapshot
        still exists.

        See the 'SNAPSHOTS' section below for some more details on how to use
        these snapshots, and their restrictions.

      console <uuid>

        Connect to the text console for a running VM. For OS VMs, this will be
        the zone console. For KVM VMs, this will be the serial console and your
        VM will need to be setup with getty or similar running on the first
        serial device. Not yet supported on LX VMs.

        To end the serial console session hit CTRL-]. For OS VMs, you'll need
        to do this at the start of a line, so generally this means pressing:
        ENTER then CTRL-] then a dot character. For KVM VMs you should just
        need to press CTRL-] by itself.

      delete <uuid>

        Delete the VM with the specified UUID. The VM and any associated
        storage including zvols and the zone filesystem will be removed.

        If you have set the indestructible_zoneroot or indestructible_delegated
        flags on a VM it *cannot* be deleted until you have unset these flags
        with something like:

            vmadm update <uuid> indestructible_zoneroot=false
            vmadm update <uuid> indestructible_delegated=false

        to remove the snapshot and holds.

        Note: 'vmadm delete' command is not interactive, take care to delete the
        right VM.

      delete-snapshot <uuid> <snapname>

        Support for snapshots is currently experimental. It only works for bhyve
        VMs and OS VMs which also have no additional datasets.

        This command deletes the ZFS snapshot that exists with the name
        <snapname> from the VM with the specified uuid. You cannot undo this
        operation and it will no longer be possible to rollback to the specified
        snapshot.

        See the 'SNAPSHOTS' section below for some more details on how to use
        these snapshots, and their restrictions.

      events [-fjr] [uuid]

        Output events seen for a given VM (all VMs on the system if the uuid
        argument is omitted).  The command will run indefinitely outputting a
        single line per event to stdout as they are seen.

          -f, --full    Output the full event (full zone names, timestamp,
                        etc.)  No data will be truncated.
          -j, --json    Output in JSON.  If `-j` is supplied `-f` is ignored.
          -r, --ready   Output an extra event when the event stream is first
                        opened and ready.

      get <uuid>

        Output the JSON object describing a VM. The JSON object will be dumped
        to stdout. The output object can then be further handled by the json(1)
        command if desired.

      info <uuid> [type,...]

        The info command operates on running KVM VMs only. It talks to the
        vmadmd(1M) daemon and requests some information about the running VM.
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
            Information about the special character devices attached to this
            VM.

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
            qemu version information.

        vnc:
            The IP, port and VNC display number for the TCP socket we're
            listening on for this VM. If VNC is enabled.


      list [-p] [-H] [-o field,...] [-s field,...] [field=value ...]

        The list command can list the VMs on a system in a variety of ways. The
        filters, order and sort options are all based on the properties of VMs.
        See the PROPERTIES section below for the list of keys allowed. All
        those listed there as 'listable' can be used as keys for filtering,
        sorting or ordering.

        The list command always operates on a set of VMs which is limited by a
        filter. By default the filter is empty so all VMs are listed. You add
        filters by specifying key=value pairs on the command line. You can also
        match filters by regular expression by using key=~value and making
        value be a regular expression.  You can add as many filters as you want
        and only VMs that match all the filter parameters will be shown.

        The fields output are controlled with the -o option which specifies the
        order.  The default order is 'uuid,type,ram,state,alias'. If you
        specify your own order with the -o option, this order is replaced so
        any fields from the default you want to keep in your output you'll have
        to add them to your list of fields.

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

      lookup [-j|-1] [-o field,field,..] [field=value ...]

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
        the -j parameter. With that flag set, the output will be a JSON array
        of VM objects containing the same JSON data as the 'get' command for
        each VM matched.

        When the -j flag is passed, you can also limit the fields in the objects
        of the output array. To do so, use the -o option. For example if you
        use:

            vmadm lookup -j -o uuid,brand,quota

        the objects in the output array will only have the uuid, brand and quota
        members. Where possible vmadm optimizes the lookups such that not
        including fields in the output means it won't have to do the potentially
        expensive operations to look them up. By default (without -o) all fields
        are included in the objects.

        If you pass the -1 parameter, lookup should only return 1 result. If
        multiple results are matched or 0 results are matched, an error will
        be returned and the exit status will be non-zero.

        See the PROPERTIES section below for the list of keys allowed. All
        those listed there as 'listable' can be used as keys for filtering.

      reboot <uuid> [-F]

        Reboot a VM. The default reboot will attempt a graceful stop of the VM
        and when the VM has stopped, it will be booted again. This ensures that
        processes within the VM are given an opportunity to shut down correctly
        in attempt to minimize data loss.

        For OS VMs, the shutdown command '/usr/sbin/shutdown -y -g 0 -i 6'
        (or '/sbin/shutdown -r now' if brand is 'lx') will be run within the
        zone, which will cause the VM to reboot after shutting down.

        For HVM VMs, vmadmd will act as a helper here for the reboot in the
        same manner as described below for the 'stop' command.

        If for some reason you are unable or do not want to do a graceful
        reboot you can add the '-F' parameter to do a forced reboot. This
        reboot will be much faster but will not necessarily give the VM any
        time to shut down its processes.

      rollback-snapshot <uuid> <snapname>

        Support for snapshots is currently experimental. It only works for bhyve
        VMs and OS VMs which also have no additional datasets.

        This command rolls the dataset backing the the VM with the specified
        uuid back to its state at the point when the snapshot with snapname was
        taken. You cannot undo this except by rolling back to an even older
        snapshot if one exists.

        IMPORTANT: when you rollback to a snapshot, all other snapshots newer
        than the one you're rolling back to will be deleted. It will no longer
        be possible to rollback to a snapshot newer than <snapname> for this VM.
        Also note: your VM will be stopped if it is running when you start a
        rollback-snapshot and will be booted after the snapshot has been
        restored.

        See the 'SNAPSHOTS' section below for some more details on how to use
        these snapshots, and their restrictions.

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

            The order= option can only be specified once per boot.

          cdrom=/path/to/image.iso,[ide|scsi|virtio]

            This option lets you add a virtual CD-ROM disk to a VM for this
            boot only. The path specified is evaluated within the zoneroot of
            the VM so /image.iso will actually be something like the path
            /zones/<uuid>/root/image.iso from the global zone.

            The second part of this parameter (after the comma) indicates which
            model the CD-ROM drive should be. You should choose ide in most
            cases.

            You can specify multiple cdrom options when booting a VM. They will
            be attached in the order they appear on the command line.

          disk=/path/to/disk,[ide|scsi|virtio]

            This option lets you add an additional disk to a VM for this boot
            only.  The path specified is evaluated within the zoneroot of the
            VM so /raw.img will actually be something like the path
            /zones/<uuid>/root/raw.img from the global zone.

            The second part of this parameter (after the comma) indicates which
            model the virtual drive should be. You should choose virtio when
            you know that the VM supports it, and ide or scsi otherwise
            depending on the drivers supported in the guest.

            You can specify multiple disk options when booting a VM. They will
            be attached in the order they appear on the command line.

      stop <uuid> [-F] [-t timeout]

        Stop a VM. The default stop will attempt to be graceful.  This ensures
        that processes within the VM are given an opportunity to shut down
        correctly in attempt to minimize data loss.

        For OS VMs, a shutdown command will be run in the zone, which will cause
        the VM to go to the 'off' state after shutting down all processes.  If
        brand is 'lx', the shutdown command is '/sbin/shutdown -h now'.  For
        other OS VMs, the shutdown command is '/usr/sbin/shutdown -y -g 0 -i 5'.
        If the VM does not shutdown before its timer expires (60 seconds), the
        VM is forcibly halted. OS VMs do not support the [-t timeout] option
        unless they also have the docker property set to true.

        For HVM VMs, the running qemu/bhyve process sends an ACPI signal to the
        guest kernel telling it to shut down. In case the guest kernel ignores
        this or for some reason does not receive this request we mark the VM
        with a transition property indicating that we tried to shut it down.
        This transition marker also includes a timeout (default 180 seconds).
        If we hit the timeout, the VM is forcibly halted.

        For docker VMs, vmadm will send a SIGTERM to init and then wait some
        number of seconds for the init process to exit. If it has not exited by
        the timeout expiry, a SIGKILL will be sent. The default timeout is 10
        seconds.

        For both HVM and docker VMs the stop timeouts can be adjusted with the
        -t <timeout seconds> option. For non-Docker and non-HVM VMs use of the
        -t option will result in an error.

        If for some reason you are unable or do not want to do a graceful stop
        you can also add the '-F' parameter via to do a forced stop. This stop
        will be much faster (especially for HVM) but will not give the VM any
        time to shut down its processes.

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
        object as the argument to the -f option on the command line, send a
        JSON object on stdin (though it will refuse to work if stdin is a tty),
        or pass property=value arguments on the command line.

        Many properties can be cleared by specifying their value as null in
        the JSON, e.g.

          { ... "zfs_snapshot_limit": null }

        However this does not work via a direct `vmadm update UUID prop=null`
        command.

        If you pass in a JSON object, that object should be formatted in the
        same manner as a create payload. The only exception is with fields
        that are themselves objects: VM NICs, KVM VM disks, customer_metadata,
        internal_metadata, tags and routes.  In the the case of the "simple"
        properties 'tags', 'customer_metadata', 'internal_metadata' and
        'routes' which are key-value pairs, there are 2 special payload members:

          set_tags || set_customer_metadata
          || set_internal_metadata || set_routes

          remove_tags || remove_customer_metadata ||
          remove_internal_metadata || remove_routes

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

        The same pattern is used for customer_metadata, internal_metadata and
        routes.

        In the case of nics, disks, and filesystems, there are 3 special
        objects:

          add_disks || add_nics || add_filesystems
          remove_disks || remove_nics || remove_filesystems
          update_disks || update_nics || update_filesystems

        For NICs for example, you can include an array of NIC objects with the
        parameter add_nics in your input. Those NICs would get added to the VM.
        For update you also pass in a new NIC object but only need to specify
        the "mac" parameter (to identify which NIC to update) and the
        properties that you want to change. If you need to change the MAC
        address itself, you'll need to add a new NIC with the same properties
        and a different MAC, and remove the existing one. To remove a NIC, the
        remove_nics property should be an array of MAC addresses only (not NIC
        objects).

        For updating filesystems, you use the same format as described above for
        NICs except that the options are add_filesystems, remove_filesystems and
        update_filesystems and instead of "mac" these will be keyed on "target".

        For updating disks, you use the same format as described above for NICs
        except that the options are add_disks, remove_disks and update_disks
        and instead of "mac" these will be keyed on "path".

        When updating disks.*.size, the system protects against accidental
        shrinkage and associated data loss. If the size of a disk is reduced,
        the end of the disk is removed. If that space contains data, it is
        permanently lost. Snapshots do not provide protection. To allow a disk
        to shrink, set the dangerous_allow_shrink property to true. This
        property is used only for the update - it is not stored. For example,
        the following will resize a disk to 10 MiB, even if it had previously
        been larger.

         {
           "update_disks": [
             {
               "path": "/dev/zvol/rdsk/zones/.../disk1",
               "size": 10,
               "dangerous_allow_shrink": true
             }
           ]
         }

        Those fields marked in the PROPERTIES section below as updatable and
        modified with '(live update)' mean that when you update the property
        the change takes effect immediately for the VM without the VM being
        restarted. Other properties will require a reboot in order to take
        effect.

        If the VM is running when an update is made, the 'mdata:fetch' service
        inside the zone will be restarted - the service will be enabled
        regardless of its state prior to the update.

     validate create [-f <filename>]
     validate update <brand> [-f <filename>]

       This command allows you to validate your JSON payloads before calling
       create or update.  You must specify the action for which your payload is
       intended (create or update) as the validation rules are different.  In
       addition, when validating an update payload, you must pass the brand
       parameter as validation rules vary based on brand.

       If no -f <filename> is specified the payload is expected to be passed
       on stdin.  If -f <filename> is specfied, the payload to validate will
       be read from the file with that name.  Output from this command in the
       case the payload is valid will be something like:

         "VALID create payload for joyent brand VMs."

       and the exit code will be 0.  When the payload is not valid the exit code
       will be 1 and you will get back a json object which will have at least
       one of the following members:

         'bad_brand'

            The brand argument you passed to validate is invalid.

         'bad_properties'

           This is an array of payload properties which are not valid for the
           specified action.

         'bad_values'

           This is an array of payload properties which had unacceptable values.

         'missing_properties'

           This is an array of the payload properties which are required for the
           given action but are missing from the specified payload.

       consult the PROPERTIES section below for help correcting errors in your
       payload.


## SNAPSHOTS

    Snapshots are currently only implemented for bhyve VMs and OS VMs, and only
    for those that do not utilize delegated datasets or any other datasets other
    than the zoneroot dataset and its dependent datasets.

    When you create a snapshot with create-snapshot, it will create a ZFS
    snapshot of that dataset with the name dataset@vmsnap-<snapname> and the
    .snapshots member of VM objects returned by things like vmadm get will
    only include those snapshots that have been created using this pattern.

    That allows vmadm to distinguish between snapshots it has taken and
    snapshots that could have been taken using other tools.

    To delete a snapshot you can use the delete-snapshot command. That will
    destroy the snapshot in ZFS and it will automatically be removed from the
    machine's snapshot list. It will no longer be possible to rollback to it.

    To rollback a VM to its state at the time of a previous snapshot, you can
    use the rollback-snapshot command. This will stop the VM rollback the
    zoneroot dataset to the specified snapshot and start the VM again.
    IMPORTANT: rollback-snapshot will automatically delete all snapshots newer
    than the one you're rolling back to. This cannot be undone.

## PROPERTIES

    Every VM has a number of properties. The properties for a VM can be listed
    with the 'vmadm get <uuid>' command. Some of these properties can be
    included in a create payload, some can be included in the output or be used
    to sort output for the 'vmadm list' command. Not all fields will be
    included for all VMs. Below the fields are marked as:

        type -- type of the properties value.

        vmtype -- This value can be one of the following groups:
                  - OS:  all types of OS VMs (joyent, joyent-minimal, and lx)
                  - HVM: all types of HVM VMs (bhyve and kvm)
                  - ANY: all types of VMs
                  or an explicit brand name such as 'lx'.

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
        vmtype: ANY
        listable: yes
        create: yes
        update: yes

    archive_on_delete:

        When archive_on_delete is set to 'true' and the VM is deleted and the
        zones/archive dataset exists and is mounted on /zones/archive, we will
        extract debug information from the zone before destroying it.
        Information saved includes cores, the JSON as output by 'vmadm get',
        the zone's XML file from /etc/zones, SMF logs, qemu logs (for KVM),
        the startvm script (for KVM), the properties from all the zone's
        datasets, metadata, tags and /var/adm/messages. In the future the list
        may change. The files specified will be written to the directory
        /zones/archive/<uuid>.

        type: boolean
        vmtype: ANY
        listable: no
        create: yes
        update: yes
        default: false

    autoboot:

        Controls whether or not a VM is booted when the system is rebooted.
        This property can be set with the initial create but any time the VM is
        started this will also get set true and when the VM is stopped it will
        get set false. This is to ensure that the compute node will always
        reboot into the intended state.

        type: boolean
        vmtype: ANY
        listable: yes
        create: yes
        update: yes

    billing_id:

        An identifier intended to help identify which billing category this VM
        should fall into.

        type: string (UUID)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes
        defaul: 00000000-0000-0000-0000-000000000000

    bhyve_extra_opts:

        This allows you to specify additional bhyve command line arguments,
        this string (if set) will be appended to the end of the bhyve command
        line. It is intended for debugging and not for general use.

        type: string (space-separated options for bhyve)
        vmtype: bhyve
        listable: no
        create: yes
        update: yes

    boot:

        This option allows you to set the boot order for KVM VMs. The format is
        the same as described above for the order parameter to the 'start'
        command.

        type: string
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: 'order=cd'

    boot_timestamp:

        This is a read-only property that will exist only for running VMs. When
        available, it will indicate the time the VM last booted.

        type: string (ISO 8601 timestamp)
        vmtype: ANY
        listable: yes
        create: no
        update: no

    bootrom:

        This indicates the bootrom to use for bhyve, valid values are 'bios',
        'uefi', or a path to a bootrom binary. The path if specified is
        evaluated within the zoneroot of the VM so /uefi-debug.bin will
        actually be something like the path /zones/<uuid>/root/uefi-debug.img
        from the global zone.

        type: string
        vmtype: bhyve
        listable: no
        create: yes
        update: yes
        default: 'bios'

    brand:

        This will be one of 'joyent', 'joyent-minimal' or 'lx' for OS
        virtualization, or 'kvm' or 'bhyve' for full hardware virtualization.
        This is a required value for VM creation.

        type: string (joyent|joyent-minimal|lx|kvm|bhyve)
        vmtype: ANY
        listable: yes
        create: yes
        update: no

    cpu_cap:

        Sets a limit on the amount of CPU time that can be used by a VM. The
        unit used is the percentage of a single CPU that can be used by the VM.
        Eg. a value of 300 means up to 3 full CPUs.

        type: integer (percentage of single CPUs, set to 0 for no cap)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes (live update)

    cpu_shares:

        Sets a limit on the number of fair share scheduler (FSS) CPU shares for
        a VM. This value is relative to all other VMs on the system, so a value
        only has meaning in relation to other VMs. If you have one VM with a
        a value 10 and another with a value of 50, the VM with 50 will get 5x
        as much time from the scheduler as the one with 10 when there is
        contention.

        type: integer (number of shares)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes (live update)
        default: 100

    cpu_type:

        For kvm VMs, this controls the type of the virtual CPU exposed to the
        guest. If the value is 'host' the guest will see the same CPU type and
        flags as are seen on the host.

        type: string (qemu64|host)
        listable: yes
        vmtype: kvm
        create: yes
        update: yes
        default: qemu64

    create_timestamp:

        The time at which the VM was created in ISO 8601 format.

        type: string (format: '2011-12-31T06:38:42.457Z')
        vmtype: ANY
        listable: yes
        create: no (automatically added)
        update: no
        default: always set to current time at VM.create().

    server_uuid:

        This is the UUID of the compute node on which the VM currently exists.
        It is most useful when pulled from sources external to the GZ (whether
        in the VM, or from another node).

        type: string (compute node's UUID)
        vmtype: ANY
        listable: no
        create: no
        update: no
        default: this is always pulled when the object is loaded.

    customer_metadata:

        This field allows metadata to be set and associated with this VM. The
        value should be an object with only top-level key=value pairs.

        NOTE1: for historical reasons, do not put keys in here that match the
        pattern *_pw. Those keys should go in internal_metadata instead.

        NOTE2: keys that are prefixed with one of the prefixes listed in
        internal_metadata_namespaces will not be read from customer_metadata but
        rather from internal_metadata. These will also be read-only from within
        the zone.

        type: JSON Object (key: value)
        vmtype: ANY
        listable: no
        create: yes
        update: yes (but see special notes on update command)
        default: {}

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
        OS VM. If true, the VM will get a dataset <zoneroot dataset>/data (by
        default: zones/<uuid>/data) added to it. This dataset will be also be
        mounted on /<zoneroot dataset>/data inside the zone (again by default:
        /zones/<uuid>/data) but you can change this by setting the mountpoint
        option on the dataset from within the zone with zfs(1M). When using
        this option, sub-datasets can be created, snapshots can be taken and
        many other options can be performed on this dataset from within the
        VM.

        type: boolean
        vmtype: OS
        listable: no
        create: yes
        update: no
        default: false

    disks:

        When creating or getting a HVM VM's JSON, you will use this property.
        This is an array of 'disk' objects. The properties available are
        listed below under the disks.*.<property> options. If you want to
        update disks, see the special notes in the section above about the
        'update' command.

        When adding or removing disks, the disks will be available to the VM in
        the order that the disks are included in the disks or add_disks array.

        To use these properties in a list output or lookup, use the format:

          disks.*.size   # for lookup matching any disk
          disks.0.size   # for list output or lookup of a specific disk

    disks.*.block_size:

        Specifies the block size for the disk. This property can only be set at
        disk creation time and cannot be changed without destroying the disk
        and creating a new one.

        Important: this property cannot be set on disks that have an image_uuid
        parameter as the image being cloned will already have the ZFS
        volblocksize property set.

        type: integer (block size in bytes, 512 to 131072, must be power of 2)
        vmtype: HVM
        listable: no
        create: yes
        update: no (except when adding new disks)
        default: 8192

    disks.*.boot:

        Specifies whether this disk should be bootable (only one disk should).

        type: boolean
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.compression:

        Specifies a compression algorithm used for this disk. This has the same
        details, warnings and caveats as the global zfs_root_compression option
        below but only affects a single disk on the VM.

        See zfs_root_compression section below for more details.

        type: string one of: "on,off,gzip,gzip-N,lz4,lzjb,zle"
        vmtype: HVM
        listable: no
        create: yes
        update: yes (see caveat in zfs_root_compression section below)
        default: off

    disks.*.guest_block_size:

        Specifies the device block size reported to the guest. By default, the
        block size of the underlying device is reported to the guest (see
        'disk.*.block_size' above). This setting will override the default
        value. It also allows reporting of both a physical and logical block
        size using a _string_ of the form "logical_size/physical_size" (e.g.
        "512/4096" to look like a 512e drive. This is useful for guests such as
        Windows where older versions of the Windows virtio driver always
        reported the block size of a virtio device as 512 bytes (regardless of
        the block size presented to the guest) while newer versions of the
        driver report the actual size of the device being reported by the host.

        NOTE: the value is _always_ a string, and all values must be a power of
        two.

        type: string of the form "NNN" or "NNN/NNN"
        vmtype: bhyve
        listable: yes
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.nocreate:

        This parameter indicates whether or not the disk should be created. It
        only makes sense for disks with media type 'disk'. For media type
        'cdrom' the device is not created. It also can only be set when
        creating a disk.

        type: boolean
        vmtype: HVM
        listable: no
        create: yes
        update: no (except when adding new disks)
        default: false (new zvol is created when media type is 'disk')

    disks.*.image_name:

        Name of dataset from which to clone this VM's disk. You should specify
        either this and 'image_size' and 'image_uuid', or 'size' for a disk.

        type: string
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.image_size:

        The size of the image from which we will create this disk. When neither
        size nor image_size is passed for a disk but an image_uuid is, and that
        image is available through imgadm, the image_size value from the
        manifest will be set as image_size.

        Important: image_size is required (unless you rely on imgadm) when you
        include image_uuid for a disk and not allowed when you don't.

        type: integer (size in MiB)
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no (loaded from imgadm if possible)

    disks.*.image_uuid:

        UUID of dataset from which to clone this VM's disk. Note: this image's
        UUID must show up in the 'imgadm list' output in order to be valid.

        type: string (UUID)
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.notrim:

        Explicitly disables TRIM functionality for the disk in the guest. This
        functionality is also known as UNMAP or DISCARD. This corresponds to
        the bhyve `nodelete` block-device-option.

        type: boolean
        vmtype: bhyve
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.pci_slot:

        Specifies the virtual PCI slot that this disk will occupy. Bhyve places
        each disk into a PCI slot that is identified by the PCI bus, device, and
        function (BDF). The slot may be specified as <bus>:<device>:<function>
        ("0:4:0"), <device>:<function> ("4:0") or <device> ("4"). If bus or
        function is not specified, 0 is used.

        Per the PCI specification legal values for bus, device and function are:

          bus: 0 - 255, inclusive
          device: 0 - 31, inclusive
          function: 0 - 7, inclusive

        All functions on devices 0, 6, 30, and 31 on bus 0 are reserved.  For
        maximum compatibility with boot ROMs and guest operating systems, the
        disk with boot=true should exist on bus 0 device 3, 4, or 5. If any
        function other than zero (e.g. 0:5:1) is used, function zero on the same
        device (e.g. 0:5:0) must also be used for the guest OS to recognize the
        disk in the non-zero slot.

        If pci_slot is not specified, disks will be assigned to available slots
        in the 0:4:0 - 0:4:7 range. Disks with media=cdrom will be assigned to
        0:3:0 - 0:3:7.

        The format used by pci_slot is slightly different than that reported by
        the Linux `lspci` utility that may be used in guests. The format used by
        `lspci` is <bus>:<device>.<function> with each number is represented in
        hexadecimal. Also notice the mixture of `:` and `.` separators by
        `lspci`.

        type: string (<bus>:<device>:<function>, <device>:function, or <device>)
        vmtype: bhyve
        listable: yes
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.refreservation:

        Specifies a refreservation for this disk. This property controls the
        minimum amount of space reserved for a given disk.  See also the zfs(1)
        man page's description of refreservation.

        type: integer number of MiB
        vmtype: HVM
        listable: no
        create: yes
        update: yes (special, see description in 'update' section above)
        default: size of the disk

    disks.*.size:

        Size of disk in MiB. You should only specify this parameter if you've
        not included the image_* parameters. It will show up in get requests
        for all disks whether you've specified or not as a means to determine
        the size of the zvol.

        Important: size is required when you don't include image_uuid for a disk
        and not allowed when you do.

        type: integer (size in MiB)
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: no

    disks.*.media:

        Specify whether this disk is a 'disk' or 'cdrom'.

        type: string (one of ['disk','cdrom'])
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: disk

    disks.*.model:

        Specify the driver for this disk. If your image supports it, you should
        use virtio. If not, use ide or scsi depending on the drivers in your
        guest.

        type: string (kvm: ['virtio','ide','scsi'])
                     (bhyve: ['virtio','ahci','nvme'])
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: the value of the disk_driver parameter for this VM

    disks.*.zpool:

        The zpool in which to create this zvol.

        type: string (zpool name)
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes (special, see description in 'update' section above)
        default: zones

        NOTE: SDC does not support any pool name other than the default 'zones'.

    disks.*.uuid:

        A UUID that may be used to uniquely identify this disk.  It must be
        unique across all disks associated with this VM.

        type: uuid
        vmtype: bhyve
        listable: yes (see above)
        create: yes
        update: yes
        default: Assigned while adding the disk or at next `vmadm start`.

    disk_driver:

        This specifies the default values for disks.*.model for disks attached
        to this VM.

        type: string (one of ['virtio','ide','scsi'])
        vmtype: kvm
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
        vmtype: ANY
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

        This property can be used to mount additional filesystems into an OS
        VM. It is primarily intended for SDC special VMs. The value is an
        array of objects. The properties available are listed below under the
        filesystems.*.<property> options. Those objects can have the following
        properties: source, target, raw (optional), type and options.

    filesystems.*.type:

        For OS VMs this specifies the type of the filesystem being mounted in.
        Example: lofs

        type: string (fs type)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystems.*.source:

        For OS VMs this specifies the directory in the global zone of the
        filesystem being mounted in.  Example: /pool/somedirectory

        type: string (path)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystems.*.target:

        For OS VMs this specifies the directory inside the Zone where this
        filesystem should be mounted.  Example: /somedirectory

        type: string (path)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystems.*.raw:

        For OS VMs this specifies the additional raw device that should be
        associated with the source filesystem.  Example: /dev/rdsk/somedisk

        type: string (device)
        vmtype: OS
        listable: no
        create: yes
        update: no

    filesystems.*.options:

        For OS VMs this specifies the array of mount options for this file
        system when it is mounted into the zone.  Examples of options include:
        "ro" and "nodevices".

        type: array of strings (each string is an option)
        vmtype: OS
        listable: no
        create: yes
        update: no

    firewall_enabled:

        This enables the firewall for this VM, allowing firewall rules set
        by fwadm(1M) to be applied.

        Note: this property will only show up in a 'vmadm get' when it's set
        true. When set false the property will not appear.

        type: boolean
        vmtype: OS
        listable: no
        create: yes
        update: yes

    flexible_disk_size:

        This sets an upper bound for the amount of space that a bhyve instance
        may use for its disks and snapshots of those disks. If this value is not
        set, it will not be possible to create snapshots of the instance.

        This value must be at least as large as the sum of all of the
        disk.*.size values.

        type: integer (number of MiB)
        vmtype: bhyve
        listable: yes
        create: yes
        update: yes (live update)

    free_space:

        This specifies the amount of space in a bhyve instance that is neither
        allocated to disks nor in use by snapshots of those disks. If snapshots
        are present, writes to disks may reduce this value.

        type: integer (number of MiB)
        vmtype: bhyve
        listable: no
        create: no
        update: no

    fs_allowed:

        This option allows you to specify filesystem types this zone is allowed
        to mount.  For example on a zone for building SmartOS you probably want
        to set this to: "ufs,pcfs,tmpfs".  To unset this property, set the
        value to the empty string.

        type: string (comma separated list of filesystem types)
        vmtype: OS
        listable: no
        create: yes
        update: yes (requires zone reboot to take effect)

    hostname:

        Sets the instance's hostname. For OS VMs, this value will get set in
        several files at creating time, but changing it later will do nothing.
        For HVM instances, the hostname is set during boot via DHCP (kvm only)
        or other boot-time automation such as cloud-init.

        type: string (hostname)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes (but does nothing for OS VMs)
        default: the value of zonename

    hvm:

        A boolean that depicts whether or not the VM is hardware virtualized.
        This property is computed based on the "brand" property and is not
        modifiable.

        type: boolean
        vmtype: ANY
        listable: yes
        create: no
        update: no

    image_uuid:

        This should be a UUID identifying the image for the VM if a VM was
        created from an image.

        NOTE: when this is passed for HVM VMs, it specifies the *zone root*
        dataset which is not visible from within the VM. The user-visible
        dataset will be the one specified through the disks.*.image_uuid.
        Normally you do *not* want to set this for HVM VMs.

        type: string (UUID)
        vmtype: ANY
        listable: yes
        create: yes
        update: no

    internal_metadata:

        This field allows metadata to be set and associated with this VM. The
        value should be an object with only top-level key=value pairs. The
        intention is that customer_metadata contain customer modifiable keys
        whereas internal_metadata is for operator generated keys.

        NOTE: for historical reasons, when a user in a zone does:

            mdata-get name_pw

        where the key ends with '_pw', the key is looked up in internal_metadata
        instead of customer_metadata.

        type: JSON Object (key: value)
        vmtype: ANY
        listable: no
        create: yes
        update: yes (but see special notes on update command)
        default: {}

    internal_metadata_namespaces:

        This allows a list of namespaces to be set as internal_metadata-only
        prefixes. If a namespace 'foo' is in this list, metadata keys with the
        prefix 'foo:' will come from internal_metadata rather than
        customer_metadata. They will also be read-only from within the zone.

        type: list of strings
        vmtype: ANY
        listable: no
        create: yes
        update: yes
        default: []

    indestructible_delegated:

        When set this property adds an @indestructible snapshot to the delegated
        (<zfs_filesystem>/data) dataset and sets a zfs hold on that snapshot.
        This hold must be removed before the VM can be deleted enabling a
        two-step deletion. Eg. to delete a VM where this has been set, you would
        need to:

            vmadm update <uuid> indestructible_delegated=false
            vmadm delete <uuid>

        instead of being able to do the delete on its own. The property will
        only show up in VM objects when set true.

        NOTE: if the hold on the @indestructible dataset is removed manually
        from the GZ or from within the zone, this would also remove this flag
        and allow the VM to be deleted.

        type: boolean
        vmtype: ANY
        listable: yes
        create: yes
        update: yes
        default: false

    indestructible_zoneroot:

        When set this property adds an @indestructible snapshot to the zoneroot
        (zfs_filesystem) dataset and sets a zfs hold on that snapshot. This hold
        must be removed before the VM can be deleted *or reprovisioned*. Eg. to
        delete a VM where this has been set, you would need to:

            vmadm update <uuid> indestructible_zoneroot=false
            vmadm delete <uuid>

        instead of being able to do the delete on its own. The property will
        only show up in VM objects when set true.

        NOTE: if the hold on the @indestructible dataset is removed manually
        from the GZ, this would also remove this flag and allow the VM to be
        deleted.

        type: boolean
        vmtype: ANY
        listable: yes
        create: yes
        update: yes
        default: false

    kernel_version:

        This sets the version of Linux to emulate for LX VMs.

        type: string (kernel version, eg. 2.6.31)
        vmtype: lx
        listable: no
        create: no
        update: yes

    limit_priv:

        This sets a list of privileges that will be available to the Zone that
        contains this VM. See privileges(5) for details on possible privileges.

        type: string (comma separated list of zone privileges)
        vmtype: OS
        listable: no
        create: yes
        update: yes
        OS default: "default"

    maintain_resolvers:

        If set, the resolvers in /etc/resolv.conf inside the VM will be updated
        when the resolvers property is updated.

        type: boolean
        vmtype: OS
        listable: no
        create: yes
        update: yes
        default: false

    max_locked_memory:

        The total amount of physical memory in the host than can be locked for
        this VM. This value cannot be higher than max_physical_memory.

        type: integer (number of MiB)
        vmtype: OS
        listable: yes
        create: yes
        update: yes (live update)
        default: value of max_physical_memory

    max_lwps:

        The maximum number of lightweight processes this VM is allowed to have
        running on the host.

        type: integer (number of LWPs)
        vmtype: OS
        listable: yes
        create: yes
        update: yes (live update)
        default: 2000

    max_physical_memory:

        The maximum amount of memory on the host that the VM is allowed to use.
        For kvm VMs, this value cannot be lower than 'ram' and should be
        ram + 1024.

        type: integer (number of MiB)
        vmtype: OS
        listable: yes
        create: yes
        update: yes (live update)
        default: 256 for OS VMs, (ram size + 1024) for HVM VMs.

    max_swap:

        The maximum amount of virtual memory the VM is allowed to use.  This
        cannot be lower than max_physical_memory, nor can it be lower than 256.

        type: integer (number of MiB)
        vmtype: OS
        listable: yes
        create: yes
        update: yes (live update)
        default: value of max_physical_memory or 256, whichever is higher.

    mdata_exec_timeout:

        For OS VMs this parameter adjusts the timeout on the start method of
        the svc:/smartdc/mdata:execute service running in the zone. This is the
        service which runs user-script scripts.

        This parameter only makes sense when creating a VM and is ignored
        in other cases.

        type: integer (0 for unlimited, >0 number of seconds)
        vmtype: OS
        listable: no
        create: yes
        update: no
        default: 300

    nics:

        When creating or getting a HVM VM's JSON, you will use this property.
        This is an array of 'nic' objects. The properties available are
        listed below under the nics.*.<property> options. If you want to
        update nics, see the special notes in the section above about the
        'update' command.

        When adding or removing NICs, the NIC names will be created in the
        order the interfaces are in the nics or add_nics array.

        To use these properties in a list output or lookup, use the format:

          nics.*.ip   # for lookup matching any interface
          nics.0.ip   # for list output or lookup of a specific interface

    nics.*.allow_dhcp_spoofing:

        With this property set to true, this VM will be able to operate as a
        DHCP server on this interface.  Without this, some of the packets
        required of a DHCP server will not get through.

        type: boolean
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_ip_spoofing:

        With this property set to true, this VM will be able to send and
        receive packets over this nic that don't match the IP address
        specified by the ip property.

        type: boolean
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_mac_spoofing:

        With this property set to true, this VM will be able to send packets
        from this nic with MAC addresses that don't match the mac property.

        type: boolean
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.allow_restricted_traffic:

        With this property set to true, this VM will be able to send
        restricted network traffic (packets that are not IPv4, IPv6, or ARP)
        from this nic.

        type: boolean
        vmtype: ANY
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
        vmtype: HVM
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.blocked_outgoing_ports:

        Array of ports on which this nic is prevented from sending traffic.

        type: array
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.allowed_ips:

        This sets additional IP addresses from which this nic is allowed to
        send traffic, in addition to the IPs in the ips and vrrp_primary_ip
        properties (if set). Values may be single IPv4 or IPv6 addresses
        or IPv4 and IPv6 CIDR ranges. The following are all valid
        examples of allowed_ips: '10.169.0.0/16', '10.99.99.7',
        'fe82::/15', '2600:3c00::f03c:91ff:fe96:a267'.

        type: array (of IP addresses or CIDR ranges)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.allowed_dhcp_cids:

        This specifies which DHCP Client Identifiers outbound DHCP packets are
        allowed to use. By default, when no Client Identifiers are listed, and
        nics.*.ips includes "dhcp" or "addrconf", all DHCP Client Identifiers
        are permitted. Client Identifiers are specified as a string of pairs of
        hexadecimal characters beginning with the prefix "0x". Up to 20 Client
        Identifiers can be listed.

        type: array (of even-lengthed hexadecimal strings beginning with "0x")
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.dhcp_server:

        With this property set to true, this VM will be able to operate as a
        DHCP server on this interface.  Without this, some of the packets
        required of a DHCP server will not get through.

        type: boolean
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes
        default: false

    nics.*.gateway (DEPRECATED):

        The IPv4 router on this network (not required if using DHCP). This
        property should be considered deprecated in favor of using
        nics.*.gateways.

        type: string (IPv4 address)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.gateways:

        An array of IPv4 addresses to use as the network gateway. If multiple
        addresses are specified, the OS-specific behaviour will apply
        (e.g., round robining on SmartOS). This property is not required if
        using DHCPv4.

        The interface for updating this field is liable to change in the
        future to make it easier to add or remove addresses.

        type: array (of IPv4 addresses)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.interface:

        This is the interface name the the VM will see for this interface. It
        will always be in the format netX where X is an integer >= 0.

        type: string (netX)
        vmtype: OS
        listable: yes (see above)
        create: yes
        update: no

    nics.*.ip (DEPRECATED):

        IPv4 unicast address for this NIC, or 'dhcp' to obtain address via
        DHCPv4. This property should be considered deprectated in favor of using
        nics.*.ips.

        type: string (IPv4 address or 'dhcp')
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.ips:

        An array of IPv4 or IPv6 addresses to assign to this NIC. The addresses
        should specify their routing prefix in CIDR notation. The strings
        'dhcp' (DHCPv4) and 'addrconf' (SLAAC or DHCPv6) can also be used to
        obtain the address dynamically. Up to 20 addresses can be listed.

        Since kvm instances receive their static IP addresses from QEMU via
        DHCPv4, they can only receive a single IPv4 address. Therefore, the only
        values that should be used are one of 'dhcp' or an IPv4 address. To
        assign further IP addresses to them, use nics.*.allowed_ips and
        configure them from inside the guest operating system.

        The interface for updating this field is liable to change in the
        future to make it easier to add or remove addresses.

        type: array (of IP addresses with routing prefixes, 'dhcp' or 'addrconf')
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.mac:

        MAC address of virtual NIC.

        type: string (MAC address)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: no (see 'update' command description)
        default: we'll generate one

    nics.*.model:

        The driver for this NIC [virtio|e1000|rtl8139|...]

        type: string (one of ['virtio','e1000','rtl8139'])
        vmtype: kvm
        listable: yes (see above)
        create: yes
        update: yes
        default: the value of the nic_driver property on the VM

    nics.*.mtu:

        Sets the MTU for the network interface. The maximum MTU for a device is
        determined based on its nic tag. If this property is not set, then it
        defaults to the current MTU of the data link that the nic tag
        corresponds to. The supported range of MTUs is from 1500-9000 for
        VMs created on physical nics, and 576-9000 for VMs created on
        etherstubs or overlays.  This property is not updated live with vmadm
        update. If a specific MTU has not been requested, then this property
        is not present through get.

        type: integer
        vmtype: ANY
        listable: no
        create: yes
        update: yes

    nics.*.netmask

        The netmask for this NIC's network (not required if using DHCP)

        type: string (IPv4 netmask, eg. 255.255.255.0)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.network_uuid

        UUID for allowing nics to be tracked in an external system

        type: string (UUID)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.nic_tag

        This option for a NIC determines which host NIC the VMs nic will be
        attached to. The value can be either a nic tag as listed in the 'NIC
        Names' field in `sysinfo`, or an etherstub or device name.

        type: string (device name or nic tag name)
        vmtype: ANY
        listable: yes
        create: yes
        update yes (requires zone stop/boot)

    nics.*.primary

        This option selects which NIC's default gateway and nameserver values
        will be used for this VM. If a VM has any nics, there must always be
        exactly one primary.  Setting a new primary will unset the old. Trying
        to set two nics to primary is an error.

        type: boolean (only true is valid)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes (setting primary=true on one NIC removes the flag from the
            current primary, and sets on the new)

    nics.*.vlan_id:

        The vlan with which to tag this NIC's traffic (0 = none).

        type: integer (0-4095)
        vmtype: ANY
        listable: yes (see above)
        create: yes
        update: yes
        default: 0

    nics.*.vrrp_primary_ip:

        The source IP that will be used to transmit the VRRP keepalive packets
        for this nic.  The IP must be the IP address of one of the other non-
        VRRP nics in this VM.

        type: string (IPv4 address)
        vmtype: OS
        listable: yes (see above)
        create: yes
        update: yes

    nics.*.vrrp_vrid:

        The VRRP Virtual Router ID for this nic.  This sets the MAC address
        of this nic to one based on the VRID.

        type: integer (0-255)
        vmtype: OS
        listable: yes (see above)
        create: yes
        update: yes

    nic_driver:

        This specifies the default values for nics.*.model for NICs attached to
        this VM.

        type: string (one of ['virtio','e1000','rtl8139'])
        vmtype: kvm
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
        vmtype: ANY
        listable: yes
        create: yes
        update: yes
        default: 00000000-0000-0000-0000-000000000000

    package_name:

        This is a private field intended for use by Joyent's SDC product.
        Other users can ignore this field.

        type: string
        vmtype: ANY
        listable: yes
        create: yes
        update: yes

    package_version:

        This is a private field intended for use by Joyent's SDC product.
        Other users can ignore this field.

        type: string
        vmtype: ANY
        listable: yes
        create: yes
        update: yes

    pid:

        For VMs that are currently running, this field indicates the PID of the
        `init` process for the zone.

        type: integer (PID)
        vmtype: ANY
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
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default:
            if vnc_password.length != 0:
                '-vnc unix:/tmp/vm.vnc,password -parallel none -usb -usbdevice tablet -k en-us'
            else
                '-vnc unix:/tmp/vm.vnc -parallel none -usb -usbdevice tablet -k en-us'

    qemu_extra_opts:

        This allows you to specify additional qemu command line arguments.
        When set this string will be appended to the end of the qemu command
        line. It is intended for debugging and not for general use.

        type: string (space-separated options for qemu)
        vmtype: kvm
        listable: no
        create: yes
        update: yes

    quota:

        This sets a quota on the zone filesystem. For OS VMs, this value is the
        space actually visible/usable in the guest. For kvm and bhyve VMs, this
        value is the quota (kvm) or refquota (bhyve) for the Zone containing
        the VM, which is not directly available to users.

        Set quota to 0 to disable (ie. for no quota).

        type: integer (number of GiB)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes (live update)

    ram:

        For kvm and bhyve VMs this is the amount of virtual RAM that will
        be available to the guest kernel. For OS VMs this will be the same as
        the property max_physical_memory.

        type: integer (number of MiB)
        vmtype: HVM
        listable: yes
        create: yes
        update: yes (requires VM reboot to take effect)
        default: 256

    resolvers:

        For OS VMs, this value sets the resolvers which get put into
        /etc/resolv.conf at VM creation. If maintain_resolvers is set to
        true, updating this property will also update the resolvers in
        /etc/resolv.conf. For HVM instances, the resolvers are set via DHCP
        (kvm only) or other other boot-time automation such as cloud-init.

        type: array
        vmtype: OS,kvm
        listable: no
        create: yes
        update: yes

    routes:

        This is a key-value object that maps destinations to gateways. These
        will be set as static routes in the VM. The destinations can be either
        IPs or subnets in CIDR form. The gateways can either be IP addresses,
        or can be of the form "nics[0]" or "macs[aa:bb:cc:12:34:56]". Using
        nics[] or macs[] specifies a link-local route. When using nics[] the IP
        of the numbered nic in that VM's nics array (the first nic is 0) is
        used. When using macs[] the IP of the nic with the matching mac address
        in that VM's nic array is used. As an example:

            {
                "10.2.2.0/24": "10.2.1.1",
                "10.3.0.1": "nics[1]",
                "10.4.0.1": "macs[aa:bb:cc:12:34:56]"
            }

        This sets three static routes: to the 10.2.2.0/24 subnet with a gateway
        of 10.2.1.1, a link-local route to the host 10.3.0.1 over the VM's
        second nic, and a link-local route to the host 10.4.0.1 over the VM's
        nic with the corresponding mac address.

        type: object
        vmtype: OS
        listable: no
        create: yes
        update: yes

    snapshots (EXPERIMENTAL):

        For bhyve VMs and OS VMs, this will display a list of snapshots from
        which you can restore the root dataset and its dependent datasets for
        your VM.  Currently this is only supported when your VM does not have
        any delegated datasets.

        type: array
        vmtype: OS or bhyve
        listable: no
        create: no (but you can use create-snapshot)
        update: no (but you can use rollback-snapshot and delete-snapshot)

    spice_opts (EXPERIMENTAL):

        This property allows you to add additional -spice options when you are
        using SPICE. NOTE: SPICE support requires your kvm zone to be using a
        zone dataset with the image_uuid option and that image must know what
        to do with these special options.

        type: string (-spice XXX options)
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: <unset>

    spice_password (EXPERIMENTAL):

        This property allows you to set a password which will be required when
        connecting to the SPICE port when SPICE is enabled. NOTE: SPICE support
        requires your kvm zone to be using a zone root dataset with the
        image_uuid option and that dataset must know what to do with these
        special options. IMPORTANT: this password will be visible from the GZ
        of the CN and anyone with access to the serial port in the guest. Set
        to an empty string (default) to not require a password at this level.

        type: string (8 chars max)
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: <unset>

    spice_port (EXPERIMENTAL):

        This specifies the TCP port to listen on for the SPICE server. By
        default SPICE is not enabled. NOTE: SPICE support requires your kvm
        zone to be using a zone root dataset with the image_uuid option and
        that dataset must know what to do with these special options. If set to
        zero, a port will be chosen at random. Set to -1 to disable TCP
        listening for SPICE.

        type: integer (0 for random, -1 for disabled)
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: <unset>

    state:

        This property exposes the current state of a VM.

        See the 'VM STATES' section below for more details.

        type: string
        vmtype: ANY
        listable: yes
        create: no
        update: no

    tmpfs:

        This property specifies how much of the VM's memory will be available
        for the /tmp filesystem. This is only available for OS VMs, and doesn't
        make any sense for HVM VMs.

        If set to 0 this indicates that you would like to not have /tmp mounted
        as tmpfs at all. When changing to/from a "0" value, the VM must be
        rebooted in order for the change to take effect.

        vmtype: OS
        listable: yes
        create: yes
        update: yes
        default: max_physical_memory

    transition_expire:

        When a HVM VM is in transition from running to either 'off' (in the
        case of stop) or 'start' (in the case of reboot), the transition_expire
        field will be set. This value will indicate the time at which the
        current transaction will time out. When the transaction has timed out,
        vmadmd will force the VM into the correct state and remove the
        transition.

        type: integer (unix epoch timestamp)
        vmtype: kvm
        listable: no
        create: no (will show automatically)
        update: no

    transition_to:

        When a HVM VM is in transition from running to either 'off' (in the
        case of stop) or 'start' (in the case of reboot), the transition_to
        field will be set to indicate which state the VM is transitioning to.
        Additionally when a VM is provisioning you may see this with a value
        of 'running'.

        type: string value, one of: ['stopped', 'start', 'running']
        vmtype: ANY
        listable: no
        create: no
        update: no

    type:

        This is a virtual field and cannot be updated. It will be 'OS' when the
        brand == 'joyent*', 'LX' when the brand == 'lx', 'KVM' when the
        brand == 'kvm', and 'BHYVE' when the brand == 'bhyve'.

        type: string value, one of: ['OS', 'LX', 'KVM', 'BHYVE']
        vmtype: ANY
        listable: yes
        create: no, set by 'brand' property.
        update: no

    uuid:

        This is the unique identifer for the VM. If one is not passed in with
        the create request, a new UUID will be generated. It cannot be changed
        after a VM is created.

        type: string (UUID)
        vmtype: ANY
        listable: yes
        create: yes
        update: no
        default: a new one is generated

    vcpus:

        For HVM VMs this parameter defines the number of virtual CPUs the guest
        will see. Generally recommended to be a multiple of 2.

        type: integer (number of vCPUs)
        vmtype: HVM
        listable: yes
        create: yes
        update: yes (requires VM reboot to take effect)
        default: 1

    vga:

        This property allows one to specify the VGA emulation to be used by
        kvm VMs. The default is 'std'. NOTE: with the qemu bundled in SmartOS
        qxl and xenfb do not work.

        type: string (one of: 'cirrus','std','vmware','qxl','xenfb')
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: 'std'

    virtio_txburst:

        This controls how many packets can be sent on a single flush of the tx
        queue. This applies to all the vnics attached to this VM using the
        virtio model.

        type: integer
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: 128

    virtio_txtimer:

        This sets the timeout for the TX timer.  It applies to all the vnics
        attached to this VM using the virtio model.

        type: integer (in nanoseconds)
        vmtype: kvm
        listable: no
        create: yes
        update: yes
        default: 200000

    vnc_password:

        This property allows you to set a password which will be required when
        connecting to the VNC port. IMPORTANT: this password will be visible
        from the GZ of the CN. For KVM anyone with access to the serial port in
        the guest can also see the password. Set to an empty string (default) to
        not require a password at this level.

        Changing the password will require a reboot of the zone before the
        change becomes active. Reboots from inside the guest will not make
        the changed password active.

        type: string (8 chars max)
        vmtype: HVM
        listable: no
        create: yes
        update: yes
        default: <unset>

    vnc_port:

        This specifies the TCP port to listen on for the VNC server, the
        default is zero which means a port will be chosen at random. Set to -1
        to disable TCP listening.

        type: integer (0 for random, -1 for disabled)
        vmtype: HVM
        listable: no
        create: yes
        update: yes
        default: 0

    zfs_data_compression:

        Specifies a compression algorithm used for this VM's data dataset. This
        option affects only the delegated dataset and therefore only makes
        sense when the VM has been created with the delegate_dataset option.

        The caveats and warnings in the zfs_root_compression section below also
        apply to this option.

        type: string one of: "on,off,gzip,gzip-N,lz4,lzjb,zle"
        vmtype: OS (and only with a delegated dataset)
        listable: no
        create: yes
        update: yes (see warning in zfs_root_compression section)
        default: off

    zfs_data_recsize:

        This specifies the suggested block size for files in the delegated
        dataset's filesystem. It can only be set when your zone has a data
        dataset as added by the delegate_dataset option.

        The warnings and caveats for zfs_root_recsize also apply to this
        option. You should read and understand those before using this.

        type: integer (record size in bytes, 512 to 131072, must be power of 2)
        vmtype: OS (and only with a delegated dataset)
        listable: no
        create: yes
        update: yes (see caveat below under zfs_root_recsize)
        default: 131072 (128k)

    zfs_filesystem_limit:

        This specifies a limit on the number of filesystems a VM can have. It is
        most useful when combined with the delegate_dataset option as a
        mechanism to limit the number of filesystems that can be created from
        within the zone. The root user in the GZ is immune to this limit.

        type: integer (0+, set to '', null, or undefined to unset)
        vmtype: OS
        listable: no
        create: yes
        update: yes
        default: none (no limit)

        See zfs(1M) `filesystem_limit` for more details.

    zfs_io_priority:

        This sets an IO throttle priority value relative to other VMs. If one
        VM has a value X and another VM has a value 2X, the machine with the
        X value will have some of its IO throttled when both try to use all
        available IO.

        type: integer (relative value)
        vmtype: ANY
        listable: yes
        create: yes
        update: yes (live update)
        default: 100

    zfs_root_compression:

        Specifies a compression algorithm used for this VM's root dataset. This
        option affects only the zoneroot dataset. Setting to 'on' is equivalent
        to setting to 'lzjb'. If you want more information about the specific
        compression types, see the man page for zfs(1M).

        WARNING: If you change this value for an existing VM, only *new* data
        will be compressed. It will not rewrite existing data compress.

        NOTE: to change this property for HVM, see disks.*.zfs_compression
        above.

        type: string one of: "on,off,gzip,gzip-N,lz4,lzjb,zle"
        vmtype: OS
        listable: no
        create: yes
        update: yes (see warning above)
        default: off

    zfs_root_recsize:

        Specifies a suggested block size for files in the root file system.
        This property is designed solely for use with database workloads that
        access files in fixed-size records. ZFS automatically tunes block sizes
        according to internal algorithms optimized for typical access patterns.
        If you have a delegated dataset (with the delegate_dataset option) you
        should consider leaving this unset and setting zfs_data_recsize
        instead.

        WARNING: Use this property only if you know exactly what you're doing
        as it is very possible to have an adverse effect performance when
        setting this incorrectly. Also, when doing an update, keep in mind that
        changing the file system's recordsize affects only files created
        after the setting is changed; existing files are unaffected.

        NOTE: to change this property for HVM, see disks.*.block_size above.

        type: integer (record size in bytes, 512 to 131072, must be power of 2)
        vmtype: OS
        listable: no
        create: yes
        update: yes (see caveat above)
        default: 131072 (128k)

    zfs_snapshot_limit:

        This specifies a limit on the number of snapshots a VM can have. It is
        most useful when combined with the delegate_dataset option as a
        mechanism to limit the number of snapshots that can be taken from within
        the zone. The root user in the GZ is immune to this limit.

        type: integer (0+, set to '', null, or undefined to unset)
        vmtype: OS
        listable: no
        create: yes
        update: yes
        default: none (no limit)

        See zfs(1M) `snapshot_limit` for more details.

    zlog_max_size:

        This property is used to set/show the maximum size for a docker zone's
        stdio.log file before zoneadmd(1m) will rotate it.

        type: integer (size in bytes)
        vmtype: ANY
        listable: no
        create: yes
        update: yes
        default: none (no rotation)

    zlog_mode:

        This property will show up for docker zones and indicates which mode the
        zlog/zfd devices will be in for the VM.

        The values are simply positional letters used to indicate various
        capabilities. The following table shows the meaning of the mode values:

        zlog-mode    gz log - tty - ngz log
        ---------    ------   ---   -------
        gt-             y      y       n
        g--             y      n       n
        gtn             y      y       y
        g-n             y      n       y
        -t-             n      y       n
        ---             n      n       n

        where the "gz log" here means we'll write the log to the
        /zones/<uuid>/logs/stdio.log file, "tty" means we'll setup the zfd
        devices as a tty, and "ngz log" means we'll setup the zfd devices to
        loop logs back into the zone so that a dockerlogger can process them in
        the zone.

        type: string (3 character mode string)
        vmtype: ANY
        listable: no
        create: no (handled via docker:* metadata)
        update: no (handled via docker:* metadata)

    zone_state:

        This property will show up when fetching a VMs JSON.  this shows the
        state of the zone in which this VM is contained. eg. 'running'.  It
        can be different from the 'state' value in several cases.

        See the 'VM STATES' section below for more details.

        type: string
        vmtype: HVM
        listable: yes
        create: no
        update: no

    zonepath:

        This property will show up in JSON representing a VM. It describes the
        path in the filesystem where you will find the VMs zone dataset. For OS
        VMs all VM data will be under this path, for HVM VMs this is where
        you'll find things such as the logs and sockets for a VM.

        type: string (path)
        vmtype: ANY
        listable: no
        create: no (automatic)
        update: no

    zonename:

        This property indicates the zonename of a VM. The zonename is a private
        property and not intended to be used directly. For OS VMs you can set
        this property with the create payload, but such use is discouraged.

        type: string
        vmtype: ANY
        listable: yes
        create: yes (OS VMs only)
        update: no
        default: value of uuid

    zonedid:

        This property will show up in a JSON payload and can be included in
        list output. It is a value that is used internally to the system and
        primarily exists to aid debugging. This value will not change when the
        VM is started/stopped.

        type: integer
        vmtype: ANY
        listable: yes
        create: no
        update: no

    zoneid:

        This property will show up in a JSON payload and can be included in
        list output. It is however a value that is used internally to the
        system and primarily exists to aid debugging. This value will change
        whenever the VM is stopped or started. Do not rely on this value.

        type: integer
        vmtype: ANY
        listable: yes
        create: no
        update: no

    zpool:

        This defines which ZFS pool the VM's zone dataset will be created in
        For OS VMs, this dataset is where all the data in the zone will live.
        For HVM VMs, this is only used by the zone shell that the VM runs in.

        type: string (zpool name)
        vmtype: ANY
        listable: yes
        create: yes
        update: no
        default: zones

        NOTE: SDC does not support any pool name other than the default 'zones'.


## VM STATES

The 'zone_state' field represents the state of the zone which contains the VM.
The zones(5) man page has some more information about these zone states.

The 'state' field defaults to the value of zone\_state, but in some cases the
state indicates details of the VM that are not reflected directly by the zone.
For example, zones have no concept of 'provisioning' so while a VM is
provisioning it will go through several zone\_states but remain in the
provisioning 'state' until either it goes to 'failed', 'stopped' or 'running'.

Generally for zone\_state you should see transitions something like:


               configured

                  ^ |
       uninstall  | |  install
                  | v

      +------> installed <-------+
      |                          |
      |           ^ |            |
      |     halt  | |  ready     |  halt
      |           | v            |
      |                          |
      |          ready ----------+
      |
      |            |
      |            |  boot
      |            v
      |
      |         running
      |
      |            |
      |            |  shutdown/reboot
      |            v
      |
      |       shutting_down
      |
      |            |
      |            |
      |            v
      |
      +--------- down


The state field will have similar transition except:

 * The zone\_state 'installed' will be state 'stopped'.

 * When first provisioning the VM, the 'provisioning' state will hide the
   zone_states 'configured' -> 'installed' -> 'ready' -> 'running', as well
   as any reboots that take place as part of the scripts inside the zone.

 * From 'provisioning' a VM can go into state 'failed' from which it will not
   recover.

 * It is possible for a VM to be in state 'receiving' while zone\_state
   transitions through several states.

 * HVM VMs can show state 'stopping' when zone\_state is running but the guest OS
   has been notified that it should perform an orderly shutdown.

The rest of this section describes the possible values for the 'state' and
'zone_state' fields for a VM object. Each state will be followed by a note about
whether it's possible for state, zone\_state or both, and a brief description
what it means that a VM has that state.

configured

  Possible For: state + zone\_state

  This indicates that the configuration has been created for the zone
  that contains the VM, but it does not have data. When a VM is first
  created you will briefly see this for zone\_state but see state
  'provisioning'. While the VM is being destroyed it also transitions
  through configured in which case you may see it for both state and
  zone\_state.


down

  Possible For: state + zone\_state

  The VM has been shut down but there is still something holding it
  from being completely released into the 'installed' state. Usually
  VMs only pass through this state briefly. If a VM stays in state
  'down' for an extended period of time it typically requires operator
  intervention to remedy as some portion of the zone was unable to be
  torn down.


failed

  Possible For: state

  When a provision fails (typically due to timeout) the VM will be
  marked as failed and the state will be 'failed' regardless of the
  zone\_state. This is usually caused either by a bug in the image's
  scripts or by the system being overloaded. When a VM has failed to
  provision it should generally be investigated by an operator to
  confirm the cause is known and perform any remedy possible before
  destroying the failed VM and provisioning it again.

  It is also possible for VMs to go to 'failed' when scripts inside
  the image have failed during a reprovision. In this case the best
  course of action is usually to have an operator confirm the cause is
  known, and reprovision again after fixing the source of the failure.


incomplete

  Possible For: state + zone\_state

  If a VM is in this state, it indicates that the zone is in the
  process of being installed or uninstalled. Normally VMs transition
  through this state quickly but if a VM stays in this state for an
  extended period of time it should be investigated by an operator.


installed

  Possible For: zone\_state

  The VM has been created and the datasets have been installed. As
  this really indicates that the VM appears to be healthy but is just
  not running, we translate this zone\_state to state 'stopped' to
  make it clear that it is ready to be started.


provisioning

  Possible For: state

  When a VM is first being created and autoboot is true, the VM will
  have state provisioning even as the zone\_state makes several
  transitions. Non-HVM VMs will stay in state 'provisioning' until the
  scripts inside the zone have completed to the point where they have
  removed the /var/svc/provisioning file that was inserted before the
  zone was first booted. HVM VMs will stay in state 'provisioning'
  until the 'query-status' result from qemu includes 'hwsetup' with a
  value of true.


ready

  Possible For: state + zone\_state

  This indicates that the VM has filesystems mounted and devices
  created but that it is not currently running processes. This state
  is normally only seen briefly while transitioning to running.


receiving

  Possible For: state

  This is similar to 'provisioning' in that a VM will stay in state
  'receiving' while the 'vmadm recv' command is running and the
  zone\_state will change underneath it. A received VM will similarly
  stay in state 'receiving' until all the required datasets have been
  received.


running

  Possible For: state + zone\_state

  The VM has all required resources and is executing processes.


shutting_down

  Possible For: state + zone\_state

  The VM is being shut down. Usually VMs only pass through this state
  briefly.  If a VM stays in state 'shutting_down' for an extended
  period of time it typically requires operator intervention to remedy
  as some portion of the zone was unable to be torn down.


stopped

  Possible For: state

  When a VM has zone\_state 'installed', it will always have state
  'stopped'.  This is just a straight rename. Please see the
  'installed' state for details on what this actually means.


stopping

  Possible For: state

  This is a state which only exists for HVM VMs. When we have sent a
  system_powerdown message to qemu via QMP we will mark the the VM as
  being in state 'stopping' until either the shutdown times out and we
  halt the zone, or the VM reaches zone\_state 'installed'.




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
          "image_uuid": "47e6af92-daf0-11e0-ac11-473ca1173ab0",
          "max_physical_memory": 256,
          "alias": "zone70",
          "nics": [
            {
              "nic_tag": "external",
              "ips": ["10.2.121.70/16"],
              "gateways": ["10.2.121.1"],
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
              "ips": ["10.88.88.51/24"],
              "gateways": ["10.88.88.2"],
              "primary": true
            }
          ]
        }
        EOF

    Example 4: Getting JSON for the VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0.

        vmadm get 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 5: Find the VM with the IP 10.2.121.70 (second one with JSON
               output)

        vmadm lookup nics.*.ip=10.2.121.70
        vmadm lookup -j nics.*.ip=10.2.121.70

    Example 6: Looking up all 128M VMs with an alias that starts with 'a' or
               'b' and then again with JSON output.

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
              "ips": ["10.2.121.71/16"],
              "gateways": ["10.2.121.1"]
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
              "ips": ["10.2.121.72/16"]
            }
          ]
        }
        EOF

    Example 11: Remove the NIC with MAC b2:1e:ba:a5:6e:71 from VM with UUID
                54f1cc77-68f1-42ab-acac-5c4f64f5d6e0.

        echo '{"remove_nics": ["b2:1e:ba:a5:6e:71"]}' | \
            vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 12: Adding a lofs filesystem mount to the VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm update 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0 <<EOF
        {
          "add_filesystems": [
            {
	      "source": "/bulk/logs/54f1cc77-68f1-42ab-acac-5c4f64f5d6e0",
	      "target": "/var/log",
	      "type": "lofs",
	      "options": [
	        "nodevice"
	      ]
            }
          ]
        }
        EOF

    Example 13: Stop VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm stop 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 14: Start VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm start 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 15: Reboot VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

        vmadm reboot 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

    Example 16: Delete VM 54f1cc77-68f1-42ab-acac-5c4f64f5d6e0

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

    vmadmd(1M), zonecfg(1M), zoneadm(1M), zones(5)

## NOTES

Some of the vmadm commands depend on the vmadmd(1M) service:

    svc/system/smartdc/vmadmd:default

If the vmadmd service is stopped while the vmadm utility is running, the vmadm
command behaviour will be undefined. Additionally if the service is not
running, some commands will be unavailable.

