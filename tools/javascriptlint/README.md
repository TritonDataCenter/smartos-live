Overview
--------

This is a fork of Matthias Miller's JavaScript Lint.  For the original, see:

    http://javascriptlint.com/

This tool has two important features that are uncommon among JavaScript lint
tools:

- It does not conflate style with lint.  Style refers to arbitrary code
  formatting rules (like leading whitespace rules).  Lint refers to potential
  program correctness issues (like missing "break" statements inside a switch).
  The line is certainly fuzzy, as in the case of JavaScript semicolon style,
  but that's why:

- It's configurable.  Each individual warning can be turned on or off, and
  warnings can be overridden for individual lines of code.  This is essential
  for cases where potentially dangerous behavior is being deliberately used
  carefully.

If you want style, see http://github.com/davepacheco/jsstyle.


Synopsis
--------

    # make install
    ...
    # build/install/jsl
    usage: jsl [options] [files]
    
    options:
      -h, --help          show this help message and exit
      --conf=CONF         set the conf file
      --profile           turn on hotshot profiling
      --recurse           recursively search directories on the command line
      --enable-wildcards  resolve wildcards in the command line
      --dump              dump this script
      --unittest          run the python unittests
      --quiet             minimal output
      --verbose           verbose output
      --nologo            suppress version information
      --nofilelisting     suppress file names
      --nosummary         suppress lint summary
      --help:conf         display the default configuration file

You can define a configuration file for jsl to enable or disable particular
warnings and to define global objects (like "window").  See the --help:conf
option.


Supported Platforms
-------------------

This branch of JSL has been tested on:

- SmartOS (Illumos-based) with Python 2.6.
- Mac OS X >=10.6 with Python 2.6. I.e. does `which python2.6` return something?


History
-------

This version forked from the Subversion repo at revision 302 (2011-04-06).
I'll happily look at incorporating new patches from upstream, though the
project has been pretty quiet for the last many months.

The main purpose of this fork is to fix building on Illumos-based systems.
Rather than fix the complex spidermonkey build system to work on Illumos, I
stripped out a bunch of unnecessary pieces and Makefiles and wrote a new set of
Makefiles.  The result now builds on Mac OSX as well, and should build on Linux
with minimal changes to the Makefile.
