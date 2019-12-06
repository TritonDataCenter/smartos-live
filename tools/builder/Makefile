#
# Copyright 2019 Joyent, Inc.
#

CC=gcc
CFLAGS=-Wall -W
SRC_ROOT=$(PWD)/../..

TARGETS=builder
OBJS=builder.o file_cp.o users.o

all: $(TARGETS)

builder: $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS)

%.o: %.c
	$(CC) -c $(CFLAGS) -o $@ $<

users.c:
	./build_users_c.sh $(SRC_ROOT)/proto/ > users.c.tmp && mv users.c.tmp users.c

clean:
	rm -f $(TARGETS) $(OBJS)
