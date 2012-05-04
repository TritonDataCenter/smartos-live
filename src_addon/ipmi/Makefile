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
# Copyright (c) 2012 Joyent Inc., All rights reserved.
#

VER=ipmitool-1.8.11
BASE=$(PWD)
DESTDIR=$(BASE)/../../proto
CC=$(DESTDIR)/usr/sfw/bin/gcc
CFLAGS=-I$(DESTDIR)/usr/include -g $(LARGEFILES)
LD=/usr/ccs/bin/ld
MAKE=gmake
INSTALL=ginstall

all: $(VER)/config.status
	(cd $(VER); env - \
	    PATH=$(PATH) \
	    CC=$(CC) \
	    CFLAGS="$(CFLAGS)" \
	    LD=$(LD) \
	    "INSTALL=$(INSTALL) -c" \
	    MAKE=$(MAKE) $(MAKE))
	@find . -name core -exec rm -f {} \;

install: all
	DESTDIR=$(DESTDIR) /bin/bash ./install-joyent

$(VER)/config.status: $(VER)/configure
	(cd $(VER); env - \
	    PATH=$(PATH) \
	    CC=$(CC) CFLAGS="$(CFLAGS)" LD=$(LD) \
	    "INSTALL=$(INSTALL) -c" \
	    "MAKE=$(MAKE)" \
	    ./configure)

$(VER)/configure: $(VER).tar.gz
	gzip -dc $(VER).tar.gz | tar xopf -
	touch $(VER)/configure

clean:
	-rm -rf $(VER)

install_h:

