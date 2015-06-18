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
# Copyright 2015 Joyent, Inc.
#

BASE :=		$(PWD)
DESTDIR =	$(BASE)/../../proto
NATIVEDIR =	$(BASE)/../../proto.strap

PROGRAM =	routeinfo

GCC =		$(NATIVEDIR)/usr/bin/gcc
GXX =		$(NATIVEDIR)/usr/bin/g++

SYSINCDIRS =	/usr/include
SYSLIBDIRS =	/usr/lib /lib

CFLAGS =	-std=gnu99 -Wall -Wextra -Werror -m32 -g \
		-I$(DOCKER_DIR) \
		-Wno-unused-parameter
CPPFLAGS =	$(SYSINCDIRS:%=-isystem $(DESTDIR)/%)
LDFLAGS =	$(SYSLIBDIRS:%=-L$(DESTDIR)/%) \
		-Wl,-zassert-deflib -Wl,-zfatal-warnings

DOCKER_DIR =	$(BASE)/../dockerinit

ROUTEINFO_OBJECTS = \
		main.o

MDATA_OBJECTS = \
		dynstr.o \
		proto.o \
		common.o \
		base64.o \
		crc32.o \
		reqid.o \
		sunos.o \
		unix_common.o

mdata_%.o :	CFLAGS += -I$(DOCKER_DIR)/mdata-client -D__HAVE_BOOLEAN_T

OBJECTS = \
		$(MDATA_OBJECTS:%=mdata_%) \
		json-nvlist.o \
		main.o

json-nvlist.o :	CFLAGS += -I$(DOCKER_DIR)/json-nvlist

LIBS =		-lnvpair -lnsl -lsocket -lsmbios -lcmdutils

CTFCONVERT =	/usr/bin/true
CTFMERGE =	/usr/bin/true

CC=$(GCC)
CFLAGS +=	-Wall -Wextra -Werror -D__HAVE_BOOLEAN_T -m32
CSTYLE =	../../tools/cstyle

COMPILE_C =	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -c -o $@ $<

INSTALL_PROG =	mkdir -p $(@D) && rm -f $@ && cp $^ $@ && \
		chmod 755 $@ && touch $@

.PHONY: all
all: $(PROGRAM)

.PHONY: check
check: $(ROUTEINFO_OBJECTS:%.o=%.check)

%.check: %.c
	$(CSTYLE) -cPp $<

lint:
	/usr/bin/true

clean:
	rm -f $(OBJECTS)
	rm -f $(PROGRAM)

#
# Compilation and linking targets
#
$(PROGRAM): $(OBJECTS)
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o $@ $(OBJECTS) $(LIBS)
	$(CTFMERGE) -L VERSION -o $@ $(OBJECTS)

mdata_%.o: $(DOCKER_DIR)/mdata-client/%.c
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

mdata_%.o: $(DOCKER_DIR)/mdata-client/plat/%.c
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

%.o: $(DOCKER_DIR)/json-nvlist/%.c
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

#
# Installation
#
.PHONY: install
install: $(DESTDIR)/usr/lib/brand/lx/$(PROGRAM)

$(DESTDIR)/usr/lib/brand/lx/$(PROGRAM): $(PROGRAM)
	$(INSTALL_PROG)
