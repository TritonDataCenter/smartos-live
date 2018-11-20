#
# Copyright (c) 2018, Joyent, Inc.
#

CC=gcc
SRC_ROOT=$(PWD)/../..
CFLAGS=-std=gnu99 -Wall -W -Werror -Wno-sign-compare -Wno-unknown-pragmas \
	-I$(SRC_ROOT)/proto/usr/include

TARGETS=format_image
LIBS=-lsmbios -luuid

#
# Yes, we're directly pulling in a local copy of libefi source: see do_ioctl()
# there for why. When our earliest platform has proper lofi support, we can stop
# doing this, but for now, it's the simplest way of having less code.
#
OBJS=format_image.o rdwr_efi.o crc32_efi.o

all: $(TARGETS)

format_image: $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LIBS)

%.o: %.c
	$(CC) -c $(CFLAGS) -o $@ $<

%.o: $(SRC_ROOT)/projects/illumos/usr/src/lib/libefi/common/%.c
	$(CC) -c $(CFLAGS) -o $@ $<

clean:
	rm $(TARGETS) $(OBJS)
