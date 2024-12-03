# sdc-factoryreset(1) -- reset a machine to its originally installed state


## SYNOPSIS

`sdc-factoryreset [-h | --help] {-s}`


## DESCRIPTION

This command resets a machine to its originally installed state.  Specifically,
it reboots the machine, imports all ZFS pools, and destroys them individually.
It does this by setting a ZFS user property on the system pool. Using the
`-s` flag will instead shut down the machine; putting it into a state where
upon next reboot, the machine will import all ZFS pool and destroy them
individually.

If this command is invoked unintentionally, an administrator can prevent the
system from resetting itself by booting in rescue mode (noimport=true as a
boot option) and clearing the smartdc:factoryreset property from the var
dataset.  Use of the `-s` option makes this easier to accomplish.

If the affected system boots without the noimport=true option, the only way
to stop the pending factory reset is to power cycle the machine, and boot
again into rescue mode.  The service which does the actual factory reset
starts well before an administrator would be able to login to the box, even
if that administrator has console access.


## OPTIONS

`-h`
    Show the help and usage mesage

`-s`
    Instead of immediately rebooting, shut down the machine instead
    (using poweroff(8)).


## COPYRIGHT

Copyright (c) 2014, Joyent, Inc.
Copyright 2024 MNX Cloud, Inc.
