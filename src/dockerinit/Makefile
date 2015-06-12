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

BASE = $(PWD)
DESTDIR = $(BASE)/../../proto
NATIVEDIR = $(BASE)/../../proto.strap

GCC = $(NATIVEDIR)/usr/bin/gcc
GXX = $(NATIVEDIR)/usr/bin/g++

SYSINCDIRS = /usr/include
SYSLIBDIRS = /usr/lib /lib

CPPFLAGS = $(SYSINCDIRS:%=-isystem $(DESTDIR)/%)
LDFLAGS = $(SYSLIBDIRS:%=-L$(DESTDIR)/%) -Wl,-zassert-deflib -Wl,-zfatal-warnings

JSON_OBJS=json-nvlist/json-nvlist.o
JSON_LIBS=-lnvpair -lcmdutils
MDATA_OBJS= \
	mdata-client/dynstr.o \
	mdata-client/proto.o \
	mdata-client/common.o \
	mdata-client/base64.o \
	mdata-client/crc32.o \
	mdata-client/reqid.o \
	mdata-client/plat/sunos.o \
	mdata-client/plat/unix_common.o
MDATA_LIBS=-lnsl -lsocket -lsmbios
NET_LIBS=-lipadm -linetutil -lnsl -lsocket
LIBS=$(JSON_LIBS) $(MDATA_LIBS) $(NET_LIBS)
OBJS=$(JSON_OBJS) $(MDATA_OBJS) src/docker-common.o
CTFCONVERT = /usr/bin/true
CTFMERGE = /usr/bin/true

CC=$(GCC)
CFLAGS=-Wall -Wextra -Werror -D__HAVE_BOOLEAN_T -m32 -g
CSTYLE=../../tools/cstyle

all: build/dockerinit build/dockerexec

install: all

build/dockerexec: src/dockerexec.c $(OBJS)
	mkdir -p build
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o build/dockerexec src/dockerexec.c $(OBJS) $(LIBS)
	$(CTFMERGE) -L VERSION -o $@ $(OBJS)

build/dockerinit: src/dockerinit.c $(OBJS)
	mkdir -p build
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o build/dockerinit src/dockerinit.c $(OBJS) $(LIBS)
	$(CTFMERGE) -L VERSION -o $@ $(OBJS)

src/docker-common.o: src/docker-common.c
	$(CC) $(CPPFLAGS) $(LDFLAGS) -c $(CFLAGS) -o $@ $<

mdata-client/plat/%.o: mdata-client/plat/%.c
	(cd mdata-client && $(MAKE) plat/$(@F))

mdata-client/%.o: mdata-client/%.c
	(cd mdata-client && $(MAKE) $(@F))

json-nvlist/%.o: json-nvlist/%.c
	$(CC) $(CPPFLAGS) $(LDFLAGS) -c $(CFLAGS) -o $@ $<
	$(CTFCONVERT) -L VERSION $@

check: src/*.c
	@echo $(PWD)/$^
	@$(CSTYLE) $^

lint:
	/usr/bin/true

clean:
	rm -f $(OBJS) build/*

%.o: %.c
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o $@ -c $<
	$(CTFCONVERT) -L VERSION $@
