How to use the tests.
=====================

The tests here run in the GZ as they need to be able to manage VMs.  In order to
run the tests run:

    ./tools/build-test-tarball.sh

which will generate a tests.tar.gz file which you can unpack on your system in
/usr/vm/test and then run:

    (cd /usr/vm/test; ./run-tests)

to run all the tests.

How to update the test framework (node-tap) from upstream.
==========================================================

You should be able to just run:

    ./tools/setup-tap.sh

which will update all the node-tap files.  Please ensure all tests are working
before you commit the update to node-tap.
