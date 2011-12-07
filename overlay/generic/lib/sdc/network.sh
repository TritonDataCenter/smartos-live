#!/usr/bin/bash
#
# network-related functions (intended to be sourced from other scripts)
#
# Copyright (c) 2010 Joyent Inc., All rights reserved.
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
