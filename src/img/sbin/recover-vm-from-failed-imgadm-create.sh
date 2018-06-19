#!/usr/bin/bash

#
# Copyright (c) 2018, Joyent, Inc.
#

#
# Recover a VM from a crashed 'imgadm create ...'.
#
# If 'imgadm create ...' *crashes*, it will fail to run likely necessary cleanup
# on the VM, e.g. rolling back to its "@imgadm-create-pre-prepare" snapshot,
# etc.
#
# This recovery script is an attempted reproduction of the relevant parts of
# IMGADM.prototype.createImage cleanup at:
#    https://github.com/joyent/smartos-live/blob/71a0dd0b0eade2e8a61d1d78c8a16fe9d899c3f7/src/img/lib/imgadm.js#L3958-L4063
#
# WARNING: The "attempted reproduction" is not perfect. We are rolling back
# customer VM snapshots and deleting snapshots, and rebooting the VM here!
# Use with care.
#
# Dev Notes:
# -
# - The comment names are the function names from 'imgadm.createImage's cleanup
#   pipeline. TODO:coderef
# - Assumption: the imgadm create process is no longer running.
#

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail

function fatal
{
    echo "$0: fatal error: $*" >&2
    trap - EXIT
    exit 1
}

function errexit
{
    if [[ $1 -eq 0 ]]; then
        exit 0
    fi
    echo "$0: error exit status $1" >&2
}

function usage () {
    echo "Recover a broken VM from a crashed 'imgadm create ...'."
    echo "WARNING: This reboots and rolls back dataset. Use with care."
    echo ""
    echo "Usage:"
    echo "  /usr/img/sbin/recover-vm-from-failed-imgadm-create.sh [OPTIONS] VM-UUID"
    echo ""
    echo "Options:"
    echo "  -h      Print this help and exit."
    echo "  -n      Do a dry-run."
}


#---- mainline

trap 'errexit $?' EXIT

# Options.
opt_dryrun=no
while getopts "hn" opt
do
    case "$opt" in
        h)
            usage
            exit 0
            ;;
        n)
            opt_dryrun=yes
            ;;
        *)
            usage
            exit 1
            ;;
    esac
done
shift $((OPTIND-1))

dryRunMsg=""
if [[ $opt_dryrun != "no" ]]; then
   dryRunMsg=" (dry-run)"
fi


RECOVER_VM="$1"
[[ -n "$RECOVER_VM" ]] || fatal "missing VM-UUID argument"
vmInfo="$(vmadm get "$RECOVER_VM")"

# Sanity check that the VM is in that state.
rollbackSnap="zones/$RECOVER_VM@imgadm-create-pre-prepare"
zfs list -Ho name "$rollbackSnap" >/dev/null \
    || fatal "vm $RECOVER_VM is not in the expected failed state: cannot find $rollbackSnap snapshot"

vmBrand=$(echo "$vmInfo" | json brand)
if [[ "$vmBrand" != "joyent" && "$vmBrand" != "joyent-minimal" ]]; then
    fatal "do not yet support recovery of non-joyent brand zones: $vmBrand"
fi

echo '
imgadm create -c gzip -i \
    -s /zones/$(vmadm lookup -1 alias=imgapi0)/root/opt/smartdc/imgapi/tools/prepare-image/smartos-prepare-image \
    $(vmadm lookup -1 alias=ca0) name=imgtest version=1
' >/dev/null

echo "Recovering VM $RECOVER_VM ($(echo "$vmInfo" | json alias)) from a failed 'imgadm create'.$dryRunMsg"

# cleanupImageFile
#
# TODO: Could accept a PID option for this. However, other than wasted disk
# in /var/tmp, it doesn't hurt to leave these files around.
#    if [[ -n "$IMGADM_FAILED_PID" ]]; then
#        ls -l /var/tmp/.imgadm-create-*-$IMGADM_FAILED_PID.*
#        rm /var/tmp/.imgadm-create-*-$IMGADM_FAILED_PID.*
#    fi

# cleanupFinalSnapshot
finalSnap=zones/$RECOVER_VM@final
if [[ $(zfs get -Ho value type "$finalSnap" 2>/dev/null) == "snapshot" ]]; then
    echo "Destroying '@final' snapshot: $finalSnap.$dryRunMsg"
    if [[ "$opt_dryrun" == "no" ]]; then
        zfs destroy "$finalSnap"
    fi
fi


# cleanupAutoprepSnapshots
#
# Restoring the VM dataset(s) to their previous state in 3 parts:
# 1. ensure the VM is stopped (it is surprising if it isn't)
# 2. rollback all the zfs filesystems
# 3. destroy the snaps
echo "Stopping VM.$dryRunMsg"
if [[ "$opt_dryrun" == "no" ]]; then
    vmadm stop "$RECOVER_VM"
fi
# TODO: support KVM and BHYVE brands (see 'autoprepSnapshotDatasets')
echo "Rolling back to $rollbackSnap snapshot.$dryRunMsg"
if [[ "$opt_dryrun" == "no" ]]; then
    zfs rollback "zones/$RECOVER_VM@imgadm-create-pre-prepare"
    zfs destroy "zones/$RECOVER_VM@imgadm-create-pre-prepare"
fi

# Validate that operator-script and "prepare-image:*" are gone.
if [[ "$opt_dryrun" == "no" ]]; then
    vmInfoAfter=$(vmadm get "$RECOVER_VM")
    if [[ -n "$(echo "$vmInfoAfter" | json internal_metadata.operator-script)" ]]; then
        fatal "operator-script is still defined on the VM after rollback"
    fi
    if [[ -n "$(echo "$vmInfoAfter" | json customer_metadata.prepare-image:status)" ]]; then
        fatal "'prepare-image:status' still defined on the VM after rollback"
    fi
    if [[ -n "$(echo "$vmInfoAfter" | json customer_metadata.prepare-image:error)" ]]; then
        fatal "'prepare-image:error' still defined on the VM after rollback"
    fi
fi

echo "Re-starting VM.$dryRunMsg"
if [[ "$opt_dryrun" == "no" ]]; then
    vmadm start "$RECOVER_VM"
fi

echo "Successfully recovered VM $RECOVER_VM.$dryRunMsg"
