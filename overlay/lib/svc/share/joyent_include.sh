#
# Copyright (c) 2010 Joyent Inc., All rights reserved.
#

MOUNTPOINT=/mnt

mount_usb() {

    if [ -f "/mnt/.joyliveusb" ]; then
        # Already mounted
        return 0;
    fi

    # First thing to do is to mount the USB key / VMWare disk
    USBKEYS=`/usr/bin/disklist -r`
    for key in $USBKEYS; do
        if [[ `/usr/sbin/fstyp /dev/dsk/${key}p0:1` == 'pcfs' ]]; then
            /usr/sbin/mount -F pcfs /dev/dsk/${key}p0:1 /mnt;
            if [[ $? == 0 ]]; then
                if [[ ! -f /mnt/.joyliveusb ]]; then
                    /usr/sbin/umount /mnt;
                else
                    break;
                fi
            fi
        fi
    done

    if [[ ! -f /mnt/.joyliveusb ]]; then
        # we're probably VMWare, so we're looking at a non-USB disk.
        for disk in `/usr/bin/disklist -a`; do
            if [[ `/usr/sbin/fstyp /dev/dsk/${disk}p1` == 'pcfs' ]]; then
                /usr/sbin/mount -F pcfs /dev/dsk/${disk}p1 /mnt;
                if [[ $? == 0 ]]; then
                    if [[ ! -f /mnt/.joyliveusb ]]; then
                        /usr/sbin/umount /mnt;
                    else
                        break;
                    fi
                fi
            fi
        done
    fi

    if [ -f "/mnt/.joyliveusb" ]; then
        return 0;
    fi

    echo "FATAL: Cannot find USB key" >/dev/console
    return 1;
}
