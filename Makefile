# Copyright (c) 2010, 2011 Joyent Inc., All rights reserved.

ROOT=$(PWD)
PROTO=$(ROOT)/proto
PATH=/opt/local/bin:/opt/local/sbin:/opt/local/gcc34/bin:/usr/xpg4/bin:/usr/bin:/usr/sbin:/usr/sfw/bin:/usr/openwin/bin:/opt/SUNWspro/bin:/usr/ccs/bin
LOCAL_SUBDIRS=ur-agent operator-toolkit

world: 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp 0-local-stamp \
	0-tools-stamp 0-man-stamp 0-devpro-stamp

live: world
	(cd $(ROOT)/src_addon && gmake DESTDIR=$(PROTO) install)
	mkdir -p ${ROOT}/log
	(cd $(ROOT) && pfexec ./tools/build_live $(ROOT)/manifest $(ROOT)/output $(ROOT)/overlay $(ROOT)/proto $(ROOT)/man/man)

update:
	@(git pull --rebase)
	@(cd projects/illumos; git pull --rebase)
	@(cd projects/illumos-extra; git pull --rebase)
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do (cd projects/local/$${dir} && gmake update); done

0-local-stamp:
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do (cd projects/local/$${dir} && gmake && gmake DESTDIR=$(PROTO) install); done

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

0-tools-stamp: tools/builder/builder tools/pwgen tools/cryptpass
	(cp ${ROOT}/tools/cryptpass $(PROTO)/usr/lib)

tools/builder/builder:
	(cd $(ROOT)/tools/builder && gmake builder)

tools/pwgen:
	(cd ${ROOT}/tools/pwgen-* && ./configure && make && cp pwgen ${ROOT}/tools)

tools/cryptpass: tools/cryptpass.c
	(cd ${ROOT}/tools && gcc -Wall -W -O2 -o cryptpass cryptpass.c)

clean:
	(cd $(ROOT)/src && gmake clean)
	(cd $(ROOT)/projects/illumos-extra && gmake clean)
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do (cd projects/local/$${dir} && gmake clean); done
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO))
	rm -f 0-*-stamp
