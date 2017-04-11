# smartos-live: SmartOS Platform

## Quickstart

```
git clone https://github.com/joyent/smartos-live.git
cd smartos-live
cp sample.configure.smartos configure.smartos
./configure
gmake world
gmake live
ls output/
```

## Overview

This is smartos-live, which builds a SmartOS platform image containing the
illumos core OS components; a set of "extra" mostly third-party software
required by illumos, by other SmartOS software, or for system management; a
collection of utilities comprising SmartOS-specific functionality
found in `projects/local/`; and implementation-specific overlays that deliver
additional files verbatim.

The build process occurs in two phases; the first phase is a bootstrap phase.
The bootstrap phase uses the pkgsrc delivered compiler to build the set of items
required to build illumos, this includes the compiler and various other
components.  This process is driven from the illumos-extra repository and
delivered into a subdirectory of the smartos-live root named `proto.strap/`.

Next, the build process accumulates from those various components a set of
objects into a subdirectory of the smartos-live root.  This subdirectory is
known as the proto area and by default is named `proto/`.  All objects that are
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

The manifests are aggregated and the resulting list of objects assembled into
lofi filesystems created in `/tmp`, which in turn are assembled into the
platform image itself.  This process is performed mainly by the `make live`
target, described below.

## Tools

As of June 2012, the Sun Studio compiler should no longer be executed as
part of the build process.  However, it is still used for building lint
libraries and for linting illumos.  Hopefully this dependency will be
removed in the future.

Additional build tools are required to be present on the build system;
`configure` (see below) will install them if you are building in a SmartOS
zone, which is the supported and recommended practice, see [Building SmartOS on
SmartOS](http://wiki.smartos.org/display/DOC/Building+SmartOS+on+SmartOS) in
the wiki for zone setup instructions.

## Build Steps

The `configure` script sets everything up for building including:

* ensures system has required packages installed (and is running on illumos!)

* ensures SUNWspro is installed in `/opt/SUNWspro`

* ensures that `projects/illumos/` exists and creates `illumos.sh` there

* ensures that `projects/illumos-extra/` exists

* optional: set the environment variable `MAX_JOBS` to set build job
  concurrency (useful for small systems)

### The `make world` Target

The operating system is built using the `make world` target.  This phase is the
longest part of the build process, and performs at least the following actions:

* The subset of illumos-extra required at build time to encode runtime
  dependencies into illumos is built, starting with gcc 4.4.4, and
  installed into the bootstrap proto area (by default, proto.strap).

* The illumos source in `projects/illumos/` (can be a link) is built with the
  aid of `tools/build_illumos` and installed into the proto area.  The
  compiler used is the one built in the first phase.

* All illumos-extra components are built and installed into the proto
  area.

* The local sources in the `src` subdirectory are built and installed into
  the proto area.

* Any extra projects found in the directory `projects/local/`, by default kvm and
  kvm-cmd, are built and installed into the proto area.

### The `make live` Target

The `make live` target constructs the bootable platform image from the operating
system components built by `make world`.  The heavy lifting is mostly implemented
in the `tools/build_live` script, which performs at least the following actions:

* The manifest is used, directories and links are created and files are taken:
    * from an overlay directory, in the order specified by the configure
      fragment's `OVERLAY` variable; then
    * from the proto area; finally
    * from the `man/man` subdirectory

* Then the image is packed up and put in `output/` with an expanded directory and
  a compressed tar archive, `platform-BUILDSTAMP.tgz`.

* Various customisations to the base operating system are applied, including
  the generation of `/etc/release`, `/etc/motd`, and so on, from templates.

* A log of the live image creation is written into the `log` subdirectory
  containing extensive trace output from the live image build process.  It
  also includes log entries from the `builder` tool describing the files
  packed into the image; e.g.,

  ```
  FILE: [path/to/file][PERM][owner/uid][group/gid]: OK (/path/to/source)
  LINK(symlink): source => target: OK
  LINK: source => target: OK
  DIR: [path/to/dir][PERM][owner/uid][group/gid]: OK
  ```

  If the build fails during this step, `tools/build_live` attempts to emit
  diagnostic output describing the problem.  If this output is not sufficient,
  the trace log can often contain further leads to debugging the problem.

## Creating Additional Build Artifacts

By default, the build only generates the `platform-BUILDSTAMP.tgz` file.  This
may also be transformed into a CD-ROM ISO image and a USB key image.  To
transform it into a CD-ROM ISO image, one may use the `make iso` target.  To
transform it into a USB image, one should use the `make usb` target.

## Known Issues

* There are still a small number of illumos-extra components that do not
  use the unified makefile system, and are built against the build system's
  headers and libraries. (TBD)

* python should be part of illumos-extra, as there are a small number of
  tools delivered that use it. (TBD)

* While there should never be a delivered object with build environment
  DT_RPATH leakage, there is currently no tool for checking this.
  ([OS-1122][OS-1122])

* There is also no tool for verifying that all objects delivered within
  the platform have no dependencies outside the platform.  This includes
  both runtime library linking and the execution of interpreters.
  ([OS-1122][OS-1122])

* illumos-extra recurses over all components even during an incremental
  build.  This is time-consuming and usually pointless. ([OS-1319][OS-1319])

* The complete set of build-order dependencies within illumos-extra
  probably has not been enumerated.  Doing so would allow for greater
  parallelism in that portion of the build.  In addition, it is likely
  that many of the components are actually unsafe to build in parallel
  internally. (TBD)

* The illumos-extra unified makefile system is not documented.

## Contributing

This repository uses [cr.joyent.us](https://cr.joyent.us) (Gerrit) for new
changes. Anyone can submit changes. To get started, see the [cr.joyent.us user
guide](https://github.com/joyent/joyent-gerrit/blob/master/docs/user/README.md).
This repo does not use GitHub pull requests.

All changes should have an associated issue. You can use the [GitHub issue
tracker](https://github.com/joyent/smartos-live/issues). (Joyent employees use
an internal JIRA exposed at <https://smartos.org/bugview>.)

Contributions should be `make check` clean.

If you are changing something non-trivial or user-facing, you may want to
discuss the issue with other developers on one of the following:

* The *smartos-discuss* mailing list. Once you [subscribe to the
  list](https://www.listbox.com/subscribe/?list_id=184463), you can send mail to
  the list address: smartos-discuss@lists.smartdatacenter.org.
  The mailing list archives are also [available on the
  web](https://www.listbox.com/member/archive/184463/=now).

* In the *#smartos* IRC channel on the [Freenode IRC
  network](https://freenode.net/).


## Other Notes

  * The resulting image requires a 64-bit x86 machine.

  * The build stamp, as well as a summary of the repositories from which the
    image was constructed, is available within the live image as `/etc/release`.

  * There is a manifest of shipped files created in the output area; i.e.,

    ```
    output/platform-BUILDSTAMP/i86pc/amd64/boot_archive.manifest
    ```

    This file contains a list of all files, directories, and links in the
    image, as well as the MD5 hash of the contents of all files.  The manifest
    is also available in the live image itself as `/usr/share/smartos/manifest`.

<!-- References -->
[OS-1122]: https://smartos.org/bugview/OS-1122
[OS-1319]: https://smartos.org/bugview/OS-1319
