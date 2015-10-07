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

PROGRAMS =	dockerinit dockerexec

.SUFFIXES:
.SECONDARY:

GCC =		$(NATIVEDIR)/usr/bin/gcc
GXX =		$(NATIVEDIR)/usr/bin/g++

SYSINCDIRS =	/usr/include
SYSLIBDIRS =	/usr/lib /lib

CPPFLAGS =	$(SYSINCDIRS:%=-isystem $(DESTDIR)/%)
LDFLAGS =	$(SYSLIBDIRS:%=-L$(DESTDIR)/%) \
		-Wl,-zassert-deflib -Wl,-zfatal-warnings

JSON_OBJS =	json-nvlist.o
JSON_LIBS =	-lnvpair -lcmdutils

MDATA_OBJS = \
		mdata-client/dynstr.o \
		mdata-client/proto.o \
		mdata-client/common.o \
		mdata-client/base64.o \
		mdata-client/crc32.o \
		mdata-client/reqid.o \
		mdata-client/plat/sunos.o \
		mdata-client/plat/unix_common.o
MDATA_LIBS =	-lnsl -lsocket -lsmbios

NET_LIBS =	-lipadm -linetutil -lnsl -lsocket

STRINGS_OBJS =	strlist.o strpath.o

DOCKER_OBJS =	docker-common.o

BUILD :=	build
OBJDIR :=	obj

BUILD_PROGS =	$(PROGRAMS:%=$(BUILD)/%)

LIBS =		$(JSON_LIBS) $(MDATA_LIBS) $(NET_LIBS) -lgen -lcontract

OBJS =		$(JSON_OBJS:%=obj/%) \
		$(MDATA_OBJS) \
		$(STRINGS_OBJS:%=obj/%) \
		$(DOCKER_OBJS:%=obj/%)

CTFCONVERT =	/usr/bin/true
CTFMERGE =	/usr/bin/true

CC =		$(GCC)
CFLAGS =	-std=gnu99 -Wall -Wextra -Werror -D__HAVE_BOOLEAN_T -m32 -g \
		-I$(BASE)/../common/strings

COMPILE_C =	$(CC) $(CPPFLAGS) $(LDFLAGS) -c $(CFLAGS) -o $@ $<

CSTYLE =	../../tools/cstyle

all: $(BUILD_PROGS)

install: all

#
# Compilation and Linking Targets
#

$(BUILD)/%: obj/%.o $(OBJS) | $(BUILD)
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o $@ $^ $(LIBS)
	$(CTFMERGE) -L VERSION -o $@ $(OBJS)

mdata-client/plat/%.o: mdata-client/plat/%.c
	(cd mdata-client && $(MAKE) plat/$(@F))

mdata-client/%.o: mdata-client/%.c
	(cd mdata-client && $(MAKE) $(@F))

$(OBJDIR)/%.o: json-nvlist/%.c | $(OBJDIR)
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

$(OBJDIR)/%.o: src/%.c | $(OBJDIR)
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

$(OBJDIR)/%.o: $(BASE)/../common/strings/%.c | $(OBJDIR)
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

$(OBJDIR) $(BUILD):
	mkdir -p $@

#
# Check, Lint and Clean Targets
#

check: src/*.c
	@echo $(PWD)/$^
	@$(CSTYLE) $^

lint:
	/usr/bin/true

clean:
	rm -f $(BUILD_PROGS)
	rm -f $(PROGRAMS:%=obj/%.o)
	rm -f $(OBJS)
	if test -d $(BUILD); then rmdir $(BUILD); fi
	if test -d $(OBJDIR); then rmdir $(OBJDIR); fi
