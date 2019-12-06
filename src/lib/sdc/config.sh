#!/usr/bin/bash
#
# functions for getting USB headnode config values (intended to be sourced
# from other scripts)
#
# It is also possible to use this to get a JSON hash of the config options using:
#
# bash config.sh -json
#
# Copyright 2018 Joyent Inc.
#

CACHE_FILE_JSON="/tmp/.config.json"
NET_BOOT_FILE="/system/boot/networking.json"
NET_BOOT_HN_FILE="/usbkey/boot/networking.json"
OVERLAY_RULES_DIR="/var/run/smartdc/networking"
OVERLAY_RULES_FILE="/var/run/smartdc/networking/overlay_rules.json"

#set -o xtrace

function boot_file_config_enabled
{
    /usr/lib/sdc/net-boot-config --enabled
}

function boot_file_config_valid
{
    if [[ -e $NET_BOOT_FILE ]]; then
        /usr/bin/json --validate -f $NET_BOOT_FILE
        return $?

    elif [[ -e $NET_BOOT_HN_FILE ]]; then
        /usr/bin/json --validate -f $NET_BOOT_HN_FILE
        return $?

    else
        return 0
    fi
}

function boot_file_nic_tag_params
{

    /usr/lib/sdc/net-boot-config | egrep '_nic=|etherstub='
}

function boot_file_config_init
{
    /usr/lib/sdc/net-boot-config --routes | while read dst gw; do
        route -pR "/" add "$dst" "$gw"
    done

    mkdir -p $OVERLAY_RULES_DIR
    rm -f $OVERLAY_RULES_FILE
    if [[ $(/usr/lib/sdc/net-boot-config --nictag-rules | /usr/bin/json -k | wc -l) != "0" ]]; then
        /usr/lib/sdc/net-boot-config --nictag-rules > $OVERLAY_RULES_FILE
    fi
}

function load_boot_file_config
{
    for line in $(/usr/lib/sdc/net-boot-config); do
        eval "CONFIG_${line}"
    done
}

# Loads sysinfo variables with prefix (default: SYSINFO_)
function load_sdc_sysinfo {

    prefix=$1
    [[ -z ${prefix} ]] && prefix="SYSINFO_"

    #
    # We've seen cases where Loader will set boot parameters that have a '#'
    # character in the name.  Not surprisingly, bash won't let you have a '#'
    # character in a shell variable name, so we strip any out of the lvalue
    # as we process the sysinfo output.
    #
    tmpfile=$(mktemp -p /tmp)
    /usr/bin/sysinfo -p | while read -r entry; do
        lval=$(echo $entry | cut -d= -f 1 | sed -e 's/#//g')
        rval=$(echo $entry | cut -d= -f 2-)
        echo ${prefix}${lval}=${rval} >> $tmpfile
    done
    eval $(cat $tmpfile)
    rm -f $tmpfile
}

# Sets SDC_CONFIG_FILENAME with the location of the config file. This can
# come from the USB key, /opt/smartdc/config/node.config, or (if on an unsetup
# CN) /var/tmp/node.config/node.config.
function load_sdc_config_filename {

    # the default
    COMPUTE_NODE_CONFIG_FILENAME="/opt/smartdc/config/node.config"

    if [[ -z "${SDC_CONFIG_FILENAME}" ]]; then
        SDC_CONFIG_FILENAME="$(svcprop -p 'joyentfs/usb_copy_path' svc:/system/filesystem/smartdc:default)/config"
        if [[ ! -f ${SDC_CONFIG_FILENAME} ]]; then
            SDC_CONFIG_FILENAME="/mnt/$(svcprop -p 'joyentfs/usb_mountpoint' svc:/system/filesystem/smartdc:default)/config"
        fi

        if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
            SDC_CONFIG_INC_DIR="$(dirname ${SDC_CONFIG_FILENAME})/config.inc"
        elif [[ ! -f ${COMPUTE_NODE_CONFIG_FILENAME} ]]; then
            if [[ -f /var/tmp/node.config/node.config ]]; then
                COMPUTE_NODE_CONFIG_FILENAME=/var/tmp/node.config/node.config
            fi
        fi

        if [[ -f ${COMPUTE_NODE_CONFIG_FILENAME} ]]; then
            if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
                # We write to console to make it clear we don't like this at all.
                echo "WARNING: ignoring config at ${COMPUTE_NODE_CONFIG_FILENAME} since we have ${SDC_CONFIG_FILENAME}" >> /dev/msglog
            else
                SDC_CONFIG_FILENAME=${COMPUTE_NODE_CONFIG_FILENAME}
                SDC_CONFIG_INC_DIR="$(dirname ${COMPUTE_NODE_CONFIG_FILENAME})"
            fi
        fi
    fi
}

