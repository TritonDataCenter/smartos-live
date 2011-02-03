#!/usr/bin/bash
#
# functions for getting USB headnode config values (intended to be sourced
# from other scripts)
#
# It is also possible to use this to get a JSON hash of the config options using:
#
# bash config.sh -json
#
# Copyright (c) 2010,2011 Joyent Inc., All rights reserved.
#

# Loads sysinfo variables with prefix (default: SYSINFO_)
function load_sdc_sysinfo {

    prefix=$1
    [[ -z ${prefix} ]] && prefix="SYSINFO_"

    eval $(/usr/bin/sysinfo -p | sed -e "s/^/${prefix}/")
}

# Sets SDC_CONFIG_FILENAME with the location of the USB config file, or /opt/smartdc/config
function load_sdc_config_filename {

    # the default
    COMPUTE_NODE_CONFIG_FILENAME="/opt/smartdc/config/node.config"

    if [[ -z "${SDC_CONFIG_FILENAME}" ]]; then
        SDC_CONFIG_FILENAME="$(svcprop -p 'joyentfs/usb_copy_path' svc:/system/filesystem/smartdc:default)/config"
        if [[ ! -f ${SDC_CONFIG_FILENAME} ]]; then
            SDC_CONFIG_FILENAME="/mnt/$(svcprop -p 'joyentfs/usb_mountpoint' svc:/system/filesystem/smartdc:default)/config"
        fi

        if [[ -f ${COMPUTE_NODE_CONFIG_FILENAME} ]]; then
            if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
                # We write to console to make it clear we don't like this at all.
                echo "WARNING: ignoring config at ${COMPUTE_NODE_CONFIG_FILENAME} since we have ${SDC_CONFIG_FILENAME}" >> /dev/msglog
            else
                SDC_CONFIG_FILENAME=${COMPUTE_NODE_CONFIG_FILENAME}
            fi
        fi
    fi
}

# Returns "true" if keys in the SDC config file contain the given string,
# false otherwise
function sdc_config_keys_contain {
    search=$1
    load_sdc_config_filename
    if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
        matches="$(cat ${SDC_CONFIG_FILENAME} | sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | sed -e "s/=.*//" | grep $search | wc -l)"
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
    if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
        keys=$(cat ${SDC_CONFIG_FILENAME} | sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | sed -e "s/=.*//")
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

    if [[ ${headnode} == "true" ]]; then
        load_sdc_config_filename
        # Ignore comments,  spaces at the beginning of lines and lines that don't start with a letter.
        if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
            eval $(cat ${SDC_CONFIG_FILENAME} | sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | sed -e "s/^/${prefix}/")
        else
            echo "FATAL: Unable to load headnode config."
            exit 1
        fi
    fi
}

if [[ $1 == "-json" ]]; then
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
    )
fi
