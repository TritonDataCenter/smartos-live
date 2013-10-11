vmadmd(1M) -- virtual machine management daemon
===============================================

## SYNOPSIS

    /usr/vm/sbin/vmadmd

## DESCRIPTION

    The vmadmd daemon is designed to run in a SmartOS global zone and support
    vmadm(1M) by performing some actions which require maintaining open
    connections or waiting for state change events that cannot be handle in a
    single run of vmadm(1M).

    The functions vmadmd handles are:

      * autobooting KVM VMs

      * exposing KVM VM VNC consoles via TCP

      * handling stopping and rebooting timeouts for KVM VMs

      * handling sending QMP commands to KVM VMs

    Each of these is described in more detail below. These actions are exposed
    through an HTTP server listening on a unix socket /tmp/vmadmd.http.

    The HTTP interface is expected to only be used by vmadm(1M) and endpoints
    should be considered a private interface. It is documented here in order to
    aid understanding of its behaviour.

## KVM Autoboot

    When the vmadmd process starts it checks for a file /tmp/.autoboot_vmadmd
    and if this file does not exist, it is created and vmadmd runs through the
    autoboot process. Since the /tmp filesystem is tmpfs, this file will only
    not exist on the first vmadmd startup after each boot.

    The autoboot process involves loading the list of zones with brand=kvm and
    checking the vm-autoboot property on these zones. If that property is set
    to true and the VM is not running, it is booted.

## KVM VNC Consoles

    VMs in a SmartOS system run within zones. The zone in which a VM is running
    has no network interfaces itself as the vnics for the VM are attached to
    the qemu process rather than being plumbed in the zone. As such there is no
    way to have the qemu processes VNC listening on a TCP socket in the zone.
    To still provide access to the VNC service, VMs run VNC connected to a unix
    socket inside their zonepath which is then exposed on a TCP socket by
    vmadmd in the global zone.

    In order to know when to bring the TCP sockets redirecting to the unix
    sockets up and down, vmadmd watches for zone status sysevents. When a 'kvm'
    branded zone goes to the 'running' state and on vmadmd startup, vmadmd will
    connect to the running VM's /zones/<uuid>/root/tmp/vm.vnc socket and opens
    a new TCP port that is redirected to this. When a zone is seen coming out
    of the running state, the TCP socket is closed.

    The port chosen for the VNC console is random, but can be discovered
    through the 'vmadm info' command. Note that this port will change if either
    the VM or vmadmd are restarted.

## Handling of Stop and Reboot

    The handling of stopping a KVM VM is complicated by the fact that sending a
    shutdown request to a guest requires cooperation from that guest. Since
    guest kernels are not always willing or able to cooperate with these
    shutdown requests, a 'vmadm stop' command marks a VM as being in transition
    to 'stopped' and sets an expiry for that transition to complete. Reboot for
    VMs is implemented as a stop and start so this also applies when running
    'vmadm reboot'.

    Since the vmadm(1M) process returns once a stop request is sent, it is up
    to vmadmd to ensure that if the VM does not complete its transition by the
    expiry, the stop or reboot is forced.

    On startup, vmadmd checks all kvm branded zones and sends a forced stop to
    any which have an expired running transition. If the transition is to
    start the VM is then started. If the transition is not yet expired when the
    VM is loaded, vmadmd sets an internal timer to check again at expire time.
    Since vmadmd also handles all stop requests, this timer is also set when
    any new stop request comes in.

## QMP Commands

    Qemu processes support a protocol called QMP for sending several types of
    management commands to the hypervisor. When created with vmadm(1M) the qmp
    socket will be listening on a unix socket /zones/<uuid>/root/tmp/vm.qmp.
    vmadmd exposes some of these commands and handles sending them through QMP.
    The commands exposed are described below.

    info (GET /vm/:id[?type=type,type,...])

        This command actually sends several requests through QMP and adds some
        'virtual' results for the VNC socket. By default all possible
        information is returned. Optionally the caller can specify a list of
        specific types of info in which case the result will include only that
        info. The result is returned as a JSON object.

        Types of info available are:

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

        version:

            Qemu version information.

        vnc:

            The IP, port and VNC display number for the TCP socket we're
            listening on for this VM.

    stop (POST /vm/:id?action=stop&timeout=secs)

        This sends a acpi shutdown request to the VM. The guest kernel needs to
        be configured to handle this request and should immediately begin a
        shutdown in order to prevent data loss. If the shutdown sequence is not
        completed within the timeout number of seconds, the VM is forcibly shut
        down.

    reload_vnc (POST /vm/:id?action=reload_vnc)

        This recreates the VNC listener for the VM after loading the new
        parameters. If the vnc_password and vnc_port are unchanged, this is
        a NO-OP. The intention is that this be used after modifying a VM's
        VNC settings.

    reset (POST /vm/:id?action=reset)

        This is the action used by 'vmadm reboot <uuid> -F' command. It acts
        similarly to pressing the virtual reset switch on your VM. The guest OS
        will not be given warning or have time to respond to this request.

    sysrq (POST /vm/:id?action=sysrq&request=[nmi|screenshot])

        There are two types of request you can make through the sysrq command:

        nmi:

            This sends a non-maskable interrupt to the VM. The guest kernel
            needs to be configured for this to do anything.

        screenshot:

            This takes a screenshot of the VMs console.  The screenshot will
            be written to the /zones/<uuid>/root/tmp/vm.ppm.

## SEE ALSO

    vmadm(1M), zonecfg(1M), zoneadm(1M), zones(5)

## NOTES

    The vmadmd service is managed by  the  service  management
    facility, smf(5), under the service identifier:

      svc:/system/smartdc/vmadmd:default

    Administrative actions on this service,  such  as  enabling,
    disabling,  or  requesting  restart,  can be performed using
    svcadm(1M). The service's status can be  queried  using  the
    svcs(1) command.

