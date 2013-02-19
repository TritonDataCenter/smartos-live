# fwadm

Repository: <https://github.com/joyent/smartos-live.git>
Browsing: <https://github.com/joyent/smartos-live/tree/master/src/fw>
Who: SmartOS mailing list <smartos-discuss@lists.smartos.org>
Docs: <https://github.com/joyent/smartos-live/tree/master/src/fw/README.md>
Tickets/bugs: <https://github.com/joyent/smartos-live/issues>


# Overview

fwadm is an adminstrative tool for managing VM firewalls.


# Repository

    etc/            Contains the bash completion file
    lib/            Source files.
    node_modules/   Committed node.js dependencies
    sbin/           Executables that are runnable as root
    test/           Test suite (using nodeunit)
    tools/          Dev tools, including jison for generating the rule parser


# Development

Before checking in, please run:

    make check

and fix any warnings. Note that jsstyle will stop after the first file with an
error, so you may need to run this multiple times while fixing.


# Testing

    make test

To run an individual test:

    ./test/runtest <path to test file>
