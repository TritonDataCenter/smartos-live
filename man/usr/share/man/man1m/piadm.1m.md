piadm(1M) -- Manage SmartOS Platform Images
===========================================

## SYNOPSIS
    /usr/sbin/piadm [-v] <command> [command-specific arguments]

## DESCRIPTION

    Historically, SmartOS booted off of a USB key or a read-only media like
    CD-ROM.  The copy and version of the SmartOS software on one of these
    media is called a Platform Image.  A Platform Image is described in
    detail in the next section. 

    piadm(1M) manages multiple copies of Platform Images on a bootable ZFS
    pool, allowing easier updates to Platform Images and maintaining multiple
    Platform Images on a single boot media.  The method and implementation of
    SmartOS booting does not change vs. a USB key or CD-ROM, but merely uses
    a bootable ZFS pool as the source of the Platform Image, which can be the
    SmartOS `zones` pool if it is a bootable pool.

## PLATFORM IMAGES

    A SmartOS Platform Image (PI) is identified by creation timestamp,
    referred to here as a PI-stamp.  One can see it in uname(1M):

        smartos-build(~)[0]% uname -a
	SunOS smartos-build 5.11 joyent_20200602T173751Z i86pc i386 i86pc
	smartos-build(~)[0]% 

    The PI-stamp for this system's Platform Image is `20200602T173751Z`.

    The Platform Image is a directory containing:

        - A directory structure in a format used by loader(5).

        - The SmartOS `unix` kernel

	- The SmartOS boot archive containing kernel modules, libraries,
	  commands, and more.

        - A manifest and hash.

	- A file containing the PI-stamp.

    The SmartOS loader(5) will find a path to a Platform Image on the
    bootable ZFS pool, and will load `unix` and then the boot archive.

    Platform images are supplies by a gzipped tarball containing the above.

## COMMANDS

    The following commands and options are supported:

      activate <PI-stamp> [ZFS-pool-name]
      assign <PI-stamp> [ZFS-pool-name]

        Activate a Platform Image for the next boot, on a specified ZFS pool
        if there are more than one bootable pools imported.  It is up to the
        administrator to know which pool the system will actually boot.

        `activate` and `assign` are synonyms, for those used to other
        distros' `beadm`, or Triton's `sdcadm platform`, respectively.

      bootable [-d] [-e] [ZFS-pool-name]

        Query or upgrade a ZFS pool's bootable status.  With no arguments,
        the status of all imported pools will be queried.  -d will disable a
        pool from being bootable, and -e will enable one.  As mentioned
        earlier, it is up to the administrator to know which pool the system
        will actually boot.

	Some pools can only be bootable from an older BIOS system, while
	other can also be bootable from UEFI systems.  The `bootable`
	subcommand will indicate this.

      install <PI-stamp, PI-tarball, PI-tarball-URL, "latest"> [ZFS-pool-name]

        Installs a new Platform Image into the bootable pool.  If there are
        more than one bootable pools, a pool name will be required.
        piadm(1M) requires a Platform Image gzipped tar file.  If a PI-stamp
        or the word "latest" is supplied, the well-known public SmartOS PI
        repository will be queried with the specified PI-stamp.

      list [ZFS-pool-name]

        Lists the available platform images on bootable pools.

      remove <PI-stamp> [ZFS-pool-name]

        The opposite of `install`, and only accepts a PI-stamp.



## EXAMPLES



## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.


## SEE ALSO

    zpool(1M), loader(5)

## NOTES

    Many ZFS pool types are not allowed to be bootable.  The system's BIOS or
    EFI must locate a bootable disk on a bootable pool in order to boot.

    SmartOS still loads a ramdisk root with a read-only /usr filesystem, even
    with a bootable pool.

    <Notes of ZFS pools>
