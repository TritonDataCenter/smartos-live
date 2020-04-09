# sdc-factoryreset(1) -- reset a machine to its originally installed state


## SYNOPSIS

`sdc-factoryreset [-h | --help]`


## DESCRIPTION

This command resets a machine to its originally installed state.  Specifically,
it reboots the machine, imports all ZFS pools, and destroys them individually.
It does this by setting a ZFS user property on the system pool.

If this command is invoked unintentionally, an administrator can prevent the
system from resetting itself by booting in rescue mode (noimport=true as a GRUB
boot option) and clearing the smartdc:factoryreset property from the var
dataset.  If the system is booting without the noimport=true GRUB option, the
only way to stop the pending factory reset is to power cycle the machine, and
boot again into rescue mode.  The service which does the actual factory reset
starts well before an administrator would be able to login to the box, even if
that administrator has console access.


## OPTIONS

`-h`
    Show the help and usage mesage


## COPYRIGHT

sdc-factoryreset Copyright (c) 2014, Joyent, Inc.
