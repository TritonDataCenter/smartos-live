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
# Copyright 2018 Joyent, Inc.
#

#
# MG runs make check prior to ./configure, so allow build.env not to exist.
#
ifeq ($(MAKECMDGOALS),check)
-include build.env
else
include build.env
endif

ROOT =		$(PWD)
PROTO =		$(ROOT)/proto
STRAP_PROTO =	$(ROOT)/proto.strap
MPROTO =	$(ROOT)/manifest.d
BOOT_MPROTO =	$(ROOT)/boot.manifest.d
BOOT_PROTO =	$(ROOT)/proto.boot
IMAGES_PROTO =	$(ROOT)/proto.images
MCPROTO =	$(ROOT)/mancheck.conf.d

# On Darwin/OS X we support running 'make check'
ifeq ($(shell uname -s),Darwin)
PATH =		/bin:/usr/bin:/usr/sbin:/sbin:/opt/local/bin
NATIVE_CC =	gcc
else
PATH =		/usr/bin:/usr/sbin:/sbin:/opt/local/bin
NATIVE_CC =	/opt/local/bin/gcc
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
MANCHECK =	$(ROOT)/tools/mancheck/mancheck
MANCF =		$(ROOT)/tools/mancf/mancf
TZCHECK =	$(ROOT)/tools/tzcheck/tzcheck
UCODECHECK =	$(ROOT)/tools/ucodecheck/ucodecheck

