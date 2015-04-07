#
# Copyright (c) 2014, Joyent, Inc.  All rights reserved.
#

ROOT =		$(PWD)
PROTO =		$(ROOT)/proto
STRAP_PROTO =	$(ROOT)/proto.strap
MPROTO =	$(ROOT)/manifest.d
BOOT_MPROTO =	$(ROOT)/boot.manifest.d
BOOT_PROTO =	$(ROOT)/proto.boot

# On Darwin/OS X we support running 'make check'
ifeq ($(shell uname -s),Darwin)
PATH =		/bin:/usr/bin:/usr/sbin:/sbin:/opt/local/bin
else
PATH =		/usr/bin:/usr/sbin:/sbin:/opt/local/bin
endif

#
# This number establishes a maximum for smartos-live, illumos-extra, and
# illumos-joyent.  Support for it can and should be added to other projects
# as time allows.  The default value on large (16 GB or more) zones/systems
# is 128; on smaller systems it is 8.  You can override this in the usual way;
# i.e.,
#
# gmake world live MAX_JOBS=32
#
CRIPPLED_HOST :=	$(shell [[ `prtconf -m 2>/dev/null || echo 999999` -lt \
    16384 ]] && echo yes || echo no)
ifeq ($(CRIPPLED_HOST),yes)
MAX_JOBS ?=	8
else
MAX_JOBS ?=	128
endif

LOCAL_SUBDIRS :=	$(shell ls projects/local)
OVERLAYS :=	$(shell cat overlay/order)
PKGSRC =	$(ROOT)/pkgsrc
MANIFEST =	manifest.gen
BOOT_MANIFEST =	boot.manifest.gen
JSSTYLE =	$(ROOT)/tools/jsstyle/jsstyle
JSLINT =	$(ROOT)/tools/javascriptlint/build/install/jsl
CSTYLE =	$(ROOT)/tools/cstyle

