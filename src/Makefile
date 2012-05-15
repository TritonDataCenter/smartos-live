#
# Copyright (c) 2012, Joyent, Inc.  All rights reserved.
#

include Makefile.defs

#
# ROOT is used only when building and running the below tools.
#
ROOT =		$(PWD)/..
JSSTYLE =	$(ROOT)/tools/jsstyle/jsstyle
JSLINT =	$(ROOT)/tools/javascriptlint/build/install/jsl
CSTYLE =	$(ROOT)/tools/cstyle

#
# Tool options
#
JSSTYLE_OPTS = \
	-o indent=4 \
	-o strict-indent=1 \
	-o doxygen \
	-o unparenthesized-return=0 \
	-o continuation-at-front=1 \
	-o leading-right-paren-ok=1

#
# Installation configuration.  Note that DESTDIR in particular is also
# assumed to contain various build tools, headers, libraries, and other
# artifacts of the platform build from which we incorporate runtime
# dependency information.  The default DESTDIR is for standalone builds
# only (i.e., without the rest of the platform) and is unlikely to work
# without extra effort; it is overridden when make is invoked in this
# subdirectory.
#
DESTDIR =		../proto

SMARTDCBINDIR =	$(DESTDIR)/smartdc/bin
SMARTDCLIBDIR =	$(DESTDIR)/smartdc/lib

#
# Per-target variable definitions go here.  See Makefile.defs and the targets
# below and in Makefile.targ to see what's useful to append to or override.
# If you need to create your own target anyway, you can either modify
# variables here or incorporate your changes directly into the target; we
# prefer modifying the generic variable to the extent that the change fits
# naturally with an existing one so that we can pick up general changes in
# Makefile.defs even for custom targets.
#
bootparams :	LIBS +=		-ldevinfo
bootparams :	WARN_FLAGS +=	-Wno-unused
diskinfo :	LIBS +=		-ldladm -ldiskmgt -lnvpair
zfs_recv :	LIBS +=		-lsocket
zfs_send :	LIBS +=		-lsocket
vmbundle :	CPPFLAGS +=	-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64
sdc-on-tty :	CFLAGS +=	$(OPT_FLAG)
zoneevent :	LIBS +=		-lnvpair -lsysevent

