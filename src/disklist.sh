#!/bin/sh

REMDISKS=""
NONREMDISKS=""

ALLDISKS=`/usr/bin/ls /dev/dsk | /usr/bin/awk "/s2$/ {print}" | /usr/bin/sed "s/s2//"`

for disk in $ALLDISKS; 
do
    pfexec removable_disk /dev/rdsk/${disk}p0 2>&1 >> /dev/null
    case "$?" in
    0)
        REMDISKS=$REMDISKS" "$disk;
        ;;
    1)
        NONREMDISKS=$NONREMDISKS" "$disk;
        ;;
    esac;
done

while getopts 'anrs' OPTION
do
    case $OPTION in
        a)
            echo $REMDISKS" "$NONREMDISKS
            ;;
        n)
            echo $NONREMDISKS
            ;;
        r)
            echo $REMDISKS
            ;;
        s)
            for disk in $NONREMDISKS; do
                size=`pfexec disk_size /dev/rdsk/${disk}p0`
                echo "${disk}=${size}"
            done
            ;;
        ?)
            printf "Usage: %s: [-anr]\n" $(basename $0) >&2
            exit 2
            ;;
    esac
done