CTFBINDIR = \
	$(ROOT)/projects/illumos/usr/src/tools/proto/*/opt/onbld/bin/i386
CTFMERGE =	$(CTFBINDIR)/ctfmerge
CTFCONVERT =	$(CTFBINDIR)/ctfconvert

NATIVE_CC =	/opt/local/bin/gcc

SUBDIR_DEFS = \
	CTFMERGE=$(CTFMERGE) \
	CTFCONVERT=$(CTFCONVERT) \
	MAX_JOBS=$(MAX_JOBS)

ADJUNCT_TARBALL :=	$(shell ls `pwd`/illumos-adjunct*.tgz 2>/dev/null \
	| tail -n1 && echo $?)

STAMPFILE :=	$(ROOT)/proto/buildstamp

WORLD_MANIFESTS := \
	$(MPROTO)/illumos.manifest \
	$(MPROTO)/live.manifest \
	$(MPROTO)/illumos-extra.manifest

BOOT_MANIFESTS := \
	$(BOOT_MPROTO)/illumos.manifest

SUBDIR_MANIFESTS :=	$(LOCAL_SUBDIRS:%=$(MPROTO)/%.sd.manifest)
OVERLAY_MANIFESTS :=	$(OVERLAYS:$(ROOT)/overlay/%=$(MPROTO)/%.ov.manifest)

BOOT_VERSION :=	boot-$(shell [[ -f $(ROOT)/configure-buildver ]] && \
    echo $$(head -n1 $(ROOT)/configure-buildver)-)$(shell head -n1 $(STAMPFILE))
BOOT_TARBALL :=	output/$(BOOT_VERSION).tgz

TOOLS_TARGETS = \
	tools/mancheck/mancheck \
	tools/cryptpass

world: 0-extra-stamp 0-illumos-stamp 1-extra-stamp 0-livesrc-stamp \
	0-local-stamp 0-tools-stamp 0-man-stamp 0-devpro-stamp \
	$(TOOLS_TARGETS) sdcman

live: world manifest boot sdcman $(TOOLS_TARGETS)
	@echo $(OVERLAY_MANIFESTS)
	@echo $(SUBDIR_MANIFESTS)
	mkdir -p ${ROOT}/log
	(cd $(ROOT) && \
	    pfexec ./tools/build_live $(ROOT)/$(MANIFEST) $(ROOT)/output \
	    $(OVERLAYS) $(ROOT)/proto $(ROOT)/man/man)

boot: $(BOOT_TARBALL)

.PHONY: pkgsrc
pkgsrc:
	cd $(PKGSRC) && gmake install

$(BOOT_TARBALL): world manifest
	pfexec rm -rf $(BOOT_PROTO)
	mkdir -p $(BOOT_PROTO)
	mkdir -p $(ROOT)/output
	pfexec ./tools/builder/builder $(ROOT)/$(BOOT_MANIFEST) \
	    $(BOOT_PROTO) $(ROOT)/proto
	(cd $(BOOT_PROTO) && pfexec gtar czf $(ROOT)/$@ .)

#
# Manifest construction.  There are 5 sources for manifests we need to collect
# in $(MPROTO) before running the manifest tool.  One each comes from
# illumos, illumos-extra, and the root of live (covering mainly what's in src).
# Additional manifests come from each of $(LOCAL_SUBDIRS), which may choose
# to construct them programmatically, and $(OVERLAYS), which must be static.
# These all end up in $(MPROTO), where we tell tools/build_manifest to look;
# it will pick up every file in that directory and treat it as a manifest.
#
# In addition, a separate manifest is generated in similar manner for the
# boot tarball.
#
# Look ma, no for loops in these shell fragments!
#
manifest: $(MANIFEST) $(BOOT_MANIFEST)

$(MPROTO) $(BOOT_MPROTO):
	mkdir -p $@

$(MPROTO)/live.manifest: src/manifest | $(MPROTO)
	gmake DESTDIR=$(MPROTO) DESTNAME=live.manifest \
	    -C src manifest

$(MPROTO)/illumos.manifest: projects/illumos/manifest | $(MPROTO)
	cp projects/illumos/manifest $(MPROTO)/illumos.manifest

$(BOOT_MPROTO)/illumos.manifest: projects/illumos/manifest | $(BOOT_MPROTO)
	cp projects/illumos/boot.manifest $(BOOT_MPROTO)/illumos.manifest

$(MPROTO)/illumos-extra.manifest: 1-extra-stamp | $(MPROTO)
	gmake DESTDIR=$(MPROTO) DESTNAME=illumos-extra.manifest \
	    -C projects/illumos-extra manifest; \

$(MPROTO)/%.sd.manifest: projects/local/%/Makefile projects/local/%/manifest
	cd $(ROOT)/projects/local/$* && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake DESTDIR=$(MPROTO) DESTNAME=$*.sd.manifest \
		    -f Makefile.joyent manifest; \
	    else \
		gmake DESTDIR=$(MPROTO) DESTNAME=$*.sd.manifest \
		    manifest; \
	    fi

$(MPROTO)/%.ov.manifest: $(MPROTO) $(ROOT)/overlay/%/manifest
	cp $(ROOT)/overlay/$*/manifest $@

$(MANIFEST): $(WORLD_MANIFESTS) $(SUBDIR_MANIFESTS) $(OVERLAY_MANIFESTS)
	-rm -f $@
	./tools/build_manifest $(MPROTO) | ./tools/sorter > $@

$(BOOT_MANIFEST): $(BOOT_MANIFESTS)
	-rm -f $@
	./tools/build_manifest $(BOOT_MPROTO) | ./tools/sorter > $@

#
# Update source code from parent repositories.  We do this for each local
# project as well as for illumos, illumos-extra, and illumos-live via the
# update_base tool.
#
update: update-base $(LOCAL_SUBDIRS:%=%.update)
	-rm -f 0-local-stamp

.PHONY: update-base
update-base:
	./tools/update_base

.PHONY: %.update
%.update:
	cd $(ROOT)/projects/local/$* && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake -f Makefile.joyent update; \
	    else \
		gmake update; \
	    fi
	-rm -f 0-subdir-$*-stamp

0-local-stamp: $(LOCAL_SUBDIRS:%=0-subdir-%-stamp)
	touch $@

