# WARNING: dockerinit is experimental

This dockerinit should be considered experimental at this point.

It may completely change, it may go away.

# How to use it

If you're the kind of person who sees bare electrical wires and can't resist
touching them to see if they're live... This section will explain how this
dockerinit works and how to use it.

A 'docker' zone is a zone which has at least:

 * the `docker` flag set true ('vmadm update <uuid> docker=true')
 * `docker` set in the `internal_metadata_namespaces`
 * a `docker:id` in the `internal_metadata` set to a 64 byte id
 * at least one of `docker:cmd` or `docker:entrypoint` in `internal_metadata`
 * `restart_init` set to false
 * `init_name` set to either '/native/usr/vm/sbin/dockerinit' or
   '/usr/vm/sbin/dockerinit'

Normally when you run:

```
vmadm update <uuid> docker=true
```

it will set all of the above for you except `docker:cmd` / `docker:entrypoint`.

So in general all you'll need to do to make a zone a docker zone is add
something like:

 * docker: true
 * internal_metadata: {"docker:cmd": "[\"/bin/sleep\",\"3600\"]"}

to your payload. You can also do this to an *existing* VM with something like:

```
vmadm update <uuid> docker=true
echo '{"set_internal_metadata": {"docker:cmd": "[\"/bin/sleep\",\"3600\"]"}}' | vmadm update <uuid>
```

at which point you can boot the VM up and you should see that the VM is running
and only has a few processes:

```
[root@headnode (coal) ~]# ps -z 08ff151c-31d5-4de3-945f-bb70bd796588
  PID TTY         TIME CMD
44427 ?           0:00 zsched
44541 ?           0:00 ipmgmtd
44487 ?           0:00 sleep
[root@headnode (coal) ~]#
```
If you don't want to have ipmgmtd in your zone, you can also add the:

 * "docker:noipmgmtd": "true"

property to your internal_metadata. Doing so will kill ipmgmtd after configuring
the interfaces. In LX zones you will still be able to list interfaces (using
`ip addr`) but not make any changes to network configuration. In SmartOS zones
you will not be able to read or write network configuration.

## Specifying commands

The `docker:cmd` and `docker:entrypoint` options both must be string-encoded
JSON arrays. These arrays will be merged in order `docker:entrypoint`, then
`docker:cmd`. So if your internal_metadata has values:

 * "docker:entrypoint": "[\"/bin/sleep\"]"
 * "docker:cmd": "[\"3600\"]"

this will behave as though you ran:

```
/bin/sleep 3600
```

as init. When the process you have specified exits, the zone will be halted.
In the future, we plan to support the same restart policies docker does.

## Stdio

The stdin, stdout and stderr of your command will be attached to /dev/console,
so you can connect to those using:

```
vmadm console <uuid>
```

or:

```
zlogin -C <zonename>
```

from the GZ.

## Networking

Networking should be configured as with any other zone with the exception that
not all features are currently supported.

Additional routes for example are not supported.

## Debugging

When things go wrong, or in order to understand what is going on with startup,
this dockerinit writes a log file to /var/log/sdc-dockerinit.log inside the
zoneroot.
