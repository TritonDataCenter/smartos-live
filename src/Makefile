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
JSSTYLE_OPTS = -o indent=4,strict-indent=1,doxygen,unparenthesized-return=0,continuation-at-front=1,leading-right-paren-ok=1

JSSTYLE_OLDSKOOL_OPTS =

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

#
# DESTNAME is used for the manifest target.  We set it to something
# obvious here so that if it's not set, the manifest target doesn't do
# bad things.
#
DESTNAME =	live.manifest

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

JS_CHECK_OLDSKOOL_TARGETS = \
	disklayout.js \
	mkzpool.js \
	node_modules/disklayout.js

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
# The dtrace-provider add-on uses a combination of C, assembly and C++ files in
# multiple directories.
#
DTRACE_PROVIDER_OBJDIR =	node-dtrace-provider/build/Release
DTRACE_PROVIDER_SRCDIR =	node-dtrace-provider
DTRACE_PROVIDER.NODE =		$(DTRACE_PROVIDER_OBJDIR)/dtrace-provider.node

DTRACE_PROVIDER_SRCS += \
			dtrace_probe.cc \
			dtrace_provider.cc

DTRACE_PROVIDER_LIBUSDT_SRCS += \
			libusdt/usdt.c \
			libusdt/usdt_dof_file.c \
			libusdt/usdt_probe.c \
			libusdt/usdt_dof.c \
			libusdt/usdt_dof_sections.c

DTRACE_PROVIDER_LIBUSDT_ASM_SRCS += \
			libusdt/usdt_tracepoints_i386.s

DTRACE_PROVIDER_HDRS += \
			node-dtrace-provider/dtrace_provider.h \
			node-dtrace-provider/libusdt/usdt_internal.h \
			node-dtrace-provider/libusdt/usdt.h

DTRACE_PROVIDER_OBJS += \
			$(DTRACE_PROVIDER_SRCS:%.cc=$(DTRACE_PROVIDER_OBJDIR)/%.o) \
			$(DTRACE_PROVIDER_LIBUSDT_SRCS:%.c=$(DTRACE_PROVIDER_OBJDIR)/%.o) \
			$(DTRACE_PROVIDER_LIBUSDT_ASM_SRCS:%.s=$(DTRACE_PROVIDER_OBJDIR)/%.o)

$(DTRACE_PROVIDER.NODE) :	WARN_FLAGS +=	-Wno-unused -Wno-sign-compare
$(DTRACE_PROVIDER.NODE) :	CFLAGS +=	$(NODE_CFLAGS)
$(DTRACE_PROVIDER.NODE) :	CPPFLAGS +=	\
					$(NODE_CPPFLAGS) \
					-Inode-dtrace-provider/libusdt
$(DTRACE_PROVIDER.NODE) :	CXXFLAGS +=	$(NODE_CFLAGS)
$(DTRACE_PROVIDER.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)

CLEANFILES +=	$(DTRACE_PROVIDER.NODE) $(DTRACE_PROVIDER_OBJS)

#
# The sqlite3 add-on uses a combination of C + C++ files in multiple
# directories, and has multiple header directories as well.
#
SQLITE3_OBJDIR =	node-sqlite3/build/Release
SQLITE3_SRCDIR =	node-sqlite3/src
SQLITE3_LIBSRCDIR =	node-sqlite3/deps/sqlite3
SQLITE3_BINDINGS.NODE =	$(SQLITE3_OBJDIR)/node_sqlite3.node

SQLITE3_SRCS += \
	database.cc \
	node_sqlite3.cc \
	statement.cc

SQLITE3_LIBSRCS +=	sqlite3.c

SQLITE3_NODEHDRS += \
	async.h \
	macros.h \
	statement.h \
	threading.h

SQLITE3_LIBHDRS += \
	sqlite3.h \
	sqlite3ext.h

SQLITE3_OBJS =		\
			$(SQLITE3_SRCS:%.cc=$(SQLITE3_OBJDIR)/%.o) \
			$(SQLITE3_LIBSRCS:%.c=$(SQLITE3_OBJDIR)/%.o)
SQLITE3_HDRS =		\
			$(SQLITE3_NODEHDRS:%=$(SQLITE3_SRCDIR)/%) \
			$(SQLITE3_LIBHDRS:%=$(SQLITE3_LIBSRCDIR)/%)
CLEANFILES +=		$(SQLITE3_OBJS)

SQLITE3_FLAGS = \
				-fdata-sections \
				-ffunction-sections \
				-fno-omit-frame-pointer \
				-fno-strict-aliasing \
				-fno-exceptions

$(SQLITE3_BINDINGS.NODE) :	WARN_FLAGS =	-Wall -Werror
$(SQLITE3_BINDINGS.NODE) :	CPPFLAGS += \
				$(NODE_CPPFLAGS) \
				-I$(SQLITE3_LIBSRCDIR) \
				-D_SQLITE_THREADSAFE=1 \
				-D_SQLITE_ENABLE_FTS3 \
				-D_SQLITE_ENABLE_RTREE \
				-D_LARGEFILE_SOURCE \
				-D_FILE_OFFSET_BITS=64 \
				-D_REENTRANT \
				-D_NDEBUG \
				-D_POSIX_PTHREAD_SEMANTICS
