#
# This file and its contents are supplied under the terms of the
# Common Development and Distribution License ("CDDL"), version 1.0.
# You may only use this file in accordance with the terms of version
# 1.0 of the CDDL.
#
# A full copy of the text of the CDDL should have accompanied this
# source.  A copy of the CDDL is also available via the Internet at
# http://www.illumos.org/license/CDDL.
#

#
# Copyright 2015, Joyent, Inc.
#

ROOT =			$(PWD)/..
PROTO =			$(ROOT)/proto
PROTO_PKGSRC =		$(ROOT)/proto.pkgsrc
VERSION =		$(shell /usr/bin/date +%Y%m%d)
PKG_CREATE =		/opt/local/sbin/pkg_create

PACKAGES = \
	dmake \
	sgstools \
	astmsgtools \
	rpcgen \
	onbld

PKGSRC_TGZS :=	$(PACKAGES:%=%-$(VERSION).tgz)

%-$(VERSION).tgz: %/build-info %/comment %/description %/packlist %/prefix %/iprefix
	rm -f $*-$(VERSION).tgz
	cd $* && \
	$(PKG_CREATE) \
	    -B build-info \
	    -c comment \
	    -d description \
	    -f packlist \
	    -I $$(cat iprefix) \
	    -p $(PROTO)/$$(cat prefix) \
	    -U $*-$(VERSION).tgz
	mv $*/$*-$(VERSION).tgz .

all: $(PKGSRC_TGZS)

install: all
	mkdir -p $(PROTO_PKGSRC)
	rm -f $(PROTO_PKGSRC)/*
	cp *.tgz $(PROTO_PKGSRC)/

clean:
	rm -f $(PROTO_PKGSRC)/*
	rm -f *.tgz

clobber: clean
