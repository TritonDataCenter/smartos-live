# diskinfo(1m) -- Provide disk device inventory and status

## SYNOPSIS

    diskinfo [-Hp] [{-c|-P}]


## DESCRIPTION

The diskinfo tool provides information about the disk devices in the system.
Because it interacts with the kernel's device management subsystem, this
tool can be used only from the global zone.  If run in any other zone, its
output will be incomplete and unreliable.

There are three main modes.  The default mode, when neither the **-c** nor
**-P** option is specified, provides a basic inventory of the disk devices
in the system.  Each line describes a single device and contains the
device's attachment bus or fabric type, the base name of the device in the
/dev/dsk directory, the disk's vendor and product identification strings,
the size (storage capacity) of the device, whether the device is removable,
and whether it is solid-state.

The **-P** option selects physical mode.  In this mode, each line of output
likewise describes one disk device; however, the fields provided indicate
the base name of the device in the /dev/dsk directory, the disk's vendor and
product identification strings, the serial number of the device, whether the
device is faulty as diagnosed by fmd(1M), whether the locate or
identification indicator is on for the device (if one is present), and the
chassis and bay number containing the disk if known.

The **-c** option selects compact mode.  This mode provides all of the
information provided by both the default mode and physical mode in a compact
format.

See OUTPUT FIELDS below for a detailed description of each column.

## OPTIONS

**-c**

Select compact mode output.  At most one of **-c** and **-P** may be
present on the command line.

**-H**

Do not print a header.  This provides output suitable for passing
into text processing tools.

**-P**

Select physical mode output.  At most one of **-P** and **-c** may
be present on the command line.

**-p**

Parseable output.  When **-p** is selected, the size (storage
capacity) is output in bytes instead of in human-readable units, and
the device's location (if known) is provided as a comma-separated
chassis and bay number instead of a human-readable location.  This
option may be used in any output mode and is intended for use by
scripts or other robotic tooling.


## OUTPUT FIELDS


  "DISK"

The base name of the device node within the /dev/dsk directory.  The
names of partitions and/or slices, if any, are derived from this name
as described by prtvtoc(1M).

This field is available in all output modes.

  "FLRS"

A condensed field incorporating the same information as the "FLT",
"LOC", "RMV", and "SSD" fields.  Each field is condensed to a single
character.  If the field is true, the first letter of the field name
will appear in its position in the string; otherwise, the "-"
character will appear instead.

This field is available only in compact output mode.

  "FLT"

A boolean field indicating whether the device is faulty;
specifically, whether the fault indicator (if one is present) is
active.

This field is available only in physical output mode.

  "LOC"

A boolean field indicating whether the locate or identify indicator,
if any, associated with the device's bay, is active.

This field is available only in physical output mode.

  "LOCATION"

The physical chassis and bay name (or chassis and bay numbers, if
**-p** is given) in which the device is located.  The chassis number
is identified in human-readable output within [ square brackets ];
chassis 0 is the host chassis itself.  The bay name, if any, is
provided by the enclosure, typically via a SCSI Enclosure Services
processor.

This field is available in compact and physical output modes.

  "PID"

The product identification string reported by the device.

This field is available in all output modes.

  "RMV"

A boolean field indicating whether the device is removable.  USB
storage devices, most optical drives and changers, and certain other
devices that report themselves as removable will be identified as
such.  SmartOS will not normally consider removable-media storage
devices to be candidates for its persistent storage pool.

This field is available only in default output mode.

  "SERIAL"

The serial number of the device.  The entire serial number is
reported if the device and its drivers provide it.

This field is available in compact and physical output modes.

  "SIZE"

The device's storage capacity.  If the **-p** option is given, this
is reported in bytes; otherwise, it is reported in a human-readable
format with units specified.  All units are based on powers of 2 and
are expressed in SI standard notation.

This field is available in compact and default output modes.

  "SSD"

A boolean field indicating whether the device is solid-state.  In
order to be correctly identified as solid-state, the device must
identify itself as such in the manner provided for by the T10 SPC-4
specification or another mechanism understood by sd(7D).  Not all
devices do so.

This field is available only in default output mode.

  "TYPE"

The transport (fabric or bus) type by which the storage device is
attached to the host, if known.  Typical transports include SCSI and
USB.

This field is available in compact and default output modes.

  "VID"

The vendor identification string reported by the device.

This field is available in all output modes.


## SEE ALSO

	fmd(1M), prtvtoc(1M), sd(7D)
