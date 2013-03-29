#
# Copyright (c) 2013, Joyent, Inc. All rights reserved.
#


#
# Directories
#
ROOT = $(PWD)/../..
TOP := $(shell pwd)
NM := node_modules
NM_ORIG := node_modules.orig
TEST_MODULES := test/node_modules


#
# Tools
#
NODEUNIT := $(TEST_MODULES)/nodeunit/bin/nodeunit
JSSTYLE =	$(ROOT)/tools/jsstyle/jsstyle
JSLINT =	$(ROOT)/tools/javascriptlint/build/install/jsl

#
# Files
#
JS_CHECK_TARGETS=\
	lib/*.js \
	lib/util/*.js \
	sbin/* \
	test/unit/*.js \
	test/integration/*.js \
	test/lib/*.js

#
# Tool options
#
JSSTYLE_OPTS = -o indent=2,strict-indent=1,doxygen,unparenthesized-return=0,continuation-at-front=1,leading-right-paren-ok=1

#
# Repo-specific targets
#
.PHONY: test
test:
	$(NODEUNIT) --reporter tap test/unit/*.js

.PHONY: teststop
teststop:
	@(for F in test/unit/*.js; do \
		echo "# $$F" ;\
		$(NODEUNIT) --reporter tap $$F ;\
		[[ $$? == "0" ]] || exit 1; \
	done)

# Create a node modules suitable for installing in the platform
$(NM):
	rm -rf $(NM)
	npm install
	rm -rf $(NM_ORIG)
	mv node_modules{,.orig}
	@mkdir $(NM)
	@cp $(NM_ORIG)/assert-plus/assert.js $(NM)/assert-plus.js
	@cp $(NM_ORIG)/node-uuid/uuid.js $(NM)/node-uuid.js
	@cp $(NM_ORIG)/mkdirp/index.js $(NM)/mkdirp.js
	@cp $(NM_ORIG)/extsprintf/lib/extsprintf.js \
		$(NM_ORIG)/verror/lib/verror.js \
		$(NM_ORIG)/vasync/lib/vasync.js \
		$(NM)/
	@mkdir $(NM)/clone
	@cp $(NM_ORIG)/clone/clone.js $(NM)/clone/index.js
	@cp $(NM_ORIG)/clone/{LICENSE,clonePrototype.js} $(NM)/clone/
	@mkdir $(NM)/fwrule
	@cp tools/fwrule/lib/* $(NM)/fwrule/
	@mkdir $(NM)/cmdln
	@cp $(NM_ORIG)/cmdln/lib/cmdln.js $(NM)/cmdln/index.js
	@cp $(NM_ORIG)/cmdln/LICENSE.txt $(NM)/cmdln/
	@mkdir $(NM)/dashdash
	@cp $(NM_ORIG)/cmdln/node_modules/dashdash/lib/dashdash.js $(NM)/dashdash/index.js
	@cp $(NM_ORIG)/cmdln/node_modules/dashdash/LICENSE.txt $(NM)/dashdash/LICENSE.txt

#
# Re-adding nodeunit and test-related source files
#
NODEUNIT_FILES = LICENSE bin index.js lib
TAP_FILES = LICENSE bin lib package.json
TAP_NM = $(NM_ORIG)/nodeunit/node_modules/tap/node_modules
# TAP dependencies that just have an index.js in their directory
TAP_IDX_MODS = buffer-equal deep-equal difflet
BUNKER = $(TAP_NM)/runforcover/node_modules/bunker
BURRITO = $(BUNKER)/node_modules/burrito

.PHONY: nodeunit
nodeunit:
	@rm -rf $(TEST_MODULES)
	@mkdir -p $(TEST_MODULES)/nodeunit/deps/ejs
	@(for F in $(NODEUNIT_FILES); do \
		cp -r $(NM_ORIG)/nodeunit/$$F $(TEST_MODULES)/nodeunit/; \
	done)
	@cp $(NM_ORIG)/nodeunit/deps/*.js $(TEST_MODULES)/nodeunit/deps
	@cp -r $(NM_ORIG)/nodeunit/deps/ejs/lib $(TEST_MODULES)/nodeunit/deps/ejs/lib
	@cp $(NM_ORIG)/nodeunit/deps/ejs/package.json $(TEST_MODULES)/nodeunit/deps/ejs/package.json
	@mkdir -p $(TEST_MODULES)/async
	@cp $(TEST_MODULES)/nodeunit/deps/async.js $(TEST_MODULES)/async/index.js
	@cp $(TEST_MODULES)/nodeunit/LICENSE $(TEST_MODULES)/async/
	@mkdir -p $(TEST_MODULES)/tap
	@(for F in $(TAP_FILES); do \
		cp -r $(NM_ORIG)/nodeunit/node_modules/tap/$$F $(TEST_MODULES)/tap/; \
	done)
	@(for D in $(TAP_IDX_MODS); do \
		cp -r $(TAP_NM)/$$D/index.js $(TEST_MODULES)/$$D.js; \
	done)
	@cp $(TAP_NM)/buffer-equal/index.js $(TEST_MODULES)/buffer-equal.js
	@mkdir -p $(TEST_MODULES)/charm
	@cp -r $(TAP_NM)/difflet/node_modules/charm/{index.js,lib} $(TEST_MODULES)/charm/
	@cp $(TAP_NM)/deep-equal/index.js $(TEST_MODULES)/deep-equal.js
	@mkdir -p $(TEST_MODULES)/inherits
	@cp $(TAP_NM)/inherits/inherits.js $(TEST_MODULES)/inherits/index.js
	@mkdir -p $(TEST_MODULES)/nopt
	@cp $(TAP_NM)/nopt/lib/nopt.js $(TEST_MODULES)/nopt/index.js
	@cp $(TAP_NM)/nopt/LICENSE $(TEST_MODULES)/nopt/
	@cp $(TAP_NM)/nopt/node_modules/abbrev/lib/abbrev.js $(TEST_MODULES)/
	@cp $(TAP_NM)/runforcover/index.js $(TEST_MODULES)/runforcover.js
	@cp $(BUNKER)/index.js $(TEST_MODULES)/bunker.js
	@mkdir -p $(TEST_MODULES)/traverse
	@cp $(TAP_NM)/difflet/node_modules/traverse/{index.js,LICENSE} $(TEST_MODULES)/traverse
	@mkdir -p $(TEST_MODULES)/burrito/node_modules/traverse
	@cp $(BURRITO)/index.js $(TEST_MODULES)/burrito/
	@cp $(BURRITO)/node_modules/traverse/{index.js,LICENSE} $(TEST_MODULES)/burrito/node_modules/traverse/
	@mkdir -p $(TEST_MODULES)/uglify-js
	@cp $(BURRITO)/node_modules/uglify-js/uglify-js.js $(TEST_MODULES)/uglify-js/index.js
	@cp -r $(BURRITO)/node_modules/uglify-js/lib $(TEST_MODULES)/uglify-js/
	@mkdir -p $(TEST_MODULES)/slide
	@cp -r $(TAP_NM)/slide/{lib,index.js} $(TEST_MODULES)/slide/
	@mkdir -p $(TEST_MODULES)/yamlish
	@cp $(TAP_NM)/yamlish/yamlish.js $(TEST_MODULES)/yamlish/index.js
	@cp $(TAP_NM)/yamlish/LICENSE $(TEST_MODULES)/yamlish/
	@mkdir -p $(TEST_MODULES)/mockery
	@cp $(NM_ORIG)/mockery/mockery.js $(TEST_MODULES)/mockery/index.js
	@cp $(NM_ORIG)/mockery/LICENSE $(TEST_MODULES)/mockery/


#
# check and related
#
check: $(JSLINT) jslint jsstyle

jslint:
	@printf "\n==> Running JavaScriptLint...\n"
	@$(JSLINT) --nologo --conf=$(TOP)/tools/jsl.node.conf \
	    $(JS_CHECK_TARGETS)

jsstyle:
	@printf "\n==> Running jsstyle...\n"
	@# jsstyle doesn't echo as it goes so we add an echo to each line below
	@(for file in $(JS_CHECK_TARGETS); do \
		echo $(PWD)/$$file; \
		$(JSSTYLE) $(JSSTYLE_OPTS) $$file; \
		[[ $$? == "0" ]] || exit 1; \
	done)
	@printf "\nJS style ok!\n"

$(JSLINT):
	(cd $(ROOT); $(MAKE) jsl)
