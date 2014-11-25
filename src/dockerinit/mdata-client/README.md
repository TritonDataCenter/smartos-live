# mdata-client

This repository contains metadata retrieval and manipulation tools for use
within guests of the SmartOS (and SDC) hypervisor.  These guests may be either
SmartOS Zones or KVM virtual machines.

This repository is part of the Joyent SmartDataCenter project (SDC).  For
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.

# Commands

There are four commands provided in this consolidation:

* [mdata-list(1M)][mdata_list]; list custom metadata keys in the metadata store
* [mdata-get(1M)][mdata_get]; get the value of a particular metadata key
* [mdata-put(1M)][mdata_put]; set the value of a particular metadata key
* [mdata-delete(1M)][mdata_delete]; remove a metadata key

Manual pages for these tools are available in this repository, and are
generally shipped with the OS (in the case of SmartOS) or in the package (e.g.
[for Ubuntu][launchpad_pkg]).  They are also viewable on the web at the links
above.

# Protocol and Transport

The Joyent Metadata Protocol [is documented online][protocol].  The programs in
this repository are clients that communicate using this protocol.  The SmartOS
(or SmartDataCenter) hypervisor provides a [common set][datadict] of supported
base metadata keys for guests to consume, as well as the ability to support
arbitrary additional user-provided metadata.

In a SmartOS container/zone guest, a UNIX domain socket is used to communicate
with the metadata server running in the hypervisor.  In a KVM guest, such as a
Linux virtual machine, the client tools will make use of the second serial port
(e.g.  `ttyb`, or `COM2`) to communicate with the hypervisor.

# OS Support

The tools currently build and function on SmartOS and various Linux
distributions.  Support for other operating systems, such as \*BSD or Windows,
is absolutely welcome.

## License

MIT (See _LICENSE_.)

[mdata_docs]: http://eng.joyent.com/mdata/
[protocol]: http://eng.joyent.com/mdata/protocol.html
[datadict]: http://eng.joyent.com/mdata/datadict.html
[mdata_get]: http://smartos.org/man/1M/mdata-get
[mdata_delete]: http://smartos.org/man/1M/mdata-delete
[mdata_put]: http://smartos.org/man/1M/mdata-put
[mdata_list]: http://smartos.org/man/1M/mdata-list
[launchpad_pkg]: https://launchpad.net/ubuntu/+source/joyent-mdata-client
