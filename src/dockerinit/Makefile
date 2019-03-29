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

PROGRAMS =	dockerinit dockerexec

.SUFFIXES:
.SECONDARY:

JSON_OBJS =	json-nvlist.o
JSON_LIBS =	-lnvpair

MDATA_LIBS =	-lnsl -lsocket -lsmbios

NET_LIBS =	-lipadm -linetutil -lnsl -lsocket

STRINGS_OBJS =	custr.o strlist.o strpath.o

DOCKER_OBJS =	docker-common.o

BUILD :=	build

BUILD_PROGS =	$(PROGRAMS:%=$(BUILD)/%)

LIBS =		$(JSON_LIBS) $(MDATA_LIBS) $(NET_LIBS) -lgen -lcontract

OBJS =		$(JSON_OBJS) \
		$(MDATA_OBJS) \
		$(STRINGS_OBJS) \
		$(DOCKER_OBJS)

CFLAGS +=	$(DEBUG_FLAGS) -D__HAVE_BOOLEAN_T -m32 -I$(STRINGS_DIR) \
		-I$(DOCKER_DIR)/mdata-client

all: $(BUILD_PROGS)

install: all

$(BUILD)/%: %.o $(OBJS) | $(BUILD)
	$(LINK.c) $^ $(LIBS)
	$(CTFCONVERT) -l $(BUILDSTAMP) $@

$(BUILD):
	mkdir -p $@

check: src/*.c
	$(CSTYLE) -P $^

clean:
	rm -f $(BUILD_PROGS)
	rm -f $(PROGRAMS:%=%.o)
	rm -f $(OBJS)
	if test -d $(BUILD); then rmdir $(BUILD); fi

include $(BASE)/Makefile.targ
