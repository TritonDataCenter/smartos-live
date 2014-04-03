# fwadm(1m) -- Manage SmartOS firewall rules


## SYNOPSIS

    fwadm add [-f <file>]                   add firewall rules or remote VMs
    fwadm delete <rule uuid>                delete a rule
    fwadm disable <rule uuid>               disable a rule
    fwadm enable <rule uuid>                enable a rule
    fwadm get <rule uuid>                   get a rule
    fwadm list                              list rules
    fwadm update [-f <file>] <rule uuid>    update firewall rules or data
    fwadm vms <rule uuid>                   list the UUIDs of VMs affected by a
                                            rule

    fwadm add-rvm [-f <file>]               add a remote VM
    fwadm delete-rvm <rvm uuid>             delete a remote VM
    fwadm get-rvm <rvm uuid>                get a remote VM
    fwadm list-rvms                         list remote VMs
    fwadm rvm-rules <rvm uuid>              list rules that apply to a remote VM

    fwadm rules <vm uuid>                   list rules that apply to a VM
    fwadm start <vm uuid>                   start a VM's firewall
    fwadm status <vm uuid>                  get the status of a VM's firewall
    fwadm stats <vm uuid>                   get rule statistics for a VM's
                                            firewall
    fwadm stop <vm uuid>                    stop a VM's firewall

    fwadm help [command]                    help on a specific subcommand


## DESCRIPTION

The fwadm tool allows you to manage firewall data on a SmartOS system. It
is primarily used to manage firewall rules and remote VMs.

Firewall rules are JSON objects. They contain a rule written in a
Domain-Specific Language, as well as other metadata.  See fwrule(5) and
the "EXAMPLES" section below for rule syntax.

Remote VMs are JSON objects. They represent VMs on other SmartOS hosts.
The format is similar to the vmadm(1M) format with most properties omitted
and some simplified properties. See the "REMOTE VMS", "REMOTE VM PROPERTIES"
and "EXAMPLES" sections below for details.

Firewall rules only apply to VMs that have the firewall_enabled property set
to true. Adding, updating or deleting firewall rules or remote VMs will reload
the firewalls of any VMs affected.


## OPTIONS

**-h, --help**
    Print help or subcommand help and exit.

**-v, --verbose**
    Output verbose diagnostic information. When a command results in an
    error, output the stack trace for that error.

**-j, --json**
    Output results or errors as JSON.


