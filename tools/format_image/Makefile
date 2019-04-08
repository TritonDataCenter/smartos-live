#
# Copyright (c) 2019, Joyent, Inc.
#

CC=gcc
ILLUMOS_SRC=$(PWD)/../../projects/illumos/usr/src

CFLAGS=-std=gnu99 -Wall -W -Werror -Wno-sign-compare
CPPFLAGS += -isystem $(PWD)/../../proto/usr/include

TARGETS=format_image
LIBS=-lsmbios -luuid

#
# Yes, we're directly pulling in a local copy of libefi source: see do_ioctl()
# there for why.
#
# There is an obvious risk of trying to use illumos-joyent code directly on the
# build platform.  However, this code is pretty self-contained, and its ioctl()
# usage fairly stable. The biggest risk here is probably the libsmbios usage:
# but even there, we don't actually care about any H/W workarounds in that code.
#
# Having said that, roll on the day when our minimum build platform has a lofi
# driver such that we can avoid doing this hack.
#
OBJS=format_image.o rdwr_efi.o crc32_efi.o

all: $(TARGETS)

format_image: $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LIBS)

%.o: %.c
	$(CC) -c $(CFLAGS) $(CPPFLAGS) -o $@ $<

%.o: $(ILLUMOS_SRC)/lib/libefi/common/%.c
	$(CC) -c $(CFLAGS) $(CPPFLAGS) -o $@ $<

clean:
	rm -f $(TARGETS) $(OBJS)
