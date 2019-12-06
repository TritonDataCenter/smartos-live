#
# This file and its contents are supplied under the terms of the
# Common Development and Distribution License ("CDDL"), version 1.0.
# You may only use this file in accordance with the terms of version
# 1.0 of the CDDL.
#
# A full copy of the text of the CDDL should have accompanied this
# source.  A copy of the CDDL is also available via the Internet at
# http://www.illumos.org/license/CDDL.
#

#
# Copyright (c) 2019, Joyent, Inc.
#

BASE :=		$(CURDIR)/../

include		$(BASE)/Makefile.defs

PROGRAM =	lx_hook_postnet

CFLAGS +=	$(DEBUG_FLAGS) -m32 -I$(DOCKER_DIR) -I$(STRINGS_DIR) \
		-I$(DOCKER_DIR)/mdata-client -I$(DOCKER_DIR)/src \
		-I$(DOCKER_DIR)/json-nvlist \
		 -Wno-unused-parameter -D__HAVE_BOOLEAN_T

LXINIT_HOOK_OBJS = \
		main.o

OBJS = \
		$(MDATA_OBJS) \
		$(LXINIT_HOOK_OBJS) \
		custr.o \
		docker-common.o \
		json-nvlist.o \
		strlist.o \
		strpath.o

LIBS =		-lnvpair -lnsl -lsocket -lsmbios -lgen

.PHONY: all
all: $(PROGRAM)

.PHONY: check
check: $(LXINIT_HOOK_OBJS:%.o=%.check)

%.check: %.c
	$(CSTYLE) -P $<

clean:
	rm -f $(OBJS)
	rm -f $(PROGRAM)

$(PROGRAM): $(OBJS)
	$(LINK.c) $^ $(LIBS)
	$(CTFCONVERT) -l $(BUILDSTAMP) $@

#
# Installation
#
.PHONY: install
install: $(DESTDIR)/usr/lib/brand/lx/$(PROGRAM)

$(DESTDIR)/usr/lib/brand/lx/$(PROGRAM): $(PROGRAM)
	$(INSTALL_PROG)

include		$(BASE)/Makefile.targ
