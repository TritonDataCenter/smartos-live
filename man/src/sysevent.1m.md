# sysevent(1M) -- Sysevent watcher

## SYNOPSIS

    sysevent [-j] [class] [subclass1] [subclass2] [...]

## DESCRIPTION

The `sysevent(1M)` tool allows watching for arbitrary sysevents from both the
kernel and userland programs.  This program will run indefinitely, emitting
output on stdout whenever a sysevent is generated.  This is a debugging tool;
options and output are still evolving and may change in the future.

Optionally, a class can be specified as the first operand to limit which
sysevents will be watched, as well as subclasses specified as the
subsequent operands to further limit the matching events.

By default the output is meant to be consumed by humans and is not easily
parseable - passing `-j` will cause the program to emit newline separated
JSON to stdout instead for easy machine parsing.

## GENERAL OPTIONS

**-c <channel>**
    Bind to the event channel.

**-h**
    Print help and exit.

**-j**
    JSON output.

**-r**
    Print 'ready' event at start.

## EXAMPLES

`sysevent`
    Watch for all sysevents on a system and print human-readable
    output.

`sysevent -j`
    Same as above, but print newline separated JSON output.

`sysevent EC_zfs`
    Watch for all events related to ZFS.

`sysevent EC_zfs ESC_ZFS_history_event`
    Watch for only ZFS command events (streaming `zpool history`
    effectively).

`sysevent -c com.sun:zones:status status`
    Watch for only "status" class events in the zones channel

## NOTES

- This tool does not work at all in non-global zones.
- The `time` attribute for each event represents when the event was received by
this tool, not necessarily when the event was generated.
