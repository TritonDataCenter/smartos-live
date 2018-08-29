#!/usr/bin/bash
#
# network-related functions (intended to be sourced from other scripts)
#
# Copyright (c) 2018 Joyent Inc., All rights reserved.
#


# Converts an IP and netmask to CIDR notation, eg:
# 10.99.99.7 + 255.255.255.0 -> 10.99.99.0/24
function ip_netmask_to_cidr {
    IP=$1
    NETMASK=$2

    OLDIFS=$IFS
    IFS=.
    set -- $IP
    a=$1
    b=$2
    c=$3
    d=$4
    set -- $NETMASK
    a=$(($a & $1))
    b=$(($b & $2))
    c=$(($c & $3))
    d=$(($d & $4))
    IFS=$OLDIFS

    typeset -i netip=0x$(printf "%02X%02X%02X%02X" $1 $2 $3 $4)
    bits=32
    while [ $((${netip} & 1 )) == 0 ] ; do
        netip=$((${netip} >> 1))
        bits=$((${bits} - 1))
    done

    echo "$a.$b.$c.$d/$bits"
}

# Check if two IPv4 addresses reside on the same network (as determined by
# a given netmask.  Typically one of the two IPs are a network address, e.g.
# ip_in_net 192.168.1.0 192.168.1.42 255.255.255.0, however there is no
# requirement that this is the case.
function ip_in_net {
    typeset ip1=(${1//\./ })
    typeset ip2=(${2//\./ })
    typeset mask=(${3//\./ })
    typeset -i x y i=0

    while (( i < ${#ip1[@]} )); do
        ((x = ip1[i] & mask[i]))
        ((y = ip2[i] & mask[i]))
        if (( x != y )); then
            return 1
        fi
        ((i++))
    done

    return 0
}

function log_if_state
{
    echo "== debug start: $1 =="
    if ! nictagadm list; then
        echo "WARNING: 'nictagadm list' failed" 2>&2
    fi
    if ! /usr/sbin/dladm show-phys; then
        echo "WARNING: 'dladm show-phys' failed" >&2
    fi
    # NOTE: DO NOT do a 'dladm show-linkprop' when using the bnx driver,
    # as it puts it into an unusable state!
    if ! /sbin/ifconfig -a; then
        echo "WARNING: 'ifconfig -a' failed" >&2
    fi
    if ! /usr/bin/netstat -rcn; then
        echo "WARNING: 'netstat -rcn' failed" >&2
    fi
    echo "== debug end: $1 =="
}

function get_link_state
{
    set -o xtrace
    link_state=$(/usr/sbin/dladm show-phys -po state "$1" 2>/dev/null)
}

function wait_for_nic_state
{
    set -o xtrace
    typeset interface="$1"
    typeset state="$2"
    typeset -i i=0

    echo "wait_for_nic_state: waiting for state '$state'"
    get_link_state $interface
    while [[ "$link_state" != "$state" ]] && [[ $i -ne 10 ]]; do
        sleep 1
        echo "  $i: link_state=$link_state"
        ((i++))
        get_link_state $interface
    done
    echo "wait_for_nic_state: finished in state '$link_state'"
}

function valid_mac
{
    typeset re='^([0-9a-fA-F]{1,2}:){5}[0-9a-fA-F]{1,2}$'
    [[ "$1" =~ $re ]]
}

function normalize_mac
{
    typeset mac="$1"
    typeset new octet colon
    typeset -A arr

    IFS=: read -rA arr <<< "$mac"

    for octet in "${arr[@]}"; do
        new=$(printf "%s%s%02x" "$new" "$colon" "0x${octet}")
        colon=":"
    done

    echo "$new"
}
