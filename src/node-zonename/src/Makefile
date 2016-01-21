#
# Copyright (c) 2013 Joyent, Inc.  All rights reserved.
#

PREFIX_NODE :=	$(shell dirname $$(bash -c 'hash node; hash -t node'))/..
V8PLUS :=       $(shell $(PREFIX_NODE)/bin/node -e 'require("v8plus");')

include $(V8PLUS)/Makefile.v8plus.defs

MODULE =	zonename_binding

SRCS =	\
		zonename.c

CC =		/opt/local/bin/gcc
CXX =		/opt/local/bin/g++

LIBS +=		-lumem

include $(V8PLUS)/Makefile.v8plus.targ
