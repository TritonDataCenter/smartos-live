# mkzpool(1m) -- Create a zpool from a JSON specification

## SYNOPSIS

    mkzpool [-f] <pool> <file.json>


## DESCRIPTION

mkzpool functions as a wrapper around zpool(1M).  It creates a pool
named <pool> from a JSON specification in the file named <file.json>
instead of command-line arguments.  The input JSON must satisfy the
schema described in the disklayout(1M) output specification.

## OPTIONS

**-f**

Force.  This flag has the same meaning as the same flag when passed to
"zpool create".

## WARNINGS

Use of this command is subject to the same caveats and warnings as the
zpool(1M) create command.

## SEE ALSO

	disklayout(1M), zpool(1M)
