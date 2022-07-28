#
# Copyright 2020 Joyent, Inc.
# Copyright 2022 MNX Cloud, Inc.
#

ROOT = $(PWD)/..
RONNJS = /opt/local/bin/node $(ROOT)/tools/ronnjs/bin/ronn.js
DESTDIR = $(ROOT)/proto

MAN_FILES = \
	smartdc/man/man1/pkgsrc-setup.1 \
	smartdc/man/man1/sdc-factoryreset.1 \
	smartdc/man/man1/sdc-lastcomm.1 \
	smartdc/man/man1/sdc-zfs-io-throttle.1 \
	usr/share/man/man1/bunzip2.1 \
	usr/share/man/man1/bzcat.1 \
	usr/share/man/man1/bzcmp.1 \
	usr/share/man/man1/bzegrep.1 \
	usr/share/man/man1/bzfgrep.1 \
	usr/share/man/man1/bzip2recover.1 \
	usr/share/man/man1/bzless.1 \
	usr/share/man/man1/gzcat.1 \
	usr/share/man/man1/gzcmp.1 \
	usr/share/man/man1/gzegrep.1 \
	usr/share/man/man1/gzfgrep.1 \
	usr/share/man/man1/json.1 \
	usr/share/man/man7/fwrule.7 \
	usr/share/man/man7/joyent.7 \
	usr/share/man/man7/openssl.7 \
	usr/share/man/man8/disklayout.8 \
	usr/share/man/man8/fssstat.8 \
	usr/share/man/man8/fwadm.8 \
	usr/share/man/man8/imgadm.8 \
	usr/share/man/man8/mkzpool.8 \
	usr/share/man/man8/nictagadm.8 \
	usr/share/man/man8/piadm.8 \
	usr/share/man/man8/sysevent.8 \
	usr/share/man/man8/sysinfo.8 \
	usr/share/man/man8/vmadm.8 \
	usr/share/man/man8/vmadmd.8 \
	usr/share/man/man8/vminfo.8 \
	usr/share/man/man8/ziostat.8 \
	usr/share/man/man8/zonememstat.8 \
	usr/share/man/man8/zonemon.8

PROTO_FILES = $(MAN_FILES:%=$(DESTDIR)/%)

clean:

all:

install: $(PROTO_FILES)

$(DESTDIR)/%: %
	mkdir -p $(@D)
	rm -f $@
	cp $< $@
	touch $@

$(DESTDIR)/%: %.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man8/%: $(ROOT)/src/fw/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man7/%: $(ROOT)/src/fw/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man8/%: $(ROOT)/src/img/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man8/%: $(ROOT)/src/vm/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@
