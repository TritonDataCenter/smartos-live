# dtrace-provider - Native DTrace providers for Node.js apps.

This extension allows you to create native DTrace providers for your
Node.js applications. That is, to create providers and probes which
expose information specific to your application, rather than
information about the node runtime.

You could use this to expose high-level information about the inner
workings of your application, or to create a specific context in which
to look at information from other runtime or system-level providers. 

The provider is not created in the usual way, by declaring it and then
changing the build process to include it, but instead dynamically at
runtime. This is done entirely in-process, and there is no background
compiler or dtrace(1) invocation. The process creating the provider
need not run as root.

## INSTALL

    $ npm install dtrace-provider

## EXAMPLE

Here's a simple example of creating a provider:

    var d = require('dtrace-provider');

    var dtp = d.createDTraceProvider("nodeapp");
    var p1 = dtp.addProbe("probe1", "int", "int");
    var p2 = dtp.addProbe("probe2", "char *");
    dtp.enable();	   

Probes may be fired via the provider object:

    dtp.fire("probe1", function(p) {
        return [1, 2];
    });
    dtp.fire("probe2", function(p) { 
        return ["hello, dtrace via provider", "foo"];
    });

or via the probe objects themselves:

    p1.fire(function(p) {
      return [1, 2, 3, 4, 5, 6];
    });
    p2.fire(function(p) {
      return ["hello, dtrace via probe", "foo"];
    });

This example creates a provider called "nodeapp", and adds two
probes. It then enables the provider, at which point the provider
becomes visible to DTrace.

The probes are then fired, which produces this output:

    $ sudo dtrace -Z -n 'nodeapp*:::probe1{ trace(arg0); trace(arg1) }'  \
                     -n 'nodeapp*:::probe2{ trace(copyinstr(arg0));  }'
    dtrace: description 'nodeapp*:::probe1' matched 0 probes
    dtrace: description 'nodeapp*:::probe2' matched 0 probes
    CPU     ID                    FUNCTION:NAME
      1 123562                      func:probe1                 1                2
      1 123563                      func:probe2   hello, dtrace                    

Arguments are captured by a callback only executed when the probe is
enabled. This means you can do more expensive work to gather arguments.

The maximum number of arguments supported is 32. 

## PLATFORM SUPPORT

This libusdt-based Node.JS module supports 64 and 32 bit processes on
Mac OS X and Solaris-like systems such as Illumos or SmartOS. As more
platform support is added to libusdt, those platforms will be
supported by this module. See libusdt's status at:

  https://github.com/chrisa/libusdt#readme

FreeBSD is supported in principle but is restricted to only 4 working
arguments per probe.

Platforms not supporting DTrace (notably, Linux and Windows) may
install this module without building libusdt, with a stub no-op
implementation provided for compatibility. This allows cross-platform
npm modules to embed probes and include a dependency on this module.

## LIMITATIONS
 
The data types supported are "int" and "char *". Support for
structured types is planned, depending on support from the host DTrace
implementation for the necessary translators. 

## CAVEATS

There is some overhead to probes, even when disabled. Probes are
already using the "is-enabled" feature of DTrace to control execution
of the arguments-gathering callback, but some work still needs to be
done before that's checked. This overhead should not be a problem
unless probes are placed in particularly hot code paths.

## CONTRIBUTING

The source is available at:

  https://github.com/chrisa/node-dtrace-provider.

For issues, please use the Github issue tracker linked to the
repository. Github pull requests are very welcome. 

## OTHER IMPLEMENTATIONS

This node extension is derived from the ruby-dtrace gem, via the Perl
module Devel::DTrace::Provider, both of which provide the same
functionality to those languages.
