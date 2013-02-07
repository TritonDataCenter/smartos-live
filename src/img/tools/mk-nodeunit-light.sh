#!/bin/bash
#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#
# Create a "light" version of nodeunit. Specifically this is about having a
# binary-module-free and small distro of nodeunit for usage in the platform.
#
# Here "light" means:
# - stripped of all but minimum to run `nodeunit`
# - dropped reporters: tap, junit
#
# Usage:
#       ./mk-nodeunit-light.sh VERSION
#
# By default VERSION is empty (i.e. latest version published to npm).
# Nodeunit is installed to "./node_modules/nodeunit".
#

if [ "$TRACE" != "" ]; then
    export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
    set -o xtrace
fi
set -o errexit
set -o pipefail



#---- support stuff

function fatal
{
    echo "$(basename $0): fatal error: $*"
    exit 1
}

function errexit
{
    [[ $1 -ne 0 ]] || exit 0
    fatal "error exit status $1 at line $2"
}

trap 'errexit $? $LINENO' EXIT



#---- mainline

VERSION=$1
D=node_modules/nodeunit

rm -rf $D node_modules/.bin/nodeunit

if [[ -n "$VERSION" ]]; then
    npm install nodeunit@$VERSION
else
    npm install nodeunit
fi

# Drop bits not needed for running.
rm -rf $D/share
rm -rf $D/nodelint.cfg
rm -rf $D/man1
rm -rf $D/doc
rm -rf $D/img
rm -rf $D/test
rm -rf $D/examples
rm -rf $D/.npmignore
rm -rf $D/Makefile
rm -rf $D/README.md
rm -rf $D/CONTRIBUTORS.md

# drop tap reporter
rm -rf $D/node_modules
rm -rf $D/lib/reporters/tap.js

# drop junit reporter
rm -rf $D/deps/ejs
rm -rf $D/lib/reporters/junit.js

# bunyan
# Patch bunyan usages to use the platform one, because it has dtrace-provider
# hooked up.
patch -p0 <<PATCH
--- node_modules/nodeunit/lib/reporters/index.js.orig
+++ node_modules/nodeunit/lib/reporters/index.js
@@ -1,12 +1,10 @@
 module.exports = {
-    'junit': require('./junit'),
     'default': require('./default'),
     'skip_passed': require('./skip_passed'),
     'minimal': require('./minimal'),
     'html': require('./html'),
     'eclipse': require('./eclipse'),
     'machineout': require('./machineout'),
-    'tap': require('./tap'),
     'nested': require('./nested'),
     'verbose' : require('./verbose')
     // browser test reporter is not listed because it cannot be used
PATCH
