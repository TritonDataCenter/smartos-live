#
# Copyright (c) 2011 Joyent Inc., All rights reserved.
#

#
# Use 'gmake'!
#
# To build man pages and test one use something like:
#
# gmake clean && gmake && man -T /usr/share/lib/tmac/ansun -M ../man zonestat
#

ROOT=$(PWD)
RONNJS=/opt/local/bin/node $(ROOT)/../../tools/ronnjs/bin/ronn.js
MANDIR=$(ROOT)/../man
OUTFILE=$(MANDIR)/man$(SECTION)/$(basename $< .md)
SECTION=$(shell basename $@ .roff | sed -e "s/.*\.//")

mds := $(subst .md,.roff,$(wildcard *.md))

all: $(mds)

$(mds): %.roff: %.md
	$(RONNJS) --build --roff $<
	mkdir -p $(shell dirname $(OUTFILE))
	mv $@ $(OUTFILE)

clean:
	rm -f *.roff
