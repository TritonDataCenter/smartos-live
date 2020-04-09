# vminfo(1M) -- Vminfod Client Tool

## SYNOPSIS

    vminfo <SUBCOMMAND> [OPTIONS]

## DESCRIPTION

`vminfo(1M)` is a tool to interface with the `vminfod` service on a machine
using the exposed HTTP interface.  It can be used for administrators to
determine service level health and status.

## SUBCOMMANDS

**help**
    Print a help message and exit.

**ping**
    Ping the server (GET /ping) and return the output with the appropriate exit
    status code set.

**status [-j] [-f]**
    Show server status (GET /status).  Supply `-f` for "full" output (more
    internal details about vminfod's state) and `-j` for JSON output.

**vms**
    Return a JSON array of all VMs known by vminfod (GET /vms). To use this
    programatically prefer `vmadm lookp -j`.

**vm [uuid]**
    Return a JSON object for the VM uuid given known by vminfod (GET
    /vms/:uuid). To use this programatically prefer `vmadm get :uuid`.

**events**
    Connect to the events stream (GET /events) and print events as they come in.
    To use this programatically prefer `vmadm events`.

## EXAMPLES

`vminfo ping`
    Check if the service is up.

`vminfo status -f`
    Print full status.

## NOTES

This tool should be used for interactive output only, and is not meant to
provide a stable interface to use for vminfod.  If you are trying to interface
with `vminfod` use the `vmadm(1M)` command (especially `vmadm events`) and, for
internal platform code, the `vminfod/client` Node.js library.
