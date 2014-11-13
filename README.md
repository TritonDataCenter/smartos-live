# smartos-live: SmartOS Platform

## Quickstart

  * cp sample.configure.smartos configure.smartos
  * ./configure
  * gmake world
  * gmake live

## Overview

This is smartos-live, which builds a SmartOS platform image containing the
illumos core OS components; a set of "extra" mostly third-party software
required by illumos, by other SmartOS software, or for system management; a
collection of utilities comprising SmartOS-specific functionality
found in projects/local; and implementation-specific overlays that deliver
additional files verbatim.

The build procses occurs in two phases; the first phase is a bootstrap phase.
The bootstrap phase uses the pkgsrc delivered compiler to build the set of items
required to build illumos, this includes the compiler and various other
components.  This process is driven from the illumos-extra repository and
delivered into a subdirectory of the smartos-live root named proto.strap.

Next, the build process accumulates from those various components a set of
objects into a subdirectory of the smartos-live root.  This subdirectory is
known as the proto area and by default is named proto.  All objects that are
delivered by the platform are built against the contents of the proto area, such
that they use the interfaces defined by the headers and libraries provided by
the software being delivered rather than that installed on the build system.
However, not all objects installed into the proto area are delivered by the
platform.  This allows objects in the platform to be built correctly without
forcing us to deliver private objects in the platform that would conflict with
objects delivered by pkgsrc into zones.

Each component (illumos, illumos-extra, illumos-live, and each subproject
and overlay) includes a manifest.  The manifest lists the files installed
into the proto area by that component that should be delivered by the
platform, along with its type, ownership, and permissions.  This includes
directories and symlinks; simply creating a directory or symlink in the
proto area does not result in that object being delivered by the program.
This also means that symlinks in the proto area can be broken without
obvious effects on the platform image, which is usually a bug and can result
in silent (and not-so-silent) build problems.

The manifests are aggregated and the resulting list of objects assembled
into lofi filesystems created in /tmp, which in turn are assembled into the
platform image itself.  This process is performed mainly by the
tools/build_live script.

## Tools

As of June 2012, the Sun Studio compiler should no longer be executed as
part of the build process.  However, it is still used for building lint
libraries and for linting illumos.  Hopefully this dependency will be
removed in the future.

Additional build tools are required to be present on the build system;
configure (see below) will install them if you are building in a SmartOS
zone, which is the supported and recommended practice, see
http://wiki.smartos.org/display/DOC/Building+SmartOS+on+SmartOS for zone
setup instructions. 

## Build Steps

The configure script sets everything up for building including:

  * ensures system has required packages installed (and is running on illumos!)
  * ensures SUNWspro is installed in `/opt/SUNWspro`
  * ensures that `projects/illumos` exists and creates `illumos.sh` there
  * ensures that `projects/illumos-extra` exists
  * optional: set the environment variable MAX_JOBS to set build job concurrency (useful for small systems)

### The "make world" works as follows:

  * The subset of illumos-extra required at build time to encode runtime
    dependencies into illumos is built, starting with gcc 4.4.4, and
    installed into the bootstrap proto area (by default, proto.strap).

  * The illumos source in projects/illumos (can be a link) is built with the
    aid of tools/build_illumos and installed into the proto area.  The
    compiler used is the one built in the first phase.

  * All illumos-extra components are built and installed into the proto
    area.

  * The local sources in the `src` subdirectory are built and installed into
    the proto area.

  * Any extra projects found in the directory projects/local, by default kvm and
    kvm-cmd, are built and installed into the proto area.

### The "make live" uses the tools/build_live script as follows:

  * The manifest is used, directories and links are created and files are taken:
      * from an overlay directory, in the order specified by the configure
        fragment's `OVERLAY` variable; then
      * from the proto area; finally
      * from the `man/man` subdirectory

  * Once the files are copied in, the tools/customize script is run which also
    sources tools/customize.* if they exist

  * Then the image is packed up and put in output with an expanded directory and
    a `platform-BUILDSTAMP.tgz`

  * A log of the live image creation is written into the `log` subdirectory
    containing entries of the form:

	FILE: [path/to/file][PERM][owner/uid][group/gid]: OK (/path/to/source)
	LINK(symlink): source => target: OK
	LINK: source => target: OK
	DIR: [path/to/dir][PERM][owner/uid][group/gid]: OK

    If the build fails during this step, check the log file for any entries
    containing FAIL.  In most cases, this will be the result of a bug in the
    build system (or an object that was not delivered to the proto area, in
    which case the failure to stop that build at that point is also a build
    system bug).

## Creating additional build artifacts

By default, the build only generates the `platform-BUILDSTAMP.tgz` file. This
may also be transformed into a CD-ROM ISO image and a USB key image. To
transform it into a CD-ROM ISO image, one may use the `./tools/build_iso`
script. To transform it into a USB image, one should use the `./tools/build_usb`
script.

## Known Issues

  * There are still a small number of illumos-extra components that do not
    use the unified makefile system, and are built against the build system's
    headers and libraries. (TBD)

  * python should be part of illumos-extra, as there are a small number of
    tools delivered that use it. (TBD)

  * While there should never be a delivered object with build environment
    DT_RPATH leakage, there is currently no tool for checking this.
    (OS-1122)

  * There is also no tool for verifying that all objects delivered within
    the platform have no dependencies outside the platform.  This includes
    both runtime library linking and the execution of interpreters.
    (OS-1122)

  * illumos-extra recurses over all components even during an incremental
    build.  This is time-consuming and usually pointless. (OS-1319)	

  * The complete set of build-order dependencies within illumos-extra
    probably has not been enumerated.  Doing so would allow for greater
    parallelism in that portion of the build.  In addition, it is likely
    that many of the components are actually unsafe to build in parallel
    internally. (TBD)

  * The illumos-extra unified makefile system is not documented.

## Contributing

Changes for any of the above issues, or any other bug you encounter, are
welcome and may be submitted via the appropriate github repository.
Additional issues may also be filed there.

## Other Notes

  * The resulting image requires a 64-bit machine
  * The BUILDSTAMP is available in the live image in /etc/joyent_buildstamp
  * There is a manifest created:

	output/platform-BUILDSTAMP/i86pc/amd64/boot_archive.manifest

   which contains a list of all files/links in the image + md5sums of files and
   is also available in the live image itself in /var/log/manifest