$(SQLITE3_BINDINGS.NODE) :	CFLAGS += \
				$(NODE_CFLAGS) \
				$(SQLITE3_FLAGS)
$(SQLITE3_BINDINGS.NODE) :	LDFLAGS += \
				$(NODE_LDFLAGS) \
				-Wl,-soname=node_sqlite3.node
$(SQLITE3_BINDINGS.NODE) :	LIBS += -lpthread

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
$(ZUTIL_BINDINGS.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS) -DSunOS
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
	disklayout \
	disklist \
	disk_size \
	mkzpool \
	removable_disk \
	vmunbundle \
	zfs_recv \
	zfs_send \
	zoneevent \
	$(EXPAT.NODE) \
	$(DTRACE_PROVIDER.NODE) \
	$(KSTAT.NODE) \
	$(SYSLOG.NODE) \
	$(SQLITE3_BINDINGS.NODE) \
	$(ZSOCK_BINDINGS.NODE) \
	$(ZUTIL_BINDINGS.NODE)

SMARTDC_TARGETS = \
	qemu-exec

SMARTDC_LIB_TARGETS = \
	sdc-on-tty

all: $(TARGETS) sysinfo $(SMARTDC_TARGETS) $(SMARTDC_LIB_TARGETS)

install: all
	mkdir -p $(DESTDIR)/usr/bin
	cp -p $(TARGETS) sysinfo $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/smartdc/bin
	cp -p $(SMARTDC_TARGETS) $(DESTDIR)/smartdc/bin
	mkdir -p $(DESTDIR)/smartdc/lib
	cp -p $(SMARTDC_LIB_TARGETS) $(DESTDIR)/smartdc/lib
	mkdir -m 0755 -p $(PREFIX_NODE)/node_modules
	cp -Pr node_modules/* $(PREFIX_NODE)/node_modules
	cp $(KSTAT.NODE) $(PREFIX_NODE)/node_modules/
	rm -rf $(DESTDIR)/usr/vm
	cp -PR vm $(DESTDIR)/usr/
	mkdir -m 0755 -p $(DESTDIR)/usr/vm/node_modules
	mkdir -p $(PREFIX_NODE)/node_modules/{zsock,zutil}/build/Release
	mkdir -p $(DESTDIR)/usr/vm/test/tests
	cp -Pr vm/common $(DESTDIR)/usr/vm/test/
	cp -Pr vm/node-tap $(DESTDIR)/usr/vm/test/
	cp -Pr vm/tests $(DESTDIR)/usr/vm/test/
	cp vm/runtest $(DESTDIR)/usr/vm/test/
	cp vm/runtests $(DESTDIR)/usr/vm/test/
	cp -Pr node-zsock/{package.json,lib} \
	    $(PREFIX_NODE)/node_modules/zsock
	cp -Pr node-zutil/{package.json,lib} \
	    $(PREFIX_NODE)/node_modules/zutil
	cp $(SQLITE3_BINDINGS.NODE) \
	    $(PREFIX_NODE)/node_modules
	(sed -e "s|var sqlite3.*;|var sqlite3 = module.exports = exports = require('./node_sqlite3');|" | \
	    sed -e "s|var trace = require.*;|var trace = require('./sqlite3_trace')|") \
	    < node-sqlite3/lib/sqlite3.js \
	    > $(PREFIX_NODE)/node_modules/sqlite3.js
	cp node-sqlite3/lib/trace.js $(PREFIX_NODE)/node_modules/sqlite3_trace.js
	cp $(ZSOCK_BINDINGS.NODE) \
	    $(PREFIX_NODE)/node_modules/zsock/build/Release
	cp $(ZUTIL_BINDINGS.NODE) \
	    $(PREFIX_NODE)/node_modules/zutil/build/Release
	cp $(EXPAT.NODE) $(PREFIX_NODE)/node_modules/expat_binding.node
	cp $(DTRACE_PROVIDER.NODE) $(PREFIX_NODE)/node_modules/dtrace-provider.node
	sed -e "s|var expat.*;|var expat = require('./expat_binding');|" \
	    < node-expat/lib/node-expat.js \
	    > $(PREFIX_NODE)/node_modules/node-expat.js
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
	mkdir -p $(DESTDIR)/usr/share/man/man1
	cp node-bunyan/lib/bunyan.js $(PREFIX_NODE)/node_modules/bunyan.js
	cp node-bunyan/docs/bunyan.1 $(DESTDIR)/usr/share/man/man1/bunyan.1
	mkdir -p $(DESTDIR)/usr/bin
	sed -e 's|^#!/usr/bin/env node.*$$|#!/usr/node/bin/node|' \
	    < node-bunyan/bin/bunyan \
	    > $(DESTDIR)/usr/bin/bunyan
	cp -PR img $(DESTDIR)/usr/
	mkdir -m 0755 -p $(DESTDIR)/var/db/imgadm

check: $(JSLINT)
	@echo "==> Running cstyle..."
	@# cstyle doesn't echo as it goes so we add an echo to each line below
	@(for file in $(C_CHECK_TARGETS); do \
		echo $(PWD)/$$file; \
		$(CSTYLE) $$file; \
	done)
	@printf "\nC files ok!\n"
	@printf "\n==> Running JavaScriptLint...\n"
	@$(JSLINT) --nologo --conf=$(ROOT)/tools/jsl.node.conf \
	    $(JS_CHECK_TARGETS) $(JS_CHECK_OLDSKOOL_TARGETS)
	@printf "\n==> Running jsstyle...\n"
	@# jsstyle doesn't echo as it goes so we add an echo to each line below
	(for file in $(JS_CHECK_TARGETS); do \
		echo $(PWD)/$$file; \
		$(JSSTYLE) $(JSSTYLE_OPTS) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	(for file in $(JS_CHECK_OLDSKOOL_TARGETS); do \
		echo $(PWD)/$$file; \
		$(JSSTYLE) $(JSSTYLE_OLDSKOOL_OPTS) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	@printf "\nJS style ok!\n"

.PHONY: manifest
manifest:
	(cat manifest && cd vm && \
	    echo "# list of tests is autogenerated by smartos-live/src/Makefile" && \
	    find tests/ -type f -exec echo "{}" "0444 root bin" \;) \
	    | sed -e "s|^tests/|f usr/vm/test/tests/|" \
	    > $(DESTDIR)/$(DESTNAME) \

$(JSLINT):
	(cd $(ROOT); $(MAKE) jsl)

clean:
	-rm -f $(TARGETS) $(SMARTDC_TARGETS) $(SMARTDC_LIB_TARGETS) *.o \
	    $(CLEANFILES)
	-rm -rf node-sqlite3/build

include Makefile.targ

#
# Custom rules for building our various real targets follow.  Generic rules
# belong in Makefile.targ.
#
disklayout: disklayout.js
	cp disklayout.js disklayout
	chmod 0755 disklayout

disklist: disklist.sh
	cp disklist.sh disklist
	chmod 0755 disklist

mkzpool: mkzpool.js
	cp mkzpool.js mkzpool
	chmod 0755 mkzpool

sysinfo:
	touch sysinfo

#
# Node native add-on target patterns.  Follow these patterns when adding a new
# add-on and see the comment and definitions for EXPAT.NODE above as well.
#
$(EXPAT.NODE): node-expat/node-expat.cc
	@mkdir -p $(EXPAT_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

#
# The next two are used to build libusdt files into
# $(DTRACE_PROVIDER_OBJDIR)/libusdt/*.o, instead of building libusdt.a
#
$(DTRACE_PROVIDER_OBJDIR)/%.o: $(DTRACE_PROVIDER_SRCDIR)/%.c \
	    $(DTRACE_PROVIDER_HDRS)
	@mkdir -p $(DTRACE_PROVIDER_OBJDIR)/libusdt
	$(GCC) $(CPPFLAGS) $(CFLAGS) -o $@ -c $<

$(DTRACE_PROVIDER_OBJDIR)/%.o: $(DTRACE_PROVIDER_SRCDIR)/%.s
	@mkdir -p $(DTRACE_PROVIDER_OBJDIR)/libusdt
	$(GCC) $(CPPFLAGS) $(CFLAGS) -o $@ -c $<

$(DTRACE_PROVIDER_OBJDIR)/%.o: $(DTRACE_PROVIDER_SRCDIR)/%.cc \
	    $(DTRACE_PROVIDER_HDRS)
	@mkdir -p $(DTRACE_PROVIDER_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ -c $<

$(DTRACE_PROVIDER.NODE): $(DTRACE_PROVIDER_OBJS)
	@mkdir -p $(DTRACE_PROVIDER_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $(DTRACE_PROVIDER_OBJS) $(LIBS)

$(KSTAT.NODE): node-kstat/kstat.cc
	@mkdir -p $(KSTAT_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) $(LDFLAGS) -o $@ $< $(LIBS)

$(SQLITE3_OBJDIR)/%.o: $(SQLITE3_SRCDIR)/%.cc $(SQLITE3_HDRS)
	@mkdir -p $(SQLITE3_OBJDIR)
	$(GXX) $(CPPFLAGS) $(CXXFLAGS) -o $@ -c $<

$(SQLITE3_OBJDIR)/%.o: $(SQLITE3_LIBSRCDIR)/%.c $(SQLITE3_HDRS)
	@mkdir -p $(SQLITE3_OBJDIR)
	$(GCC) $(CPPFLAGS) $(CFLAGS) -o $@ -c $<

$(SQLITE3_BINDINGS.NODE): $(SQLITE3_OBJS)
	$(GXX) $(LDFLAGS) -o $@ $(SQLITE3_OBJS) $(LIBS)

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
