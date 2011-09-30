# Copyright (c) 2010, 2011 Joyent Inc., All rights reserved.

ROOT=$(PWD)
PROTO=$(ROOT)/proto
PATH=/opt/local/bin:/opt/local/sbin:/opt/local/gcc34/bin:/usr/xpg4/bin:/usr/bin:/usr/sbin:/usr/sfw/bin:/usr/openwin/bin:/opt/SUNWspro/bin:/usr/ccs/bin
LOCAL_SUBDIRS:=$(shell ls projects/local)

world: 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp 0-local-stamp \
	0-tools-stamp 0-man-stamp 0-devpro-stamp

live: world
	(cd $(ROOT)/src_addon && gmake DESTDIR=$(PROTO) install)
	mkdir -p ${ROOT}/log
	(cd $(ROOT) && pfexec ./tools/build_live $(ROOT)/manifest $(ROOT)/output $(ROOT)/overlay $(ROOT)/proto $(ROOT)/man/)

update:
	./tools/update_base
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do \
	cd $(ROOT)/projects/local/$${dir}; \
	if [[ -f Makefile.joyent ]]; then \
	gmake -f Makefile.joyent update; else gmake update; fi; done


0-local-stamp:
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do \
	cd $(ROOT)/projects/local/$${dir}; \
	if [[ -f Makefile.joyent ]]; then \
	gmake -f Makefile.joyent world; else gmake world; fi; \
        gmake SMARTOS=true DESTDIR=$(PROTO) install; done

0-devpro-stamp:
	[ ! -d projects/devpro ] || \
	(cd projects/devpro && gmake DESTDIR=$(PROTO) install)

0-illumos-stamp:
	(cd $(ROOT) && ./tools/build_illumos)
	touch 0-illumos-stamp

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extra && gmake DESTDIR=$(PROTO) install)
	touch 0-extra-stamp

0-livesrc-stamp: src/bootparams.c
	(cd $(ROOT)/src && gmake DESTDIR=$(PROTO) && gmake DESTDIR=$(PROTO) install)

0-man-stamp:
	(cd $(ROOT)/man/src && gmake clean && gmake)

0-tools-stamp: 0-builder-stamp 0-pwgen-stamp tools/cryptpass
	(cp ${ROOT}/tools/cryptpass $(PROTO)/usr/lib)

0-builder-stamp:
	(cd $(ROOT)/tools/builder && gmake builder)

0-pwgen-stamp:
	(cd ${ROOT}/tools/pwgen-* && ./configure && make && cp pwgen ${ROOT}/tools)

tools/cryptpass: tools/cryptpass.c
	(cd ${ROOT}/tools && gcc -Wall -W -O2 -o cryptpass cryptpass.c)

clean:
	(cd $(ROOT)/src && gmake clean)
	[ ! -d $(ROOT)/projects/illumos-extra ] || (cd $(ROOT)/projects/illumos-extra && gmake clean)
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do \
	cd $(ROOT)/projects/local/$${dir}; \
	if [[ -f Makefile.joyent ]]; then \
	gmake -f Makefile.joyent clean; else gmake clean; fi; done
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO))
	rm -f 0-*-stamp
