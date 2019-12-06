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
# Copyright 2019 Joyent, Inc.
#

PROG =		tzcheck

OBJECTS =					\
		common.o			\
		custr.o				\
		main.o				\
		manifest.o			\
		parser.o			\
		strlist.o			\
		strpath.o

SRC =		$(OBJECTS:%=.o%.c)

CFLAGS =					\
		-Wall -Wextra -Werror 		\
		-std=c99 			\
		-D__EXTENSIONS__ 		\
		-D_REENTRANT			\
		-I../common			\
		-I../../src/common/strings

LDLIBS =					\
		-lumem				\
		-lavl


ILLUMOS_SRC =	../../projects/illumos
TOOLS_BIN =	$(ILLUMOS_SRC)/usr/src/tools/proto/root_i386-nd/opt/onbld/bin
CC =		gcc
CTFCONVERT =	$(TOOLS_BIN)/i386/ctfconvert

COMPILE_C =	$(CC) -c -gdwarf-2 $(CFLAGS) -o $@ $^

all: $(PROG)

%.o: %.c
	$(COMPILE_C)

%.o: ../common/%.c
	$(COMPILE_C)

%.o: ../../src/common/strings/%.c
	$(COMPILE_C)

$(PROG): $(OBJECTS)
	$(CC) -o $@ $^ $(LDLIBS)
	$(CTFCONVERT) -l $(PROG) $@

clean:
	rm -f $(OBJECTS) $(PROG)
