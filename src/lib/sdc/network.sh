#!/usr/bin/bash
#
# network-related functions (intended to be sourced from other scripts)
#
# Copyright 2019 Joyent, Inc.
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

function valid_ipv4 {
    typeset ip=(${1//\./ })
    typeset ip_type="$2"
    typeset -i i=0

    if (( ${#ip[@]} != 4 )); then
        echo "ERROR: IPv4 ${ip_type} '$1' does not have four octets" >&2
        return 1
    fi

    while (( i < 4 )); do
        if [[ ${ip[$i]} != +([0-9]) ]]; then
            echo "ERROR: IPv4 ${ip_type} '$1' contains a non-numeric octet" \
                "(${ip[$i]})" >&2
            return 1
        fi
        if (( ip[i] > 255 )); then
            echo "ERROR: IPv4 ${ip_type} '$1' contains an octet value > 255" \
                "(${ip[$i]})" >&2
            return 1
        fi
        (( i++ ))
    done

    return 0
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

    valid_ipv4 "$1" address && valid_ipv4 "$2" address && \
        valid_ipv4 "$3" netmask || return 1

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
    /usr/sbin/dladm show-phys -po state "$1" 2>/dev/null
}

function wait_for_nic_state
{
    typeset interface="$1"
    typeset state="$2"
    typeset current_state
    typeset -i i=1

    echo "wait_for_nic_state: waiting for state '$state'"
    while (( i <= 10 )); do
        current_state="$(get_link_state $interface)"
        [[ "$current_state" == "$state" ]] && break
        echo "  $i: link_state=$current_state"
        sleep 1
        (( i++ ))
    done
    echo "wait_for_nic_state: finished in state '$current_state'"
}

function valid_mac
{
    typeset re='^([0-9a-fA-F]{1,2}:){5}[0-9a-fA-F]{1,2}$'
    [[ "$1" =~ $re ]]
}

function normalize_mac
{
    typeset mac="$1"

    # Note that we want to expand $mac out into multiple parameters
    # so that printf has enough arguments for the format string.
    # It is assumed that valid_mac() has been called on $mac prior
    # to calling normalize_mac()
    printf '%02x:%02x:%02x:%02x:%02x:%02x\n' 0x${mac//:/ 0x}
}

function valid_mtu
{
    set -o xtrace
    typeset tag mtu

    tag="$1"
    mtu="$2"

    if ! [[ $mtu =~ [1-9][0-9][0-9][0-9] ]] ; then
        echo "Invalid mtu specified for tag $tag: $mtu"
        echo "Valid MTU range is from 1500-9000"
        exit $SMF_EXIT_ERR_FATAL
    fi

    if ((mtu > 9000 || $mtu < 1500 )); then
        echo "Invalid mtu specified for tag $tag: $mtu"
        echo "Valid MTU range is from 1500-9000"
        exit $SMF_EXIT_ERR_FATAL
    fi
}

# Plumbs the admin interface, and attempts to work around poorly-behaved
# drivers that can't handle plumb commands too quicky after one another
function plumb_admin
{
    set -o xtrace
    typeset admin_if="$1"
    typeset admin_mtu="${2:-1500}"
    typeset driver=${admin_if%%[0-9]*}

    if [[ "$(get_link_state "$admin_if")" == "down" ]]; then
        echo "admin nic '$admin_if' is down: unplumbing"
        /sbin/ifconfig "$admin_if" down unplumb
        wait_for_nic_state "$admin_if" unknown
    fi

    # There's some sort of race condition in the bnx driver: if the plumb
    # command comes too soon after the unplumb, the interface can come up
    # in a state where it never fires interrupts for link state changes.
    if [[ "$driver" == "bnx" ]]; then
        sleep 5
    fi
    /sbin/ifconfig "$admin_if" plumb mtu $admin_mtu
    wait_for_nic_state "$admin_if" "up"
}