# These files will get run through jsstyle and jslint on 'make check'
JS_CHECK_TARGETS=\
	node_modules/{system,onlyif}.js \
	vm/sbin/*.js \
	vm/node_modules/{qmp,VM,dladm}.js \
	img/node_modules/*.js \
	img/sbin/imgadm

# These files will get run through cstyle on 'make check'
C_CHECK_TARGETS=\
	qemu-exec.c \
	vmunbundle.c \
	zfs_recv.c \
	zfs_send.c \
	zoneevent.c

#
# Generic flags we apply by default to everything.
#
CFLAGS +=	$(WARN_FLAGS)
CXXFLAGS =	$(CFLAGS)

#
# Node native add-on patterns.  For add-ons with a single source file in the
# root of the add-on tree and no headers of its own, follow the EXPAT.NODE
# pattern here and below in the targets.  More complex examples (source
# subdirectory, headers, multiple C++ sources) follow; see associated comments
# if you are looking for a pattern to copy.
#
EXPAT_OBJDIR =	node-expat/build/Release
EXPAT.NODE =	$(EXPAT_OBJDIR)/node-expat.node

$(EXPAT.NODE) :	WARN_FLAGS +=	-Wno-unused
$(EXPAT.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(EXPAT.NODE) :	CXXFLAGS +=	$(NODE_CFLAGS)
$(EXPAT.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(EXPAT.NODE) :	LIBS +=		-lexpat

#
# The kstat Node add-on follows the same pattern as EXPAT.NODE.
#
KSTAT_OBJDIR =	node-kstat/build/Release
KSTAT.NODE =	$(KSTAT_OBJDIR)/kstat.node

$(KSTAT.NODE) :	WARN_FLAGS +=	-Wno-unused -Wno-write-strings -Wno-sign-compare
$(KSTAT.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(KSTAT.NODE) :	CXXFLAGS +=	$(NODE_CFLAGS)
$(KSTAT.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(KSTAT.NODE) :	LIBS +=		-lkstat

#
# Likewise the syslog add-on.
#
SYSLOG_OBJDIR =	node-syslog/build/Release
SYSLOG.NODE =	$(SYSLOG_OBJDIR)/syslog.node

$(SYSLOG.NODE) :	WARN_FLAGS +=	-Wno-unused
$(SYSLOG.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(SYSLOG.NODE) :	CXXFLAGS +=	$(NODE_CFLAGS)
$(SYSLOG.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)

#
# The zsock add-on places its single source file in a subdirectory.
#
ZSOCK_OBJDIR =	node-zsock/build/Release
ZSOCK_SRCDIR =	node-zsock/src
ZSOCK_BINDINGS.NODE =	$(ZSOCK_OBJDIR)/zsock_bindings.node

$(ZSOCK_BINDINGS.NODE) :	WARN_FLAGS =	-Wall -Werror
$(ZSOCK_BINDINGS.NODE) :	CPPFLAGS += \
				$(NODE_CPPFLAGS) \
				-D_REENTRANT \
				-D_POSIX_PTHREAD_SEMANTICS \
				-D_XOPEN_SOURCE_EXTENDED=1 \
				-D__EXTENSIONS__ \
				-DSunOS
$(ZSOCK_BINDINGS.NODE) :	CXXFLAGS += \
				$(NODE_CFLAGS) \
				-std=c++98
$(ZSOCK_BINDINGS.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(ZSOCK_BINDINGS.NODE) :	LIBS +=		-lsocket -lnsl -lcontract

#
# The zutil add-on places its multiple source files in a subdirectory, and
# builds them against some headers that it also supplies and needs to depend on.
# Because we must build intermediate object files, this requires a
# different target pattern as well; see below.
#
ZUTIL_OBJDIR =	node-zutil/build/Release
ZUTIL_SRCDIR =	node-zutil/src
ZUTIL_BINDINGS.NODE =	$(ZUTIL_OBJDIR)/zutil_bindings.node

ZUTIL_SRCS += \
	zone.cc \
	zonecfg.cc \
	zutil_bindings.cc

ZUTIL_HDRS += \
	zone.h \
	zonecfg.h \
	zutil_common.h

ZUTIL_BINDINGS_OBJS =	$(ZUTIL_SRCS:%.cc=$(ZUTIL_OBJDIR)/%.o)
ZUTIL_BINDINGS_HDRS =	$(ZUTIL_HDRS:%=$(ZUTIL_SRCDIR)/%)
CLEANFILES +=		$(ZUTIL_BINDINGS_OBJS)

$(ZUTIL_BINDINGS.NODE) :	WARN_FLAGS +=	-Wno-unused
$(ZUTIL_BINDINGS.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(ZUTIL_BINDINGS.NODE) :	CXXFLAGS +=	$(NODE_CFLAGS)
$(ZUTIL_BINDINGS.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(ZUTIL_BINDINGS.NODE) :	LIBS +=		-lzonecfg

#
# List of targets.  TARGETS, SMARTDC_TARGETS, and SMARTDC_LIB_TARGETS must
# include only those files that are safe to remove when the clean target is
# built.
#
TARGETS = \
	bootparams \
	diskinfo \
	disklist \
	disk_size \
	removable_disk \
	vmunbundle \
	zfs_recv \
	zfs_send \
	zoneevent \
	$(EXPAT.NODE) \
	$(KSTAT.NODE) \
	$(SYSLOG.NODE) \
	$(ZSOCK_BINDINGS.NODE) \
	$(ZUTIL_BINDINGS.NODE)

SMARTDC_TARGETS = \
	qemu-exec

SMARTDC_LIB_TARGETS = \
	sdc-on-tty

all: $(TARGETS) sysinfo $(SMARTDC_TARGETS) $(SMARTDC_LIB_TARGETS) \
    vm/tests.tar.gz

install: all
	mkdir -p $(DESTDIR)/usr/bin
	cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/smartdc/bin
	cp -p $(SMARTDC_TARGETS) $(DESTDIR)/smartdc/bin
	mkdir -p $(DESTDIR)/smartdc/lib
	cp -p $(SMARTDC_LIB_TARGETS) $(DESTDIR)/smartdc/lib
	mkdir -m 0755 -p $(DESTDIR)/usr/node_modules
	cp -Pr node_modules/* $(DESTDIR)/usr/node_modules
	cp $(KSTAT.NODE) $(DESTDIR)/usr/node_modules/
	cp $(SYSLOG.NODE) $(DESTDIR)/usr/node_modules/syslog.node
	rm -rf $(DESTDIR)/usr/vm
	cp -PR vm $(DESTDIR)/usr/
	mkdir -m 0755 -p $(DESTDIR)/usr/vm/node_modules
	mkdir -p $(DESTDIR)/usr/vm/node_modules/{zsock,zutil}/build/Release
	cp -Pr node-zsock/{package.json,lib} \
	    $(DESTDIR)/usr/vm/node_modules/zsock
	cp -Pr node-zutil/{package.json,lib} \
	    $(DESTDIR)/usr/vm/node_modules/zutil
	cp $(ZSOCK_BINDINGS.NODE) \
	    $(DESTDIR)/usr/vm/node_modules/zsock/build/Release
	cp $(ZUTIL_BINDINGS.NODE) \
	    $(DESTDIR)/usr/vm/node_modules/zutil/build/Release
	cp $(EXPAT.NODE) $(DESTDIR)/usr/vm/node_modules/expat_binding.node
	sed -e "s|var expat.*;|var expat = require('expat_binding');|" \
	    < node-expat/lib/node-expat.js \
	    > $(DESTDIR)/usr/vm/node_modules/node-expat.js
	cp zoneevent $(DESTDIR)/usr/vm/sbin/zoneevent
	cp zfs_send $(DESTDIR)/usr/vm/sbin/zfs_send
	cp zfs_recv $(DESTDIR)/usr/vm/sbin/zfs_recv
	cp vmunbundle $(DESTDIR)/usr/vm/sbin/vmunbundle
	mkdir -p $(DESTDIR)/lib/svc/manifest/system
	cp vm/smf/system-vmadmd.xml \
	    $(DESTDIR)/lib/svc/manifest/system/system-vmadmd.xml
	cp vm/smf/system-metadata.xml \
	    $(DESTDIR)/lib/svc/manifest/system/system-metadata.xml
	mv $(DESTDIR)/usr/vm/sbin/vmadmd.js $(DESTDIR)/usr/vm/sbin/vmadmd
	mv $(DESTDIR)/usr/vm/sbin/vmadm.js $(DESTDIR)/usr/vm/sbin/vmadm
	mv $(DESTDIR)/usr/vm/sbin/add-userscript.js \
	    $(DESTDIR)/usr/vm/sbin/add-userscript
	mv $(DESTDIR)/usr/vm/sbin/metadata.js $(DESTDIR)/usr/vm/sbin/metadata
	cp -PR img $(DESTDIR)/usr/
	mkdir -m 0755 -p $(DESTDIR)/var/db/imgadm

check: $(JSLINT)
	@echo "==> Running cstyle..."
	@(for file in $(C_CHECK_TARGETS); do \
		echo $(PWD)/$$file; \ # cstyle doesn't echo as it goes
		$(CSTYLE) $$file; \
	done)
	@printf "\nC files ok!\n"
	@printf "\n==> Running JavaScriptLint...\n"
	@$(JSLINT) --nologo --conf=$(ROOT)/tools/jsl.node.conf \
	    $(JS_CHECK_TARGETS)
	@printf "\n==> Running jsstyle...\n"
	@(for file in $(JS_CHECK_TARGETS); do \
		echo $(PWD)/$$file; \ # jsstyle doesn't echo as it goes
		$(JSSTYLE) $(JSSTYLE_OPTS) $$file; \
	done)
	@printf "\nJS style ok!\n"

$(JSLINT):
	(cd $(ROOT); $(MAKE) jsl)

clean:
	-rm -f $(TARGETS) $(SMARTDC_TARGETS) $(SMARTDC_LIB_TARGETS) *.o \
	    $(CLEANFILES)

include Makefile.targ

#
# Custom rules for building our various real targets follow.  Generic rules
# belong in Makefile.targ.
#
disklist:
	cp disklist.sh disklist
	chmod 0755 disklist

sysinfo:
	touch sysinfo

.PHONY: vm/tests.tar.gz
vm/tests.tar.gz:
	(cd vm && ./tools/build-test-tarball.sh)

#
# Node native add-on target patterns.  Follow these patterns when adding a new
# add-on and see the comment and definitions for EXPAT.NODE above as well.
#
$(EXPAT.NODE): node-expat/node-expat.cc
	@mkdir -p $(EXPAT_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

$(KSTAT.NODE): node-kstat/kstat.cc
	@mkdir -p $(KSTAT_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

$(SYSLOG.NODE): node-syslog/syslog.cc
	@mkdir -p $(SYSLOG_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

$(ZSOCK_BINDINGS.NODE): $(ZSOCK_SRCDIR)/zsock.cc
	@mkdir -p $(ZSOCK_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

#
# The zutil add-on requires a slightly more complex 2-phase build.
#
$(ZUTIL_OBJDIR)/%.o: $(ZUTIL_SRCDIR)/%.cc $(ZUTIL_BINDINGS_HDRS)
	@mkdir -p $(ZUTIL_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) -o $@ -c $<

$(ZUTIL_BINDINGS.NODE): $(ZUTIL_BINDINGS_OBJS)
	$(GXX) $(LDFLAGS) -o $@ $(ZUTIL_BINDINGS_OBJS) $(LIBS)
