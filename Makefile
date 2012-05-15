#
# Copyright (c) 2012, Joyent, Inc.  All rights reserved.
#

ROOT =		$(PWD)
PROTO =		$(ROOT)/proto
STRAP_PROTO =	$(ROOT)/proto.strap
MPROTO =	$(ROOT)/manifest.d
PATH =		/usr/bin:/usr/sbin:/sbin:/opt/local/bin

LOCAL_SUBDIRS :=	$(shell ls projects/local)
OVERLAYS :=	$(shell cat overlay/order)
MANIFEST =	manifest.gen
JSSTYLE =	$(ROOT)/tools/jsstyle/jsstyle
JSLINT =	$(ROOT)/tools/javascriptlint/build/install/jsl
CSTYLE =	$(ROOT)/tools/cstyle

ADJUNCT_TARBALL :=	$(shell ls `pwd`/illumos-adjunct*.tgz 2>/dev/null \
	| tail -n1 && echo $?)

VMTESTS :=	$(ROOT)/src/vm/tests.tar.gz
BUILDSTAMP :=	$(ROOT)/proto/buildstamp

WORLD_MANIFESTS := \
	$(MPROTO)/illumos.manifest \
	$(MPROTO)/live.manifest \
	$(MPROTO)/illumos-extra.manifest

SUBDIR_MANIFESTS :=	$(LOCAL_SUBDIRS:%=$(MPROTO)/%.sd.manifest)
OVERLAY_MANIFESTS :=	$(OVERLAYS:$(ROOT)/overlay/%=$(MPROTO)/%.ov.manifest)

world: 0-extra-stamp 0-illumos-stamp 1-extra-stamp 0-livesrc-stamp \
	0-local-stamp 0-tools-stamp 0-man-stamp 0-devpro-stamp

live: world manifest
	@echo $(OVERLAY_MANIFESTS)
	@echo $(SUBDIR_MANIFESTS)
	mkdir -p ${ROOT}/log
	(cd $(ROOT) && \
	    pfexec ./tools/build_live $(ROOT)/$(MANIFEST) $(ROOT)/output \
	    $(OVERLAYS) $(ROOT)/proto $(ROOT)/man/man)
	if [[ -f $(VMTESTS) && -f $(BUILDSTAMP) ]]; then \
		pfexec cp $(VMTESTS) \
		    $(ROOT)/output/vmtests-$$(cat $(BUILDSTAMP)).tgz ; \
	fi

#
# Manifest construction.  There are 5 sources for manifests we need to collect
# in $(MPROTO) before running the manifest tool.  One each comes from
# illumos, illumos-extra, and the root of live (covering mainly what's in src).
# Additional manifests come from each of $(LOCAL_SUBDIRS), which may choose
# to construct them programmatically, and $(OVERLAYS), which must be static.
# These all end up in $(MPROTO), where we tell tools/build_manifest to look;
# it will pick up every file in that directory and treat it as a manifest.
#
# Look ma, no for loops in these shell fragments!
#
manifest: $(MANIFEST)

$(MPROTO):
	mkdir -p $(MPROTO)

$(MPROTO)/live.manifest: $(MPROTO) src/manifest
	cp src/manifest $(MPROTO)/live.manifest

$(MPROTO)/illumos.manifest: $(MPROTO) projects/illumos/manifest
	cp projects/illumos/manifest $(MPROTO)/illumos.manifest

$(MPROTO)/illumos-extra.manifest: $(MPROTO) 1-extra-stamp
	gmake DESTDIR=$(MPROTO) DESTNAME=illumos-extra.manifest \
	    -C projects/illumos-extra manifest; \

.PHONY: $(MPROTO)/%.sd.manifest
$(MPROTO)/%.sd.manifest:
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
	-rm -f $(MANIFEST)
	./tools/build_manifest
	./tools/sorter manifest.gen > manifest.gen.sorted && \
	    mv manifest.gen.sorted $@

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

0-subdir-%-stamp:
	cd "$(ROOT)/projects/local/$*" && \
	    if [[ -f Makefile.joyent ]]; then \
		gmake -f Makefile.joyent DESTDIR=$(PROTO) world install; \
	    else \
		gmake DESTDIR=$(PROTO) world install; \
	    fi
	touch $@

0-devpro-stamp:
	[ ! -d projects/devpro ] || \
	    (cd projects/devpro && gmake DESTDIR=$(PROTO) install)
	touch $@

0-illumos-stamp: 0-extra-stamp
	(cd $(ROOT) && ./tools/build_illumos)
	touch $@

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extra && \
	    gmake DESTDIR=$(STRAP_PROTO) install_strap)
	(cd $(STRAP_PROTO) && gtar xzf $(ADJUNCT_TARBALL))
	touch $@

1-extra-stamp: 0-illumos-stamp
	(cd $(ROOT)/projects/illumos-extra && \
	    gmake DESTDIR=$(PROTO) install)
	touch $@

0-livesrc-stamp: src/bootparams.c
	(cd $(ROOT)/src && \
	    gmake DESTDIR=$(PROTO) && \
	    gmake DESTDIR=$(PROTO) install)
	touch $@

0-man-stamp:
	(cd $(ROOT)/man/src && gmake clean && gmake)
	touch $@

0-tools-stamp: 0-builder-stamp 0-pwgen-stamp tools/cryptpass
	(cp ${ROOT}/tools/cryptpass $(PROTO)/usr/lib)
	touch $@

0-builder-stamp:
	(cd $(ROOT)/tools/builder && gmake builder)
	touch $@

0-pwgen-stamp:
	(cd ${ROOT}/tools/pwgen-* && autoconf && ./configure && \
	    make && cp pwgen ${ROOT}/tools)
	touch $@

tools/cryptpass: tools/cryptpass.c
	(cd ${ROOT}/tools && gcc -Wall -W -O2 -o cryptpass cryptpass.c)

jsl: $(JSLINT)

$(JSLINT):
	@(cd $(ROOT)/tools/javascriptlint; make CC=gcc install)

check: $(JSLINT)
	@(cd $(ROOT)/src && make check)

clean:
	rm -f $(MANIFEST)
	rm -rf $(ROOT)/$(MPROTO)/*
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
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && rm -rf $(STRAP_PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO) $(STRAP_PROTO))
	rm -f 0-*-stamp 1-*-stamp

.PHONY: manifest check jsl
