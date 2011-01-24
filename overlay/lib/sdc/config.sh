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

function load_sdc_config {
    if /bin/bootparams | grep "^headnode=true" >/dev/null; then
        headnode="true"
    else
        headnode="false"
    fi

    if [[ ${headnode} == "true" ]]; then
        # Load config variables with CONFIG_ prefix, ignoring comments,  spaces
        # at the beginning of lines and lines that don't start with a letter.
        config_filename="$(svcprop -p 'joyentfs/usb_copy_path' svc:/system/filesystem/joyent:default)/config"
        if [[ ! -f ${config_filename} ]]; then
            config_filename="/mnt/$(svcprop -p 'joyentfs/usb_mountpoint' svc:/system/filesystem/joyent:default)/config"
        fi
        if [[ -f ${config_filename} ]]; then
            eval $(cat ${config_filename} | sed -e "s/^ *//" | grep -v "^#" | grep "^[a-zA-Z]" | sed -e "s/^/CONFIG_/")
        else
            echo "FATAL: Unable to load headnode config."
            exit 1
        fi
    fi
}
