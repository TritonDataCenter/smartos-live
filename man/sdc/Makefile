#
# Copyright 2015 Joyent, Inc.
#

ROOT=$(PWD)
RONNJS=/opt/local/bin/node $(ROOT)/../../tools/ronnjs/bin/ronn.js

MAN1_PAGES = 					\
			sdc-factoryreset

MAN1_FILES =		$(MAN1_PAGES:%=%.1)

DESTDIR =		../../proto
PROTO_MAN1_DIR =	$(DESTDIR)/smartdc/man/man1
PROTO_MAN1_FILES =	$(MAN1_FILES:%=$(PROTO_MAN1_DIR)/%)

all: $(MAN1_FILES)

install: $(PROTO_MAN1_FILES)

$(PROTO_MAN1_DIR)/%: %
	mkdir -p $(@D)
	rm -f $@
	cp $< $@
	touch $@

%: %.md
	rm -f $@
	$(RONNJS) --roff $< > $@

clean:
	rm -f $(MAN1_FILES)
