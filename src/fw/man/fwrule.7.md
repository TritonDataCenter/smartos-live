# fwrule(7) -- SmartOS fwadm firewall rule syntax


## OVERVIEW

The base policy for a VM with its firewall enabled is:

* block all inbound traffic
* allow all outbound traffic

All firewall rules applied to a VM are applied on top of those defaults.
Firewall rules can affect one VM (using the vm target) or many (using the
tag or all vms target types).

Adding and updating rules takes effect immediately.  Adding or removing
tags on a VM causes rules that apply to those tags to be added or removed
immediately.

In the case of two rules that affect the same VM and port, the rule that
goes counter to the default policy takes precedence.  This means:

* If you have an incoming BLOCK and an incoming ALLOW rule for the
  same VM and port, the ALLOW will override.
* If you have an outgoing BLOCK and an outgoing ALLOW rule for the
  same VM and port, the BLOCK will override.


## RULE PAYLOAD

Rules are created and updated using a JSON payload as in this example:

    {
        "rule": "FROM any TO all vms ALLOW tcp port 22",
        "enabled": true,
        "owner_uuid": "5c3ea269-75b8-42fa-badc-956684fb4d4e"
    }

The properties of this payload are:

* **rule** (required): the firewall rule.  See the Rule Syntax section below
  for the syntax.
* **enabled** (boolean, optional): If set to true, the rule will be applied
  to VMs.  If set to false, the rule will be added but not applied.
* **global** (boolean, optional): If set, the rule will be applied to all VMs
  in the datacenter, regardless of owner.
* **owner_uuid** (UUID, optional): If set, restricts the set of VMs that
  the rule can be applied to VMs owned by this UUID.

Note that only one of **owner_uuid** or **global** can be set at a time for
a rule.


## RULE SYNTAX

Firewall rules are in the following format:

    FROM <from targets> TO <to targets> <action> <protocol> \
         <ports or types>
    
The parameters are the following:

**from targets** and **to targets** can be any of the following types
(see the Target Types section below):

* vm <uuid>
* ip <IPv4 or IPv6 address>
* subnet <subnet CIDR>
* tag <tag name>
* tag <tag name>=<tag value>
* a target list of up to 32 of the above
* all vms
* any

**action** can be one of (see the Actions section below):

* ALLOW
* BLOCK

**protocol** can be one of (see the Protocols section below):

* tcp
* udp
* icmp
* icmp6

**ports** or **types** can be one of (see the Ports section below):

* port <port number> (if protocol is tcp or udp)
* ports <port numbers and ranges> (if protocol is tcp or udp)
* type <ICMP type> (if protocol is icmp)
* type <ICMP type> code <ICMP code> (if protocol is icmp)


The limits for the parameters are:

* 24 from targets
* 24 to targets
* 8 ports or types


## TARGET TYPES

### vm

    vm <uuid>

Targets the VM with that UUID.

**Example:**

    FROM any to vm 04128191-d2cb-43fc-a970-e4deefe970d8 ALLOW tcp port 80

Allows HTTP traffic from any host to VM 04128...

### ip

    ip <IP address>

Targets the specified IPv4 or IPv6 address.

**Example:**

    FROM all vms to (ip 10.2.0.1 OR ip fd22::1234) BLOCK tcp port 25

Blocks SMTP traffic to that IP.

### subnet

    subnet <subnet CIDR>

Targets the specified IPv4 or IPv6 subnet range.

**Example:**

    FROM subnet 10.8.0.0/16 TO vm 0f570678-c007-4610-a2c0-bbfcaab9f4e6 ALLOW \
         tcp port 443
    
Allows HTTPS traffic from a private IPv4 /16 to the specified VM.

**Example:**

    FROM subnet fd22::/64 TO vm 0f570678-c007-4610-a2c0-bbfcaab9f4e6 ALLOW \
         tcp port 443
    
Allows HTTPS traffic from a private IPv6 /64 to the specified VM.

### tag

    tag <name>
    tag <name> = <value>
    tag "<name with spaces>" = "<value with spaces>"

Targets all VMs with the specified tag, or all VMs with the specified tag
and value.  Both tag name and value can be quoted if they contain spaces.

**Examples:**

    FROM all vms TO tag syslog ALLOW udp port 514

Allows syslog traffic from all VMs to syslog servers.

    FROM tag role = db TO tag role = www ALLOW tcp port 5432

