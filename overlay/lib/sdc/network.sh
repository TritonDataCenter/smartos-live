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

    let netip=0x$(printf "%02X%02X%02X%02X" $1 $2 $3 $4)
    bits=32
    while [ $((${netip} & 1 )) == 0 ] ; do
        netip=$((${netip} >> 1))
        bits=$((${bits} - 1))
    done

    echo "$a.$b.$c.$d/$bits"
}


# Creates a bridge on the external interface (to put the external interface in
# promiscuous mode), and sets COAL_EXTERNAL_BRIDGE_CREATED to indicate success
# requires load_sdc_sysinfo (from config.sh) to have been run first
function create_vmware_external_bridge {
    if [[ -z "${COAL_EXTERNAL_BRIDGE_CREATED}" ]] && [[ ${SYSINFO_Product} == "VMware Virtual Platform" ]]; then
        dladm create-bridge -l ${SYSINFO_NIC_external} vmwareextbr
        COAL_EXTERNAL_BRIDGE_CREATED=true
    fi
}


# Gets the static IP for a vnic + zone pair (from their config files)
function get_static_ip_for_vnic {
    zone=$1
    vnic=$2
    vnic_file="/zones/${zone}/root/etc/hostname.${vnic}"
    if [ -e ${vnic_file} ]; then
        cat ${vnic_file} | nawk '{ print $1 }' | /usr/xpg4/bin/egrep "[[:digit:]]{1,3}\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}\.[[:digit:]]{1,3}"
    fi
}

# Enable antispoof options for the given vnic and zone pair:
# - IP
# - MAC
# - DHCP
# - Restrict IPs to the zone's static IPs (if it has a static IP)
# (Only the MAC option is enabled for the dhcpd zone)
function enable_antispoof_for_vnic {
    zone=$1
    vnic=$2
    antispoof_opts="ip-nospoof,mac-nospoof,restricted,dhcp-nospoof"
    if [[ "${zone}" == "dhcpd" ]]; then
        antispoof_opts="mac-nospoof"
    fi
    dladm set-linkprop -p "protection=${antispoof_opts}" ${vnic}
    zone_ip=$(get_static_ip_for_vnic ${zone} ${vnic})
    if [[ -n "${zone_ip}" ]]; then
        dladm set-linkprop -p "allowed-ips=${zone_ip}" ${vnic}
    fi
}
