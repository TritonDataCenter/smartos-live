#!/bin/bash

tar -zcvf tests.tar.gz \
    node-tap \
    tests \
    run-tests \
    common

exit 0
