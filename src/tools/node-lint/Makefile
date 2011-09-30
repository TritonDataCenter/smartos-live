PACKAGE = node-lint
PACKAGE_BIN = node-lint
NODEJS = $(if $(shell test -f /usr/bin/nodejs && echo "true"),nodejs,node)

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
DATADIR ?= $(PREFIX)/share
MANDIR ?= $(PREFIX)/share/man
LIBDIR ?= $(PREFIX)/lib
ETCDIR ?= $(PREFIX)/etc
PACKAGEDATADIR ?= $(DATADIR)/$(PACKAGE)

BUILDDIR = dist

$(shell if [ ! -d $(BUILDDIR) ]; then mkdir $(BUILDDIR); fi)

DOCS = $(shell find doc -name '*.md' \
        |sed 's|.md|.1|g' \
        |sed 's|doc/|man1/|g' \
        )

all: build doc

build: stamp-build

stamp-build: lib bin etc
	touch $@;
	cp -R -t $(BUILDDIR) $^;
	perl -pi -e 's{^\s*LIB_PATH=.*?\n}{LIB_PATH="$(PACKAGEDATADIR)"\n}ms' $(BUILDDIR)/bin/node-lint
	perl -pi -e 's{^\s*export NODELINT_CONFIG_FILE=.*?\n}{export NODELINT_CONFIG_FILE="$(ETCDIR)/$(PACKAGE).conf"\n}ms' $(BUILDDIR)/bin/$(PACKAGE_BIN)

install: build doc
	install --directory $(PACKAGEDATADIR)
	cp -r -t $(PACKAGEDATADIR) $(BUILDDIR)/lib/*
	install --mode 0644 $(BUILDDIR)/etc/config.json $(ETCDIR)/$(PACKAGE).conf
	install --mode 0755 $(BUILDDIR)/bin/$(PACKAGE_BIN) $(BINDIR)/$(PACKAGE_BIN)
	install --directory $(MANDIR)/man1/
	cp -a man1/node-lint.1 $(MANDIR)/man1/

uninstall:
	rm -rf $(PACKAGEDATADIR) $(ETCDIR)/$(PACKAGE).conf $(BINDIR)/$(PACKAGE_BIN)
	rm -rf $(MANDIR)/man1/$(PACKAGE).1

clean:
	rm -rf $(BUILDDIR) stamp-build

doc: man1 $(DOCS)
	@true

man1:
	@if ! test -d man1 ; then mkdir -p man1 ; fi

# use `npm install ronn` for this to work.
man1/%.1: doc/%.md
	ronn --roff $< > $@

.PHONY: test install uninstall build all
