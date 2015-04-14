#
# Copyright (c) 2010 Joyent Inc., All rights reserved.
#

CC=gcc
CFLAGS=-Wall -W -Werror -std=c99 -I../common -D__EXTENSIONS__
SRC_ROOT=$(PWD)/../..

PROG=builder
OBJS=new_builder.o copyfile.o users.o strlist.o strset.o manifest.o common.o parser.o custr.o
LDLIBS=-lavl

ILLUMOS_SRC=../../projects/illumos
TOOLS_BIN=$(ILLUMOS_SRC)/usr/src/tools/proto/root_i386-nd/opt/onbld/bin
CTFCONVERT=$(TOOLS_BIN)/i386/ctfconvert
CTFMERGE=$(TOOLS_BIN)/i386/ctfmerge

all: $(PROG)

builder: $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDLIBS)
	$(CTFMERGE) -l $(PROG) -o $@ $(OBJS)

%.o: %.c
	$(CC) -c -gdwarf-2 $(CFLAGS) -o $@ $<
	$(CTFCONVERT) -l $(PROG) $@

%.o: ../common/%.c
	$(CC) -c -gdwarf-2 $(CFLAGS) -o $@ $<
	$(CTFCONVERT) -l $(PROG) $@

clean:
	rm -f $(TARGETS) $(OBJS)
