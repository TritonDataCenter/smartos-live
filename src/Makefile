#
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
CFLAGS=-Wall
TARGETS=bootparams disklist removable_disk disk_size
DESTDIR=../proto

all: $(TARGETS) sysinfo

install: $(TARGETS) sysinfo
	mkdir -p $(DESTDIR)/usr/bin
	pfexec cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin

bootparams: bootparams.c
	$(CC) $(CFLAGS) -o $@ $^ -ldevinfo

removable_disk: removable_disk.c
	$(CC) $(CFLAGS) -o $@ $^

disk_size: disk_size.c
	$(CC) $(CFLAGS) -o $@ $^

disklist:
	cp disklist.sh disklist
	chmod 0755 disklist

sysinfo:
	touch sysinfo

clean:
	@rm -f $(TARGETS)
