#!/usr/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

# XXX - TODO
# - if $ntp_hosts == "local", configure ntp for no external time source
# - try to figure out why ^C doesn't intr when running under SMF

PATH=/usr/sbin:/usr/bin
export PATH
. /lib/sdc/config.sh
load_sdc_sysinfo
load_sdc_config

# Defaults
datacenter_headnode_id=0
mail_to="root@localhost"
ntp_hosts="0.smartos.pool.ntp.org"
dns_resolver1="8.8.8.8"
dns_resolver2="8.8.4.4"

# Globals
declare -a states
declare -a nics
declare -a assigned
declare -a DISK_LIST

sigexit()
{
	echo
	echo "System configuration has not been completed."
	echo "You must reboot to re-run system configuration."
	exit 0
}

#
# Get the max. IP addr for the given field, based in the netmask.
# That is, if netmask is 255, then its just the input field, otherwise its
# the host portion of the netmask (e.g. netmask 224 -> 31).
# Param 1 is the field and param 2 the mask for that field.
#
max_fld()
{
	if [ $2 -eq 255 ]; then
		fmax=$1
	else
		fmax=$((255 & ~$2))
	fi
}

#
# Converts an IP and netmask to a network
# For example: 10.99.99.7 + 255.255.255.0 -> 10.99.99.0
# Each field is in the net_a, net_b, net_c and net_d variables.
# Also, host_addr stores the address of the host w/o the network number (e.g.
# 7 in the 10.99.99.7 example above).  Also, max_host stores the max. host
# number (e.g. 10.99.99.254 in the example above).
#
ip_netmask_to_network()
{
	IP=$1
	NETMASK=$2

	OLDIFS=$IFS
	IFS=.
	set -- $IP
	net_a=$1
	net_b=$2
	net_c=$3
	net_d=$4
	addr_d=$net_d

	set -- $NETMASK

	# Calculate the maximum host address
	max_fld "$net_a" "$1"
	max_a=$fmax
	max_fld "$net_b" "$2"
	max_b=$fmax
	max_fld "$net_c" "$3"
	max_c=$fmax
	max_fld "$net_d" "$4"
	max_d=$(expr $fmax - 1)
	max_host="$max_a.$max_b.$max_c.$max_d"

	net_a=$(($net_a & $1))
	net_b=$(($net_b & $2))
	net_c=$(($net_c & $3))
	net_d=$(($net_d & $4))

	host_addr=$(($addr_d & ~$4))
	IFS=$OLDIFS
}

# Tests whether entire string is a number.
isdigit ()
{
	[ $# -eq 1 ] || return 1

	case $1 in
  	*[!0-9]*|"") return 1;;
	*) return 0;;
	esac
}

# Tests network numner (num.num.num.num)
is_net()
{
	NET=$1

	OLDIFS=$IFS
	IFS=.
	set -- $NET
	a=$1
	b=$2
	c=$3
	d=$4
	IFS=$OLDIFS

	isdigit "$a" || return 1
	isdigit "$b" || return 1
	isdigit "$c" || return 1
	isdigit "$d" || return 1

	[ -z $a ] && return 1
	[ -z $b ] && return 1
	[ -z $c ] && return 1
	[ -z $d ] && return 1

	[ $a -lt 0 ] && return 1
	[ $a -gt 255 ] && return 1
	[ $b -lt 0 ] && return 1
	[ $b -gt 255 ] && return 1
	[ $c -lt 0 ] && return 1
	[ $c -gt 255 ] && return 1
	[ $d -lt 0 ] && return 1
	# Make sure the last field isn't the broadcast addr.
	[ $d -ge 255 ] && return 1
	return 0
}

# Optional input
promptopt()
{
	val=
	printf "%s [press enter for none]: " "$1"
	read val
}

