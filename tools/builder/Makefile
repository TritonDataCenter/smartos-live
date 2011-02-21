# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License, Version 1.0 only
# (the "License").  You may not use this file except in compliance
# with the License.
#
# You can obtain a copy of the license at COPYING
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at COPYING.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright (c) 2010,2011 Joyent Inc.
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
	./build_users_c.sh $(SRC_ROOT)/overlay > users.c

clean:
	rm $(TARGETS) $(OBJS)
