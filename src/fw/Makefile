#
# Copyright (c) 2019, Joyent, Inc. All rights reserved.
#


#
# Directories
#
ROOT = $(CURDIR)/../..
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
RAMSEY := tools/ramsey/bin/ramsey

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
MAN_CHECK_TARGETS=\
	man/fwadm.1m.md \
	man/fwrule.5.md

#
# Tool options
#
JSSTYLE_OPTS = -o indent=4,strict-indent=1,doxygen,unparenthesized-return=0,continuation-at-front=1,leading-right-paren-ok=1

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
	$(TOP)/tools/bin/rebuild-node-modules

.PHONY: man
man: man/fwadm.1m.md man/fwrule.5.md

man/fwadm.1m.md: man/fwadm.1m.md.in etc/examples/*
	$(RAMSEY) -d etc/examples man/fwadm.1m.md.in man/fwadm.1m.md

man/fwrule.5.md: man/fwrule.5.header tools/fwrule/docs/rules.md.in man/fwrule.5.footer
	@cat man/fwrule.5.header > $@
	$(RAMSEY) -p wrap=80 tools/fwrule/docs/rules.md.in | sed -e 's,^#,##,' -e 's,&lt;,<,g' | awk '/^## / { print toupper($$0); next } 1' >> $@
	@cat man/fwrule.5.footer >> $@


#
# check and related
#
check: $(JSLINT) jslint jsstyle mancheck

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

mancheck:
	@printf "\n==> Check man page line lengths...\n"
	@(for file in $(MAN_CHECK_TARGETS); do \
		echo $$file; \
		cat $$file | awk '{ if (length($0) > 80) { x = length($0); print $0 } } END { exit x }'; \
	done)
