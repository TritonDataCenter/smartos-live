#!/bin/bash
#
# This script creates a node-tap you can actually use.  From the parent dir:
#
#  ./tools/setup-tap.sh
#
# to update node-tap.
#

set -o errexit

git=$(which git)
if [[ -z ${git} || $? != 0 ]]; then
    echo "FATAL: can't find git."
    exit 1
fi

rm -rf node-tap
mkdir -p node-tap/node_modules
mkdir -p node-tap/node_modules/lib
mkdir -p node-tap/bin
cd node-tap
git clone --depth 1 https://github.com/isaacs/node-tap.git
cp node-tap/lib/tap-* node_modules/
cp node-tap/lib/main.js node_modules/tap.js
git clone --depth 1 https://github.com/isaacs/slide-flow-control.git
cp slide-flow-control/lib/* node_modules/
git clone --depth 1 https://github.com/isaacs/inherits.git
cp inherits/inherits.js node_modules/
git clone --depth 1 https://github.com/isaacs/yamlish.git
cp yamlish/yamlish.js node_modules/
cp node-tap/bin/tap.js bin/tap
git clone --depth 1 https://github.com/substack/difflet.git
cp difflet/index.js node_modules/difflet.js
git clone --depth 1 https://github.com/substack/js-traverse.git
cp js-traverse/index.js node_modules/traverse.js
git clone --depth 1 https://github.com/substack/node-charm.git
cp node-charm/index.js node_modules/charm.js
cp node-charm/lib/encode.js node_modules/lib/encode.js
git clone --depth 1 https://github.com/substack/node-deep-equal.git
cp node-deep-equal/index.js node_modules/deep-equal.js

ln -s node_modules lib
rm -rf slide-flow-control
rm -rf inherits
rm -rf yamlish
rm -rf difflet
rm -rf js-traverse
rm -rf node-charm
rm -rf node-deep-equal
rm -rf node-deep-equal

./bin/tap node-tap/test && rm -rf node-tap
#