0-subdir-%-stamp: 0-illumos-stamp
	cd "$(ROOT)/projects/local/$*" && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake -f Makefile.joyent $(SUBDIR_DEFS) DESTDIR=$(PROTO) \
		    world install; \
	    else \
		gmake $(SUBDIR_DEFS) DESTDIR=$(PROTO) world install; \
	    fi
	touch $@

0-devpro-stamp:
	[ ! -d projects/devpro ] || \
	    (cd projects/devpro && gmake DESTDIR=$(PROTO) install)
	touch $@

0-illumos-stamp: 0-extra-stamp
	(cd $(ROOT) && MAX_JOBS=$(MAX_JOBS) ./tools/build_illumos)
	touch $@

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extra && \
	    gmake MAX_JOBS=$(MAX_JOBS) STRAP=strap DESTDIR=$(STRAP_PROTO) \
	    install_strap)
	(cd $(STRAP_PROTO) && gtar xzf $(ADJUNCT_TARBALL))
	touch $@

1-extra-stamp: 0-illumos-stamp
	(cd $(ROOT)/projects/illumos-extra && \
	    gmake $(SUBDIR_DEFS) DESTDIR=$(PROTO) install)
	touch $@

0-livesrc-stamp: 0-illumos-stamp 0-extra-stamp 1-extra-stamp
	(cd $(ROOT)/src && \
	    gmake -j$(MAX_JOBS) NATIVEDIR=$(STRAP_PROTO) \
	    DESTDIR=$(PROTO) && \
	    gmake NATIVEDIR=$(STRAP_PROTO) DESTDIR=$(PROTO) install)
	touch $@

0-man-stamp:
	(cd $(ROOT)/man/src && gmake clean && gmake)
	touch $@

0-tools-stamp: 0-pwgen-stamp
	(cd $(ROOT)/tools/builder && gmake builder)
	touch $@

0-pwgen-stamp:
	(cd ${ROOT}/tools/pwgen-* && autoconf && ./configure && \
	    make && cp pwgen ${ROOT}/tools)
	touch $@

tools/cryptpass: src/cryptpass.c
	$(NATIVE_CC) -Wall -W -O2 -o $@ $<

.PHONY: tools/mancheck/mancheck
tools/mancheck/mancheck: 0-illumos-stamp
	(cd tools/mancheck && gmake mancheck CC=$(NATIVE_CC) $(SUBDIR_DEFS))

.PHONY: sdcman
sdcman:
	(cd $(ROOT)/man/sdc && gmake install DESTDIR=$(PROTO) $(SUBDIR_DEFS))

jsl: $(JSLINT)

$(JSLINT):
	@(cd $(ROOT)/tools/javascriptlint; make CC=$(NATIVE_CC) install)

check: $(JSLINT)
	@(cd $(ROOT)/src && make check)

clean:
	rm -f $(MANIFEST) $(BOOT_MANIFEST)
	rm -rf $(MPROTO)/* $(BOOT_MPROTO)/*
	(cd $(ROOT)/src && gmake clean)
	[ ! -d $(ROOT)/projects/illumos-extra ] || \
	    (cd $(ROOT)/projects/illumos-extra && gmake clean)
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do \
		cd $(ROOT)/projects/local/$${dir} && \
		if [[ -f Makefile.joyent ]]; then \
			gmake -f Makefile.joyent clean; \
		else \
			gmake clean; \
		fi; \
	done
	(cd $(PKGSRC) && gmake clean)
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && rm -rf $(STRAP_PROTO))
	(cd $(ROOT) && pfexec rm -rf $(BOOT_PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO) $(STRAP_PROTO) $(BOOT_PROTO))
	rm -f tools/cryptpass
	(cd tools/mancheck && gmake clean)
	(cd man/sdc && gmake clean)
	rm -f 0-*-stamp 1-*-stamp

clobber: clean
	rm -f output/* output-iso/* output-usb/*
 
iso: live
	./tools/build_iso

usb: live
	./tools/build_usb

.PHONY: manifest check jsl