promptval()
{
	val=""
	def="$2"
	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			printf "%s [%s]: " "$1" "$def"
		else
			printf "%s: " "$1"
		fi
		read val
		[ -z "$val" ] && val="$def"
		[ -n "$val" ] && break
		echo "A value must be provided."
	done
}

# Input must be a valid network number (see is_net())
promptnet()
{
	val=""
	def="$2"
	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			printf "%s [%s]: " "$1" "$def"
		else
			printf "%s: " "$1"
		fi
		read val
		[ -z "$val" ] && val="$def"
    if [[ "$val" != "dhcp" ]]; then
		  is_net "$val" || val=""
    fi
		[ -n "$val" ] && break
		echo "A valid network number (n.n.n.n) or 'dhcp' must be provided."
	done
}

printnics()
{
	i=1
	printf "%-6s %-9s %-18s %-7s %-10s\n" "Number" "Link" "MAC Address" \
	    "State" "Network"
	while [ $i -le $nic_cnt ]; do
		printf "%-6d %-9s %-18s %-7s %-10s\n" $i ${nics[$i]} \
		    ${macs[$i]} ${states[$i]} ${assigned[i]}
		((i++))
	done
}

# Must choose a valid NIC on this system
promptnic()
{
	if [[ $nic_cnt -eq 1 ]]; then
		val="${macs[1]}"
		return
	fi

	printnics
	num=0
	while [ /usr/bin/true ]; do
		printf "Enter the number of the NIC for the %s interface: " \
		   "$1"
		read num
		if ! [[ "$num" =~ ^[0-9]+$ ]] ; then
			echo ""
		elif [ $num -ge 1 -a $num -le $nic_cnt ]; then
			mac_addr="${macs[$num]}"
			assigned[$num]=$1
			break
		fi
		# echo "You must choose between 1 and $nic_cnt."
		updatenicstates
		printnics
	done

	val=$mac_addr
}

