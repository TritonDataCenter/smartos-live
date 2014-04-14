#
# Copyright (c) 2013 Joyent, Inc.  All rights reserved.
#

PREFIX_NODE :=	$(shell dirname $$(bash -c 'hash node; hash -t node'))/..
V8PLUS :=       $(shell $(PREFIX_NODE)/bin/node -e 'require("v8plus");')

include $(V8PLUS)/Makefile.v8plus.defs

MODULE =	zsock_bindings

SRCS =	\
		zsock.c

ERRNO_JSON =	errno.json

CC =		/opt/local/bin/gcc
CXX =		/opt/local/bin/g++

CFLAGS +=	-pthread
CPPFLAGS +=	-DV8PLUS_NEW_API

zsock.o :	CPPFLAGS += -D_POSIX_C_SOURCE=200112L -D__EXTENSIONS__

LIBS +=		-lcontract -lsocket -lnsl -lumem

include $(V8PLUS)/Makefile.v8plus.targ