# Returns "true" if keys in the SDC config file contain the given string,
# false otherwise
function sdc_config_keys_contain {
    search=$1
    load_sdc_config_filename

    if [[ -f ${SDC_CONFIG_INC_DIR}/generic ]]; then
        GEN_FILE=${SDC_CONFIG_INC_DIR}/generic
    else
        GEN_FILE=/dev/null
    fi

    if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
        matches=$((cat ${GEN_FILE} ${SDC_CONFIG_FILENAME}; echo "config_inc_dir=${SDC_CONFIG_INC_DIR}") | \
            sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | \
            sed -e "s/=.*//" | grep $search | wc -l)
        if [[ $matches -eq 0 ]]; then
            echo false
        else
            echo true
        fi
    else
        echo "FATAL: Unable to load headnode config."
        exit 1
    fi
}

function sdc_config_keys {
    load_sdc_config_filename
    if [[ -f ${SDC_CONFIG_INC_DIR}/generic ]]; then
        GEN_FILE=${SDC_CONFIG_INC_DIR}/generic
    else
        GEN_FILE=/dev/null
    fi

    if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
        keys=$((cat ${GEN_FILE} ${SDC_CONFIG_FILENAME}; echo "config_inc_dir=${SDC_CONFIG_INC_DIR}") | \
            sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | \
            sed -e "s/=.*//")
    fi
    echo "${keys}"
}

# Loads config variables with prefix (default: CONFIG_)
function load_sdc_config {

    prefix=$1
    [[ -z ${prefix} ]] && prefix="CONFIG_"

    if /bin/bootparams | grep "^headnode=true" >/dev/null; then
        headnode="true"
    else
        headnode="false"
    fi

    load_sdc_config_filename
    if [[ -f ${SDC_CONFIG_INC_DIR}/generic ]]; then
        GEN_FILE=${SDC_CONFIG_INC_DIR}/generic
    else
        GEN_FILE=/dev/null
    fi

    # Ignore comments, spaces at the beginning of lines and lines that don't
    # start with a letter.
    if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
        eval $((cat ${GEN_FILE} ${SDC_CONFIG_FILENAME}; echo "config_inc_dir=${SDC_CONFIG_INC_DIR}") | \
            sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | \
            sed -e "s/^/${prefix}/")
    elif [[ ${headnode} == "true" ]]; then
        echo "FATAL: Unable to load headnode config."
        exit 1
    fi
}

# Loads bootparams as variables with prefix (default: BOOT_)
function load_sdc_bootparams {
    prefix=$1
    [[ -z ${prefix} ]] && prefix="BOOT_"
    for line in $(/bin/bootparams); do
        fields=(${line//=/ })
        key=$(echo ${fields[0]} | sed -e "s/-/_/g;s/#//g")
        eval "${prefix}${key}=\"${fields[1]}\""
    done
}

# Outputs the keys from bootparams
function sdc_bootparams_keys {
    #keys=$(/bin/bootparams | sed -e "s/=.*//")
    #keys=$(cat /tmp/bootparams | sed -e "s/=.*//")
    for line in $(/bin/bootparams); do
        fields=(${line//=/ })
        key=$(echo ${fields[0]} | sed -e "s/=.*//;s/#//g")
        echo ${key}
    done
}

if [[ $1 == "-json" ]]; then

    update_cache=0

    load_sdc_config_filename
    if [[ ! -f ${CACHE_FILE_JSON} ]]; then
        # no cache file, need update
        update_cache=1

    elif [[ -f ${SDC_CONFIG_FILENAME}
        && ${SDC_CONFIG_FILENAME} -nt ${CACHE_FILE_JSON} ]]; then

        # /usbkey/config (or CN config) is newer, need update
        update_cache=1

    elif [[ -f ${SDC_CONFIG_INC_DIR}/generic
        && ${SDC_CONFIG_INC_DIR}/generic -nt ${CACHE_FILE_JSON} ]]; then

        # /usbkey/config.inc/generic (or CN config) is newer, need update
        update_cache=1
    fi

    if [[ ${update_cache} == 1 ]]; then

        # If called to output config as JSON, we'll do that.
        (
            echo "{"
            load_sdc_config
            first_key=1
            keys=$(sdc_config_keys)
            for key in ${keys}; do
                value=$(eval "echo \${CONFIG_${key}}")
                # too bad we can't use extra commas
                if [[ ${first_key} -eq 1 ]]; then
                    echo "    \"${key}\": \"${value}\""
                    first_key=0
                else
                    echo "  , \"${key}\": \"${value}\""
                fi
            done
            echo "}"
        ) >${CACHE_FILE_JSON}.new.$$ \
        && mv ${CACHE_FILE_JSON}.new.$$ ${CACHE_FILE_JSON}
    fi

    # either we recreated the cache or it already exists
    exec cat ${CACHE_FILE_JSON}
fi