promptpw()
{
	while [ /usr/bin/true ]; do
		val=""
		while [ -z "$val" ]; do
			printf "%s: " "$1"
			stty -echo
			read val
			stty echo
			echo
			if [ -n "$val" ]; then
				if [ "$2" == "chklen" -a ${#val} -lt 6 ]; then
					echo "The password must be at least" \
					    "6 characters long."
					val=""
				else
	 				break
				fi
			else
				echo "A value must be provided."
			fi
		done

		cval=""
		while [ -z "$cval" ]; do
			printf "%s: " "Confirm password"
			stty -echo
			read cval
			stty echo
			echo
			[ -n "$cval" ] && break
			echo "A value must be provided."
		done

		[ "$val" == "$cval" ] && break

		echo "The entries do not match, please re-enter."
	done
}

promptpool()
{
  disks=$(disklist -n)
  while [[ /usr/bin/true ]]; do
    echo "Please select disks for the storage pool, space separated"
    echo ""
    printf "Valid choices are ${disks}"
    echo ""
    bad=""
    read val
    if [[ $val == "" ]]; then
      echo "At least one disk must be specified"
      echo ""
      continue
    fi
    for disk in $(echo $val | tr " " "\n"); do
      if [[ -z $disk ]]; then continue; fi;
      echo $disks | grep $disk 1>&2 > /dev/null
      if [[ $? != 0 ]]; then
        bad="$disk $bad"
      fi
    done
    if [[ $bad != "" ]]; then
      printf "The disks %s are not valid choices" $bad
    else
      DISK_LIST="$val"
      break
    fi
  done

}

create_dump()
{
    # Get avail zpool size - this assumes we're not using any space yet.
    base_size=`zfs get -H -p -o value available ${SYS_ZPOOL}`
    # Convert to MB
    base_size=`expr $base_size / 1000000`
    # Calculate 5% of that
    base_size=`expr $base_size / 20`
    # Cap it at 4GB
    [ ${base_size} -gt 4096 ] && base_size=4096

    # Create the dump zvol
    zfs create -V ${base_size}mb ${SYS_ZPOOL}/dump || \
      fatal "failed to create the dump zvol"
    dumpadm -d /dev/zvol/dsk/${SYS_ZPOOL}/dump
}

#
# Setup the persistent datasets on the zpool.
#
setup_datasets()
{
  datasets=$(zfs list -H -o name | xargs)

  if ! echo $datasets | grep dump > /dev/null; then
    printf "%-56s" "Making dump zvol... "
    create_dump
    printf "%4s\n" "done"
  fi

  if ! echo $datasets | grep ${CONFDS} > /dev/null; then
    printf "%-56s" "Initializing config dataset for zones... "
    zfs create ${CONFDS} || fatal "failed to create the config dataset"
    chmod 755 /${CONFDS}
    cp -p /etc/zones/* /${CONFDS}
    zfs set mountpoint=legacy ${CONFDS}
    printf "%4s\n" "done"
  fi

  if ! echo $datasets | grep ${USBKEYDS} > /dev/null; then
    if [[ -n $(/bin/bootparams | grep "^smartos=true") ]]; then
        printf "%-56s" "Creating config dataset... "
        zfs create -o mountpoint=legacy ${USBKEYDS} || \
          fatal "failed to create the config dataset"
        mkdir /usbkey
        mount -F zfs ${USBKEYDS} /usbkey
        printf "%4s\n" "done"
    fi
  fi

  if ! echo $datasets | grep ${COREDS} > /dev/null; then
    printf "%-56s" "Creating global cores dataset... "
    zfs create -o quota=10g -o mountpoint=/${SYS_ZPOOL}/global/cores \
        -o compression=gzip ${COREDS} || \
        fatal "failed to create the cores dataset"
    printf "%4s\n" "done"
  fi

  if ! echo $datasets | grep ${OPTDS} > /dev/null; then
    printf "%-56s" "Creating opt dataset... "
    zfs create -o mountpoint=legacy ${OPTDS} || \
      fatal "failed to create the opt dataset"
    printf "%4s\n" "done"
  fi

  if ! echo $datasets | grep ${VARDS} > /dev/null; then
    printf "%-56s" "Initializing var dataset... "
    zfs create ${VARDS} || \
      fatal "failed to create the var dataset"
    chmod 755 /${VARDS}
    cd /var
    if ( ! find . -print | cpio -pdm /${VARDS} 2>/dev/null ); then
        fatal "failed to initialize the var directory"
    fi

    zfs set mountpoint=legacy ${VARDS}

    if ! echo $datasets | grep ${SWAPVOL} > /dev/null; then
          printf "%-56s" "Creating swap zvol... "
          #
          # We cannot allow the swap size to be less than the size of DRAM, lest$
          # we run into the availrmem double accounting issue for locked$
          # anonymous memory that is backed by in-memory swap (which will$
          # severely and artificially limit VM tenancy).  We will therfore not$
          # create a swap device smaller than DRAM -- but we still allow for the$
          # configuration variable to account for actual consumed space by using$
          # it to set the refreservation on the swap volume if/when the$
          # specified size is smaller than DRAM.$
          #
          size=${SYSINFO_MiB_of_Memory}
          zfs create -V ${size}mb ${SWAPVOL}
          swap -a /dev/zvol/dsk/${SWAPVOL}
    fi
    printf "%4s\n" "done"
  fi
}


create_zpool()
{
    disks=$1
    pool=zones

    # If the pool already exists, don't create it again.
    if /usr/sbin/zpool list -H -o name $pool >/dev/null 2>&1; then
        return 0
    fi

    disk_count=$(echo "${disks}" | wc -w | tr -d ' ')
    printf "%-56s" "Creating pool $pool... "

    # If no pool profile was provided, use a default based on the number of
    # devices in that pool.
    if [[ -z ${profile} ]]; then
        case ${disk_count} in
        0)
             fatal "no disks found, can't create zpool";;
        1)
             profile="";;
        2)
             profile=mirror;;
        *)
             profile=raidz;;
        esac
    fi

    zpool_args=""

    # When creating a mirrored pool, create a mirrored pair of devices out of
    # every two disks.
    if [[ ${profile} == "mirror" ]]; then
        ii=0
        for disk in ${disks}; do
            if [[ $(( $ii % 2 )) -eq 0 ]]; then
                  zpool_args="${zpool_args} ${profile}"
            fi
            zpool_args="${zpool_args} ${disk}"
            ii=$(($ii + 1))
        done
    else
        zpool_args="${profile} ${disks}"
    fi

    zpool create -f ${pool} ${zpool_args} || \
        fatal "failed to create pool ${pool}"
    zfs set atime=off ${pool} || \
        fatal "failed to set atime=off for pool ${pool}"

    printf "%4s\n" "done"
}
create_zpools()
{
  devs=$1

  export SYS_ZPOOL="zones"
  create_zpool "$devs"
  sleep 5

  svccfg -s svc:/system/smartdc/init setprop config/zpool="zones"
  svccfg -s svc:/system/smartdc/init:default refresh

  export CONFDS=${SYS_ZPOOL}/config
  export COREDS=${SYS_ZPOOL}/cores
  export OPTDS=${SYS_ZPOOL}/opt
  export VARDS=${SYS_ZPOOL}/var
  export USBKEYDS=${SYS_ZPOOL}/usbkey
  export SWAPVOL=${SYS_ZPOOL}/swap

  setup_datasets
  #
  # Since there may be more than one storage pool on the system, put a
  # file with a certain name in the actual "system" pool.
  #
  touch /${SYS_ZPOOL}/.system_pool
}
updatenicstates()
{
	states=(1)
	#states[0]=1
	while IFS=: read -r link state ; do
		states=( ${states[@]-} $(echo "$state") )
	done < <(dladm show-phys -po link,state 2>/dev/null)
}

printheader()
{
  local newline=
  local cols=`tput cols`
  local subheader=$1

  if [ $cols -gt 80 ] ;then
    newline='\n'
  fi

  clear
  for i in {1..80} ; do printf "-" ; done && printf "$newline"
  printf " %-40s\n" "SmartOS Setup"
  printf " %-40s%38s\n" "$subheader" "http://wiki.smartos.org/install"
  for i in {1..80} ; do printf "-" ; done && printf "$newline"

}

trap sigexit SIGINT

#
# Get local NIC info
#
nic_cnt=0

while IFS=: read -r link addr ; do
    ((nic_cnt++))
    nics[$nic_cnt]=$link
    macs[$nic_cnt]=`echo $addr | sed 's/\\\:/:/g'`
    assigned[$nic_cnt]="-"
done < <(dladm show-phys -pmo link,address 2>/dev/null)

if [[ $nic_cnt -lt 1 ]]; then
	echo "ERROR: cannot configure the system, no NICs were found."
	exit 0
fi

ifconfig -a plumb
updatenicstates

export TERM=sun-color
export TERM=xterm-color
stty erase ^H

printheader "Copyright 2011, Joyent, Inc."

message="
You must answer the following questions to configure the system.
You will have a chance to review and correct your answers, as well as a
chance to edit the final configuration, before it is applied.

Would you like to continue with configuration? [Y/n]"

printf "$message"
read continue;
if [[ $continue == 'n' ]]; then
	exit 0
fi
#
# Main loop to prompt for user input
#
while [ /usr/bin/true ]; do

	printheader "Networking"

	promptnic "'admin'"
	admin_nic="$val"

	promptnet "IP address (or 'dhcp' )" "$admin_ip"
	admin_ip="$val"
  if [[ $admin_ip != 'dhcp' ]]; then
    promptnet "netmask" "$admin_netmask"
    admin_netmask="$val"

    ip_netmask_to_network $admin_ip $admin_netmask
    admin_network="$net_a.$net_b.$net_c.$net_d"

    printheader "Networking - Continued"
    message=""

    printf "$message"

    message="
  The default gateway will determine which network will be used to connect to
  other networks.\n\n"

    printf "$message"

    promptnet "Enter the default gateway IP" "$headnode_default_gateway"
    headnode_default_gateway="$val"

    promptval "Enter the Primary DNS server IP" "$dns_resolver1"
    dns_resolver1="$val"
    promptval "Enter the Secondary DNS server IP" "$dns_resolver2"
    dns_resolver2="$val"
    promptval "Enter the domain name" "$domainname"
    domainname="$val"
    promptval "Default DNS search domain" "$dns_domain"
    dns_domain="$val"
  fi
	printheader "Storage"
	promptpool

	printheader "Account Information"

	promptpw "Enter root password" "nolen"
	root_shadow="$val"

	printheader "Verify Configuration"
	message=""

	printf "$message"

	echo "Verify that the following values are correct:"
	echo
	echo "MAC address: $admin_nic"
	echo "IP address: $admin_ip"
  if [[ $admin_ip != 'dhcp' ]]; then
    echo "Netmask: $admin_netmask"
    echo "Gateway router IP address: $headnode_default_gateway"
    echo "DNS servers: $dns_resolver1,$dns_resolver2"
    echo "Default DNS search domain: $dns_domain"
    echo "NTP server: $ntp_hosts"
	  echo "Domain name: $domainname"
    echo
  fi
	promptval "Is this correct?" "y"
	[ "$val" == "y" ] && break
	clear
done

#
# Generate config file
#
tmp_config=/tmp_config
touch $tmp_config
chmod 600 $tmp_config

echo "#" >$tmp_config
echo "# This file was auto-generated and must be source-able by bash." \
    >>$tmp_config
echo "#" >>$tmp_config
echo >>$tmp_config

# If in a VM, setup coal so networking will work.
platform=$(smbios -t1 | nawk '{if ($1 == "Product:") print $2}')
[ "$platform" == "VMware" ] && echo "coal=true" >>$tmp_config


echo "# admin_nic is the nic admin_ip will be connected to for headnode zones."\
    >>$tmp_config
echo "admin_nic=$admin_nic" >>$tmp_config
echo "admin_ip=$admin_ip" >>$tmp_config
echo "admin_netmask=$admin_netmask" >>$tmp_config
echo "admin_network=$admin_network" >>$tmp_config
echo "admin_gateway=$admin_ip" >>$tmp_config
echo >>$tmp_config

echo "headnode_default_gateway=$headnode_default_gateway" >>$tmp_config
echo >>$tmp_config

echo "dns_resolvers=$dns_resolver1,$dns_resolver2" >>$tmp_config
echo "dns_domain=$dns_domain" >>$tmp_config
echo >>$tmp_config


echo "ntp_hosts=$ntp_hosts" >>$tmp_config

echo "compute_node_ntp_hosts=$admin_ip" >>$tmp_config
echo >>$tmp_config

echo
echo "Your configuration is about to be applied."
promptval "Would you like to edit the final configuration file?" "n"
[ "$val" == "y" ] && vi $tmp_config
clear

echo
echo "Your data pool will be created with the following disks:"
echo $DISK_LIST
echo "*********************************************"
echo "* This will erase *ALL DATA* on these disks *"
echo "*********************************************"
promptval "are you sure?" "n"
[ "$val" == "y" ] && (create_zpools "$DISK_LIST")

clear
echo "The system will now finish configuration and reboot. Please wait..."
mv $tmp_config /usbkey/config

# set the root password
root_shadow=$(/usr/lib/cryptpass "$root_shadow")
sed -e "s|^root:[^\:]*:|root:${root_shadow}:|" /etc/shadow > /usbkey/shadow \
      && chmod 400 /usbkey/shadow

cp -rp /etc/ssh /usbkey/ssh

reboot