Allows database traffic from databases to webservers. All other VMs with
role tags (role = staging, for example) will not be affected by this rule.

    FROM all vms TO tag "VM type" = "LDAP server" ALLOW tcp PORT 389

Allow LDAP access from all VMs to LDAP servers.

### all vms

    all vms

Targets all VMs.

**Example:**

    FROM all vms TO all vms ALLOW tcp port 22

Allows ssh traffic between all VMs.

### any

    any

Targets any host (any IPv4 address).

**Example:**

    FROM any TO all vms ALLOW tcp port 80

Allows HTTP traffic from any IP to all VMs.

### target list

    ( <target> OR <target> OR ... )

The vm, ip, subnet and tag target types can be combined into a list surrounded
by parentheses and joined by OR.

**Example:**

    FROM (vm 163dcedb-828d-43c9-b076-625423250ee2 OR tag db) TO (subnet \
         10.2.2.0/24 OR ip 10.3.0.1) BLOCK tcp port 443
    
Blocks HTTPS traffic to an internal subnet and IP.


## ACTIONS

    ALLOW
    BLOCK

Actions can be one of ALLOW or BLOCK.  Note that certain combinations of
actions and directions will essentially have no effect on the behaviour
of a VM's firewall.  For example:

    FROM any TO all vms BLOCK tcp port 143

Since the default rule set blocks all incoming ports, this rule doesn't
really have an effect on the VMs.  Another example:

    FROM all vms TO any ALLOW tcp port 25

Since the default policy allows all outbound traffic, this rule doesn't
have an effect.


## PROTOCOLS

    tcp
    udp
    icmp
    icmp6

The protocol can be one of tcp, udp or icmp(6). The protocol dictates whether
ports or types can be used (see the Ports section below).


## PORTS

    port <port number>
    ( port <port number> AND port <port number> ... )
    ports <port number or range>
    ports <port number or range>, <port number or range>, ...
    type <icmp type>
    type <icmp type> code <icmp code>
    ( type <icmp type> AND type <icmp type> code <icmp code> AND ... )

For TCP and UDP, this specifies the port numbers that the rule applies to.
Port numbers must be between 1 and 65535, inclusive. Ranges are written as two
port numbers separated by a - (hyphen), with the lower number coming first, with
optional spaces around the hyphen. Port ranges are inclusive, so writing the
range "20 - 22" would cause the rule to apply to the ports 20, 21 and 22.

For ICMP, this specifies the ICMP type and optional code that the rule
applies to.  Types and codes must be between 0 and 255, inclusive.

**Examples:**

    FROM tag www TO any ALLOW tcp (port 80 AND port 443)

Allows HTTP and HTTPS traffic from any IP to all webservers.

    FROM tag www TO any ALLOW tcp ports 80, 443, 8000-8100

Allows traffic on HTTP, HTTPS and common alternative HTTP ports from any IP to
all webservers.

    FROM any TO all vms ALLOW icmp TYPE 8 CODE 0

Allows pinging all VMs. The IPv6 equivalent would be:

    FROM any TO all vms ALLOW icmp6 TYPE 128 CODE 0

And to block outgoing replies:

    FROM all vms TO any BLOCK icmp TYPE 0
    FROM all vms TO any BLOCK icmp6 TYPE 129


## EXAMPLES

    FROM all vms TO tag syslog ALLOW udp port 514

Allows syslog traffic from all VMs to syslog servers.

    FROM tag role = db TO tag role = www ALLOW tcp port 5432

Allows database traffic from databases to webservers.

    FROM all vms TO all vms ALLOW tcp port 22

Allows ssh traffic between all VMs.

    FROM any TO all vms ALLOW tcp port 80

Allow HTTP traffic from any host to all VMs.


## ERROR MESSAGES

This section explains error messages.

### rule does not affect VMs

The rule you're trying to create doesn't contain any targets that will
actually cause rules to be applied to VMs.  Targets that will cause rules
to be applied are:

* tag
* vm
* all vms

Some examples of rules that would cause this message include:

    FROM any TO any ALLOW tcp port 22

    FROM ip 192.168.1.3 TO subnet 192.168.1.0/24 ALLOW tcp port 22



## SEE ALSO

    ipfilter(7), vmadm(8), ipf(8), fwadm(8)
