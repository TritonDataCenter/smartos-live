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

PATH=/sbin:/usr/sbin:/usr/bin:/opt/SUNWspro/bin:/opt/local/bin
BASE=$(PWD)
DESTDIR=$(BASE)/proto

all:
	/bin/true

install:
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/include include/demangle.h
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib lib/libC.so.5
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib lib/libCrun.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib lib/libCstd.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib lib/libdemangle.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib lib/libiostream.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib/amd64 \
	    lib/amd64/libCrun.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib/amd64 \
	    lib/amd64/libCstd.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib/amd64 \
	    lib/amd64/libdemangle.so.1
	/usr/sbin/install -m 0755 -f $(DESTDIR)/usr/lib/amd64 \
	    lib/amd64/libiostream.so.1

clean:
	/bin/true
