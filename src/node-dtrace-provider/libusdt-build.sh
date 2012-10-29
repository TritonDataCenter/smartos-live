#!/bin/sh

# GYP's MAKEFLAGS confuses libusdt's Makefile
#
unset MAKEFLAGS

# Ask node what arch it's been built for, and build libusdt to match.
#
# (this will need to change at the point that GYP is able to build
# node extensions universal on the Mac - for now we'll go with x86_64
# on a 64 bit Mac)
#
ARCH=`node -e "console.log(process.config.variables.target_arch == 'x64' ? 'x86_64' : 'i386')"`
echo "Building libusdt for ${ARCH}"
export ARCH

# Respect a MAKE variable if set
if [ -z $MAKE ]; then
  MAKE=make
fi

# Build.
#
$MAKE -C libusdt clean all
