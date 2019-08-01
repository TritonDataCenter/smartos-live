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

#
# We allow build.env not to exist in case build automation expects to run
# generic 'make check' actions without actually running ./configure in
# advance of a full build.
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

#
# deps/eng is a submodule that includes build tools, ensure it gets checked out
#
ENGBLD_REQUIRE := $(shell git submodule update --init deps/eng)

LOCAL_SUBDIRS :=	$(shell ls projects/local)
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

SUBDIR_DEFS = \
	CTFMERGE=$(CTFMERGE) \
	CTFCONVERT=$(CTFCONVERT) \
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

SUBDIR_MANCHECK_CONFS := \
	$(LOCAL_SUBDIRS:%=$(MCPROTO)/%.sd.mancheck.conf)

BOOT_VERSION :=	boot-$(shell [[ -f $(ROOT)/configure-buildver ]] && \
    echo $$(head -n1 $(ROOT)/configure-buildver)-)$(shell head -n1 $(STAMPFILE))
BOOT_TARBALL :=	output/$(BOOT_VERSION).tgz

IMAGES_VERSION :=	images-$(shell [[ -f $(ROOT)/configure-buildver ]] && \
    echo $$(head -n1 $(ROOT)/configure-buildver)-)$(shell head -n1 $(STAMPFILE))
IMAGES_TARBALL :=	output/$(IMAGES_VERSION).tgz

ifdef PLATFORM_PASSWORD
PLATFORM_PASSWORD_OPT=-p $(PLATFORM_PASSWORD)
endif

TOOLS_TARGETS = \
	$(MANCHECK) \
	$(MANCF) \
	$(TZCHECK) \
	$(UCODECHECK) \
	tools/cryptpass

world: 0-strap-stamp 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp \
	0-local-stamp 0-tools-stamp 0-man-stamp 0-devpro-stamp \
	$(TOOLS_TARGETS)

live: world manifest mancheck_conf boot $(TOOLS_TARGETS) $(MANCF_FILE)
	@echo $(SUBDIR_MANIFESTS)
	mkdir -p ${ROOT}/log
	CTFCONVERT=$(CTFCONVERT) ./tools/build_live \
	    -m $(ROOT)/$(MANIFEST) -o $(ROOT)/output $(PLATFORM_PASSWORD_OPT) \
	    $(ROOT)/proto $(ROOT)/man/man

boot: $(BOOT_TARBALL)

.PHONY: pkgsrc
pkgsrc:
	cd $(PKGSRC) && gmake install

$(BOOT_TARBALL): world manifest
	pfexec rm -rf $(BOOT_PROTO)
	mkdir -p $(BOOT_PROTO)/etc/version/
	mkdir -p $(ROOT)/output
	pfexec ./tools/builder/builder $(ROOT)/$(BOOT_MANIFEST) \
	    $(BOOT_PROTO) $(ROOT)/proto
	cp $(STAMPFILE) $(BOOT_PROTO)/etc/version/boot
	(cd $(BOOT_PROTO) && pfexec gtar czf $(ROOT)/$@ .)

#
# Create proforma images for use in assembling bootable USB device images.  The
# images tar file is used by "make coal" and "make usb" in "sdc-headnode.git"
# to create Triton boot and installation media.
#
$(IMAGES_PROTO)/4gb.img: boot
	rm -f $@
	mkdir -p $(IMAGES_PROTO)
	./tools/build_boot_image -p 4 -r $(ROOT)

$(IMAGES_TARBALL): $(IMAGES_PROTO)/4gb.img
	cd $(IMAGES_PROTO) && gtar -Scvz --owner=0 --group=0 -f $(ROOT)/$@ *

images-tar: $(IMAGES_TARBALL)

#
# Manifest construction.  There are 5 sources for manifests we need to collect
# in $(MPROTO) before running the manifest tool.  One each comes from
# illumos, illumos-extra, and the root of live (covering mainly what's in src).
# Additional manifests come from each of $(LOCAL_SUBDIRS), which may choose
# to construct them programmatically.
#
# These all end up in $(MPROTO), where we tell tools/build_manifest to look;
# it will pick up every file in that directory and treat it as a manifest.
#
# In addition, a separate manifest is generated in similar manner for the
# boot tarball.
#
# Look ma, no for loops in these shell fragments!
#
manifest: $(MANIFEST) $(BOOT_MANIFEST)

