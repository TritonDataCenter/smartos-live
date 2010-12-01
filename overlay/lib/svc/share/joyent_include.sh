#
# Copyright (c) 2010 Joyent Inc., All rights reserved.
#

MOUNTPOINT=/mnt

mount_usb() {
    sleep 5
    mount_usb_msg=""

    if [[ -z ${DEBUG} || ${DEBUG} != "true" ]]; then
        DEBUG="false"
    fi

    if [[ -f "/mnt/.joyliveusb" ]]; then
        mount_usb_msg="already mounted"
        return 0;
    fi

    # First thing to do is to mount the USB key / VMWare disk
    USBKEYS=`/usr/bin/disklist -r`
    for key in ${USBKEYS}; do
        if [[ `/usr/sbin/fstyp /dev/dsk/${key}p0:1` == 'pcfs' ]]; then
            /usr/sbin/mount -F pcfs /dev/dsk/${key}p0:1 /mnt;
            if [[ $? == "0" ]]; then
                if [[ ! -f /mnt/.joyliveusb ]]; then
                    if [[ ${DEBUG} == "true" ]]; then
                        mount_usb_msg="${mount_usb_msg}\n[debug] didn't find /mnt/.joyliveusb on pcfs /dev/dsk/${key}p0:1"
                    fi
                    /usr/sbin/umount /mnt;
                else
                    if [[ ${DEBUG} == "true" ]]; then
                        mount_usb_msg="${mount_usb_msg}\n[debug] found /mnt/.joyliveusb on pcfs /dev/dsk/${key}p0:1"
                    fi
                    break;
                fi
            elif [[ ${DEBUG} == "true" ]]; then
                mount_usb_msg="${mount_usb_msg}\n[debug] mount failed for pcfs /dev/dsk/${key}p0:1"
            fi
        elif [[ ${DEBUG} == "true" ]]; then
            mount_usb_msg="${mount_usb_msg}\n[debug] /dev/dsk/${key}p0:1 is not pcfs"
        fi
    done

    if [[ ! -f "/mnt/.joyliveusb" ]]; then
        # we're probably VMWare, so we're looking at a non-USB disk.
        for disk in `/usr/bin/disklist -a`; do
            if [[ `/usr/sbin/fstyp /dev/dsk/${disk}p1` == 'pcfs' ]]; then
                /usr/sbin/mount -F pcfs /dev/dsk/${disk}p1 /mnt;
                if [[ $? == "0" ]]; then
                    if [[ ! -f /mnt/.joyliveusb ]]; then
                        if [[ ${DEBUG} == "true" ]]; then
                            mount_usb_msg="${mount_usb_msg}\n[debug] didn't find /mnt/.joyliveusb on pcfs /dev/dsk/${disk}p1"
                        fi
                        /usr/sbin/umount /mnt;
                    else
                        if [[ ${DEBUG} == "true" ]]; then
                            mount_usb_msg="${mount_usb_msg}\n[debug] found /mnt/.joyliveusb on pcfs /dev/dsk/${disk}p1"
                        fi
                        break;
                    fi
                elif [[ ${DEBUG} == "true" ]]; then
                    mount_usb_msg="${mount_usb_msg}\n[debug] unable to mount /dev/dsk/${disk}p1"
                fi
            elif [[ ${DEBUG} == "true" ]]; then
                mount_usb_msg="${mount_usb_msg}\n[debug] /dev/dsk/${disk}p1 is not pcfs"
            fi
        done
    fi

    if [[ -f "/mnt/.joyliveusb" ]]; then
        mount_usb_msg="success"
        return 0;
    fi

    mount_usb_msg="${mount_usb_msg}\n[FATAL] mount_usb(): could not find USB Key"
    return 1;
}
