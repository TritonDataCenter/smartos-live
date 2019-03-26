#!/usr/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2019 Joyent, Inc.
#

# XXX - TODO
# - if $ntp_hosts == "local", configure ntp for no external time source

exec 4>>/var/log/prompt-config.log
echo "=== Starting prompt-config on $(tty) at $(date) ===" >&4
export PS4='[\D{%FT%TZ}] $(tty): ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
export BASH_XTRACEFD=4
set -o xtrace

if [[ -z $(/bin/bootparams | grep "^smartos=true") ]]; then
	echo "This script should only be run on SmartOS"
	exit 1
fi

PATH=/usr/sbin:/usr/bin
export PATH

. /lib/svc/share/smf_include.sh

. /lib/sdc/config.sh
load_sdc_sysinfo
load_sdc_config

# ERRORS (for getanswer's errno)
ENOTFOUND=1
EBADJSON=2
EUNKNOWN=3

# Defaults
mail_to="root@localhost"
ntp_hosts="0.smartos.pool.ntp.org"
dns_resolver1="8.8.8.8"
dns_resolver2="8.8.4.4"

# Globals
declare -a states
declare -a nics
declare -a assigned
declare prmpt_str

#
# Generate a horizontal ruler of appropriate length.  Doing this each time we
# emit a ruler appears to induce a surprisingly noticeable latency, so we just
# do it once.
#
ruler=
while (( ${#ruler} < 80 )); do
	ruler+='-'
done

#
# Determine whether we need a trailing newline after the horizontal ruler.  It
# would seem that most modern terminal emulators behave like the VT100: if the
# cursor has naturally progressed to the rightmost column _and_ the next
# character is a newline, the terminal will discard what is effectively a
# redundant newline.  Unfortunately, the framebuffer terminal emulator in
# illumos does not currently do this.  Attempt to guess if we are attached to a
# serial line or not, so as to decide whether we should send the extra newline.
#
console=$(bootparams | awk -F= '$1 == "console" { print $2 }')
if [[ $(/bin/tty) != '/dev/console' ]] || [[ $console =~ ^tty ]]; then
	ruler+='\n'
fi

nicsup_done=0

fatal()
{
	echo
	if [[ -n "$1" ]]; then
		echo "ERROR: $1"
	fi
	echo
	echo "System configuration failed, launching a shell."
	echo "You must reboot to re-run system configuration."
	echo "A log of setup may be found in /var/log/prompt-config.log"
	echo
	/usr/bin/bash
}


sig_doshell()
{
	echo
	echo
	echo "Bringing up a shell.  When you are done in the shell hit ^D to"
	echo "return to the system configuration tool."
	echo

	/usr/bin/bash

	echo
	echo "Resuming the system configuration tool."
	echo
	printf "$prmpt_str"
}

ip_to_num()
{
	IP=$1

	OLDIFS=$IFS
	IFS=.
	set -- $IP
	num_a=$(($1 << 24))
	num_b=$(($2 << 16))
	num_c=$(($3 << 8))
	num_d=$4
	IFS=$OLDIFS

	num=$((num_a + $num_b + $num_c + $num_d))
}

num_to_ip()
{
	NUM=$1

	fld_d=$(($NUM & 255))
	NUM=$(($NUM >> 8))
	fld_c=$(($NUM & 255))
	NUM=$(($NUM >> 8))
	fld_b=$(($NUM & 255))
	NUM=$(($NUM >> 8))
	fld_a=$NUM

	ip_addr="$fld_a.$fld_b.$fld_c.$fld_d"
}

#
# Converts an IP and netmask to their numeric representation.
# Sets the global variables IP_NUM, NET_NUM, NM_NUM and BCAST_ADDR to their
# respective numeric values.
#
ip_netmask_to_network()
{
	ip_to_num $1
	IP_NUM=$num

	ip_to_num $2
	NM_NUM=$num

	NET_NUM=$(($NM_NUM & $IP_NUM))

	ip_to_num "255.255.255.255"
	local bcasthost=$((~$NM_NUM & $num))
	BCAST_ADDR=$(($NET_NUM + $bcasthost))
}

# Sets two variables, USE_LO and USE_HI, which are the usable IP addrs for the
# largest block of available host addresses on the subnet, based on the two
# addrs the user has chosen for the GW and External Host IP.
# We look at the three ranges (upper, middle, lower) defined by the two addrs.
calc_ext_default_range()
{
	local a1=$1
	local a2=$2

	local lo=
	local hi=
	if [ $a1 -lt $a2 ]; then
		lo=$a1
		hi=$a2
	else
		lo=$a2
		hi=$a1
	fi

	u_start=$(($hi + 1))
	m_start=$(($lo + 1))
	l_start=$(($NET_NUM + 1))

	u_max=$(($BCAST_ADDR - 1))
	m_max=$(($hi - 1))
	l_max=$(($lo - 1))

	up_range=$(($u_max - $u_start))
	mid_range=$(($m_max - $m_start))
	lo_range=$(($l_max - $l_start))

	if [ $up_range -gt $mid_range ]; then
		USE_LO=$u_start
		USE_HI=$u_max
		range=$up_range
	else
		USE_LO=$m_start
		USE_HI=$m_max
		range=$mid_range
	fi

	if [ $range -lt $lo_range ]; then
		USE_LO=$l_start
		USE_HI=$l_max
	fi
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
	return 0
}

# Tests if input is an email address
is_email() {
	regex="^[a-z0-9!#\$%&'*+/=?^_\`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.?)+[a-z0-9]([a-z0-9-]*[a-z0-9])?\$"
	ADDRESS=$1

	[[ $ADDRESS =~ $regex ]] && return 0
	return 1
}

# You can call this like:
#
#  value=$(getanswer "foo")
#  [[ $? == 0 ]] || fatal "no answer for question foo"
#
getanswer()
{
	local key=$1
	local answer=""
	local potential=""

	if [[ -z ${answer_file} ]]; then
		return ${ENOTFOUND}
	fi

	# json does not distingush between an empty string and a key that's not
	# there with the normal output, so we fix that so we can distinguish.
	answer=$(/usr/bin/cat ${answer_file} \
		| /usr/bin/json -e "if (this['${key}'] === undefined) this['${key}'] = '<<undefined>>';" \
		"${key}" 2>&1)
	if [[ $? != 0 ]]; then
		if [[ -n $(echo "${answer}" | grep "input is not JSON") ]]; then
			return ${EBADJSON}
		else
			return ${EUNKNOWN}
		fi
	fi

	if [[ ${answer} == "<<undefined>>" ]]; then
		return ${ENOTFOUND}
	fi

	echo "${answer}"
	return 0
}

# Optional input
promptopt()
{
	val=""
	def="$2"
	key="$3"

	if [[ -n ${key} ]]; then
		val=$(getanswer "${key}")
		if [[ $? == 0 ]]; then
			if [[ ${val} == "<default>" ]]; then
				val=${def}
			fi
			return
		fi
	fi

	if [ -z "$def" ]; then
		prmpt_str="$1 [press enter for none]: "
	else
		prmpt_str="$1 [$def]: "
	fi
	printf "$prmpt_str"
	read val
	# If def was null and they hit return, we just assign null to val
	[ -z "$val" ] && val="$def"
}

promptval()
{
	val=""
	def="$2"
	key="$3"

	if [[ -n ${key} ]]; then
		val=$(getanswer "${key}")
		if [[ ${val} == "<default>" && -n ${def} ]]; then
			val=${def}
			return
		fi
	fi

	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			prmpt_str="$1 [$def]: "
		else
			prmpt_str="$1: "
		fi
		printf "$prmpt_str"
		read val
		[ -z "$val" ] && val="$def"
		# Forward and back quotes not allowed
		echo $val | nawk '{
		    if (index($0, "\047") != 0)
		        exit 1
		    if (index($0, "`") != 0)
		        exit 1
		}'
		if [ $? != 0 ]; then
			echo "Single quotes are not allowed."
			val=""
			continue
		fi
		[ -n "$val" ] && break
		echo "A value must be provided."
	done
}

prompt_host_ok_val()
{
	val=""
	def="$2"
	key="$3"

	if [[ -n ${key} ]]; then
		val=$(getanswer "${key}")
		if [[ ${val} == "<default>" && -n ${def} ]]; then
			val=${def}
		fi
	fi

	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			prmpt_str="$1 [$def]: "
		else
			prmpt_str="$1: "
		fi
		printf "$prmpt_str"
		read val
		[ -z "$val" ] && val="$def"
		if [ -n "$val" ]; then
			trap "" SIGINT
			printf "Checking connectivity..."
			ping $val >/dev/null 2>&1
			if [ $? != 0 ]; then
				printf "UNREACHABLE\n"
			else
				printf "OK\n"
			fi
			trap sig_doshell SIGINT
			break
		else
			echo "A value must be provided."
		fi
	done
}

promptemail()
{
	val=""
	def="$2"
	key="$3"

	if [[ -n ${key} ]]; then
		val=$(getanswer "${key}")
		if [[ ${val} == "<default>" && -n ${def} ]]; then
			val=${def}
			is_email "$val" || val=""
		elif [[ -n ${val} ]]; then
			is_email "$val" || val=""
		fi
	fi

	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			prmpt_str="$1 [$def]: "
		else
			prmpt_str="$1: "
		fi
		printf "$prmpt_str"
		read val
		[ -z "$val" ] && val="$def"
		is_email "$val" || val=""
		[ -n "$val" ] && break
		echo "A valid email address must be provided."
	done
}

# Input must be a valid network number (see is_net())
promptnet()
{
	val=""
	def="$2"
	key="$3"

	if [[ -n ${key} ]]; then
		val=$(getanswer "${key}")
		if [[ ${val} == "<default>" && -n ${def} ]]; then
			val=${def}
		fi
		if [[ ${val} != "none" && ${val} != "dhcp" ]]; then
			is_net "$val" || val=""
		fi
	fi

	while [ -z "$val" ]; do
		if [ -n "$def" ]; then
			prmpt_str="$1 [$def]: "
		else
			prmpt_str="$1: "
		fi
		printf "$prmpt_str"
		read val
		[ -z "$val" ] && val="$def"
		if [[ ${val} != "none" && ${val} != "dhcp" ]]; then
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
    tag=$(echo $1 | cut -d"'" -f2)
    if [[ -n ${tag} ]]; then
        mac=$(getanswer "${tag}_nic")
        if [[ -n ${mac} ]]; then
            for idx in ${!macs[*]}; do
                if [[ ${mac} == ${macs[${idx}]} ]]; then
                    mac_addr="${macs[${idx}]}"
                    val="${macs[${idx}]}"
                    nic_val="${nics[${idx}]}"
                    return
                fi
            done
        fi
    fi

    if [[ $nic_cnt -eq 1 ]]; then
        val="${macs[1]}"
        nic_val=${nics[1]}
        return
    fi

    printnics
    num=0
    while [ /usr/bin/true ]; do
        prmpt_str="Enter the number of the NIC for the $1 interface: "
        printf "$prmpt_str"
        read num
        if ! [[ "$num" =~ ^[0-9]+$ ]] ; then
                echo ""
        elif [ $num -ge 1 -a $num -le $nic_cnt ]; then
                mac_addr="${macs[$num]}"
                assigned[$num]=$1
                nic_val=${nics[$num]}
                break
        fi
        # echo "You must choose between 1 and $nic_cnt."
        updatenicstates
        printnics
    done

    val=$mac_addr
}

readpw()
{
	IFS='' read -r -s pw
	printf '%s' "$pw"
}

promptpw()
{
	def="$3"
	key="$4"

	if [[ -n ${key} ]]; then
		preset_val="$(getanswer "${key}")"
	fi

	trap "" SIGINT
	while [ /usr/bin/true ]; do
		val=""
		while [ -z "$val" ]; do
			if [[ -n ${preset_val} ]]; then
				val="${preset_val}"
			else
				if [ -z "$def" ]; then
					printf "%s: " "$1"
				else
					printf "%s [enter to keep existing]: " "$1"
				fi
				val="$(readpw)"
				echo
			fi
			if [ -n "$val" ]; then
				if [ "$2" == "chklen" -a ${#val} -lt 6 ]; then
					echo "The password must be at least" \
						"6 characters long."
					val=""
					preset_val=""
				else
					break
				fi
			else
				if [ -n "$def" ]; then
					val="$def"
					return
				else
					echo "A value must be provided."
				fi
			fi
		done

		cval=""
		while [ -z "$cval" ]; do
			if [[ -n ${preset_val} ]]; then
				cval="${preset_val}"
			else
				printf "%s: " "Confirm password"
				cval="$(readpw)"
				echo
			fi
			[ -n "$cval" ] && break
			echo "A value must be provided."
		done

		[ "$val" == "$cval" ] && break

		echo "The entries do not match, please re-enter."
	done
	trap sig_doshell SIGINT
}

updatenicstates()
{
	states=(1)
	#states[0]=1
	while IFS=: read -r link state ; do
		states=( ${states[@]-} $(echo "$state") )
	done < <(dladm show-phys -po link,state 2>/dev/null)
}

printruler()
{
	#
	# Print the horizontal ruler we have generated for this terminal.  Note
	# that the ruler string is a printf(1) format string which may include
	# a newline escape sequence.
	#
	printf -- "$ruler"
}

printheader()
{
	local subheader=$1

	if [[ $(getanswer "simple_headers") == "true" ]]; then
		echo "> ${subheader}"
		return
	fi

	clear
	printf " %-40s\n" "SmartOS Setup"
	printf " %-40s%38s\n" "$subheader" "https://wiki.smartos.org/install"

	printruler
}

print_warning()
{
	clear
	printf "WARNING\n"
	printruler
	printf "\n$1\n"

	prmpt_str="\nPress [enter] to continue "
	printf "$prmpt_str"
	read continue
}

nicsup()
{
	[ $nicsup_done -eq 1 ] && return

	local vlan_opts=""
	if [[ "$admin_ip" == "dhcp" ]]; then
		ifconfig $admin_iface up
		ifconfig $admin_iface dhcp
	else
		ifconfig $admin_iface inet $admin_ip netmask $admin_netmask up
	fi

	if [[ -n ${external_nic} ]]; then
		if [ -n "$external_vlan_id" ]; then
			vlan_opts="-v $external_vlan_id"
		fi

		dladm create-vnic -l $external_iface $vlan_opts external0
		ifconfig external0 plumb
		ifconfig external0 inet $external_ip netmask $external_netmask up
	fi

	if [[ -n ${headnode_default_gateway}
	    && ${headnode_default_gateway} != "none" ]]; then

		route add default $headnode_default_gateway >/dev/null
	fi

	nicsup_done=1
}

nicsdown()
{
	ifconfig ${admin_iface} inet down unplumb
	if [[ -n ${external_nic} ]]; then
		ifconfig external0 inet down unplumb
		dladm delete-vnic external0
	fi
}

printdisklayout()
{
  json -f "$1" | json -e '
    out = "vdevs:\n";
    disklist = [];
    for (var i = 0; i < vdevs.length; i++) {
      var x = vdevs[i];
      if (!x.type) {
        out += "   " + x.name + "\n";
        continue;
      }
      if (x.type === "mirror") {
        out += "   " + x.type + "  " + x.devices[0].name + " " +
          x.devices[1].name + "\n";
        continue;
      }
      out += "   " + x.type + "\n";
      var lout = "      ";
      for (var j = 0; j < x.devices.length; j++) {
        if ((lout + x.devices[j].name).length > 80) {
          out += lout + "\n";
          lout = "      " + x.devices[j].name + " ";
        } else {
          lout += x.devices[j].name + " ";
        }
      }
      out += lout + "\n";
    }
    if (typeof (spares) !== "undefined" && spares.length > 0) {
      out += "spares:\n";
      var lout = "      ";
      for (var i = 0; i < spares.length; i++) {
        if ((lout + spares[i].name).length > 80) {
          out += lout + "\n";
          lout += "      " + spares[i].name + " ";
        } else {
          lout += spares[i].name + " ";
        }
      }
      out += lout + "\n";
    }
    if (typeof (logs) !== "undefined" && logs.length > 0) {
      out += "logs:\n";
      var lout = "      ";
      for (var i = 0; i < logs.length; i++) {
        if ((lout + logs[i].name).length > 80) {
          out += lout + "\n";
          lout += "      " + logs[i].name + " ";
        } else {
          lout += logs[i].name + " ";
        }
      }
      out += lout + "\n";
    }
    out += "total capacity:   " + Number(capacity / 1073741824).toFixed(2)
      + " GB";
    ' out
}

promptpool()
{
	local layout=""
	local disks=
	while [[ /usr/bin/true ]]; do
		# Skip USB devices and the VMware boot image by default.
		diskinfo -Hp | nawk '
			$1 != "USB" {
				diskinfo = $0;
				bootdisk = 0;
				cmd = "fstyp -v /dev/dsk/" $2 "p1 2>/dev/null";
				while ((cmd | getline) > 0) {
					if ($0 ~ /^Volume Label:/ && $3 == "SMARTOSBOOT")
						bootdisk = 1;
				}
				close(cmd);
				cmd = "fstyp -v /dev/dsk/" $2 "s2 2>/dev/null";
				while ((cmd | getline) > 0) {
					if ($0 ~ /^Volume Label:/ && $3 == "SMARTOSBOOT")
						bootdisk = 1;
				}
				close(cmd);
				if (bootdisk)
					next;
				print diskinfo;
			}' > /var/tmp/mydisks
		disklayout -f /var/tmp/mydisks $layout > /var/tmp/disklayout.json

		if [[ $? -ne 0 ]]; then
			#
			# There are two classes of errors that we need to
			# distinguish between. Those which are endemic to the
			# system itself and those which are as a result of a
			# user issue.  This is a bad way to tell these apart,
			# but for the moment this is the primary case.
			#
			if ! grep -q 'no primary storage disks' /var/tmp/disklayout.json; then
				cat /var/tmp/disklayout.json
				layout=""
				continue
			fi
			cat >&2 <<EOF

WARNING: failed to determine possible disk layout. It is possible that
the system detected no disks. We are launching a shell to allow you to
investigate the problem. Check for disks and their sizes with the
diskinfo(1M) command. If you do not see disks that you expect, please
determine your storage controller and reach out to the SmartOS community
if you require assistence.

If you create or import a zpool named "zones" then installation will continue.
If you cannot, you should shutdown your system.

EOF
			/usr/bin/bash
			zpool list zones >/dev/null 2>/dev/null
			[[ $? -eq 0 ]] && return

			printheader "Storage"
			continue
		fi
		json error < /var/tmp/disklayout.json 2>/dev/null | grep . && layout="" && continue
		prmpt_str="$(printdisklayout /var/tmp/disklayout.json)\n\n"
		[[ -z "$layout" ]] && layout="default"
		prmpt_str+="This is the '${layout}' storage configuration.  To use it, type 'yes'.\n"
		prmpt_str+=" To see a different configuration, type: 'raidz2', 'mirror', or 'default'.\n"
		prmpt_str+=" To specify a manual configuration, type: 'manual'.\n\n"
		print $prmpt_str
		promptval "Selected zpool layout" "yes"
		if [[ $val == "raidz2" || $val == "mirror" ]]; then
			# go around again
			layout=$val
		elif [[ $val == "default" ]]; then
			layout=""
		elif [[ $val == "yes" ]]; then
			DISK_LAYOUT=/var/tmp/disklayout.json
			return
		elif [[ $val == "manual" ]]; then
			# let the user manually create the zpool
			layout=""
			DISK_LAYOUT="manual"
			echo "Launching a shell."
			echo "Please manually create/import a zpool named \"zones\"."
			echo "If you no longer wish to manually create a zpool,"
			echo "simply exit the shell."
			/usr/bin/bash
			zpool list zones >/dev/null 2>/dev/null
			[[ $? -eq 0 ]] && return
		else
			layout=""
		fi
	done
}

#
# The original setup capped the dumpvol at 4G, however this is too small for
# large memory servers.  This function will setup a dumpvol based on the size
# of the dumpadm -e estimate.
#
# We take the value and double it to ensure that we have an appropriately sized
# dumpvol out of the box.  We also set the smallest dumpvol to 1G.  The reason
# to double the estimate is this is the cleanest way to get a usable dump size
# on most systems. Setting the minimum to 1G should allow the dumpvol to work
# even on small ram setups without consuming too much disk space.
#
create_dump()
{
	local dumpsize=$(LC_ALL=C LANG=C dumpadm -e | awk '
		/Estimated dump size:/ {
			sz = $NF;
			outsz = 0;
			if (index(sz, "M") > 0) {
				outsz = sz * 1;
			} else if (index(sz, "G") > 0) {
				outsz = sz * 1024;
			}
		}
		END {
			outsz *= 2;
			printf("%d\n", outsz < 1024 ? 1024 : outsz);
		}
	')

	# Create the dump zvol
	zfs create -V ${dumpsize}mb -o checksum=noparity ${SYS_ZPOOL}/dump || \
	    fatal "failed to create the dump zvol"
	dumpadm -d /dev/zvol/dsk/${SYS_ZPOOL}/dump >/dev/null
	[[ $? -eq 0 ]] || fatal "failed to enable dump device"
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
		printf "%-56s" "Creating config dataset... "
		zfs create -o mountpoint=legacy ${USBKEYDS} || \
		  fatal "failed to create the config dataset"
		mkdir /usbkey
		mount -F zfs ${USBKEYDS} /usbkey
		printf "%4s\n" "done"
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
		printf "%4s\n" "done"
	fi

	if ! echo $datasets | grep ${SWAPVOL} > /dev/null; then
		printf "%-56s" "Creating swap zvol... "

		#
		# We cannot allow the swap size to be less than the size of
		# DRAM, lest we run into the availrmem double accounting
		# issue for locked anonymous memory that is backed by
		# in-memory swap (which will severely and artificially limit
		# VM tenancy).  We will therfore not create a swap device
		# smaller than DRAM -- but we still allow for the
		# configuration variable to account for actual consumed space
		# by using it to set the refreservation on the swap volume
		# if/when the specified size is smaller than DRAM.
		#

		size=${SYSINFO_MiB_of_Memory}
		zfs create -V ${size}mb ${SWAPVOL} || fatal \
		    "failed to create swap partition"

		swap -a /dev/zvol/dsk/${SWAPVOL}
	    fi
	    printf "%4s\n" "done"
}

create_zpool()
{
	layout=$1
	disks=$2
	pool=zones

	# If the pool already exists, don't create it again.
	if /usr/sbin/zpool list -H -o name $pool >/dev/null 2>/dev/null; then
		printf "%-56s\n" "Pool '$pool' exists, skipping creation... "
		return 0
	fi

	printf "%-56s" "Creating pool $pool... "

	# If this is not a manual layout, then we've been given
	# a JSON file describing the desired pool, so use that:
	mkzpool -f $pool $layout || \
	    fatal "failed to create pool ${pool}"

	zfs set atime=off ${pool} || \
	    fatal "failed to set atime=off for pool ${pool}"

	printf "%4s\n" "done"
}

create_zpools()
{
	layout=$1
	devs=$2

	export SYS_ZPOOL="zones"
	create_zpool "$layout" "$devs"
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

trap "" SIGINT

while getopts "f:" opt
do
	case "$opt" in
		f)	answer_file=${OPTARG};;
	esac
done

shift $(($OPTIND - 1))

USBMNT=$1

if [[ -n ${answer_file} ]]; then
	if [[ ! -f ${answer_file} ]]; then
		echo "ERROR: answer file '${answer_file}' does not exist!"
		exit 1
	fi
elif [[ -f ${USBMNT}/private/answers.json ]]; then
	answer_file=${USBMNT}/private/answers.json
fi

#
# Get local NIC info
#
nic_cnt=0

while IFS=: read -r link addr ; do
	((nic_cnt++))
	nics[$nic_cnt]=$link
	macs[$nic_cnt]=`echo $addr | sed 's/\\\:/:/g'`
	# reformat the nic so that it's in the proper 00:00:ab... form not 0:0:ab...
	macs[$nic_cnt]=$(printf "%02x:%02x:%02x:%02x:%02x:%02x" \
	    $(echo "${macs[${nic_cnt}]}" \
	    | tr ':' ' ' | sed -e "s/\([A-Fa-f0-9]*\)/0x\1/g"))
	assigned[$nic_cnt]="-"
done < <(dladm show-phys -pmo link,address 2>/dev/null)

if [[ $nic_cnt -lt 1 ]]; then
	echo "ERROR: cannot configure the system, no NICs were found."
	exit 0
fi

# Don't do an 'ifconfig -a' - this causes some nics (bnx) to not
# work when combined with the later dladm commands
for iface in $(dladm show-phys -pmo link); do
	ifconfig $iface plumb 2>/dev/null
done
updatenicstates

export TERM=xterm-color

trap sig_doshell SIGINT

printheader "Joyent"

message="
You must answer the following questions to configure your SmartOS node.
You will have a chance to review and correct your answers, as well as a
chance to edit the final configuration, before it is applied.

At the prompts, if you type ^C you will be placed into a shell. When you
exit the shell the configuration process will resume from where it was
interrupted.

Press [enter] to continue"

if [[ $(getanswer "skip_instructions") != "true" ]]; then
	printf "$message"
fi

console=$(getanswer "config_console")
# If we've asked for automatic configuration, but are not running on the
# primary boot console (as selected in the bootloader menu), then pause at a
# prompt:
if [[ -z ${console} || $(tty) != "/dev/console" ]]; then
	read continue;
fi

if [ -f /tmp/config_in_progress ]; then
	message="
Configuration is already in progress on another terminal.
This session can no longer perform system configuration.\n"
	while [ /usr/bin/true ]; do
		printf "$message"
		read continue;
	done

fi
touch /tmp/config_in_progress

#
# Main loop to prompt for user input
#
while [ /usr/bin/true ]; do

	printheader "Networking"
	message="
To set up networking you must first configure a network tag. A network tag
refers to a physical NIC or an aggregation. Virtual machines will be created on
top of a network tag. Setup will first create a network tag and configure a NIC
so that you can access the SmartOS global zone. After setup has been completed,
you will have the option of creating additional network tags and configuring
additional NICs for accessing the global zone through the nictagadm(1M) command.

Press [enter] to continue"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
		prmpt_str="\nPress [enter] to continue "
		read continue
	fi

	printheader "Networking - Admin"
	message="
The admin network is the primary network in SmartOS. It is the default network
that is created. The configured NIC will be used to access the global zone. If
you wish to use a VLAN on this network, you must configure VLAN ACCESS mode for
this network.\n\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	promptnic "'admin'"
	admin_nic="$val"
	admin_iface="$nic_val"

	valid=0
	while [ $valid -ne 1 ]; do
		promptnet "(admin) IP address (or dhcp)" "$admin_ip" "admin_ip"
		admin_ip="$val"

		if [[ "$admin_ip" != "dhcp" ]]; then
			[[ -z "$admin_netmask" ]] && \
			    admin_netmask="255.255.255.0"

			promptnet "(admin) netmask" "$admin_netmask" \
			    "admin_netmask"
			admin_netmask="$val"
			ip_netmask_to_network "$admin_ip" "$admin_netmask"
			[ $IP_NUM -ne $BCAST_ADDR ] && valid=1
		else
			valid=1
		fi
	done

	printheader "Networking - Continued"
	message=""

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	message="
The default gateway will determine which router will be used to connect the
global zone to other networks. This will almost certainly be the router
connected to your 'admin' network. Use 'none' if you have no gateway.\n\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	# default to external_gateway if that's set, if not, use 'none'
	[[ -z "$headnode_default_gateway" && -n ${external_gateway} ]] && \
	    headnode_default_gateway="$external_gateway"
	[[ -z "$headnode_default_gateway" ]] && \
	    headnode_default_gateway="none"

	promptnet "Enter the default gateway IP" "$headnode_default_gateway" "headnode_default_gateway"
	headnode_default_gateway="$val"

	# Bring the admin and external nics up now: they need to be for the
	# connectivity checks in the next section
	nicsup

	message="
The DNS servers set here will be used to provide name resolution abilities to
the SmartOS global zone itself. These DNS servers are independent of anything
you use to create virtual machines through vmadm(1M).\n\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	prompt_host_ok_val "Enter the Primary DNS server IP" "$dns_resolver1" "dns_resolver1"
	dns_resolver1="$val"
	prompt_host_ok_val "Enter the Secondary DNS server IP" "$dns_resolver2" "dns_resolver2"
	dns_resolver2="$val"
	promptval "Default DNS search domain" "$dns_domain" "dns_search"
	dns_domain="$val"
	cat > /etc/resolv.conf <<EOF
nameserver $dns_resolver1
nameserver $dns_resolver2
EOF


	message="
By default the headnode acts as an NTP server for the admin network. You can
set the headnode to be an NTP client to synchronize to another NTP server.\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	prompt_host_ok_val \
	    "Enter an NTP server IP address or hostname" "$ntp_hosts" "ntp_host"
	ntp_hosts="$val"

skip_ntp=$(getanswer "skip_ntp_check")
if [[ -z ${skip_ntp} || ${skip_ntp} != "true" ]]; then
		ntpdate -b $ntp_hosts >/dev/null 2>&1
		[ $? != 0 ] && print_warning "NTP failure setting date and time"
fi

	printheader "Storage"

	message="
SmartOS will automatically determine what we think is
the best zpool layout from your current disks. You may use this
suggestion, change to another built in storage profile, or simply create
your own zpool.\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	promptpool


	printheader "System Configuration"
	message="
Setup will now go through and prompt for final pieces of account configuration.
This includes setting the root password for the global zone and optionally
setting a hostname.\n\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	promptpw "Enter root password" "nolen" "$root_shadow" "root_password"
	root_shadow="$val"

	promptopt "Enter system hostname" "$hostname" "hostname"
	hostname="$val"

	printheader "Verify Configuration"
	message="
Please verify your SmartOS Configuration. After this point the system will set
up and all data on the disks will be erased.\n\n"

	if [[ $(getanswer "skip_instructions") != "true" ]]; then
		printf "$message"
	fi

	if [[ $(getanswer "skip_final_summary") != "true" ]]; then
		printf "%8s %17s %15s %15s\n" "Net" "MAC" \
		    "IP addr." "Netmask"
		if [[ "$admin_ip" == "dhcp" ]]; then
		printf "%8s %17s %15s %15s\n" "Admin" $admin_nic \
		    $admin_ip "N/A"
		else
		printf "%8s %17s %15s %15s\n" "Admin" $admin_nic \
		    $admin_ip $admin_netmask
		fi
		echo
		printf "DNS Servers: (%s, %s), Search Domain: %s\n" \
		    "$dns_resolver1" "$dns_resolver2" "$dns_domain"
		printf "Hostname: %s\n" "$hostname"
		printf "NTP server: $ntp_hosts\n"
		echo
	fi

	if [[ $(getanswer "skip_final_confirm") != "true" ]]; then
		promptval "Is this correct, proceed with installation?" "y"
		[ "$val" == "y" ] && break
		clear
	else
		break
	fi
done

tmp_config=/tmp/config
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

echo "admin_nic=$admin_nic" >>$tmp_config
echo "admin_ip=$admin_ip" >>$tmp_config
if [[ "$admin_ip" != "dhcp" ]]; then
	echo "admin_netmask=$admin_netmask" >>$tmp_config
	echo "admin_network=$admin_network" >>$tmp_config
	echo "admin_gateway=$admin_ip" >>$tmp_config
	echo >>$tmp_config
fi

echo "headnode_default_gateway=$headnode_default_gateway" >>$tmp_config
echo >>$tmp_config

echo "dns_resolvers=$dns_resolver1,$dns_resolver2" >>$tmp_config
echo "dns_domain=$dns_domain" >>$tmp_config
echo >>$tmp_config

echo "ntp_hosts=$ntp_hosts" >>$tmp_config
echo "compute_node_ntp_hosts=$admin_ip" >>$tmp_config
echo >>$tmp_config

echo "hostname=$hostname" >> $tmp_config
echo >>$tmp_config

echo "smt_enabled=true" >>$tmp_config
echo >>$tmp_config

create_zpools "$DISK_LAYOUT"

mv $tmp_config /usbkey/config || fatal "failed to persist configuration"

# set the root password
root_shadow=$(/usr/lib/cryptpass "$root_shadow")
sed -e "s|^root:[^\:]*:|root:${root_shadow}:|" /etc/shadow > /usbkey/shadow \
      && chmod 400 /usbkey/shadow
[[ $? -eq 0 ]] || fatal "failed to preserve root pasword"

cp -rp /etc/ssh /usbkey/ssh || fatal "failed to set up preserve host keys"

printf "System setup has completed.\n\nPress enter to reboot.\n"

read foo
reboot