## SUBCOMMANDS

    The following commands and options are supported:

    fwadm help [command]

        Print general tool help or help on a specific command.


    fwadm add -f <file>
    fwadm add [-e] [--desc <description>] [-g] [-O <owner uuid>] <rule>

        Add firewall rules or remote VMs.  A single rule and its properties can
        be added using arguments and options, or the -f option can be used to
        pass a file containing a JSON object with one or many rules and remote
        VMs to be added. See the "EXAMPLES" section below for details on what to
        pass in the JSON object.

        Options:
            --desc <description>    Rule description
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.
            -e, --enable            Set the enabled property for the rule.
                                    Default is false.
            -f <filename>           Path to file containing JSON payload of
                                    firewall data to add.
            -g, --global            Set the global property for the rule.
            -O, --owner_uuid        Set the owner for the rule.
            --stdout                Output ipf rule lists for VM firewalls
                                    that were updated.

        Arguments:
            <rule>                  Firewall rule, written in the rule DSL.  See
                                    fwrule(5) for syntax.

        Examples:
            # Add a disabled rule with an owner by specifying it on the
            # commandline.
            fwadm add --owner_uuid=e6c73bd2-fae4-4e0a-af76-2c05d088b066 FROM \
                 any TO all vms ALLOW tcp PORT 22

            # Add an enabled global rule by specifying it on the commandline.
            fwadm add -g -e FROM any TO all vms ALLOW tcp PORT 22

            # Add a remote VM and a rule referencing that VM.
            echo '{
                "rules": [
                    {
                      "enabled": true,
                      "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
                      "rule": "FROM vm a223bec2-c62b-4fe7-babb-ad4c4d8441bb \
                           TO all vms ALLOW tcp PORT 22"
                    }
                ],
                "remoteVMs": [
                    {
                        "uuid": "5baca016-6dda-11e3-a6f2-730593c54f04",
                        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
                        "nics": [ { "ip": "172.29.0.2" } ],
                        "tags": { "role": "web" }
                    }
                ]
            }' | fwadm add
            

    fwadm add-rvm -f <file>

        Add a remote VM.

        Options:
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.
            --stdout                Output ipf rule lists for VM firewalls
                                    that were updated.


    fwadm delete <rule uuid>

        Delete a firewall rule.

        Options:
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.

        Arguments:
            <rule uuid>             Firewall rule UUID


    fwadm disable <rule uuid>

        Disable a firewall rule.

        Options:
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.

        Arguments:
            <rule uuid>             Firewall rule UUID


    fwadm enable <rule uuid>

        Enable a firewall rule.

        Options:
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.

        Arguments:
            <rule uuid>             Firewall rule UUID


    fwadm get <rule uuid>

        Get a firewall rule.

        Arguments:
            <rule uuid>             Firewall rule UUID


    fwadm list

        List firewall rules.

        Options:
            -d, --delim             Set the delimiting character for parseable
                                    output. Default is ":".
            -j, --json              Output results as JSON.
            -o, --fields            Rule properties to output.
            -p, --parseable         Output results in parseable format.

        Examples:
            # Output rule list in parseable format with the "|" character as a
            # delimiter.
            fwadm list -d "|" -p

            # Output only the uuid and rule fields in JSON format
            fwadm list -j -o uuid,rule
            

    fwadm update -f <file>
    fwadm update [-e] [--desc <description>] [-g] [-O <owner uuid>] <rule>

        Update firewall rules or remote VMs.  A single rule and its properties
        can be updated using arguments, or the -f option can be used to pass a
        file containing a JSON object with one or many rules and remote VMs to
        be updated. See the "EXAMPLES" section below for details on what to
        pass in the JSON object.

        Options:
            --desc <description>    Rule description
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.
            -e, --enable            Set the enabled property for the rule.
                                    Default is false.
            -f <filename>           Path to file containing JSON payload of
                                    firewall data to add.
            -g, --global            Set the global property for the rule.
            -O, --owner_uuid        Set the owner for the rule.
            --stdout                Output ipf rule lists for VM firewalls
                                    that were updated.

        Arguments:
            <rule>                  Firewall rule, written in the rule DSL.  See
                                    fwrule(5) for syntax.

        Examples:
            # Update a rule by specifying it on the commandline.
            fwadm update 71bf3c29-bcd3-42a4-b4cb-222585429a70 'FROM (tag www \
                 OR ip 172.30.0.250) TO tag db ALLOW tcp PORT 5432'

            # Add an IP to a remote VM.
            echo '{
                "remoteVMs": [
                    {
                        "uuid": "5baca016-6dda-11e3-a6f2-730593c54f04",
                        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
                        "ips": [ "172.29.0.2", "172.31.0.2" ],
                        "tags": { "role": "web" }
                    }
                ]
            }' | fwadm update
            

    fwadm vms <rule uuid>

        List the UUIDs of VMs affected by a rule.

        Arguments:
            <rule uuid>             Firewall rule UUID


    fwadm delete-rvm <rvm uuid>

        Delete a remote VM.

        Options:
            --dryrun                Output changes to be made, but don't write
                                    files to disk or reload VM firewalls.

        Arguments:
            <rvm uuid>              Remote VM UUID


    fwadm get-rvm <rvm uuid>

        Get a remote VM.

        Arguments:
            <rvm uuid>              Remote VM UUID


    fwadm list-rvms

        List remote VMs in JSON format.


    fwadm rvm-rules <rvm uuid>

        List rules that apply to a remote VM.

        Arguments:
            <rvm uuid>              Remote VM UUID


    fwadm rules <vm uuid>

        List rules that apply to a VM.

        Arguments:
            <vm uuid>               VM UUID


    fwadm start <vm uuid>

        Start the firewall for a VM.

        Arguments:
            <vm uuid>               VM UUID


    fwadm status [-v] <vm uuid>

        Get the firewall status (running, stopped) for a VM.

        Options:
            --v, --verbose          Output additional information about the
                                    firewall

        Arguments:
            <vm uuid>               VM UUID


    fwadm stats <vm uuid>

        Get ipfilter rule statistics for a VM's firewall.

        Arguments:
            <vm uuid>               VM UUID


    fwadm stop <vm uuid>

        Stop the firewall for a VM.

        Arguments:
            <vm uuid>               VM UUID


