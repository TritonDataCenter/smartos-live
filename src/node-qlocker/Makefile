#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2019 Joyent, Inc.
#

TOOLS =		deps/eng/tools
NPM =		npm
GIT =		git
JSL =		deps/javascriptlint/build/install/jsl
JSL_FLAGS =	--conf=$(TOOLS)/jsl.node.conf
JSSTYLE =	deps/jsstyle/jsstyle
JSSTYLE_FLAGS =	-f $(TOOLS)/jsstyle.conf -o indent=4

JS_FILES := index.js $(shell find lib test -name '*.js')

all: build check test
test: install

.PHONY: build install test
build install test:
	$(NPM) $@

.PHONY: check
check: $(TOOLS) $(JSL) $(JSSTYLE)
	$(JSL) $(JSL_FLAGS) $(JS_FILES)
	$(JSSTYLE) $(JSSTYLE_FLAGS) $(JS_FILES)

$(TOOLS):
	$(GIT) submodule update --init deps/eng

$(JSL):
	$(GIT) submodule update --init deps/javascriptlint
	cd deps/javascriptlint && $(MAKE) install

$(JSSTYLE):
	$(GIT) submodule update --init deps/jsstyle

clean:
	-rm -rf node_modules
