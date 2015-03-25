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

PROG =		mancheck

OBJECTS =					\
		common.o			\
		custr.o				\
		main.o				\
		manifest.o			\
		parser.o			\
		strlist.o			\
		strset.o

SRC =		$(OBJECTS:%=.o%.c)

CFLAGS =					\
		-Wall -Wextra -Werror 		\
		-std=c99 			\
		-D__EXTENSIONS__ 		\
		-D_REENTRANT			\
		-I../common

LDLIBS =					\
		-lumem				\
		-lavl


ILLUMOS_SRC =	../../projects/illumos
TOOLS_BIN =	$(ILLUMOS_SRC)/usr/src/tools/proto/root_i386-nd/opt/onbld/bin
CC =		gcc
CTFCONVERT =	$(TOOLS_BIN)/i386/ctfconvert
CTFMERGE =	$(TOOLS_BIN)/i386/ctfmerge

all: mancheck

%.o: %.c
	$(CC) -c -gdwarf-2 $(CFLAGS) -o $@ $^
	$(CTFCONVERT) -l $(PROG) $@

%.o: ../common/%.c
	$(CC) -c -gdwarf-2 $(CFLAGS) -o $@ $^
	$(CTFCONVERT) -l $(PROG) $@

mancheck: $(OBJECTS)
	$(CC) -o $@ $^ $(LDLIBS)
	$(CTFMERGE) -l $(PROG) -o $@ $(OBJECTS)

clean:
	rm -f $(OBJECTS) $(PROG)