mancheck_conf: $(WORLD_MANCHECK_CONFS) $(SUBDIR_MANCHECK_CONFS)

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

$(MANIFEST): $(WORLD_MANIFESTS) $(SUBDIR_MANIFESTS)
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
	@echo "========== building $* =========="
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
	@echo "========== building src =========="
	(cd $(ROOT)/src && \
	    gmake -j$(MAX_JOBS) NATIVEDIR=$(STRAP_PROTO) \
	    DESTDIR=$(PROTO) && \
	    gmake NATIVEDIR=$(STRAP_PROTO) DESTDIR=$(PROTO) install)
	touch $@

0-man-stamp:
	(cd $(ROOT)/man/sdc && gmake install DESTDIR=$(PROTO) $(SUBDIR_DEFS))
	(cd $(ROOT)/man/src && gmake clean && gmake)
	touch $@

0-tools-stamp: 0-pwgen-stamp
	(cd $(ROOT)/tools/builder && gmake builder)
	(cd $(ROOT)/tools/format_image && gmake)
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
	(cd tools/builder && gmake clean)
	(cd tools/format_image && gmake clean)
	(cd tools/mancheck && gmake clean)
	(cd tools/mancf && gmake clean)
	(cd tools/tzcheck && gmake clean)
	(cd man/sdc && gmake clean)
	rm -f 0-*-stamp 1-*-stamp

