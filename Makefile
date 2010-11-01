# Copyright (c) 2010 Joyent Inc., All rights reserved.

ROOT:sh=pwd
PROTO=$(ROOT)/proto

world: 0-illumos-stamp 0-extra-stamp 0-livesrc-stamp

live: world
	(cd $(ROOT) && ./tools/build_live $(ROOT)/manifest)

0-illumos-stamp:
	(cd $(ROOT) && ./tools/build_illumos)
	touch 0-illumos-stamp

0-extra-stamp:
	(cd $(ROOT)/projects/illumos-extras && /usr/ccs/bin/make DESTDIR=$(PROTO) && /usr/ccs/bin/make DESTDIR=$(PROTO) install)
	touch 0-extra-stamp

0-livesrc-stamp: src/bootparams.c
	(cd $(ROOT)/src && /usr/ccs/bin/make DESTDIR=$(PROTO) && /usr/ccs/bin/make DESTDIR=$(PROTO) install)
	touch 0-livesrc-stamp

clean:
	(cd $(ROOT)/src && /usr/ccs/bin/make clean)
	(cd $(ROOT)/projects/illumos-extras && /usr/ccs/bin/make clean)
	(cd $(ROOT) && rm -rf $(PROTO))
	(cd $(ROOT) && mkdir -p $(PROTO))
	rm -f 0-*-stamp
