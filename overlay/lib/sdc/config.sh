#!/usr/bin/bash
#
# functions for getting USB headnode config values (intended to be sourced
# from other scripts)
#
# Copyright (c) 2010 Joyent Inc., All rights reserved.
#


# Loads sysinfo variables with SYSINFO_ prefix
function load_sdc_sysinfo {
    eval $(/usr/bin/sysinfo -p | sed -e "s/^/SYSINFO_/")
}

# Sets SDC_CONFIG_FILENAME with the location of the USB config file
function load_sdc_config_filename {
    if [[ -z "${SDC_CONFIG_FILENAME}" ]]; then
        SDC_CONFIG_FILENAME="$(svcprop -p 'joyentfs/usb_copy_path' svc:/system/filesystem/smartdc:default)/config"
        if [[ ! -f ${SDC_CONFIG_FILENAME} ]]; then
            SDC_CONFIG_FILENAME="/mnt/$(svcprop -p 'joyentfs/usb_mountpoint' svc:/system/filesystem/smartdc:default)/config"
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

# Loads config variables with CONFIG_ prefix
function load_sdc_config {
    if /bin/bootparams | grep "^headnode=true" >/dev/null; then
        headnode="true"
    else
        headnode="false"
    fi

    if [[ ${headnode} == "true" ]]; then
        load_sdc_config_filename
        # Ignore comments,  spaces at the beginning of lines and lines that don't start with a letter.
        if [[ -f ${SDC_CONFIG_FILENAME} ]]; then
            eval $(cat ${SDC_CONFIG_FILENAME} | sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | sed -e "s/^/CONFIG_/")
        else
            echo "FATAL: Unable to load headnode config."
            exit 1
        fi
    fi
}
