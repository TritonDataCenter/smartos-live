# Copyright (c) 2014, Joyent, Inc.

JSON_OBJS=json-nvlist/json-nvlist.o
JSON_LIBS=-lnvpair
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

# NOTE: we add the '-z now' here to the CFLAGS because otherwise we'll try to
# load libdladm.so.1 after we've entered a chroot and it will look in the wrong
# place (/native/... when we've already chroot()'d to /native).
CC=gcc
CFLAGS=-Wall -Wextra -D__HAVE_BOOLEAN_T -m32 -z now
CSTYLE=../../tools/cstyle

all: build/dockerinit build/dockerexec

build/dockerexec: src/dockerexec.c $(OBJS)
	mkdir -p build
	$(CC) $(CFLAGS) -o build/dockerexec src/dockerexec.c $(OBJS) $(LIBS)

build/dockerinit: src/dockerinit.c $(OBJS)
	mkdir -p build
	$(CC) $(CFLAGS) -o build/dockerinit src/dockerinit.c $(OBJS) $(LIBS)

src/docker-common.o: src/docker-common.c
	$(CC) -c $(CFLAGS) -o $@ $<

mdata-client/plat/%.o: mdata-client/plat/%.c
	(cd mdata-client && $(MAKE) plat/$(@F))

mdata-client/%.o: mdata-client/%.c
	(cd mdata-client && $(MAKE) $(@F))

json-nvlist/%.o: json-nvlist/%.c
	$(CC) -c $(CFLAGS) -o $@ $<

check: src/*.c
	@echo $(PWD)/$^
	@$(CSTYLE) $^

clean:
	rm -f $(OBJS) build/*
