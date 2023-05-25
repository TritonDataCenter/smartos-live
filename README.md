# Quickstart

```
git clone https://github.com/TritonDataCenter/smartos-live.git
cd smartos-live
./configure
gmake world
gmake live
ls output/
```

# Overview

This repository is smartos-live, which builds a SmartOS platform image
containing the illumos core OS components; a set of "extra" mostly
third-party software required by illumos, by other SmartOS software, or
for system management; and a collection of utilities comprising
SmartOS-specific functionality found in `projects/local/`.

# Contents

- [Community](#community)
- [Bug Reports](#bug-reports)
- [Components of SmartOS](#components-of-smartos)
- [Building SmartOS](#building-smartos)
  * [Setting up a Build Environment](#setting-up-a-build-environment)
  * [Common Tasks](#common-tasks)
  * [Incremental Development](#incremental-development)
  * [Proto Area](#proto-area)
  * [Packaging and Manifests](#packaging-and-manifests)
- [Contributing](#contributing)
  * [Review](#review)
  * [Upstreaming](#upstreaming)
  * [Integration](#integration)
  * [Testing changes](#testing-changes)

# Community

You can interact with the SmartOS community in a number of ways. This
includes:

* The *smartos-discuss*
  [mailing list](https://smartos.topicbox.com/groups/smartos-discuss).
  If you wish to send mail to the list you'll need to join, but you can view
  and search the archives online without being a member.

* In the *#smartos* IRC channel on the [Libera Chat IRC
  network](https://libera.chat/).

# Bug Reports

If you encounter a problem, please reach out for assistance. You can file a
[GitHub issue](https://github.com/TritonDataCenter/smartos-live/issues) for
any problem you encounter. When filing a bug, please include the platform
version that you're running and a description of the problem.

If there was an operating system crash dump or a program generated a
core dump, it would be greatly appreciated if you could make that
available.

While there are multiple repositories that make up the smartos-live
image, if you're in doubt about where to file a bug or just are
uncertain, please file it on the [SmartOS live issue
tracker](https://github.com/TritonDataCenter/smartos-live/issues) and we'll
help from there. It's more important that the bug is recorded and we can work
on solving it than it end up in the right location.

# Components of SmartOS

SmartOS is made up of several different components. These components are:

## smartos-live

The [smartos-live](https://github.com/TritonDataCenter/smartos-live)
repository is the root of SmartOS. It has logic for how to build all of the
different components that make up SmartOS and has components that are
specific to the SmartOS live image environment. For example, it has tools
like `vmadm` and `imgadm`.

## illumos-joyent

The [illumos-joyent](https://github.com/TritonDataCenter/illumos-joyent)
repository is the core of the operating system. It represents SmartOS's
child of [illumos-gate](https://github.com/illumos/illumos-gate). This
has the core kernel, libraries, and user commands.

The illumos-joyent code can be found in the smartos-live tree under
`projects/illumos`. The SmartOS build only supports using illumos-joyent
and not stock illumos-gate.

## illumos-extra

The [illumos-extra](https://github.com/TritonDataCenter/illumos-extra)
repository contains a few different sets of software:

1. Software which is held at a specific version that is required for the
platform to build. For example, GNU binutils fall into this category.
1. Software which is required for illumos-gate to build and is required
at run time. This category includes things like OpenSSL and libz.
1. Extra software that we want to exist in the platform image at run
time. This category includes software like bash, curl, and Node.js.

illumos-extra serves to make sure that we have the specific versions of
software that we require at build time. The theory is that given a basic
working build machine of any illumos vintage, we can build the rest of
the platform and get the specific patched versions of software we need
from illumos-extra.

The illumos-extra code can be found in the smartos-live tree under
`projects/illumos-extra`.

### illumos-extra design

illumos-extra operates in a different fashion from the rest of the tree.
Because it consists solely of third-party software, it operates in a
different way. This software is often built using the GNU autotools.

Rather than modifying the software directly like we do in the rest of
the platform, we instead maintain a series of patches that we apply to a
stock release of the software, conventionally in a directory named
`Patches`.

illumos-extra will build the software at least once, but possibly more
times. For example, most software doesn't support building both a 32-bit
and 64-bit version of itself. We also build software that's required to
build the platform image against the host-system during a bootstrap
phase. For each version, we'll create a directory that uses the name and
version of the software appended with the bitness of the version and
whether or not it's the bootstrap phase. For example, if we were
building zlib-1.2.3.tar.gz, we'd see the following directories:

```
$ ls -1 libz/
...
zlib-1.2.3-32
zlib-1.2.3-32strap
zlib-1.2.3-64
zlib-1.2.3-64strap
zlib-1.2.3.tar.gz
...
```

Finally, while many tarballs are part of the repository, to keep down
the ever increasing size of the repository, we are transitioning to
having the contents stored externally and downloaded initially as part
of the set up process.

## Local Projects

There are a collection of extra projects that live in separate
repositories. Each of these projects lives in the `projects/local`
directory of the smartos-live root. The local projects system defines a
series of Makefile targets that a local project is required to implement.

The current set of local projects include:

* [illumos-kvm](https://github.com/TritonDataCenter/illumos-kvm)
* [illumos-kvm-cmd](https://github.com/TritonDataCenter/illumos-kvm-cmd) aka
QEMU
* [mdata-client](https://github.com/TritonDataCenter/mdata-client)
* [ur-agent](https://github.com/TritonDataCenter/sdc-ur-agent)

# Building SmartOS

## Setting up a Build Environment

The first step when building is to set up a build environment. The SmartOS
build requires building on SmartOS.  As of the `base-64-lts 21.4.0` build
image, the SmartOS Platform Image must be 20211007 or newer. This can be done
in VMware, on an existing SmartOS machine, or other virtualization. You must
build inside of a non-global zone.

### Minimum Platform Image

As of [OS-8412](https://smartos.org/bugview/OS-8412), OpenSSH requires OpenSSL
3.0 to build, which means that you'll need to use a platform that includes
[OS-8334](https://smartos.org/bugview/OS-8334). Release builds as of
20211216T012707Z will satisfy this requirement.

### Importing the Zone Image

The SmartOS build currently uses the `base-64-lts 21.4.0` image
which has a UUID of `c8715b60-7e98-11ec-82d1-03d16599f529 `. To import
the image, you should run the imgadm command from the global zone:

```
# imgadm import c8715b60-7e98-11ec-82d1-03d16599f529
Importing c8715b60-7e98-11ec-82d1-03d16599f529 (base-64-lts@21.4.0) from "https://images.smartos.org"
Gather image c8715b60-7e98-11ec-82d1-03d16599f529 ancestry
Must download and install 1 image (148.6 MiB)
Download 1 image     [=======================>] 100% 148.62MB 497.77KB/s  5m 5s
Downloaded image c8715b60-7e98-11ec-82d1-03d16599f529 (148.6 MiB)
...82d1-03d16599f529 [=======================>] 100% 148.62MB   5.12MB/s    29s
Imported image c8715b60-7e98-11ec-82d1-03d16599f529 (base-64-lts@21.4.0)
#
```

### Creating the Zone

To create a zone, you need to create a `joyent` branded zone with
`vmadm`. We recommend that the zone have the following attributes:

* The brand set to `"joyent"`
* The `image_uuid` set to `"c8715b60-7e98-11ec-82d1-03d16599f529"`
* At least 25 GiB of disk space specified in the `quota` property
* At least 2-4 GiB of DRAM specified in the `max-physical-memory`
property
* 1.5-2x the amount of DRAM in the `max_swap` property
* At least 1 network interface that can reach the Internet
* The `fs_allowed` property set to `"ufs,pcfs,tmpfs"`

For more information, please see the vmadm manual page and its EXAMPLES
section. Once written, you can validate your JSON file by running `vmadm
validate`. For example, if your JSON file was in /var/tmp/build.json you
would run:

```
# vmadm validate create -f /var/tmp/build.json
```

If there are problems, then it will tell you which portions of the JSON
are incorrect and need to be fixed. You can always check if a file is
valid JSON by using the `json` command as `json --validate -f
/var/tmp/build.json`

Once that's done, then you can create the VM using vmadm as:

```
# vmadm create -f /var/tmp/build.json
```
### Setting Up the Zone

While you can build as the root user, we recommend that you create a
user to do your day to day work as. If you do create that user there are
two things that you should do:

1. Make sure that the user has the 'Primary Administrator' privilege.
There are occasional parts of the build that require administrator
privileges and these will use `pfexec` to do so. To add a user to the
primary administrator role, as the root user in the zone, you should
run:

```
# usermod -P 'Primary Administrator' <user>
```

2. Make sure that the user's shell is set to `/bin/bash`. There have
occasionally been build issues when using different shells.  Ultimately,
those are bugs. If you do use another shell and encounter issues,
[please tell us](#bug-reports).

The final prerequisite is to make sure that `git` is installed. To do
that, you should run as your user:

```
$ pfexec pkgin -y in git
...
$
```

With this, you should be all set in your new environment. The normal
build process will make sure that any required packages are installed.

If you're running any of the release-engineering targets, the build will
also require Manta tools and `updates-imgadm` to be available on `$PATH`,
but most users are unlikely to need to build these targets.

## Basic Build Pattern

Once the build zone has been configured, you can kick off a build in a
few easy steps:

```
$ git clone https://github.com/TritonDataCenter/smartos-live
$ cd smartos-live
$ ./configure
$ gmake live
```

This will produce a tarball that contains the platform. The platform
will be placed in the `output` directory and a symlink to the latest
tarball will be there.

The configure script takes a few options that allow you to do a DEBUG
build, configure shadow compilers, etc. See `./configure -h`.

### Build Outputs

By default, running `gmake live` produces a directory and a tarball in
the `output` directory.  This can be used in Triton with the `sdcadm`
commands and can be used to boot through `ipxe` or other network boot
loaders.

It is also possible to create ISO and USB images. These images default
to the VGA console. To make an ISO or USB image you can run from the
root of the smartos-live repository:

```
$ ./tools/build_boot_image -r $ROOT
$ ./tools/build_boot_image -I -r $ROOT
$ ./tools/build_boot_image -I -r $ROOT -c ttyb # sets the default console to ttyb
```

These will create images in the `output-usb` and `output-iso`
directories based on the latest platform image.

## Build Order and Common Targets

When you kick off a smartos-live build (running `gmake live`), it will
build components in the following order:

1. illumos-extra bootstrap phase against the build system
2. illumos-joyent
3. illumos-extra main phase against the proto area
4. smartos-live src against the proto area
5. local projects against the proto area
6. assemble packaging manifests
7. assemble the platform tgz

If you run `gmake world` instead of `gmake live`, then the build will
stop after all of the components have been built.

The following summarizes the primary targets used on a day to day basis:

* `world`: Builds all the components
* `live`: Assembles the live image from the built components
* `check`: Runs various style and lint tools on code in smartos-live
* `clean`: Removes built artifacts and intermediate objects
* `update`: Updates all of the repositories to the latest
* `iso`: Builds a CD-ROM ISO image, defaulting to the VGA console
* `usb`: Builds a FAT 32 USB image, defaulting to the VGA console

## Build Targets for Release Engineering

This section is likely to only interest users who perform release builds
of SmartOS, or the Triton Platform Image.

When performing release builds, the following are convenient targets
which encapsulate the entire release process for a specific Triton
and/or SmartOS build variety:

* `common-release`: depends on `check`, `live` and `pkgsrc` targets and
   needs to be run before a subsequent `make` invocation of any of
   the `-release` targets below
* `smartos-release`: builds, publishes and uploads SmartOS artifacts
* `triton-release`: builds, publishes and uploads a Triton platform
  image
* `triton-and-smartos-release`: all of the above

The following are used by the targets listed above as part of the
release engineering process when publishing release builds of the
SmartOS and Triton platform image. There are varieties of each target
for both build flavors.

* `*-publish`: stage bits from the output directory, preparing for
  upload
* `*-bits-upload`: upload bits to either Manta, a remote filesystem
  and optionally, a Triton imgapi instance, defaulting to
  `updates.tritondatacenter.com`
* `*-bits-upload-latest`: as above, except attempt to re-upload the
  latest built bits, useful in case of interrupted uploads

The `bits-upload` tool comes from
[eng.git](http://github.com/TritonDataCenter/eng) which the build pulls in via
the `deps/eng` "git submodule" from the top-level of the workspace.

The upload can be influenced by the following shell environment
variables:

* `ENGBLD_DEST_OUT_PATH`: The path where we wish to upload bits. This is
  assumed to be relative to `$MANTA_USER` if using a Manta path.
  Otherwise this can be set to a local (or NFS) path where we wish to
  upload build arifacts.
* `ENGBLD_BITS_UPLOAD_LOCAL`: If set to `true`, this causes us to simply
  `cp(1)` bits to `$ENGBLD_DEST_OUT_PATH` rather than upload using
  Manta tools.
* `ENGBLD_BITS_UPLOAD_IMGAPI`: If set to `true`, this causes the build to
  also attempt to upload any Triton images found in the `output/bits`
  directory to an imgapi instance, which defaults to
  `updates.tritondatacenter.com`.

For Manta and imgapi uploads, the following environment variables are
used to configure the upload:

* `MANTA_USER`
* `MANTA_KEY_ID`
* `MANTA_URL`
* `UPDATES_IMGADM_URL`
* `UPDATES_IMGADM_IDENTITY`
* `UPDATES_IMGADM_CHANNEL`
* `UPDATES_IMGADM_USER`

For details on the default values of these variables, and how they are
used, see
[bits-upload.sh](https://github.com/TritonDataCenter/eng/blob/master/tools/bits-upload.sh)

Finally, release engineers may find the script
[`build_jenkins`](/tools/build_jenkins) useful, intended to be run
directly as part of a Jenkins job, invoking the targets above.

## Common Tasks

### Cleaning Up

To clean out all the built contents of the various repositories, there
is a top level 'clean' target. This will remove all of the built
artifacts, the proto area, and will descend into each component and
clean them up. For example, this will end up running `dmake clobber` in
illumos-joyent to clean up all of its contents.

Occasionally, there are bugs which cause some files to be missed. If you
encounter that, you can use git's `git clean -fdx` command to clean up.
However, please be careful when using this command as if you have new
files that aren't in the git repository, this will mistakenly remove
them. If you encounter cases where we're not properly removing files,
please report a bug.

### Updating

To update all of the repositories that are part of the platform, you
should first make sure that all of your changes have been committed.
Once they have been, you can run the following from the root of the
smartos-live repository:

```
$ gmake update
```

Which will go through and update every repository. If a repository has
changed, it will also remove the corresponding stamp file that controls
its building. If you have local changes in the repository, then it will
rebase your local changes (as though it had run `git pull --rebase`) on
top of everything.

If you haven't updated in a while, you may want to clean your
repositories and kick off a full build again before performing
incremental building. Occasionally, there will be flag days that will
require you to rerun `./configure` before proceeding.

### Changing Branches

Most of the time, all development happens on the `master` branch. All
SmartOS images are built from the master branch and the general theory
is that the master branch should always build, run, and be of a high
enough quality that we could cut a release at any time.

While developing, you may want to use local branches, sometimes there
are longer lived branches that exist for project development or for
releases. To automate the configuration of branches when creating the
`projects` directory, create a file called `configure-projects` in the
root of the smartos-live repository.

The `configure-projects` file takes the format:

```
<path relative to ./projects>:<project branch>:[project git repo URL or path]
```

The special token `origin` can be used in place of a full git repo URL to denote
the standard github.com location for that project.  If no URL is given, we
default to github.com.

If you update the branch name that corresponds to a repository, rerun
`./configure` to make sure that every branch is set to the correct
one, except that of smartos-live which needs to be changed manually.

Not all repositories have to be on the same branch. It's totally fine to
mix and match.

### Additional build customization

Several variables can also be set in a shell script at the top of the
smartos-live repository called `configure-build` and are sourced by `configure`
if this file exists. This allows you to override `configure` script defaults,
or include additional pre-build customization.

If this file does not exist, the following defaults are set by `configure`:

```
PUBLISHER="joyent"
RELEASE_VER="joyent_147"
ON_CLOSED_BINS_URL="https://us-east.manta.joyent.com/Joyent_Dev/public/releng/illumos/on-closed-bins.i386.tar.bz2"
ON_CLOSED_BINS_ND_URL="https://us-east.manta.joyent.com/Joyent_Dev/public/releng/illumos/on-closed-bins-nd.i386.tar.bz2"
ILLUMOS_ADJUNCT_TARBALL_URL="https://us-east.manta.joyent.com/Joyent_Dev/public/releng/adjuncts/illumos-adjunct.20210922.tgz"
```

### Debug Builds

By default, all of SmartOS is built non-debug. It is possible to build a
debug build of SmartOS. This debug build primarily changes things by
creating a debug build of illumos. A debug build of illumos will result
in various things such as:

* Additional assertions
* Additional log messages
* Kernel memory debugging being enabled by default
* Several daemons will enable user land memory debugging

Note, the overhead of some things like kernel memory debugging is
non-trivial. Debug builds should not be used for performance testing. In
addition, there will be substantially more memory used as a result.

However, for development and bring up, a debug build can be invaluable.
To enable a debug build in a fresh build environment, you can specify
arguments when running `./configure` to take care of it. For example, you
would modify the normal workflow as follows:

```
$ git clone https://github.com/TritonDataCenter/smartos-live
$ cd smartos-live
$ ./configure -d
$ gmake live
```

If you have an existing build environment, you can modify the
`illumos.sh` file that is generated to cause it to perform a debug
build. However, if you have already built illumos, it is recommended
that you clobber it before doing anything else. For example:

```
$ gmake clobber
$ vi projects/illumos/illumos.sh
# Add -DF to the NIGHTLY_OPTIONS line
$ gmake live
```

The `-D` flag indicates that a debug build should be performed while the
`-F` flag indicates that we should not perform both a debug and
non-debug build. This is done because we do not set up the build to
support multiple proto-areas, this will end up just causing the system
to clobber one build with the other. For more information on the nightly
flags, see [nightly(1ONBLD)](https://illumos.org/man/1onbld/nightly)

### Controlling Maximum Number of Jobs

By default, the build will determine the maximum number of jobs to use
based on the DRAM and CPU available in the zone. However, there are
times where you may want to control this manually. To do this, you
should set the `MAX_JOBS` environment variable.

## Incremental Development

Each of the different build phases is represented with a stamp file that
exists in the root of the smartos-live clone. These files are named based
on the directory. For example `0-illumos-stamp` and
`0-subdir-mdata-client-stamp`.

If you remove one of these stamp files, the component will be rebuilt
and anything which depends on it will be. For example, if you remove
`0-illumos-stamp`, it will end up causing illumos-extra to be rebuilt
(as it depends on the contents of illumos) and all of the local projects
will be rebuilt. Each of these components will be built incrementally.
They will not be rebuilt from scratch unless they are cleaned up.

The one project which is different here is illumos-extra. illumos-extra
has two stamps: the `0-strap-stamp` and the `0-extra-stamp`. The
`0-strap-stamp` represents building the bootstrap phase of
illumos-extra. This is the version of illumos-extra which builds the
dependencies we need for the build. These are built against the host
build system. After illumos is built, we then move onto the primary
phase of illumos-extra where we build everything that we need against
the proto area. This represents the `0-extra-stamp`.

To rebuild most components you can simply remove the stamp file and
build that stamp file again. For illumos and illumos-extra this may
prove to be rather cumbersome. For incremental building of these
components, we recommend that you first build the system completely
before performing any incremental work.

### Incremental Building of illumos

If you are going to perform incremental building of illumos, you should
first familiarize yourself with the [illumos Developer's
Guide](https://www.illumos.org/books/dev/). If you simply remove the
`0-illumos-stamp` file, this will perform an incremental nightly build.

However, for most iterations, this can be cumbersome. Here, you can use
the `bldenv(1ONBLD)` tool. To use `bldenv`, follow the following steps
from the root of the smartos-live repository:

```
$ cd projects/illumos/usr/src
$ ./tools/proto/root_i386-nd/opt/onbld/bin/bldenv ../../illumos.sh
```

From here, you can follow the [illumos Developer's
Guide](https://www.illumos.org/books/dev/workflow.html#incremental-building)
with respect to building individual components. If you build everything
that you need and it has no impact on other components in the broader
SmartOS build, then once you are complete, you can run `gmake live` again.
For example, if you're iterating on a driver or command of some kind in
the platform then you can simply use `dmake install` to get the build
artifacts into the proto area and then run `gmake live` at the top level
of smartos-live to rebuild the platform image.

In addition, depending on what you're working on, you can also sometimes
copy over build artifacts over to the running system and use them out of
`/var/tmp/`. For example, if you're iterating on a single command. Rather
than building the live image time and time again, a more common approach
is to use `bldenv` and make that single command or library again and copy
it over to a running system to test against. Even if the vast majority
of development is done this way, it's still important to always test a
full build at the end.

The top-level tool `./tools/build_illumos` in the smartos-live
repository will execute an incremental nightly(1ONBLD) build. This will
perform the same actions as if you removed the `0-illumos-stamp` and ran
`gmake 0-illumos-stamp` at the top-level. However, manually invoking it
will not cause dependent items to be rebuilt. This comes with the same
risks and rewards of using `bldenv`.

### Iterating on illumos-extra

If you're working on the bootstrap phase, make sure you're not using a cached
`proto.strap` first. Using `./configure -r` will tell `./tools/build_strap` not
to download a pre-built tarball for `proto.strap`, but instead do a full strap
build of illumos-extra. Remember to explicitly `rm 0-strap-stamp`.

Working on illumos-extra can sometimes be frustrating if you're simply
building it from the top-level via the stamp each time. This is because
some parts of GCC and other software will often be rebuilt. It is
possible to rebuild just a single directory by manually invoking what
the Makefile would do. Note, that this manual process requires you to
use the path of the repository that you're operating on.

The simplest way to figure out how to rebuild what you need is to examine the
make output from a build. For example, if you were iterating on gas and the root
of the smartos-live repository was at `/home/rm/src/mdb_v8`, then you might run
a manual command like:

```
$ cd projects/illumos-extra/binutils
$ STRAP= \
  CTFMERGE=/home/rm/src/mdb_v8/projects/illumos/usr/src/tools/proto/*/opt/onbld/bin/i386/ctfmerge \
  CTFCONVERT=/home/rm/src/mdb_v8/projects/illumos/usr/src/tools/proto/*/opt/onbld/bin/i386/ctfconvert \
  gmake DESTDIR=/home/rm/src/mdb_v8/proto install
```

Please do not take the above command and run it in your environment.
This is meant to be an example. The actual illumos-extra per-directory
invocation may have changed. This will also vary whether or not you're
operating during the bootstrap phase or not.

By default, running the `install` target will perform an incremental
build. If a partial build has been completed, the source will not be
extracted again and patches will not be applied. If you're changing any
patches that apply or configure options, you should use the `clean`
target inside of the target directory.

### Iterating on vmadm and imgadm

While working on `vmadm` and `imgadm` there often isn't a need to rebuild
the platform image every single time that you want to make a change. A
script called `tools/rsync-to` exists which will synchronize all of your
local change from the smartos-live `src/vm` and `src/img` directories
and apply them to the target server by copying them into `/var/tmp/` and
then performing a lofs mount.

## Proto Area

When various pieces of software build, they are eventually installed
into a proto area. The proto area represents the file system layout of
what will become the platform image. For example, the contents of the
`/usr` directory in the proto area will be used in the built platform
area. Note, the entire contents of the proto area are not included. The
specific set of files is determined by the manifests, which will be
discussed in a later section.

The root of the proto area is in the `proto` directory under the root of
the smartos-live git clone.

Binaries in the proto area should be thought of as cross-compiled
binaries. While in our case, we are building x86 on x86, the binaries
and libraries should not be assumed to work on the existing system. That
said, in many cases you can get away with it. However, testing out of
the proto area is no substitute for doing full testing.

## Packaging and Manifests

There are a lot of items which are installed into the proto area.
However, not everything installed into the proto area is actually placed
inside the live image. To determine the items that are a part of the
live image, each repository that makes up the platform has a `manifest`
file.

The manifest files for each repository are combined into one large
manifest file. This manifest file is used by the `builder` program found
in smartos-live in the `tools/builder` directory.

Each line of a manifest file contains a single file, directory, symlink,
or hardlink directive. Comments are done with the `#` character. For example:

```
#
# This is a file:
# f path/to/file <perms> <user> <group>
# This is a directory:
# d path/to/dir <perms> <user> <group>
# This is a symlink:
# s <target>=<source>
# This is a hardlink:
# h <target>=<source>
# For example:
#
d usr 0755 root sys
d usr/bin 0755 root sys
f usr/bin/grep 0555 root bin
h usr/bin/egrep=usr/bin/grep
s usr/bin/coolgrep=usr/bin/grep
```

Something that we deliver should only ever be added to the manifest file
from the repository that builds it. For example, because illumos-joyent
delivers `/usr/sbin/dtrace` it should be in the manifest file for
illumos-joyent and not any other repository. Keeping them separate this
way allows us to minimize build-time flag days that require updating
multiple repositories at once.

### Device Drivers

For SmartOS, adding a device driver involves updating files that are
assembled at run-time under vanilla illumos. You should check and update if
necessary the following files under `projects/illumos`:

```
usr/src/uts/intel/os/device_policy
usr/src/uts/intel/os/driver_aliases
usr/src/uts/intel/os/driver_classes
usr/src/uts/intel/os/name_to_major
usr/src/uts/intel/os/minor_perm
```

# Contributing

All the repositories contained within this build use GitHub pull requests for
new changes.

All changes should have an associated issue. You can use the [GitHub
issue tracker](https://github.com/TritonDataCenter/smartos-live/issues). MNX
employees use an internal JIRA exposed at
<https://smartos.org/bugview>. The commit message should be of this form:

```
TritonDataCenter/smartos-live#9999 make some changes (#23)

TritonDataCenter/smartos-live#10000 make a related change
Reviewed by: Steve Reviewer <steve.reviewer@gmail.com>
Approved by: Amy Approver <amy.approver@gmail.com>
```

The first line should be the bug ID and title, optionally followed by the PR
number as added by GitHub. After a blank line, the commit body should list any
additional bugs fixed in this change, along with the usual reviewer tags.

In addition to at least one code review, you will need to document your testing
and gain "integration approval" (the Approved by tag).

If you would like to make a change to `illumos-joyent` specifically, please see
[Upstreaming](#upstreaming) below.

## Review

In general, before putting something up for review, some amount of
testing should have already been done. Once you post it for review, then
you need to seek out reviewers. A good first step for finding reviewers
is to see who has worked on changes in similar areas. A good way to do
this is to use `git log` in portions of the source tree and note who the
authors, reviewers, and approvers have been. This can often be a good
source of trying to figure out who to ask.

If you're not sure of who to ask or are having trouble finding someone,
then consider asking in a public forum such as internal chat or IRC.
Even if you're not sure if someone would make sense as a reviewer or
not, don't hesitate to reach out and folks will help you find or suggest
reviewers. For more information on where to reach out, see
[Community](#community).

## Upstreaming

If you are making a change to `illumos-joyent`, please consider contributing
directly to [illumos-gate](https://github.com/illumos/illumos-gate) instead.
We automatically merge this into `illumos-joyent` every working day, so your fix
will soon make it into SmartOS itself.

The default case should be contributing directly to upstream. However, in areas
of significant divergence, such as `lx` brand or certain areas of the networking
stack, this may not be the best choice.

## Integration

When thinking about integrating, the following are questions that you or
your approver should be asking:

* Have I tested this in all the ways I can think of? Might this impact
standalone SmartOS or Triton in some way?
* Have I documented any new commands or interfaces in manual pages?
* Have I built this both debug and non-debug?
* Have I reviewed the `git pbchk` output when working in bldenv in
illumos-joyent?
* Have I run any appropriate `make check` targets?
* Have I looked for memory leaks?
* Have I performed appropriate stress testing to try and find issues
that might only arise after prolonged use?
* Is this a particularly risky change? If so, should I wait
until the start of the next release cycle to integrate?
* Are there any heads-up notices I need to send as part of this? For
example, this might happen because of a flag day.
* Have I added a new tool that's required to run at build-time and
tested this on older platform images?

Prior to a PR being merged, it must have at least one code reviewer and one
approver. They can be the same person, but two sets of eyes are preferred.

## Testing changes

A large part of development in the platform should be focused around
testing. Some components such as vmadm and DTrace have extensive test
suites. Other components often don't have as extensive test suites. Some
components, such as device drivers, often have none.

You should always ask yourself what kinds of unit tests or regression
tests can we add that would cover this behavior and add that to the
general test suite wherever possible. Otherwise, the useful thing to do
is to try and understand and think through all the different ways that
your change interacts with the system. What components have been changed
and what has been impacted.

For example, if changing a public header in the operating system, the
impact can often be beyond just the software in the platform. That might
impact all the third-party software that is built via pkgsrc and so it
may be appropriate to compare pkgsrc bulk builds before and after the
change.

If changing a device driver, you may need to track down multiple
generations of said hardware to test against to verify that there aren't
regressions.

Along with the various build artifacts created by the SmartOS build that
deliver the operating system media, we produce a tarball containing the
test suites that were included in the 'illumos-joyent' repository.

A wrapper script is included in the archive which can configure a test system
to run these tests, will extract the tests to the correct location on the
system, and will optionally execute some of the included test suites.

It has the following usage:

```
[root@kura ~]# /opt/smartos-test/bin/smartos-test -h
Usage: smartos-test [-h] [-c] [-e] [-r] [-w] <path to tests.tgz>

At least one of -c, -e, -r is required.

  -h       print usage
  -c       configure the system for testing
  -e       execute known tests
  -f       skip the check to ensure platform version == test version
  -r       snapshot or rollback to zones/opt@system-test-smartos-test
           before doing any system configuration or test execution
  -w       when mounting the lofs /usr, make it writable

```

Developers should extract the script from the test archive, then run it with an
argument that points to the test archive, and use one or more of the options
`-r`, `-c`, `-e`.

When called with all of the options listed above, `smartos-test` will do the
following:

* verify we're running on the global zone
* verify that the user has indicated that no production data exists on this
  system
* verify that the test archive version matches the version of the running
  SmartOS instance
* take a named-snapshot of /opt if one doesn't already exist, or rollback to
  that snapshot prior to extracting the tests to /opt
* create an lofs-mount of /usr in order to extract portions of the test archive
  that need to reside there
* temporarily add any local user accounts needed to execute tests
* download a pkgsrc bootstrap to /opt and install the pkgsrc dependencies
  needed to run the tests
* execute the tests serially, accumulating result codes
* exit 0 if all tests passed, or 1 if one or more tests failed

For example:

```
[root@kura /var/tmp]# tar zvxf tests-test_archive-master-20191001T134222Z.tgz ./opt/smartos-test
Decompressing 'tests-test_archive-master-20191001T134222Z.tgz' with '/usr/bin/gzcat'...
x ./opt/smartos-test, 0 bytes, 0 tape blocks
x ./opt/smartos-test/README, 958 bytes, 2 tape blocks
x ./opt/smartos-test/bin, 0 bytes, 0 tape blocks
x ./opt/smartos-test/bin/smartos-test, 10062 bytes, 20 tape blocks

[root@kura /var/tmp]# ./opt/smartos-test/bin/smartos-test -rce ./tests-test_archive-master-20191001T134222Z.tgz
Platform version: 20191001T134222Z
   Tests version: 20191001T134222Z
To setup and run these tests you must create the file:
    /lib/sdc/.sdc-test-no-production-data
after ensuring you have no production data on this system.
[root@kura /var/tmp]# touch /lib/sdc/.sdc-test-no-production-data

[root@kura /var/tmp]# ./opt/smartos-test/bin/smartos-test -rce ./tests-test_archive-master-20191001T134222Z.tgz
Platform version: 20191001T134222Z
   Tests version: 20191001T134222Z
Running zfs snapshot zones/opt@system-test-smartos-test
Creating new lofs mount for /usr on /var/tmp/smartos-test-loopback
820704 blocks
Running tar -xzf ./tests-test_archive-master-20191001T134222Z.tgz -C /var/tmp/smartos-test-loopback ./usr
Running mount -O -F lofs -o ro /var/tmp/smartos-test-loopback/usr /usr
Running tar -xzf ./tests-test_archive-master-20191001T134222Z.tgz -C / ./opt ./kernel ./tests.manifest.gen ./tests.buildstamp
adding cyrus user
adding ztest user
Running curl -kO https://pkgsrc.smartos.org/packages/SmartOS/bootstrap/bootstrap-2021Q4-tools.tar.gz
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 22.9M  100 22.9M    0     0   566k      0  0:00:41  0:00:41 --:--:--  577k
Running tar -zxpf bootstrap-2021Q4-tools.tar.gz -C /
Running ln -s /opt/tools /opt/local
Running pkgin -y in python27 sudo coreutils gcc7 gmake
reading local summary...
processing local summary...
processing remote summary (https://pkgsrc.smartos.org/packages/SmartOS/2021Q4/tools/All)...
pkg_summary.xz                                                                                        100%  120KB 119.9KB/s   00:00
calculating dependencies...done.

1 package to refresh:
  bzip2-1.0.8

13 packages to install:
  libiconv-1.14nb3 tcp_wrappers-7.6.4 libffi-3.2.1nb4 gettext-lib-0.19.8.1 db4-4.8.30 openldap-client-2.4.47 cyrus-sasl-2.1.27
  binutils-2.26.1nb1 python27-2.7.15nb1 sudo-1.8.26 coreutils-8.29nb1 gcc7-7.3.0nb4 gmake-4.2.1nb1

1 to refresh, 0 to upgrade, 13 to install
137M to download, 415M to install

libiconv-1.14nb3.tgz                                                                                  100% 2068KB 689.3KB/s   00:03
libffi-3.2.1nb4.tgz                                                                                   100%   59KB  59.4KB/s   00:00
gettext-lib-0.19.8.1.tgz                                                                              100%   67KB  67.3KB/s   00:00

.
. (output omitted for brevity)
.

gcc7-7.3.0nb4: registering info file /opt/tools/gcc7/info/libquadmath.info
installing gmake-4.2.1nb1...
gmake-4.2.1nb1: registering info file /opt/tools/info/make.info
pkg_install warnings: 0, errors: 0
reading local summary...
processing local summary...
marking python27-2.7.15nb1 as non auto-removable
marking sudo-1.8.26 as non auto-removable
marking coreutils-8.29nb1 as non auto-removable
marking gcc7-7.3.0nb4 as non auto-removable
marking gmake-4.2.1nb1 as non auto-removable
Starting test runs

Starting test for bhyvetest with /opt/bhyvetest/bin/bhyvetest -ak
Starting tests...
output directory: /var/tmp/bhyvetest.23953
Executing test /opt/bhyvetest/tst/mevent/lists.delete.exe ... passed
Executing test /opt/bhyvetest/tst/mevent/read.disable.exe ... passed
Executing test /opt/bhyvetest/tst/mevent/read.pause.exe ... passed
Executing test /opt/bhyvetest/tst/mevent/read.requeue.exe ... passed

-------------
Results
-------------

Tests passed: 4
Tests failed: 0
Tests ran:    4

Congrats, some tiny parts of bhyve aren't completely broken, the tests pass.

Starting test-runner for crypto-tests with /opt/crypto-tests/runfiles/default.run
Test: /opt/crypto-tests/tests/aes/kcf/setup (run as root)         [00:00] [PASS]
Test: /opt/crypto-tests/tests/aes/kcf/aes_cbc_32 (run as root)    [00:00] [PASS]
Test: /opt/crypto-tests/tests/aes/kcf/aes_ccm_32 (run as root)    [00:00] [PASS]

.
. (output omitted for brevity)
.

Test: /opt/util-tests/tests/vnic-mtu (run as root)                [00:00] [PASS]
Test: /opt/util-tests/tests/xargs_test (run as root)              [00:00] [PASS]
Test: /opt/util-tests/tests/awk/runtests.sh (run as nobody)       [02:35] [PASS]
Test: /opt/util-tests/tests/ctf/precheck (run as root)            [00:00] [PASS]
Test: /opt/util-tests/tests/ctf/ctftest (run as root)             [00:06] [PASS]
Test: /opt/util-tests/tests/demangle/afl-fast (run as root)       [00:01] [PASS]
Test: /opt/util-tests/tests/demangle/gcc-libstdc++ (run as root)  [00:00] [PASS]
Test: /opt/util-tests/tests/demangle/llvm-stdcxxabi (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_00_blank (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_01_boolean (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_02_numbers (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_03_empty_arrays (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_04_number_arrays (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_05_strings (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_06_nested (run as root) [00:00] [PASS]
Test: /opt/util-tests/tests/libnvpair_json/json_07_nested_arrays (run as root) [00:00] [PASS]

Results Summary
PASS      30

Running Time:   00:02:47
Percent passed: 100.0%
Log directory:  /var/tmp/test_results/20191002T101510
[root@kura /var/tmp]#
```

Note that each test suite emits its own results summary. If any test suites
failed, the names of those suites are emitted by `smartos-test` just before
the script exits.

When developers are adding tests to illumos, they should ensure that new
tests are added to `$SRC/usr/src/pkg/manifests/\*.p5m` as these IPS
manifests are used to generate the test archive during the SmartOS build.

## Public Interfaces

One important thing to always think about is whether or not the thing
that's changing is a public interface or not. If this is a standard
command or a library function that's been documented or is part of a
mapfile section, then it probably is.

When changing a public interface, you need to always pause and work
through several cases and make sure that we aren't breaking backwards
compatibility.  Some questions to ask include ones like:

1. If I take an old binary and use it against the new library, what
happens?
2. If I had written a shell script that used a command and the output
changed, what will happen?
3. What expectations come from standards or other system about these
issues?

These are intended to help guide understand the impact and risk related
to the change.

## Mapfiles

We have a hard rule: a public mapfile version should not be added directly
to illumos-joyent. Instead, if you need to add a new version to a mapfile,
it should be done directly via contributing to illumos-gate.

If for some reason that's not feasible, then it should be added to a private
version and moved to a public version if/when it is upstreamed to illumos.

If the library in question is specific to illumos-joyent, then it's
alright to version it. However, this is not true for the vast majority
of libraries.