CTFBINDIR = \
	$(ROOT)/projects/illumos/usr/src/tools/proto/*/opt/onbld/bin/i386
CTFMERGE =	$(CTFBINDIR)/ctfmerge
CTFCONVERT =	$(CTFBINDIR)/ctfconvert
ALTCTFCONVERT =	$(CTFBINDIR)/ctfconvert-altexec

SUBDIR_DEFS = \
	CTFMERGE=$(CTFMERGE) \
	CTFCONVERT=$(CTFCONVERT) \
	ALTCTFCONVERT=$(ALTCTFCONVERT) \
	MAX_JOBS=$(MAX_JOBS)

ADJUNCT_TARBALL :=	$(shell ls `pwd`/illumos-adjunct*.tgz 2>/dev/null \
	| tail -n1 && echo $?)

STAMPFILE :=	$(ROOT)/proto/buildstamp

MANCF_FILE :=	$(ROOT)/proto/usr/share/man/man.cf

WORLD_MANIFESTS := \
	$(MPROTO)/illumos.manifest \
	$(MPROTO)/live.manifest \
	$(MPROTO)/illumos-extra.manifest

WORLD_MANCHECK_CONFS := \
	$(MCPROTO)/illumos.mancheck.conf \
	$(MCPROTO)/live.mancheck.conf \
	$(MCPROTO)/illumos-extra.mancheck.conf

BOOT_MANIFESTS := \
	$(BOOT_MPROTO)/illumos.manifest

SUBDIR_MANIFESTS :=	$(LOCAL_SUBDIRS:%=$(MPROTO)/%.sd.manifest)
OVERLAY_MANIFESTS :=	$(OVERLAYS:$(ROOT)/overlay/%=$(MPROTO)/%.ov.manifest)

SUBDIR_MANCHECK_CONFS := \
	$(LOCAL_SUBDIRS:%=$(MCPROTO)/%.sd.mancheck.conf)
OVERLAY_MANCHECK_CONFS := \
	$(OVERLAYS:$(ROOT)/overlay/%=$(MCPROTO)/%.ov.mancheck.conf)

BOOT_VERSION :=	boot-$(shell [[ -f $(ROOT)/configure-buildver ]] && \
    echo $$(head -n1 $(ROOT)/configure-buildver)-)$(shell head -n1 $(STAMPFILE))
BOOT_TARBALL :=	output/$(BOOT_VERSION).tgz

IMAGES_VERSION :=	images-$(shell [[ -f $(ROOT)/configure-buildver ]] && \
    echo $$(head -n1 $(ROOT)/configure-buildver)-)$(shell head -n1 $(STAMPFILE))
IMAGES_TARBALL :=	output/$(IMAGES_VERSION).tgz

IMAGES_SIZES_GB :=	1 2 4 8

TOOLS_TARGETS = \
	$(MANCHECK) \
	$(MANCF) \
	$(TZCHECK) \
	$(UCODECHECK) \
	tools/cryptpass

world: 0-strap-stamp 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp \
	0-local-stamp 0-tools-stamp 0-man-stamp 0-devpro-stamp \
	$(TOOLS_TARGETS) sdcman

live: world manifest mancheck_conf boot sdcman $(TOOLS_TARGETS) $(MANCF_FILE)
	@echo $(OVERLAY_MANIFESTS)
	@echo $(SUBDIR_MANIFESTS)
	mkdir -p ${ROOT}/log
	ALTCTFCONVERT=$(ALTCTFCONVERT) ./tools/build_live \
	    -m $(ROOT)/$(MANIFEST) -o $(ROOT)/output $(OVERLAYS) $(ROOT)/proto \
	    $(ROOT)/man/man

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
# Create proforma images for use in assembling bootable USB device images.
# These images are assembled into a sparse tar file which takes up hardly any
# space, despite the large size of the (mostly blank) images.  This tar file is
# used by "make coal" and "make usb" in "sdc-headnode.git" to create Triton
# boot and installation media.
#
images: $(IMAGES_SIZES_GB:%=$(IMAGES_PROTO)/%gb.img)

$(IMAGES_PROTO)/%.img: boot tools/images/%.fdisk tools/images/make_image
	rm -f $@
	mkdir -p $(IMAGES_PROTO)
	./tools/images/make_image -s $* -G $(ROOT)/proto \
	    -F tools/images/$*.fdisk $@

images-tar: $(IMAGES_TARBALL)

$(IMAGES_TARBALL): images
	cd $(IMAGES_PROTO) && gtar -Scvz --owner=0 --group=0 -f $(ROOT)/$@ \
	    $(IMAGES_SIZES_GB:%=%gb.img)

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

mancheck_conf: $(WORLD_MANCHECK_CONFS) $(SUBDIR_MANCHECK_CONFS) \
    $(OVERLAY_MANCHECK_CONFS)

dump_mancheck_conf: manifest mancheck_conf $(MANCHECK)
	args=; for x in $(MCPROTO)/*.mancheck.conf; do \
	    args="$$args -c $$x"; done; \
	    $(MANCHECK) -f manifest.gen -s -D $$args

$(MPROTO) $(BOOT_MPROTO) $(MCPROTO):
	mkdir -p $@

$(MPROTO)/live.manifest: src/manifest | $(MPROTO)
	gmake DESTDIR=$(MPROTO) DESTNAME=live.manifest \
	    -C src manifest

$(MCPROTO)/live.mancheck.conf: src/mancheck.conf | $(MCPROTO)
	gmake DESTDIR=$(MCPROTO) DESTNAME=live.mancheck.conf \
	    -C src mancheck_conf

$(MPROTO)/illumos.manifest: projects/illumos/manifest | $(MPROTO)
	cp projects/illumos/manifest $(MPROTO)/illumos.manifest

$(MCPROTO)/illumos.mancheck.conf: projects/illumos/mancheck.conf | $(MCPROTO)
	cp projects/illumos/mancheck.conf $(MCPROTO)/illumos.mancheck.conf

$(BOOT_MPROTO)/illumos.manifest: projects/illumos/manifest | $(BOOT_MPROTO)
	cp projects/illumos/boot.manifest $(BOOT_MPROTO)/illumos.manifest

$(MPROTO)/illumos-extra.manifest: 0-extra-stamp \
    projects/illumos-extra/manifest | $(MPROTO)
	gmake DESTDIR=$(MPROTO) DESTNAME=illumos-extra.manifest \
	    -C projects/illumos-extra manifest; \

$(MCPROTO)/illumos-extra.mancheck.conf: FRC | 0-extra-stamp $(MCPROTO)
	gmake DESTDIR=$(MCPROTO) DESTNAME=illumos-extra.mancheck.conf \
	    -C projects/illumos-extra mancheck_conf; \

$(MPROTO)/%.sd.manifest: projects/local/%/Makefile projects/local/%/manifest
	cd $(ROOT)/projects/local/$* && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake DESTDIR=$(MPROTO) DESTNAME=$*.sd.manifest \
		    -f Makefile.joyent manifest; \
	    else \
		gmake DESTDIR=$(MPROTO) DESTNAME=$*.sd.manifest \
		    manifest; \
	    fi

$(MCPROTO)/%.sd.mancheck.conf: FRC | $(MCPROTO)
	cd $(ROOT)/projects/local/$* && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake DESTDIR=$(MCPROTO) DESTNAME=$*.sd.mancheck.conf \
		    -f Makefile.joyent mancheck_conf; \
	    else \
		gmake DESTDIR=$(MCPROTO) DESTNAME=$*.sd.mancheck.conf \
		    mancheck_conf; \
	    fi

$(MPROTO)/%.ov.manifest: $(MPROTO) $(ROOT)/overlay/%/manifest
	cp $(ROOT)/overlay/$*/manifest $@

