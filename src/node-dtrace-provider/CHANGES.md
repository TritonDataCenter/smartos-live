dtrace-provider - Changes
=========================

## HISTORY

 * 0.2.1:
   Update binding.gyp for clang on Snow Leopard - no space after -L.

 * 0.2.0:
   Update libusdt, and attempt to build it correctly for various platforms.
   Add support for disabling providers and removing probes.

 * 0.1.1:
   Replace Node-specific implementation with wrappers for libusdt.
   Extend argument support to 32 primitives.
   Adds Solaris x86_64 support.

 * 0.0.9:
   Force the build architecture to x86_64 for OS X.

 * 0.0.8:
   Removed overridden "scripts" section from package.json, breaking Windows installs

 * 0.0.7:
   Fix for multiple enable() calls breaking providers.

 * 0.0.6:
   Fix for segfault trying to use non-enabled probes (Mark Cavage mcavage@gmail.com)

 * 0.0.5:
   Revert changes to make probe objects available.

 * 0.0.4:
   Remove unused "sys" import (Alex Whitman) 
   No longer builds an empty extension on non-DTrace platforms
   Probe objects are made available to Javascript.

 * 0.0.3:
   Builds to a stubbed-out version on non-DTrace platforms (Mark Cavage <mcavage@gmail.com>)

 * 0.0.2:
   Solaris i386 support.
   Fixes memory leaks
   Improved performance, enabled- and disabled-probe. 

 * 0.0.1: 
   First working version: OSX x86_64 only. 
