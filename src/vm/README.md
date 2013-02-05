How to use the tests.
=====================

The tests here run in the GZ as they need to be able to manage VMs.  Tests are
now bundled into the platform at build time.  To run all tests you can go to
/usr/vm/test in the platform and run:

    touch /lib/sdc/.sdc-test-no-production-data
    ./runtests

This will take some time and run them all.  If you want to run a single test, go
to /usr/vm/test and run:

    touch /lib/sdc/.sdc-test-no-production-data
    ./runtest tests/test-<testname>.js

which will run only that test.

How to update the test framework (node-tap) from upstream.
==========================================================

You should be able to just run:

    ./tools/setup-tap.sh

which will update all the node-tap files.  Please ensure all tests are working
before you commit the update to node-tap.
