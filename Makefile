# Copyright (c) 2010 Joyent Inc., All rights reserved.

ROOT=$(PWD)
PROTO=$(ROOT)/proto
PATH=/opt/local/bin:/opt/local/sbin:/opt/local/gcc34/bin:/usr/xpg4/bin:/usr/bin:/usr/sbin:/usr/sfw/bin:/usr/openwin/bin:/opt/SUNWspro/bin:/usr/ccs/bin

world: 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp

live: world
	(cd $(ROOT) && ./tools/build_live $(ROOT)/manifest)

update:
	@(git pull --rebase)
	@(cd projects/illumos; git pull --rebase)
	@(cd projects/illumos-extras; git pull --rebase)

0-illumos-stamp:
	(cd $(ROOT) && ./tools/build_illumos)
	touch 0-illumos-stamp

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extras && gmake DESTDIR=$(PROTO) && gmake DESTDIR=$(PROTO) install)
	touch 0-extra-stamp

0-livesrc-stamp: src/bootparams.c
	(cd $(ROOT)/src && gmake DESTDIR=$(PROTO) && gmake DESTDIR=$(PROTO) install)
	touch 0-livesrc-stamp

clean:
	(cd $(ROOT)/src && gmake clean)
	(cd $(ROOT)/projects/illumos-extras && gmake clean)
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO))
	rm -f 0-*-stamp
