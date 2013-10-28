#
# Copyright (c) 2013 Joyent, Inc.  All rights reserved.
#

PREFIX_NODE :=	$(shell dirname $$(bash -c 'hash node; hash -t node'))/..
V8PLUS :=       $(shell $(PREFIX_NODE)/bin/node -e 'require("v8plus");')

include $(V8PLUS)/Makefile.v8plus.defs

MODULE =	lockfd_binding

SRCS =	\
		lockfd.c

ERRNO_JSON =	errno.json

CC =		/opt/local/bin/gcc
CXX =		/opt/local/bin/g++

CFLAGS +=	-pthread

#WARN_FLAGS +=	-Wno-error=unused-parameter

#LDFLAGS +=	-L/usr/lib/fm -R/usr/lib/fm
LIBS +=		-lumem

include $(V8PLUS)/Makefile.v8plus.targ
