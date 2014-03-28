#
# Copyright (c) 2014 Joyent, Inc.  All rights reserved.
#

PREFIX_NODE :=	$(shell dirname $$(bash -c 'hash node; hash -t node'))/..
V8PLUS :=       $(shell $(PREFIX_NODE)/bin/node -e 'require("v8plus");')

include $(V8PLUS)/Makefile.v8plus.defs

MODULE =	zutil_bindings

SRCS =	\
		zone.c \
		zonecfg.c \
		zutil_bindings.c

CC =		/opt/local/bin/gcc
CXX =		/opt/local/bin/g++

CFLAGS +=	-pthread
CPPFLAGS +=	-DV8PLUS_NEW_API

zonecfg.o :	CPPFLAGS += -D_POSIX_C_SOURCE=200112L -D__EXTENSIONS__

LIBS +=		-lzonecfg -lnsl -lumem

include $(V8PLUS)/Makefile.v8plus.targ
