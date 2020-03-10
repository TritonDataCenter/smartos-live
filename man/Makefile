#
# Copyright 2020 Joyent, Inc.
#

ROOT = $(PWD)/..
RONNJS = /opt/local/bin/node $(ROOT)/tools/ronnjs/bin/ronn.js
DESTDIR = $(ROOT)/proto

MAN_FILES = \
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
	usr/share/man/man1m/disklayout.1m \
	usr/share/man/man1m/fssstat.1m \
	usr/share/man/man1m/fwadm.1m \
	usr/share/man/man1m/imgadm.1m \
	usr/share/man/man1m/mkzpool.1m \
	usr/share/man/man1m/nictagadm.1m \
	usr/share/man/man1m/sysevent.1m \
	usr/share/man/man1m/sysinfo.1m \
	usr/share/man/man1m/vmadm.1m \
	usr/share/man/man1m/vmadmd.1m \
	usr/share/man/man1m/vminfo.1m \
	usr/share/man/man1m/ziostat.1m \
	usr/share/man/man1m/zonememstat.1m \
	usr/share/man/man1m/zonemon.1m \
	usr/share/man/man5/fwrule.5 \
	usr/share/man/man5/joyent.5 \
	usr/share/man/man5/openssl.5

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

$(DESTDIR)/usr/share/man/man1m/%: $(ROOT)/src/fw/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man5/%: $(ROOT)/src/fw/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man1m/%: $(ROOT)/src/img/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@

$(DESTDIR)/usr/share/man/man1m/%: $(ROOT)/src/vm/man/%.md
	mkdir -p $(@D)
	rm -f $@
	$(RONNJS) --roff $< > $@
