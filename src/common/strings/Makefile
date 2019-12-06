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

#
# NOTE: This Makefile only contains tests and style checks for the files in
# this directory, and should not be used to _build_ objects for use in other
# programs.  Programs seeking to consume this code should build their own
# objects from this source in their own Makefile.
#

BASE =		$(CURDIR)/../../

include $(BASE)/Makefile.defs

.SUFFIXES:
.SECONDARY:

CFLAGS +=	$(DEBUG_FLAGS) -m32 -Wno-unused-parameter -I.

TEST_PROGRAMS = \
		test0 \
		test1 \
		test2 \
		test3 \
		test4 \
		testpath

OBJS = 		\
		custr.o \
		strlist.o \
		strpath.o

LIBS =		-lumem

.PHONY: all
all: $(TEST_PROGRAMS)

.PHONY: check
check: $(OBJS:%.o=%.check)

clean:
	rm -f $(OBJS) $(TEST_PROGRAMS:%=%.o)
	rm -f $(TEST_PROGRAMS)

.PHONY: test
test: all $(TEST_PROGRAMS:%=%.runtest)

%.runtest: %
	@echo RUNNING TEST $^ ...
	@./$^
	@echo OK
	@echo ""

test%: test%.o $(OBJS) tests/force_umem_debug.c
	@mkdir -p $(@D)
	$(LINK.c) $^ $(LIBS)
	$(CTFCONVERT) -l $(BUILDSTAMP) $@

test%.o: tests/test%.c
	@mkdir -p $(@D)
	$(COMPILE.c) $^

include $(BASE)/Makefile.targ
