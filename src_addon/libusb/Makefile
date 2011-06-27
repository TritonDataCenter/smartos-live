#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License, Version 1.0 only
# (the "License").  You may not use this file except in compliance
# with the License.
#
# You can obtain a copy of the license at COPYING
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at COPYING.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright (c) 2011 Joyent Inc., All rights reserved.
#

BASE=$(PWD)
DESTDIR=$(BASE)/proto

all: libusb.so.1

libusb.so.1: wr_libusb.o
	cc  -D_REENTRANT -ldl -M libusb.mapfile -o libusb.so.1 -G  wr_libusb.o

wr_libusb.o: wr_libusb.c
	cc -D_REENTRANT -c -o wr_libusb.o wr_libusb.c

install: all
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib libusb.so.1

clean:
	rm -f wr_libusb.o libusb.so.1
