#!/bin/sh

REMDISKS=""
NONREMDISKS=""

ALLDISKS=`/usr/bin/ls /dev/dsk | /usr/bin/awk "/s2$/ {print}" | /usr/bin/sed "s/s2//"`

for disk in $ALLDISKS; 
do
    pfexec removable_disk /dev/rdsk/${disk}p0 2>&1 >> /dev/null
    if [[ $? == 0 ]];
    then
        REMDISKS=$REMDISKS" "$disk;
    else
        NONREMDISKS=$NONREMDISKS" "$disk;
    fi;
done

while getopts 'anr' OPTION
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
        ?)
            printf "Usage: %s: [-anr]\n" $(basename $0) >&2
            exit 2
            ;;
    esac
done