$(MCPROTO)/%.ov.mancheck.conf: $(ROOT)/overlay/%/mancheck.conf | $(MCPROTO)
	cp $(ROOT)/overlay/$*/mancheck.conf $@

$(MANIFEST): $(WORLD_MANIFESTS) $(SUBDIR_MANIFESTS) $(OVERLAY_MANIFESTS)
	-rm -f $@
	./tools/build_manifest $(MPROTO) | ./tools/sorter > $@

$(BOOT_MANIFEST): $(BOOT_MANIFESTS)
	-rm -f $@
	./tools/build_manifest $(BOOT_MPROTO) | ./tools/sorter > $@

#
# Update source code from parent repositories.  We do this for each local
# project as well as for illumos, illumos-extra, and smartos-live via the
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

0-illumos-stamp: 0-strap-stamp
	@if [[ "$(ILLUMOS_CLOBBER)" = "yes" ]]; then \
		(cd $(ROOT) && MAX_JOBS=$(MAX_JOBS) ./tools/clobber_illumos) \
	fi
	(cd $(ROOT) && MAX_JOBS=$(MAX_JOBS) ./tools/build_illumos)
	touch $@

FORCEARG_yes=-f

# build our proto.strap area
0-strap-stamp:
	$(ROOT)/tools/build_strap -j $(MAX_JOBS) -d $(STRAP_PROTO) \
	    -a $(ADJUNCT_TARBALL) $(FORCEARG_$(FORCE_STRAP_REBUILD))
	touch $@

# report the Manta location of the proto.strap cache
strap-cache-location:
	@$(ROOT)/tools/build_strap -l

# build a proto.strap cache tarball
strap-cache:
	$(ROOT)/tools/build_strap -c -j $(MAX_JOBS) -a $(ADJUNCT_TARBALL)

# additional illumos-extra content for proto itself
0-extra-stamp: 0-illumos-stamp
	(cd $(ROOT)/projects/illumos-extra && \
	    gmake $(SUBDIR_DEFS) DESTDIR=$(PROTO) \
	    install)
	touch $@

0-livesrc-stamp: 0-illumos-stamp 0-strap-stamp 0-extra-stamp
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

$(MANCF_FILE): $(MANCF) $(MANIFEST)
	@rm -f $@
	$(MANCF) -t -f $(MANIFEST) > $@

.PHONY: $(MANCF)
$(MANCF): 0-illumos-stamp
	(cd tools/mancf && gmake mancf CC=$(NATIVE_CC) $(SUBDIR_DEFS))

.PHONY: $(MANCHECK)
$(MANCHECK): 0-illumos-stamp
	(cd tools/mancheck && gmake mancheck CC=$(NATIVE_CC) $(SUBDIR_DEFS))

.PHONY: $(TZCHECK)
$(TZCHECK): 0-illumos-stamp
	(cd tools/tzcheck && gmake tzcheck CC=$(NATIVE_CC) $(SUBDIR_DEFS))

.PHONY: $(UCODECHECK)
$(UCODECHECK): 0-illumos-stamp
	(cd tools/ucodecheck && gmake ucodecheck CC=$(NATIVE_CC) $(SUBDIR_DEFS))

.PHONY: sdcman
sdcman:
	(cd $(ROOT)/man/sdc && gmake install DESTDIR=$(PROTO) $(SUBDIR_DEFS))

jsl: $(JSLINT)

$(JSLINT):
	@(cd $(ROOT)/tools/javascriptlint; make CC=$(NATIVE_CC) install)

check: $(JSLINT)
	@(cd $(ROOT)/src && make check)

clean:
	./tools/clobber_illumos
	rm -f $(MANIFEST) $(BOOT_MANIFEST)
	rm -rf $(MPROTO)/* $(BOOT_MPROTO)/* $(MCPROTO)/*
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
	(cd $(ROOT) && [ -h $(STRAP_PROTO) ] || rm -rf $(STRAP_PROTO))
	(cd $(ROOT) && pfexec rm -rf $(BOOT_PROTO))
	(cd $(ROOT) && pfexec rm -rf $(IMAGES_PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO) $(STRAP_PROTO) $(BOOT_PROTO) \
	    $(IMAGES_PROTO))
	rm -f tools/cryptpass
	(cd tools/mancheck && gmake clean)
	(cd tools/mancf && gmake clean)
	(cd tools/tzcheck && gmake clean)
	(cd man/sdc && gmake clean)
	rm -f 0-*-stamp 1-*-stamp

clobber: clean
	pfexec rm -rf output/* output-iso/* output-usb/*
 
iso: live
	./tools/build_iso

usb: live
	./tools/build_usb

FRC:

.PHONY: manifest mancheck_conf check jsl FRC
