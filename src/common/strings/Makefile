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
# Copyright (c) 2017, Joyent, Inc.
#

#
# NOTE: This Makefile only contains tests and style checks for the files in
# this directory, and should not be used to _build_ objects for use in other
# programs.  Programs seeking to consume this code should build their own
# objects from this source in their own Makefile.
#

BASE :=		$(PWD)
DESTDIR =	$(BASE)/../../../proto
NATIVEDIR =	$(BASE)/../../../proto.strap

GCC =		$(NATIVEDIR)/usr/bin/gcc
GXX =		$(NATIVEDIR)/usr/bin/g++

.SUFFIXES:
.SECONDARY:

CFLAGS =	-std=gnu99 -Wall -Wextra -Werror -m32 -g \
		-Wno-unused-parameter -I$(BASE)

TEST_PROGRAMS = \
		test0 \
		test1 \
		test2 \
		test3 \
		test4 \
		testpath

TEST_BINS =	$(TEST_PROGRAMS:%=obj/%)

STRINGS_OBJECTS = \
		custr.o \
		strlist.o \
		strpath.o

OBJECTS = \
		$(STRINGS_OBJECTS:%=obj/%)

CTFCONVERT =	/usr/bin/true
CTFMERGE =	/usr/bin/true

CC =		$(GCC)
CSTYLE =	../../../tools/cstyle

LIBS =		-lumem

COMPILE_C =	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -c -o $@ $< $(LIBS)

INSTALL_PROG =	mkdir -p $(@D) && rm -f $@ && cp $^ $@ && \
		chmod 755 $@ && touch $@

.PHONY: all
all: $(TEST_BINS)

.PHONY: check
check: $(STRINGS_OBJECTS:%.o=%.check)

%.check: %.c
	$(CSTYLE) -cPp $<

lint:
	/usr/bin/true

clean:
	rm -f $(OBJECTS) $(TEST_BINS:%=%.o)
	rm -f $(TEST_BINS)
	rmdir obj/

.PHONY: test
test: all $(TEST_PROGRAMS:%=%.runtest)

%.runtest: obj/%
	@echo RUNNING TEST $^ ...
	@./$^
	@echo OK
	@echo ""

#
# Compilation and linking targets
#
obj/test%: obj/test%.o $(OBJECTS)
	$(CC) $(CPPFLAGS) $(LDFLAGS) $(CFLAGS) -o $@ $^ $(LIBS) \
	    tests/force_umem_debug.c
	$(CTFMERGE) -L VERSION -o $@ $(OBJECTS)

obj/test%.o: tests/test%.c
	@mkdir -p $(@D)
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

obj/%.o: %.c
	@mkdir -p $(@D)
	$(COMPILE_C)
	$(CTFCONVERT) -L VERSION $@

