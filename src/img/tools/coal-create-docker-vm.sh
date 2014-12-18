#!/bin/bash
#
# Play script to create a docker VM from an imported docker image.
#
# tl;dr: Only runs in COAL. Attempts to pick 'alias' and 'ip' for you. Runs
# with 'docker:cmd' set to '/bin/sleep 3600', so the VM will stop after an
# hour.
#
#
# Usage:
#   /usr/img/tools/coal-create-docker-vm.sh IMAGE_UUID [ALIAS]
#
#
# First import a docker image, e.g. the latest busybox image:
#
#   imgadm sources --add-docker-hub
#   imgadm sources -v   # should show a docker source
#   imgadm import busybox
#
# At the time of writing, this latest busybox image uuid is as follows.
# (Granted having to use UUIDs is inconvenient. Hopefully we can improve that
# later.)
#
#   e72ac664-f4f0-c6a0-61ac-4ef332557a70
#
# Now create a docker VM with this image:
#
#   /usr/img/tools/coal-create-docker-vm.sh e72ac664-f4f0-c6a0-61ac-4ef332557a70 bb0
#
# TODO: get this closer and closer to a 'docker run'-alike
#

if [[ -n "$TRACE" ]]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail


#---- support routines

function fatal
{
    echo "$0: fatal error: $*"
    exit 1
}



#---- mainline

is_coal=$(bash /lib/sdc/config.sh -json | json coal)
[[ $is_coal == "true" ]] || fatal "this script will only run on COAL"


image_uuid=$1
[[ -n "$image_uuid" ]] || fatal "no IMAGE_UUID arg given"

image_name=$(imgadm get $image_uuid | json manifest.name)
image_version=$(imgadm get $image_uuid | json manifest.version)
echo "image_uuid: $image_uuid ($image_name@$image_version)"

alias=$2
if [[ -z "$alias" ]]; then
    existing_aliases=$(vmadm lookup -j | json -a alias)
    i=0
    while [[ $i -lt 10 ]]; do
        alias=$image_name-vm$i
        if [[ -z "$(echo "$existing_aliases" | (grep $alias || true))" ]]; then
            break
        fi
        i=$(( $i + 1 ))
    done
    [[ $i -lt 10 ]] || fatal "could not find a free alias"
fi
echo "alias: $alias"

existing_external_ips=$(vmadm lookup -j | json -a nics | json -g -c 'this.nic_tag === "external"' -a ip)
i=0
while [[ $i -lt 100 ]]; do
    ip=10.88.88.1$(printf "%02d" $i)
    if [[ -z "$(echo "$existing_external_ips" | (grep $ip || true))" ]]; then
        break
    fi
    i=$(( $i + 1 ))
done
[[ $i -lt 100 ]] || fatal "could not find a free ip in 10.88.88.1xx range"
echo "ip: $ip"


payload=$(cat <<EOM
{
    "alias": "$alias",
    "image_uuid": "$image_uuid",
    "nics": [
        {
            "interface": "net0",
            "nic_tag": "external",
            "gateway": "10.88.88.2",
            "netmask": "255.255.255.0",
            "primary": true,
            "ip": "$ip"
        }
    ],

    "brand": "lx",
    "kernel_version": "3.13.0",
    "docker": true,
    "cpu_shares": 1000,
    "zfs_io_priority": 1000,
    "max_lwps": 2000,
    "max_physical_memory": 8192,
    "max_locked_memory": 8192,
    "max_swap": 16384,
    "cpu_cap": 1000,
    "tmpfs": 16384,
    "maintain_resolvers": true,
    "resolvers": [
        "8.8.8.8",
        "8.8.4.4"
    ],
    "internal_metadata": {
        "docker:cmd": "[\"/bin/sleep\", \"3600\"]"
    },
    "quota": 100
}
EOM
)

echo "payload: $payload"
echo "$payload" | vmadm create
