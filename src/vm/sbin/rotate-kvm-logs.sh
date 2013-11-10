#!/bin/bash
#
# Copyright (c) 2013 Joyent Inc.
#
# Consume Qemu log files from KVM zones writing to /var/log/sdc/upload so they
# are ready for offloading to another system.
#
# You can optionally pass a <VM UUID> argument to only rotate the logs for that
# VM. By default it rotates Qemu logs for all KVM VMs.
#

set -o errexit
set -o pipefail

if [[ -n ${TRACE} ]]; then
    set -o xtrace
fi

DEST_DIR="/var/log/sdc/upload"
SERVER_UUID=$(sysinfo | json UUID)

function log()
{
    local date=$(TZ=UTC date +"%Y-%d-%mT%H:%M:%SZ")

    echo "${date} $*"
}

function rotate_log()
{
    local destfile=
    local deststamp=
    local logfile=$2
    local vm_uuid=$1

    if [[ ! -s ${logfile} ]]; then
        # file doesn't exist or is empty
        return;
    fi

    # The logs for 03:00 - 04:00 go to the file w/ XXXX-XX-XXT04:00:00
    # so w/ cron we rotate downward to the nearest hour when we run at minute 0
    # but if we run from vmadmd or manually we want to roll forward.
    if [[ -n ${SDC_LOG_ROLL_BACKWARD} ]]; then
        deststamp=$(date +"%Y-%m-%dT%H:00:00")
    else # roll forward
        deststamp=$(/usr/node/bin/node -e "console.log(new Date(((new Date() / 1000) + 3600) * 1000).toISOString().split('.')[0].replace(/[0-9][0-9]:[0-9][0-9]$/, '00:00'))")
    fi
    destfile="${DEST_DIR}/qemu_${vm_uuid}@${SERVER_UUID}_${deststamp}.log"

    echo "${logfile} is non-empty, rotating into ${destfile}"

    if [[ $(basename ${logfile}) == "vm.log.rotating" ]]; then
        #
        # Previous rotation failed for this file, try to append and delete it
        # we either succeed here and return or fail. In either case this script
        # remains idempotent since on failure we'll try again on re-run and on
        # success we'll be done with this file and it will be gone.
        #
        cat "${logfile}" >> ${destfile}  \
            && rm -f "/zones/${vm_uuid}/root/tmp/vm.log.rotating"
        return;
    fi

    #
    # Rotate {logfile} using 'copytruncate':
    #  only if {logfile} >= 1 byte
    #  and rotate now
    #  and write to vm.log.rotating (temporarily)
    #  and after writing there, append to ${destfile} and remove temp file
    #
    logadm \
        -c \
        -s 1b \
        -p now \
        -t '$dirname/vm.log.rotating' \
        -R "cat \$file >> ${destfile} && rm -f \$file" \
        ${logfile}
}

function rotate_vm_logs()
{
    local vm_uuid=$1
    local zoneroot="/zones/${vm_uuid}/root"

    log "Rotating logs in ${zoneroot}/tmp..."
    # Always catch any failed previous rotation first
    rotate_log ${vm_uuid} "${zoneroot}/tmp/vm.log.rotating"

    # The .# files get put into place on VM boot by qemu-exec
    for idx in {9..0}; do
        rotate_log ${vm_uuid} "${zoneroot}/tmp/vm.log.${idx}"
    done

    # After all the *old* logs, rotate the latest one
    rotate_log ${vm_uuid} "${zoneroot}/tmp/vm.log"
    log "Done rotating logs in ${zoneroot}/tmp."
}

function usage()
{
    if [[ -n $1 ]]; then
        echo $* >&2
    fi

    cat >&2 <<EOF
Usage: $0 [<KVM VM UUID>]
EOF
    exit 2
}

VM_UUID=$1

[[ -n $2 ]] && usage "Too many arguments (expected 0-1)."
[[ ${VM_UUID} == "-?" || ${VM_UUID} == "-h" ]] && usage

if [[ ! -d ${DEST_DIR} ]]; then
    mkdir -p ${DEST_DIR}
fi

if [[ -n ${VM_UUID} ]]; then
    uuid=$(vmadm lookup -1 uuid=${VM_UUID} brand=kvm 2>/dev/null || /bin/true)
    if [[ ${uuid} == ${VM_UUID} ]]; then
        rotate_vm_logs ${VM_UUID}
    else
        usage "FATAL: \"${VM_UUID}\" does not seem to be a KVM VM."
    fi
else
    for vm in $(vmadm lookup brand=kvm); do
        rotate_vm_logs ${vm}
    done
fi

exit 0
