# Deployment Examples

These examples are meant to outline some common use-cases for the firewall.
Note that all VMs need to have their firewall property set for rules to apply
to them:

    {
        "firewall_enabled": true
    }
    
Recall that for VMs that have firewall_enabled set, the default policy is
always:

* allow incoming ping requests
* block all other incoming traffic
* allow all outgoing traffic

Note as well that all of the examples here are not mutually exclusive. You can
combine the rules in the examples as you see fit.


## Allow SSH traffic

To allow SSH access from any IP to all VMs in a datacenter, create the
following rule:

    {
        "description": "allow SSH to all VMs",
        "enabled": true,
        "rule": "FROM any TO all vms ALLOW tcp PORT 22"
    }
    

To allow SSH to one VM with ID ba2c95e9-1cdf-4295-8253-3fee371374d9, create
this rule:

    {
        "description": "allow SSH to all VMs",
        "enabled": true,
        "rule": "FROM any TO vm ba2c95e9-1cdf-4295-8253-3fee371374d9 ALLOW tcp PORT 22"
    }
    
Note that if you have created the first rule in this section, you do not need
to create this second rule - every VM will already have SSH access enabled.


## Allow HTTP traffic

To allow HTTP connections from any IP to all VMs in a datacenter, create the
following rule:

    {
        "description": "allow HTTP traffic from any IP to all VMs",
        "enabled": true,
        "rule": "FROM any TO all vms ALLOW tcp PORT 80"
    }
    

To allow both HTTP and HTTPS connections to all VMs in a datacenter, create the
following rule (or update the rule above to the following):

    {
        "description": "allow HTTP and HTTPS traffic from any IP to all VMs",
        "enabled": true,
        "rule": "FROM any TO all vms ALLOW tcp (PORT 80 AND PORT 443)"
    }
    
To allow HTTP to one VM with ID ba2c95e9-1cdf-4295-8253-3fee371374d9, create
this rule:

    {
        "description": "allow HTTP traffic to a single VM",
        "enabled": true,
        "rule": "FROM any TO vm ba2c95e9-1cdf-4295-8253-3fee371374d9 ALLOW tcp PORT 80"
    }
    
Note that if you have created either of the first two rules in this section,
you do not need to create this second rule - every VM will already allow
HTTP connections.


## Multiple web and database server setup

Say you are running a website.  You have two webservers that talk to two
database servers.

For each of the webservers, you create them with these parameters:

    {
        "firewall_enabled": true,
        "tags": {
            "role": "www"
        }
    }
    
For each of the database servers, you create them with these parameters:

    {
        "firewall_enabled": true,
        "tags": {
            "role": "db"
        }
    }
    
We now need to create firewall rules to control access to these VMs.  Recall
that by default, VMs with firewalls enabled will block all incoming TCP and
UDP traffic. We now need to open up the necessary ports for each VM role.

First, we want to allow communication between the webservers and the database
servers. We do so by creating this rule:

    {
        "description": "allow database traffic from web servers to database servers",
        "enabled": true,
        "rule": "FROM tag role = www TO tag role = db ALLOW tcp PORT 5432"
    }
    
This rule allows *only* the webservers to connect to the database servers on
the standard PostgreSQL port (5432). All other inbound traffic to the database
servers is blocked.

Second, we want to allow HTTP and HTTPS traffic to the webservers from anywhere
on the internet. We do so by creating this rule:

    {
        "description": "allow HTTP and HTTPS traffic from anywhere to webservers",
        "enabled": true,
        "rule": "FROM any TO tag role = www ALLOW tcp (PORT 80 AND PORT 443)"
    }
    
After both of these rules have been created, VMs with tag role set to "db"
will have the following behaviour:

* Allow TCP traffic on port 5432 from VMs with tag role="www"
* Allow all outgoing traffic
* Allow incoming ping requests
* Block all other incoming traffic

After both of these rules have been created, VMs with tag role set to "www"
will have the following behaviour:

* Allow incoming TCP traffic on ports 80 and 443 from any IP
* Allow outgoing TCP traffic on port 5432 to VMs with tag role="www"
* Allow all outgoing traffic
* Allow incoming ping requests
* Block all other incoming traffic

Creating additional VMs with the role tags listed above will automatically
apply these rules. For example, to apply the webserver rules to a new server,
just give it tag role = "www".


## Bastion host setup

In this setup, we have the following requirements:

1. VMs are allowed access from the bastion host on all ports
2. VMs block all other connections
3. The bastion host accepts SSH connections from only certain IP addresses and
   no others.

Recall that the default policy is to block all incoming connecions, so
requirement 2 is taken care of. We then need two rules to handle the other
requirements.

First, let's take care of VMs allowing access from the bastion host
cb3f80b9-d333-4521-b067-b237e748e473 by creating this rule:

    {
        "description": "allow access to all VMs from bastion host",
        "enabled": true,
        "rule": "FROM vm cb3f80b9-d333-4521-b067-b237e748e473 TO all vms ALLOW tcp PORT all"
    }
    
Second, let's take care of the bastion host accepting connections from certain
IP addresses with this rule:

    {
        "description": "allow access to all VMs from bastion host",
        "enabled": true,
        "rule": "FROM (ip 172.1.1.110 OR ip 172.1.1.111) TO vm cb3f80b9-d333-4521-b067-b237e748e473 ALLOW tcp PORT 22"
    }
    
When you create new VMs, they will have access from the bastion host.