clobber: clean
	pfexec rm -rf output/* output-iso/* output-usb/*

iso: live
	./tools/build_boot_image -I -r $(ROOT)

usb: live
	./tools/build_boot_image -r $(ROOT)

#
# Targets and macros to create Triton manifests and publish build artifacts.
#

#
# The build itself doesn't add debug suffixes to its outputs when running
# in the 'ILLUMOS_ENABLE_DEBUG=exclusive' (configure -d) mode, so the settings
# below add suffixes to the bits-dir copies of these files as appropriate.
# The 'PUB_' prefix below indicates published build artifacts.
#
ifeq ($(ILLUMOS_ENABLE_DEBUG),exclusive)
    PLATFORM_DEBUG_SUFFIX = -debug
endif

BUILD_NAME			?= platform

#
# Values specific to the 'platform' build.
#
PLATFORM_BITS_DIR		= $(ROOT)/output/bits/platform$(PLATFORM_DEBUG_SUFFIX)
PLATFORM_BRANCH ?= $(shell git symbolic-ref HEAD | awk -F/ '{print $$3}')

#
# PUB_BRANCH_DESC indicates the different 'projects' branches used by the build.
# Our shell script uniqifies the branches used, then emits a
# hyphen-separated string of 'projects' branches *other* than ones which
# match $PLATFORM_BRANCH (the branch of smartos-live.git itself).
# While this doesn't perfectly disambiguate builds from different branches,
# it is good enough for our needs.
#
PUB_BRANCH_DESC		= $(shell ./tools/projects_branch_desc $(PLATFORM_BRANCH))

PLATFORM_TIMESTAMP		= $(shell head -n1 $(STAMPFILE))
PLATFORM_STAMP			= $(PLATFORM_BRANCH)$(PUB_BRANCH_DESC)-$(PLATFORM_TIMESTAMP)

PLATFORM_TARBALL_BASE		= platform-$(PLATFORM_TIMESTAMP).tgz
PLATFORM_TARBALL		= output/$(PLATFORM_TARBALL_BASE)

PUB_IMAGES_BASE			= images$(PLATFORM_DEBUG_SUFFIX)-$(PLATFORM_STAMP).tgz
PUB_BOOT_BASE			= boot$(PLATFORM_DEBUG_SUFFIX)-$(PLATFORM_STAMP).tgz

PUB_PLATFORM_IMG_BASE		= platform$(PLATFORM_DEBUG_SUFFIX)-$(PLATFORM_STAMP).tgz
PUB_PLATFORM_MF_BASE		= platform$(PLATFORM_DEBUG_SUFFIX)-$(PLATFORM_STAMP).imgmanifest

PUB_PLATFORM_MF			= $(PLATFORM_BITS_DIR)/$(PUB_PLATFORM_MF_BASE)
PUB_PLATFORM_TARBALL		= $(PLATFORM_BITS_DIR)/$(PUB_PLATFORM_IMG_BASE)

PUB_IMAGES_TARBALL		= $(PLATFORM_BITS_DIR)/$(PUB_IMAGES_BASE)
PUB_BOOT_TARBALL		= $(PLATFORM_BITS_DIR)/$(PUB_BOOT_BASE)

PLATFORM_IMAGE_UUID		?= $(shell uuid -v4)

#
# platform-publish, platform-bits-upload and platform-bits-upload-latest
# are analogous to the 'publish', 'bits-upload' and 'bits-upload-latest'
# targets defined in the eng.git Makefile.defs and Makefile.targ files.
# Typically a user would 'make world && make live' before invoking any
# of these targets, though the '*-release' targets are likely more convenient.
# Those are not dependencies to allow more flexibility during the publication
# process.
#
# The platform-bits-publish|upload targets are also used for pushing
# SmartOS releases to Manta.
#


.PHONY: common-platform-publish
common-platform-publish:
	@echo "# Publish common platform$(PLATFORM_DEBUG_SUFFIX) bits"
	mkdir -p $(PLATFORM_BITS_DIR)
	cp $(PLATFORM_TARBALL) $(PUB_PLATFORM_TARBALL)
	for config_file in configure-projects configure-build; do \
	    if [[ -f $$config_file ]]; then \
	        cp $$config_file $(PLATFORM_BITS_DIR); \
	    fi; \
	done
	echo $(PLATFORM_STAMP) > latest-build-stamp
	./tools/build_changelog
	cp output/gitstatus.json $(PLATFORM_BITS_DIR)
	cp output/changelog.txt $(PLATFORM_BITS_DIR)

.PHONY: triton-platform-publish
triton-platform-publish: common-platform-publish
	@echo "# Publish Triton-specific platform$(PLATFORM_DEBUG_SUFFIX) bits"
	mkdir -p $(PLATFORM_BITS_DIR)
	cat src/platform.imgmanifest.in | sed \
	    -e "s/UUID/$(PLATFORM_IMAGE_UUID)/" \
	    -e "s/VERSION_STAMP/$(PLATFORM_STAMP)/" \
	    -e "s/BUILDSTAMP/$(PLATFORM_STAMP)/" \
	    -e "s/SIZE/$$(stat --printf="%s" $(PLATFORM_TARBALL))/" \
	    -e "s#SHA#$$(digest -a sha1 $(PLATFORM_TARBALL))#" \
	    > $(PUB_PLATFORM_MF)
	cp $(IMAGES_TARBALL) $(PUB_IMAGES_TARBALL)
	cp $(BOOT_TARBALL) $(PUB_BOOT_TARBALL)
	cd $(ROOT)/output/bits/platform$(PLATFORM_DEBUG_SUFFIX)
	rm -f platform$(PLATFORM_DEBUG_SUFFIX)-latest.imgmanifest
	ln -s $(PUB_PLATFORM_MF_BASE) \
	    platform$(PLATFORM_DEBUG_SUFFIX)-latest.imgmanifest

#
# The bits-upload.sh script in deps/eng is used to upload bits
# either to a Manta instance under $ENGBLD_DEST_OUT_PATH (requiring $MANTA_USER,
# $MANTA_KEY_ID and $MANTA_URL to be set in the environment, and
# $MANTA_TOOLS_PATH pointing to the manta-client tools scripts) or, with
# $ENGBLD_BITS_UPLOAD_LOCAL set to 'true', will upload to $ENGBLD_DEST_OUT_PATH
# on a local filesystem. If $ENGBLD_BITS_UPLOAD_IMGAPI is set in the environment
# it also publishes any images from the -D directory to updates.joyent.com.
#

ENGBLD_DEST_OUT_PATH ?=	/public/builds

ifeq ($(ENGBLD_BITS_UPLOAD_LOCAL), true)
BITS_UPLOAD_LOCAL_ARG = -L
else
BITS_UPLOAD_LOCAL_ARG =
endif

ifeq ($(ENGBLD_BITS_UPLOAD_IMGAPI), true)
BITS_UPLOAD_IMGAPI_ARG = -p
else
BITS_UPLOAD_IMGAPI_ARG =
endif

.PHONY: platform-bits-upload
platform-bits-upload:
	PATH=$(MANTA_TOOLS_PATH):$(PATH) \
	    $(ROOT)/deps/eng/tools/bits-upload.sh \
	        -b $(PLATFORM_BRANCH)$(PUB_BRANCH_DESC) \
	        $(BITS_UPLOAD_LOCAL_ARG) \
	        $(BITS_UPLOAD_IMGAPI_ARG) \
	        -D $(ROOT)/output/bits \
	        -d $(ENGBLD_DEST_OUT_PATH)/$(BUILD_NAME)$(PLATFORM_DEBUG_SUFFIX) \
	        -n $(BUILD_NAME)$(PLATFORM_DEBUG_SUFFIX) \
	        -t $(PLATFORM_STAMP)

#
# Clear TIMESTAMP due to TOOLS-2241, where bits-upload would otherwise interpret
# that environment variable as the '-t' option
#
.PHONY: platform-bits-upload-latest
platform-bits-upload-latest:
	PATH=$(MANTA_TOOLS_PATH):$(PATH) TIMESTAMP= \
	    $(ROOT)/deps/eng/tools/bits-upload.sh \
	        -b $(PLATFORM_BRANCH)$(PUB_BRANCH_DESC) \
	        $(BITS_UPLOAD_LOCAL_ARG) \
	        $(BITS_UPLOAD_IMGAPI_ARG) \
	        -D $(ROOT)/output/bits \
	        -d $(ENGBLD_DEST_OUT_PATH)/$(BUILD_NAME)$(PLATFORM_DEBUG_SUFFIX) \
	        -n $(BUILD_NAME)$(PLATFORM_DEBUG_SUFFIX)

#
# A wrapper to build the additional components that a standard
# SmartOS release needs.
#
.PHONY: smartos-build
smartos-build:
	./tools/build_boot_image -I -r $(ROOT)
	./tools/build_boot_image -r $(ROOT)
	./tools/build_vmware -r $(ROOT)

.PHONY: smartos-publish
smartos-publish:
	@echo "# Publish SmartOS platform $(PLATFORM_TIMESTAMP) images"
	mkdir -p $(PLATFORM_BITS_DIR)
	cp output/platform-$(PLATFORM_TIMESTAMP)/root.password \
	    $(PLATFORM_BITS_DIR)/SINGLE_USER_ROOT_PASSWORD.txt
	cp output-iso/platform-$(PLATFORM_TIMESTAMP).iso \
	    $(PLATFORM_BITS_DIR)/smartos-$(PLATFORM_TIMESTAMP).iso
	cp output-usb/platform-$(PLATFORM_TIMESTAMP).usb.gz \
	    $(PLATFORM_BITS_DIR)/smartos-$(PLATFORM_TIMESTAMP)-USB.img.gz
	cp output-vmware/smartos-$(PLATFORM_TIMESTAMP).vmwarevm.tar.gz \
		$(PLATFORM_BITS_DIR)
	(cd $(PLATFORM_BITS_DIR) && \
	    $(ROOT)/tools/smartos-index $(PLATFORM_TIMESTAMP) > index.html)
	(cd $(PLATFORM_BITS_DIR) && \
	    /usr/bin/sum -x md5 * > md5sums.txt)

#
# Define a series of phony targets that encapsulate a standard 'release' process
# for both SmartOS and Triton platform builds. These are a convenience to allow
# callers to invoke only two 'make' commands after './configure' has been run.
# We can't combine these because our stampfile likely doesn't exist at the point
# that the various build artifact Makefile macros are set, resulting in
# misnamed artifacts. Thus, expected usage is:
#
# ./configure
# make common-release; make triton-release
#  or
# make common-release; make triton-smartos-release
# or
# make common-release; make smartos-only-release
#
.PHONY: common-release
common-release: \
    check \
    live \
    pkgsrc

.PHONY: triton-release
triton-release: \
    images-tar \
    triton-platform-publish \
    platform-bits-upload

.PHONY: triton-smartos-release
triton-smartos-release: \
    images-tar \
    triton-platform-publish \
    smartos-build \
    smartos-publish \
    platform-bits-upload

.PHONY: smartos-only-release
smartos-only-release: \
    common-platform-publish \
    smartos-build \
    smartos-publish \
    platform-bits-upload

print-%:
	@echo '$*=$($*)'

FRC:

.PHONY: manifest mancheck_conf check jsl FRC
