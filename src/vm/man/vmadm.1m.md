vmadm(1m) -- Manage SmartOS virtual machines
============================================

## SYNOPSIS
    /usr/vm/sbin/vmadm <command> [-d] [-v] [command-specific arguments]

## DESCRIPTION

The vmadm tool allows you to interact with virtual machines on a SmartOS system.
Both OS Virtual Machines (zones) and KVM Virtual Machines can be managed. vmadm
allows you to create, inspect, modify and delete virtual machines on the local
system.

TODO

## COMMANDS

    The following commands and options are supported:

      create [-f <filename>]

        TODO

      delete <uuid>

        TODO

      get <uuid>

        TODO

      info <uuid> [type,...]

        TODO

      list [-p] [-H] [-o field,...] [-s field,...] [field=value ...]

        TODO

      lookup [-j] [field=value ...]

        TODO

      reboot <uuid> [-F]

        TODO

      start <uuid> [option=value ...]

        TODO

      stop <uuid> [-F]

        TODO

      sysrq <uuid> <nmi|screenshot>

        TODO

      update <uuid> [-f <filename>]

        TODO

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
                  updates affect the behavior of the running machine. Other
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

        type: string
        vmtype: KVM
        listable: no

    brand:

        This will be one of 'joyent' for OS virtualization and 'kvm' for full
        hardware virtualization. This is a required value for VM creation.

        type: string (joyent|kvm)
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

    customer_metadata:

        type: JSON Object (key: value)
        vmtype

    dataset_uuid:

        This should be a UUID identifying the image for the VM if a VM was
        created from an image.

    dns_domain:

        vmtype: OS
        listable: yes

    hostname:

        vmtype: OS,KVM
        listable: yes

    limitpriv:

        vmtype: OS,KVM
        listable: no

    max_locked_memory:

        vmtype: OS,KVM
        listable: yes

    max_lwps:

        vmtype: OS,KVM
        listable: yes

    max_physical_memory:

        vmtype: OS,KVM
        listable: yes

    max_swap:

        vmtype: OS,KVM
        listable: yes

    never_booted:

        vmtype: OS,KVM
        listable: no
        create: no (set automatically)
        update: no

    owner_uuid:

        vmtype: OS,KVM
        listable: yes
        create: yes
        update: yes
        default: 000...

    package_name:

        vmtype: OS,KVM
        listable: yes

    package_version:

        vmtype: OS,KVM
        listable: yes

    qemu_opts:

        vmtype: KVM
        listable: no
        create: yes
        update: yes
        default:

    qemu_extra_opts:

        vmtype: KVM
        listable: no
        create: yes
        update: yes

    quota:

        vmtype: OS,KVM
        listable: yes

    ram:

        For KVM VMs this is the amount of virtual RAM that will be available to
        the guest kernel. For OS VMs this will be the same as the property
        max_physical_memory.

        type: integer (number of MiB)
        vmtype: KVM
        listable: yes
        create: KVM VMs only
        update: KVM VMs only, for OS VMs update max_physical_memory instead.
        default: ?

    real_state:

        This property may show up when fetching a VMs JSON if that VM is in a
        transition. In that case the 'state' option will show something like
        'stopping' but the 'real_state' property will show the zone's actual
        state: eg. 'running'.

        type: string
        vmtype: KVM
        listable: yes
        create: no
        update: no

    resolvers:

        vmtype: OS
        listable: no
        create: yes
        update: yes

    state:

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
        default: ?

    transition_expire:

        TODO

        type: integer (unix epoch timestamp)
        vmtype: KVM
        listable: no

    transition_to:

        TODO

        type: string value, one of: ['stopped', 'start']
        vmtype: KVM
        listable: no

    type:

        This is a virtual field and cannot be updated. It will be 'OS' when the
        brand=='joyent' and 'KVM' when the brand=='kvm'.

        vmtype: OS,KVM
        listable: yes
        update: no
        create: no, set by 'brand' property.

    uuid:

        type: string (UUID)
        vmtype: OS,KVM
        listable: yes
        update: no
        create: yes

    vcpus:

        type: integer (number of CPUs)
        vmtype: KVM
        listable: yes
        create: KVM only
        update: KVM only (requires reboot to take effect)

    zfs_io_priority:

        vmtype: OS,KVM
        listable: yes

    zfs_storage_pool_name:

        vmtype: OS,KVM
        listable: yes

    zonepath:

        vmtype: OS,KVM
        listable: no

    zonename:

        vmtype: OS,KVM
        listable: yes
        create: yes (OS VMs only)
        update: no

    zoneid:

        vmtype: OS,KVM
        listable: yes
        create: no
        update: no


## EXAMPLES

    Example 1: ...

        TODO

## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.

     3
         svc:system/smartdc/vmadmd:default not running or not
         responding.


## SEE ALSO

    vmadmd(1m), zonecfg(1m), zoneadm(1m), zones(5)

## NOTES

Some of the vmadm commands depend on the vmadmd(1m) service:

    svc/system/smartdc/vmadmd:default

If the vmadmd service is stopped while the vmadm utility is running, the vmadm
command behavior will be undefined. Additionally if the service is not running,
some commands will be unavailable.

