# pkgsrc-setup(1) -- bootstrap pkgsrc-tools


## SYNOPSIS

`pkgsrc-setup [--clean]`


## DESCRIPTION

This command installs pkgsrc-tools for the global zone to /opt/tools.


## OPTIONS

`--clean`
    This option will re-bootstrap the pkgsrc-tools installation by removing
    /opt/tools and reinstalling all currently installed packages.
    Re-bootstrapping is generally not necessary, but can be used to "reset"
    the installation without having to manually reinstall all packages.


## COPYRIGHT

pkgsrc-setup Copyright 2022 MNX Cloud, Inc.
