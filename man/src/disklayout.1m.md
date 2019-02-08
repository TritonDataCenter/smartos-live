# disklayout(1m) -- Lay out a ZFS pool configuration from a disk inventory

## SYNOPSIS

    disklayout [-c] [-f file] [-s spares] [-w width] [layout]


## DESCRIPTION

disklayout generates a JSON description of a ZFS pool configuration
suitable for use by the mkzpool(1M) utility.  The utility may be run in
two modes; when the **-f** option is given, the specified file is taken
to be the output of the diskinfo(1M) command and used as the source of
information about the available disks.  Otherwise, the disks currently
present on the system will be enumerated and the utility will attempt to
generate a pool layout that uses as many of the available disks as
possible.  The generated layout will not contain any removable disks.

The utility does not create any pools, nor does it alter the contents of
the disks.  The generated JSON is written to standard output.  Its
format is described in detail in OUTPUT FIELDS below.

Unless the **-f** option is given, diskinfo must be used in the global
zone only so that it can enumerate the host's available disks.

## DEVICE ASSIGNMENT

Devices will be assigned to one of three basic roles: primary storage,
dedicated intent log ("log"), or second-level ARC (or "cache").  Devices
that are not known to be solid-state will not be assigned the log or
cache roles.  The assignment of solid-state devices to the log role will
be made before any are assigned the cache role.  Broadly, the intent is
to define a pool configuration that provides a good balance of
performance, durability, and usable capacity given the available device
inventory.  If there are inadequate devices to do this, disklayout will
attempt to define a functional pool with redundancy.  If there is a
single device, disklayout will define a pool with that single device.

If the number of spares has not been explicitly specified with the **-s**
option, then when at least 5 primary storage devices are available,
disklayout tries to allocate at least one spare. Additional spares may be
allocated as the total number of primary storage devices increases and/or
if the number of available primary storage devices does not divide evenly
by the number of devices per vdev with enough left over to provide the minimum
number of spares.

When constructing RAIDZ-type layouts, disklayout will consider a range
of stripe widths (i.e., number of leaf devices per RAIDZ-n vdev).  The
number of leaf devices per vdev will be at least 3 for RAIDZ, at least 5
for RAIDZ-2, and at least 7 for RAIDZ-3.  Some versions of this utility
may consider only stripes wider than the limits documented here.

Other than as described here, the heuristics used to select layouts and
to optimise allocation of devices are not an interface and are subject
to change at any time without notice.

## OPTIONS

**-c**

Prevent disklayout from allocating any disks as cache devices.

**-f file**

Use **file** as the source of information about available disks.  The
running system will not be interrogated; in this mode, the utility may
be used in a zone if desired.

**-s spares**

Specify **spares** as the number of disks to be be allocated as spares.

**-w width**

Specify **width** as the number of disks in the mirror or raidz vdevs.

**layout**

Specify the class of pool layout to generate.  By default, disklayout
selects a pool layout class based on the type, number, and size of
available storage devices.  If you specify a layout class, it will
generate a configuration of that class instead.  If it is not possible
to do so given the available devices, an error will occur; see ERRORS
below.  The set of supported layouts includes "single", "mirror", "raidz1",
"raidz2" and "raidz3", and will be listed if you specify an unsupported
layout.


## OUTPUT FIELDS


  "spares"

An array of device specifications that are allocated as hot spares.

  "vdevs"

An array of vdev specifications allocated to the active pool.

  "capacity"

The number of bytes of usable storage in the pool.  This is the amount
of user data that the pool can store, taking into account devices
reserved for spares and mirrored/parity devices.

  "logs"

An array of device specifications that are allocated as dedicated intent
log devices.  There is no internal structure; all log devices are
striped.

  "cache"

An array of device specifications that are allocated as dedicated
second-level ARC devices.  There is no internal structure.

## VDEV SPECIFICATIONS

A vdev specification contains the following properties:

  "type"

The vdev type, as defined by ZFS.  See zpool(1M).

  "devices"

An array of device specifications allocated to the vdev.

## DEVICE SPECIFICATIONS

Each device is specified by the following properties:

  "name"

The base name of the device's nodes under /dev/dsk.

  "vid"

The vendor identification string of the device.  See diskinfo(1M).

  "pid"

The product identification string of the device.  See diskinfo(1M).

  "size"

The storage capacity in bytes of the device.

## ERRORS

If the requested layout class cannot be satisfied by the available
devices, or if the set of available devices does not include any usable
primary storage devices, an error will occur.  The resulting JSON output
will contain the original device roster (in JSON format) and a text
description of the error.  This message is not localised.

## SEE ALSO

	diskinfo(1M), mkzpool(1M), sd(7D), zpool(1M)