## REMOTE VMS

    The purpose of remote VMs is to allow VMs on other SmartOS hosts to be
    included when generating rules.  For example, if the following remote
    VM from another SmartOS host was added:

    {
        "uuid": "86abf627-5398-45ee-8e65-8260d3466e3f",
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "ips": [ "172.29.0.4" ],
        "tags": {
            "role": "bastion"
        }
    }

    And the following rule:
    {
        "description": "allow ssh from bastion host",
        "enabled": true,
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "rule": "FROM tag role=bastion TO all vms ALLOW tcp PORT 22"
    }

    
    The remote VM has the tag role with value bastion, which means that it
    matches the rule above. All VMs on this host with firewall_enabled set
    would then allow connections on TCP port 22 from that remote VM.

    This rule would also match, since it has the remote VM's UUID as a target:

    {
        "description": "block UDP port 5400 to bastion host",
        "enabled": true,
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "rule": "FROM all vms TO vm 86abf627-5398-45ee-8e65-8260d3466e3f \
             BLOCK udp PORT 54"
    }
    

## REMOTE VM PROPERTIES

    Remote VMs are simplified versions of the VM objects used by vmadm(1m).
    They are also in a JSON format, but only the properties below will be
    stored and used by fwadm. All other properties will be discarded. The
    properties used are:

    ips:

        Array of IP addresses for the remote VM. At least one IP from this
        property or the nics property below must be specified when creating
        or updating.

    nics:

        Array of nics, as per vmadm(1m). Only the "ip" property of each of
        these nic objects is required - all other properties will be ignored.
        This property is used for creation of remote VMs only - it is not
        stored in the object. IPs from these objects will be added to the ips
        array. This property is supported so the output of "vmadm get" on one
        host can be used in the input to "fwadm add" on another host.

    owner_uuid:

        Owner UUID. Only rules with a matching owner_uuid can use IPs for
        remote VMs with this property set.

    tags:

        vmadm(1m) tags object, mapping tag keys to values.

    uuid (required):

        UUID. This must not be the same as the UUID of any other remote VM or
        local VM managed by vmadm(1m).

    Note that VMs can be added and updated in this simplified representation,
    or using the same representation as "vmadm get". This enables the output
    of "vmadm get" or "vmadm lookup" to be input to the commands listed in the
    "SUBCOMMANDS" section.


## INTERACTION WITH VMADM(1M)

    fwadm relies on properties of VMs from vmadm(1m) in order to generate
    firewall rules correctly. Therefore, when vmadm is used to create a new
    VM or update properties on an existing VM that can affect firewall rules,
    it will update firewall rules through fwadm accordingly.

    As an example, if the following rules are present on a SmartOS host:

    {
        "description": "block all outgoing SMTP traffic",
        "enabled": true,
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "rule": "FROM tag blocksmtp TO any BLOCK tcp PORT 25"
    }

    {
        "description": "allow HTTP and HTTPS traffic",
        "enabled": true,
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "rule": "FROM any TO tag role=webserver ALLOW tcp (PORT 80 AND PORT \
             443)"
    }

    And then a VM is created with these parameters:

    {
        "brand": "joyent",
        "image_uuid": "01b2c898-945f-11e1-a523-af1afbe22822",
        "firewall_enabled": true,
        "nics": [
          {
            "nic_tag": "external",
            "ip": "10.88.88.59",
            "netmask": "255.255.255.0",
            "gateway": "10.88.88.2",
            "primary": true
          }
        ],
        "owner_uuid": "e6c73bd2-fae4-4e0a-af76-2c05d088b066",
        "ram": 128,
        "tags": {
            "blocksmtp": true
        },
        "uuid": "60e90d15-fb48-4bb9-90e6-1e1bb8269d1e"
    }

    The first rule would be applied to that VM.  If the following vmadm command
    was then run:

    echo '{ "set_tags": { "role": "webserver" } }' | vmadm update \
         60e90d15-fb48-4bb9-90e6-1e1bb8269d1e

    The second rule would then be applied to that VM in addition to the first.
    

## EXIT STATUS

The following exit values are returned:

     0
         Successful completion.

     1
         An error occurred.

     2
         Invalid usage.


## SEE ALSO

    vmadm(1m), fwrule(5), ipf(1m), ipfilter(5)
