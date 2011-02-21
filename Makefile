#
#
# CDDL HEADER START
#
# The contents of this file are subject to the terms of the
# Common Development and Distribution License, Version 1.0 only
# (the "License").  You may not use this file except in compliance
# with the License.
#
# You can obtain a copy of the license at COPYING
# See the License for the specific language governing permissions
# and limitations under the License.
#
# When distributing Covered Code, include this CDDL HEADER in each
# file and include the License file at COPYING.
# If applicable, add the following below this CDDL HEADER, with the
# fields enclosed by brackets "[]" replaced with your own identifying
# information: Portions Copyright [yyyy] [name of copyright owner]
#
# CDDL HEADER END
#
# Copyright (c) 2010,2011 Joyent Inc.
#

ROOT=$(PWD)
PROTO=$(ROOT)/proto
PATH=/opt/local/bin:/opt/local/sbin:/opt/local/gcc34/bin:/usr/xpg4/bin:/usr/bin:/usr/sbin:/usr/sfw/bin:/usr/openwin/bin:/opt/SUNWspro/bin:/usr/ccs/bin
LOCAL_SUBDIRS=""

world: 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp 0-local-stamp 0-tools-stamp

live: world
	mkdir -p ${ROOT}/log
	(cd $(ROOT) && pfexec ./tools/build_live $(ROOT)/manifest $(ROOT)/output $(ROOT)/overlay $(ROOT)/proto $(ROOT)/projects/opensolaris-man /)

update:
	@(git pull --rebase)
	@(cd projects/illumos; git pull --rebase || hg pull -u)
	@(cd projects/illumos-extra; git pull --rebase)
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do (cd projects/local/$${dir} && git pull --rebase); done

0-local-stamp:
	[ ! -d projects/local ] || for dir in $(LOCAL_SUBDIRS); do (cd projects/local/$${dir} && gmake && gmake DESTDIR=$(PROTO) install); done

0-illumos-stamp:
	(cd $(ROOT) && ./tools/build_illumos)
	touch 0-illumos-stamp

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extra && gmake DESTDIR=$(PROTO) && gmake DESTDIR=$(PROTO) install)
	touch 0-extra-stamp

0-livesrc-stamp: src/bootparams.c
	(cd $(ROOT)/src && gmake DESTDIR=$(PROTO) && gmake DESTDIR=$(PROTO) install)

0-tools-stamp: tools/builder/builder tools/pwgen tools/cryptpass

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
