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
# Copyright 2019 Joyent, Inc.
#

BASE =		$(CURDIR)

include Makefile.defs

#
# ROOT is used only when building and running the below tools.
#
ROOT =		$(BASE)/..
JSSTYLE =	$(ROOT)/tools/jsstyle/jsstyle
JSLINT =	$(ROOT)/tools/javascriptlint/build/install/jsl

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
# This should be an absolute path, or building $(SUBDIRS) will fail
DESTDIR =		$(realpath ../proto)

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
fswatcher :	CPPFLAGS +=	-D_REENTRANT
fswatcher :	LIBS +=		-lthread -lnvpair -lavl
zfs_recv :	LIBS +=		-lsocket
zfs_send :	LIBS +=		-lsocket
vmbundle :	CPPFLAGS +=	-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64
sysevent :	LIBS +=		-lnvpair -lsysevent
sysinfo_mod.so : CPPFLAGS +=	-D_REENTRANT
sysinfo_mod.so : CFLAGS +=	-fpic -Wno-unused-parameter $(DEBUG_FLAGS)
sysinfo_mod.so : LDFLAGS +=	-shared -Wl,-ztext

SYSINFO_MOD_DIR = $(DESTDIR)/usr/lib/sysevent/modules

# These files will get run through jsstyle and jslint on 'make check'
JS_CHECK_TARGETS=\
	filewait.js \
	node_modules/{system,onlyif,net-boot-config}.js \
	net-boot-config \
	vm/sbin/*.js \
	vm/node_modules/diff.js \
	vm/node_modules/dladm.js \
	vm/node_modules/expander.js \
	vm/node_modules/fswatcher.js \
	vm/node_modules/hrtime.js \
	vm/node_modules/ip.js \
	vm/node_modules/nic.js \
	vm/node_modules/proptable.js \
	vm/node_modules/utils.js \
	vm/node_modules/VM.js \
	vm/node_modules/qmp.js \
	vm/node_modules/queue.js \
	vm/node_modules/openonerrlogger.js \
	vm/node_modules/vmload/*.js \
	vm/node_modules/vminfod/*.js \
	vm/node_modules/sysevent-stream.js \
	vm/node_modules/zonecfg.js \
	vm/node_modules/zoneevent.js \
	img/lib/*.js \
	img/sbin/imgadm \
	img/test/*.test.js \
	vm/common/nictag.js \
	vm/tests/common.js \
	vm/tests/test-alias.js \
	vm/tests/test-bhyve-disk-resize.js \
	vm/tests/test-bhyve-pci.js \
	vm/tests/test-bhyve-pci_slot.js \
	vm/tests/test-cleanup-on-failure.js \
	vm/tests/test-create-filesystems.js \
	vm/tests/test-create.js \
	vm/tests/test-defaults.js \
	vm/tests/test-disk-uuid.js \
	vm/tests/test-docker.js \
	vm/tests/test-firewall.js \
	vm/tests/test-fswatcher.js \
	vm/tests/test-hrtime.js \
	vm/tests/test-indestructible.js \
	vm/tests/test-internal_metadata_namespaces.js \
	vm/tests/test-info.js \
	vm/tests/test-lastexited.js \
	vm/tests/test-openonerrlogger.js \
	vm/tests/test-queue.js \
	vm/tests/test-quota.js \
	vm/tests/test-reboot.js \
	vm/tests/test-reprovision.js \
	vm/tests/test-send-recv.js \
	vm/tests/test-snapshots.js \
	vm/tests/test-spoof-opts.js \
	vm/tests/test-sysinfo.js \
	vm/tests/test-tmpfs.js \
	vm/tests/test-update.js \
	vm/tests/test-update-kvm.js \
	vm/tests/test-update-bhyve.js \
	vm/tests/test-vrrp-nics.js \
	vm/tests/test-vminfod.js \
	vm/tests/test-vminfod-zonewatcher.js \
	vm/tests/test-vminfod-zonewatcher-overflow.js \
	vm/tests/test-vminfod-zpoolwatcher.js \
	vm/lib/metadata/*.js

JS_CHECK_OLDSKOOL_TARGETS = \
	disklayout.js \
	mkzpool.js \
	smartdc/lib/ntp_config.js \
	node_modules/disklayout.js

# "json.js" intentionally missing

# These files will get run through cstyle on 'make check'
C_CHECK_TARGETS=\
	bootparams.c \
	cryptpass.c \
	disk_size.c \
	fswatcher.c \
	measure_terminal.c \
	nomknod.c \
	smartdc/bin/qemu-exec.c \
	removable_disk.c \
	vmunbundle.c \
	zfs_recv.c \
	zfs_send.c \
	smartdc/lib/sdc-on-tty.c \
	sysinfo_mod.c \
	sysevent.c

#
# Node native add-on patterns.  For add-ons with a single source file in the
# root of the add-on tree and no headers of its own, follow the EXPAT.NODE
# pattern here and below in the targets.  More complex examples (source
# subdirectory, headers, multiple C++ sources) follow; see associated comments
# if you are looking for a pattern to copy.
#

NODE_DESTDIR =	$(PREFIX_NODE)/node_modules/

EXPAT_OBJDIR =	node-expat/build/Release
EXPAT.NODE =	$(EXPAT_OBJDIR)/node-expat.node

$(EXPAT.NODE) :	NODE_WARN_FLAGS += -Wno-unused
$(EXPAT.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(EXPAT.NODE) :	CXXFLAGS +=	$(NODE_CXXFLAGS)
$(EXPAT.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(EXPAT.NODE) :	LIBS +=		-lexpat

#
# The libuuid Node add-on follows the same pattern as EXPAT.NODE.
#
UUID_OBJDIR =	node-libuuid/build/Release
UUID_SRCDIR =	node-libuuid/src
UUID.NODE =	$(UUID_OBJDIR)/uuid.node

$(UUID.NODE) :	NODE_WARN_FLAGS += -Wno-unused -Wno-write-strings
$(UUID.NODE) :	NODE_WARN_FLAGS += -Wno-sign-compare
$(UUID.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(UUID.NODE) :	CXXFLAGS +=	$(NODE_CXXFLAGS)
$(UUID.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(UUID.NODE) :	LIBS +=		-luuid

#
# The kstat Node add-on follows the same pattern as EXPAT.NODE.
#
KSTAT_OBJDIR =	node-kstat/build/Release
KSTAT.NODE =	$(KSTAT_OBJDIR)/kstat.node

$(KSTAT.NODE) :	NODE_WARN_FLAGS += -Wno-unused -Wno-write-strings
$(KSTAT.NODE) :	NODE_WARN_FLAGS += -Wno-sign-compare
$(KSTAT.NODE) :	NODE_WARN_FLAGS += -Wno-format-truncation
$(KSTAT.NODE) :	CPPFLAGS +=	$(NODE_CPPFLAGS)
$(KSTAT.NODE) :	CXXFLAGS +=	$(NODE_CXXFLAGS)
$(KSTAT.NODE) :	LDFLAGS +=	$(NODE_LDFLAGS)
$(KSTAT.NODE) :	LIBS +=		-lkstat

NODE_SUBDIR_ENV = \
			V=1 \
			NODE_DTRACE_PROVIDER_REQUIRE=hard \
			CC="$(GCC)" \
			CXX="$(GXX)" \
			CPPFLAGS="$(NODE_CPPFLAGS)" \
			CFLAGS="$(NODE_CFLAGS)" \
			CXXFLAGS="$(NODE_CXXFLAGS)" \
			LDFLAGS="$(NODE_LDFLAGS)"

DTRACE_PROVIDER_SRCDIR =	node-dtrace-provider

$(DTRACE_PROVIDER_SRCDIR): NODE_WARN_FLAGS += -Wno-sign-compare
$(DTRACE_PROVIDER_SRCDIR): NODE_WARN_FLAGS += -Wno-unused-parameter

$(DTRACE_PROVIDER_SRCDIR):
	cd $(DTRACE_PROVIDER_SRCDIR) && $(NODE_SUBDIR_ENV) $(NPM_EXEC) install \
	    --production --unsafe-perm

CLEANFILES += $(DTRACE_PROVIDER_SRCDIR)/build
CLEANFILES += $(DTRACE_PROVIDER_SRCDIR)/node_modules
CLEANFILES += $(DTRACE_PROVIDER_SRCDIR)/src/build

QLOCKER_SRCDIR =		node-qlocker
QLOCKER_DESTDIR =		$(NODE_DESTDIR)/qlocker

$(QLOCKER_SRCDIR):
	cd $(QLOCKER_SRCDIR) && $(NODE_SUBDIR_ENV) $(NPM_EXEC) install \
	    --production --unsafe-perm

CLEANFILES += $(QLOCKER_SRCDIR)/node_modules

ZONENAME_SRCDIR =		node-zonename
ZONENAME_DESTDIR =		$(NODE_DESTDIR)/zonename

$(ZONENAME_SRCDIR):
	cd $(ZONENAME_SRCDIR) && $(NODE_SUBDIR_ENV) $(NPM_EXEC) install \
	    --production --unsafe-perm

CLEANFILES += $(ZONENAME_SRCDIR)/build
CLEANFILES += $(ZONENAME_SRCDIR)/node_modules

#
# Rules for building the nomknod related shared object.
#
NOMKNOD_SRC =		nomknod.c
NOMKNOD_SO =		nomknod.so
NOMKNOD_32 =		$(NOMKNOD_SO).32
NOMKNOD_64 =		$(NOMKNOD_SO).64

NOMKNOD_FLAGS =		-nostdlib $(PIC_FLAGS) $(SHARED_FLAGS) \
			-Wno-unused-parameter

$(NOMKNOD_32) :		CFLAGS += $(NOMKNOD_FLAGS)
$(NOMKNOD_64) :		CFLAGS += $(NOMKNOD_FLAGS)
NOMKNOD_TARGS =		$(NOMKNOD_32) $(NOMKNOD_64)
NOMKNOD_ROOT =		$(DESTDIR)/usr/img/lib
NOMKNOD_ROOT64 =	$(DESTDIR)/usr/img/lib/amd64

CLEANFILES +=		$(NOMKNOD_TARGS)

BUILT_TARGETS = \
	bootparams \
	disklayout \
	disklist \
	disk_size \
	fssstat \
	fswatcher \
	json \
	mkzpool \
	nomknod.so.32 \
	nomknod.so.64 \
	piadm \
	removable_disk \
	sysevent \
	sysinfo_mod.so \
	vm/node_modules/props.js \
	vmunbundle \
	zfs_recv \
	zfs_send \
	zonememstat \
	zonemon \
	$(EXPAT.NODE) \
	$(KSTAT.NODE) \
	$(NOMKNOD_TARGS) \
	$(UUID.NODE)

NPM_TARGETS = \
	$(DTRACE_PROVIDER_SRCDIR) \
	$(ZONENAME_SRCDIR) \
	$(QLOCKER_SRCDIR)

.PHONY: $(NPM_TARGETS)

USRBIN_TARGETS = \
	bootparams \
	disklayout \
	disklist \
	disk_size \
	json \
	mkzpool \
	nictagadm \
	removable_disk \
	sysinfo

TARGETS = $(BUILT_TARGETS) \
	$(NPM_TARGETS) \
	$(USRBIN_TARGETS)

BUILT_USR_LIB_TARGETS = \
	cryptpass \
	measure_terminal

USR_LIB_TARGETS = $(BUILT_USR_LIB_TARGETS)

BUILT_SMARTDC_TARGETS = \
	smartdc/bin/sdc-factoryreset \
	smartdc/bin/sdc-lastcomm \
	smartdc/bin/sdc-zfs-io-throttle \
	smartdc/bin/qemu-exec

SMARTDC_TARGETS = $(BUILT_SMARTDC_TARGETS)

BUILT_SMARTDC_LIB_TARGETS = \
	smartdc/lib/ntp_config \
	smartdc/lib/sdc-on-tty

SMARTDC_LIB_TARGETS = \
	$(BUILT_SMARTDC_LIB_TARGETS) \
	smartdc/lib/smartos_prompt_config.sh

LIBSDC_TARGETS = \
	lib/sdc/config.sh \
	lib/sdc/network.sh \
	lib/sdc/usb-key.sh \
	lib/sdc/zone.sh

ETC_TARGETS = \
	etc/nodename \
	etc/rtc_config \
	etc/ssh/sshd_config

ETC_COPYRIGHT_TARGET = etc/notices/COPYRIGHT

BHYVE_TARGETS = \
	bhyve/uefi-csm-rom.bin \
	bhyve/uefi-rom.bin \
	bhyve/README

CLEANFILES += $(NOMKNOD_TARGETS) $(BUILT_TARGETS) \
    $(BUILT_SMARTDC_TARGETS) $(BUILT_SMARTDC_LIB_TARGETS)

#
# Subdirectory management
#
SUBDIRS = dockerinit routeinfo lx_hook_postnet

all : TARGET = all
clean : TARGET = clean
install : TARGET = install
check : TARGET = check

all: $(TARGETS) $(USR_LIB_TARGETS) $(SMARTDC_TARGETS) \
    $(SMARTDC_LIB_TARGETS) $(LIBSDC_TARGETS) $(ETC_TARGETS) \
    $(SUBDIRS) $(BHYVE_TARGETS) $(ETC_COPYRIGHT_TARGET)


$(SUBDIRS): FRC
	@cd $@; pwd; $(MAKE) $(TARGET)

install: all $(SUBDIRS)
	echo "7.0" >$(DESTDIR)/.smartdc_version
	mkdir -p $(DESTDIR)/var/db/imgadm $(DESTDIR)/var/fw
	mkdir -p $(DESTDIR)/var/log/sdc/upload $(DESTDIR)/var/log/vm
	mkdir -p $(DESTDIR)/usr/bin
	cp -p $(USRBIN_TARGETS) $(DESTDIR)/usr/bin
	mkdir -p $(DESTDIR)/usr/sbin
	cp -p fssstat piadm sysevent zonememstat zonemon $(DESTDIR)/usr/sbin
	cp -p $(USR_LIB_TARGETS) $(DESTDIR)/usr/lib
	mkdir -p $(DESTDIR)/smartdc/bin
	cp -p $(SMARTDC_TARGETS) $(DESTDIR)/smartdc/bin
	mkdir -p $(DESTDIR)/lib/sdc
	cp -p $(LIBSDC_TARGETS) $(DESTDIR)/lib/sdc/
	mkdir -p $(DESTDIR)/smartdc/lib
	cp -p $(SMARTDC_LIB_TARGETS) $(DESTDIR)/smartdc/lib
	mkdir -p $(DESTDIR)/etc/ssh $(DESTDIR)/etc/notices
	for file in $(ETC_TARGETS); do \
		cp -r $$file $(DESTDIR)/$$file; \
	done
	# /usr/vm
	rm -rf $(DESTDIR)/usr/vm
	cp -PR vm $(DESTDIR)/usr/
	mkdir -m 0755 -p $(DESTDIR)/usr/vm/node_modules
	mkdir -p $(DESTDIR)/usr/vm/test/tests
	cp -Pr vm/common $(DESTDIR)/usr/vm/test/
	mkdir -p $(DESTDIR)/usr/vm/test/tests
	cp -Pr vm/tests/*.js $(DESTDIR)/usr/vm/test/tests/
	cp -Pr vm/tests/testdata $(DESTDIR)/usr/vm/test/
	cp vm/runtest $(DESTDIR)/usr/vm/test/
	cp vm/runtests $(DESTDIR)/usr/vm/test/
	# /usr/node/node_modules
	mkdir -m 0755 -p $(NODE_DESTDIR)
	cp -Pr node_modules/* $(NODE_DESTDIR)
	cp $(KSTAT.NODE) $(NODE_DESTDIR)/
	cp $(EXPAT.NODE) $(NODE_DESTDIR)/expat_binding.node
	cp $(UUID.NODE) $(NODE_DESTDIR)/uuid.node
	mkdir -p $(ZONENAME_DESTDIR)/build/Release
	cp $(ZONENAME_SRCDIR)/build/Release/zonename.node \
	    $(ZONENAME_DESTDIR)/build/Release
	cp $(ZONENAME_SRCDIR)/index.js $(ZONENAME_SRCDIR)/package.json \
	    $(ZONENAME_DESTDIR)/
	mkdir -p $(NODE_DESTDIR)/src/build/Release
	cp $(DTRACE_PROVIDER_SRCDIR)/src/build/Release/DTraceProviderBindings.node \
	    $(NODE_DESTDIR)/src/build/Release/DTraceProviderBindings.node
	cp $(DTRACE_PROVIDER_SRCDIR)//dtrace-provider.js \
	    $(NODE_DESTDIR)/dtrace-provider.js
	mkdir -p $(QLOCKER_DESTDIR)/lib
	cp $(QLOCKER_SRCDIR)/index.js $(QLOCKER_DESTDIR)/
	cp $(QLOCKER_SRCDIR)/lib/qlocker.js $(QLOCKER_DESTDIR)/lib/
	mkdir -p $(NODE_DESTDIR)/fs-ext/build/Release/
	cp $(QLOCKER_SRCDIR)/node_modules/fs-ext/package.json \
	    $(QLOCKER_SRCDIR)/node_modules/fs-ext/fs-ext.js \
	    $(NODE_DESTDIR)/fs-ext/
	cp $(QLOCKER_SRCDIR)/node_modules/fs-ext/build/Release/fs-ext.node \
	    $(NODE_DESTDIR)/fs-ext/build/Release/
	sed -e "s|var expat.*;|var expat = require('./expat_binding');|" \
	    < node-expat/lib/node-expat.js \
	    > $(NODE_DESTDIR)/node-expat.js
	# others
	cp fswatcher $(DESTDIR)/usr/vm/sbin/fswatcher
	cp dockerinit/build/dockerinit $(DESTDIR)/usr/vm/sbin/dockerinit
	cp dockerinit/build/dockerexec $(DESTDIR)/usr/vm/sbin/dockerexec
	cp zoneevent.js $(DESTDIR)/usr/vm/sbin/zoneevent
	cp zfs_send $(DESTDIR)/usr/vm/sbin/zfs_send
	cp zfs_recv $(DESTDIR)/usr/vm/sbin/zfs_recv
	cp vmunbundle $(DESTDIR)/usr/vm/sbin/vmunbundle
	cp filewait.js $(DESTDIR)/usr/vm/sbin/filewait
	mkdir -p $(DESTDIR)/lib/svc/manifest/system
	cp vm/smf/system-vmadmd.xml \
	    $(DESTDIR)/lib/svc/manifest/system/system-vmadmd.xml
	cp vm/smf/system-metadata.xml \
	    $(DESTDIR)/lib/svc/manifest/system/system-metadata.xml
	cp vm/smf/system-vminfod.xml \
	    $(DESTDIR)/lib/svc/manifest/system/system-vminfod.xml
	mv $(DESTDIR)/usr/vm/sbin/vmadmd.js $(DESTDIR)/usr/vm/sbin/vmadmd
	mv $(DESTDIR)/usr/vm/sbin/vmadm.js $(DESTDIR)/usr/vm/sbin/vmadm
	mv $(DESTDIR)/usr/vm/sbin/vminfo.js $(DESTDIR)/usr/vm/sbin/vminfo
	mv $(DESTDIR)/usr/vm/sbin/vminfod.js $(DESTDIR)/usr/vm/sbin/vminfod
	mv $(DESTDIR)/usr/vm/sbin/add-userscript.js \
	    $(DESTDIR)/usr/vm/sbin/add-userscript
	mv $(DESTDIR)/usr/vm/sbin/metadata.js $(DESTDIR)/usr/vm/sbin/metadata
	sed -e "s|require('dtrace-provider'|require('/usr/node/node_modules/dtrace-provider'|" \
	    < node-bunyan/lib/bunyan.js \
	    > $(NODE_DESTDIR)/bunyan.js
	mkdir -p $(DESTDIR)/usr/share/man/man1
	cp node-bunyan/docs/bunyan.1 $(DESTDIR)/usr/share/man/man1/bunyan.1
	mkdir -p $(DESTDIR)/usr/bin
	sed -e 's|^#!/usr/bin/env node.*$$|#!/usr/node/bin/node|' \
	    < node-bunyan/bin/bunyan \
	    > $(DESTDIR)/usr/bin/bunyan
	rm -rf $(DESTDIR)/usr/img
	mkdir -m 0755 -p $(DESTDIR)/usr/img
	cp img/README.md $(DESTDIR)/usr/img/README.md
	cp img/package.json $(DESTDIR)/usr/img/package.json
	cp -PR img/etc $(DESTDIR)/usr/img/
	cp -PR img/lib $(DESTDIR)/usr/img/
	cp -PR img/node_modules $(DESTDIR)/usr/img/
	cp -PR img/sbin $(DESTDIR)/usr/img/
	cp -PR img/test $(DESTDIR)/usr/img/
	rm -rf $(DESTDIR)/usr/fw
	mkdir -m 0755 -p $(DESTDIR)/usr/fw/test
	cp -PR fw/etc $(DESTDIR)/usr/fw/
	cp -Pr fw/test/integration $(DESTDIR)/usr/fw/test/
	cp -Pr fw/test/lib $(DESTDIR)/usr/fw/test/
	cp -Pr fw/test/node_modules $(DESTDIR)/usr/fw/test/
	cp fw/test/runtest $(DESTDIR)/usr/fw/test/
	cp fw/test/runtests $(DESTDIR)/usr/fw/test/
	cp -PR fw/lib $(DESTDIR)/usr/fw/
	cp -PR fw/node_modules $(DESTDIR)/usr/fw/
	cp -PR fw/sbin $(DESTDIR)/usr/fw/
	cp -Pr node_modules/onlyif.js $(DESTDIR)/usr/fw/node_modules/onlyif.js
	cp $(DESTDIR)/usr/node/0.10/node_modules/dtrace-provider.js $(DESTDIR)/usr/fw/node_modules/dtrace-provider.js
	cp $(DTRACE_PROVIDER_SRCDIR)/src/build/Release/DTraceProviderBindings.node \
	     $(DESTDIR)/usr/fw/node_modules/DTraceProviderBindings.node
	sed -e "s|require('dtrace-provider')|require('/usr/fw/node_modules/dtrace-provider')|" \
	    < node-bunyan/lib/bunyan.js \
	    > $(DESTDIR)/usr/fw/node_modules/bunyan.js
	mkdir -m 0755 -p $(DESTDIR)/usr/lib/sdc
	cp -p net-boot-config $(DESTDIR)/usr/lib/sdc
	cd routeinfo && $(MAKE) install
	cd lx_hook_postnet && $(MAKE) install
	mkdir -p $(SYSINFO_MOD_DIR)
	rm -f $(SYSINFO_MOD_DIR)/sysinfo_mod.so
	/usr/sbin/install -f $(SYSINFO_MOD_DIR) -m 0555 sysinfo_mod.so
	mkdir -p $(NOMKNOD_ROOT) $(NOMKNOD_ROOT64)
	rm -f $(DESTDIR)/usr/img/lib/64
	ln -s $(NOMKNOD_ROOT64) $(NOMKNOD_ROOT)/64
	rm -f $(NOMKNOD_ROOT)/$(NOMKNOD_SO) $(NOMKNOD_ROOT64)/$(NOMKNOD_SO)
	/usr/sbin/install -f $(NOMKNOD_ROOT) -m 0555 $(NOMKNOD_32)
	mv $(NOMKNOD_ROOT)/$(NOMKNOD_32) $(NOMKNOD_ROOT)/$(NOMKNOD_SO)
	/usr/sbin/install -f $(NOMKNOD_ROOT64) -m 0555 $(NOMKNOD_64)
	mv $(NOMKNOD_ROOT64)/$(NOMKNOD_64) $(NOMKNOD_ROOT64)/$(NOMKNOD_SO)
	mkdir -p $(DESTDIR)/usr/share/bhyve
	cp $(BHYVE_TARGETS) $(DESTDIR)/usr/share/bhyve
	sed -e "s/%%YEAR%%/$$(date +%Y)/1" $(ETC_COPYRIGHT_TARGET) \
		> $(DESTDIR)/$(ETC_COPYRIGHT_TARGET)

check: $(JSLINT) $(SUBDIRS)
	@echo "==> Running cstyle..."
	@# cstyle doesn't echo as it goes so we add an echo to each line below
	@(for file in $(C_CHECK_TARGETS); do \
		echo $(BASE)/$$file; \
		$(CSTYLE) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	@printf "\nC files ok!\n"
	@printf "\n==> Running JavaScriptLint...\n"
	@$(JSLINT) --nologo --conf=$(ROOT)/tools/jsl.node.conf \
	    $(JS_CHECK_TARGETS) $(JS_CHECK_OLDSKOOL_TARGETS)
	@printf "\n==> Running jsstyle...\n"
	@# jsstyle doesn't echo as it goes so we add an echo to each line below
	(for file in $(JS_CHECK_TARGETS); do \
		echo $(BASE)/$$file; \
		$(JSSTYLE) $(JSSTYLE_OPTS) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	(for file in $(JS_CHECK_OLDSKOOL_TARGETS); do \
		echo $(BASE)/$$file; \
		$(JSSTYLE) $(JSSTYLE_OLDSKOOL_OPTS) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	@$(MAKE) -C fw check
	@printf "\nJS style ok!\n"

.PHONY: manifest
manifest:
	cp manifest ./$(DESTNAME).tmp
	echo "# list of tests is autogenerated by smartos-live/src/Makefile" \
	    >> ./$(DESTNAME).tmp
	(cd vm && git ls-files tests) | grep -v /testdata/ \
	    | sed -e 's|^|f usr/vm/test/|' -e 's|$$| 0444 root bin|' \
	    >> ./$(DESTNAME).tmp
	(cd vm/tests && git ls-files testdata) \
	    | sed -e 's|^|f usr/vm/test/|' -e 's|$$| 0444 root bin|' \
	    >> ./$(DESTNAME).tmp
	(cd fw/test && git ls-files integration) \
	    | sed -e 's|^|f usr/fw/test/|' -e 's|$$| 0444 root bin|' \
	    >> ./$(DESTNAME).tmp
	(cd fw/etc && git ls-files examples) \
	    | sed -e 's|^|f usr/fw/etc/|' -e 's|$$| 0444 root bin|' \
	    >> ./$(DESTNAME).tmp
	mv ./$(DESTNAME).tmp $(DESTDIR)/$(DESTNAME)

$(JSLINT):
	(cd $(ROOT); $(MAKE) jsl)

clean: $(SUBDIRS)
	-rm -f $(CLEANFILES) *.o

include Makefile.targ

#
# Custom rules for building our various real targets follow.  Generic rules
# belong in Makefile.targ.
#
vm/node_modules/props.js: vm/node_modules/proptable.js vm/node_modules/expander.js
	node vm/node_modules/expander.js > vm/node_modules/props.js.new \
		&& mv vm/node_modules/props.js.new vm/node_modules/props.js

#
# Node native add-on target patterns.  Follow these patterns when adding a new
# add-on and see the comment and definitions for EXPAT.NODE above as well.
#
$(EXPAT.NODE): node-expat/node-expat.cc
	@mkdir -p $(@D)
	$(LINK32.cc) $^ $(LIBS)

$(KSTAT.NODE): node-kstat/kstat.cc
	@mkdir -p $(@D)
	$(LINK32.cc) $^ $(LIBS)

$(UUID.NODE): $(UUID_SRCDIR)/uuid.cc
	@mkdir -p $(@D)
	$(LINK32.cc) $^ $(LIBS)

$(NOMKNOD_32):	$(NOMKNOD_SRC)
	$(LINK32.c) $^

$(NOMKNOD_64):	$(NOMKNOD_SRC)
	$(LINK64.c) $^

FRC:
